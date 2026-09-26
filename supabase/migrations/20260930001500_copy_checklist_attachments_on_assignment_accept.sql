-- Bugfix: assigning a goal that has a checklist or file attachment
-- silently dropped both once the recipient accepted -- respond_to_goal_
-- assignment only ever snapshotted title/details/priority onto
-- goal_assignments itself, never touched goal_checklist_items/
-- goal_attachments at all.
--
-- Checklist items are a plain copy (text rows, no storage involved) --
-- copied with a fresh, unchecked state, since the recipient is starting
-- their own execution of the goal, not inheriting the assigner's
-- progress on it.
--
-- Attachments are trickier: the underlying file lives in a private
-- bucket keyed by the UPLOADER's user-id folder (see goal_attachments'
-- own storage policies), so a recipient can't read the original file
-- just by getting a copied metadata row -- their own auth.uid() doesn't
-- match that folder. Rather than re-uploading/duplicating the file
-- (this app has no service-role key / server-side storage access to do
-- a byte-for-byte copy -- see supabase_sql_workflow), the fix mirrors
-- this app's established "extend visibility, don't duplicate data"
-- pattern (post sharing, individual post visibility, post-images'
-- can_view_post-gated storage read): copy the metadata row only, and add
-- a second, additive storage SELECT policy granting read access whenever
-- a goal_attachments row the CALLER owns references that exact path.
--
-- This makes respond_to_goal_assignment's cross-user reads of the
-- ASSIGNER's checklist/attachment rows necessary, so the function flips
-- from security invoker to security definer -- safe because every id it
-- touches from that point on (assigner_goal_id) comes from the already-
-- validated goal_assignments row (recipient_id = auth.uid() and status =
-- 'pending', checked explicitly at the top), never arbitrary client
-- input -- the same justification get_my_goal_assignments/can_view_post
-- already rely on for their own cross-user reads.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create or replace function public.respond_to_goal_assignment(p_assignment_id uuid, p_accept boolean)
returns public.goal_assignments
language plpgsql security definer set search_path = public
as $$
declare
  v_assignment public.goal_assignments;
  v_plan_id uuid;
  v_next_sort integer;
  v_new_goal_id uuid;
begin
  select * into v_assignment from public.goal_assignments
    where id = p_assignment_id and recipient_id = auth.uid() and status = 'pending'
    for update;

  if v_assignment.id is null then
    raise exception 'Pending assignment % not found for this user', p_assignment_id;
  end if;

  if not p_accept then
    update public.goal_assignments
      set status = 'declined', responded_at = now()
      where id = p_assignment_id
      returning * into v_assignment;
    return v_assignment;
  end if;

  -- Get-or-create the recipient's own plan for this date -- same
  -- unique(user_id, plan_date) constraint getOrCreatePlan() relies on
  -- client-side.
  select id into v_plan_id from public.daily_plans
    where user_id = auth.uid() and plan_date = v_assignment.plan_date;

  if v_plan_id is null then
    insert into public.daily_plans (user_id, plan_date)
      values (auth.uid(), v_assignment.plan_date)
      on conflict (user_id, plan_date) do nothing
      returning id into v_plan_id;
    if v_plan_id is null then
      select id into v_plan_id from public.daily_plans
        where user_id = auth.uid() and plan_date = v_assignment.plan_date;
    end if;
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort
    from public.goals where plan_id = v_plan_id;

  insert into public.goals (user_id, plan_id, title, details, status, sort_order, priority)
    values (auth.uid(), v_plan_id, v_assignment.snapshot_title, v_assignment.snapshot_details,
            'not_started', v_next_sort, v_assignment.snapshot_priority)
    returning id into v_new_goal_id;

  -- Carry the checklist and attachments over from the assigner's
  -- original goal, if it still exists -- assigner_goal_id is SET NULL if
  -- they later deleted/rescheduled it, in which case there's nothing to
  -- copy and the recipient just gets the bare snapshot as before.
  if v_assignment.assigner_goal_id is not null then
    insert into public.goal_checklist_items (user_id, goal_id, text, is_checked, position)
      select auth.uid(), v_new_goal_id, text, false, position
      from public.goal_checklist_items
      where goal_id = v_assignment.assigner_goal_id;

    insert into public.goal_attachments (user_id, goal_id, storage_path, file_name, mime_type, size_bytes)
      select auth.uid(), v_new_goal_id, storage_path, file_name, mime_type, size_bytes
      from public.goal_attachments
      where goal_id = v_assignment.assigner_goal_id;
  end if;

  update public.goal_assignments
    set status = 'accepted', responded_at = now(), recipient_goal_id = v_new_goal_id
    where id = p_assignment_id
    returning * into v_assignment;

  return v_assignment;
end;
$$;
revoke all on function public.respond_to_goal_assignment(uuid, boolean) from public;
grant execute on function public.respond_to_goal_assignment(uuid, boolean) to authenticated;

-- Second, additive PERMISSIVE select policy (Postgres ORs multiple
-- permissive policies for the same command) -- the original folder-based
-- policy is untouched, so nothing about the uploader's own access
-- changes. This is what actually makes the copied attachment row above
-- openable: without it, the recipient's own goal_attachments row would
-- exist but getAttachmentUrl() would 403 since the file still physically
-- lives under the assigner's folder.
create policy "goal_attachments_storage_select_via_row"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'goal-attachments'
    and exists (
      select 1 from public.goal_attachments ga
      where ga.storage_path = storage.objects.name and ga.user_id = auth.uid()
    )
  );

-- deleteGoalAttachment's "is this file still referenced by another row"
-- check was a plain RLS-scoped select, which only ever saw the CALLING
-- user's own goal_attachments rows -- harmless while every reference to
-- a given storage_path belonged to one user (the reschedule case this
-- check was written for), but an assignment-accept can now create a
-- second owner for the same path, so that check needs to see across
-- users or a shared file could be deleted out from under whichever party
-- didn't happen to be the one calling delete.
create or replace function public.is_attachment_path_referenced(p_storage_path text)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (select 1 from public.goal_attachments where storage_path = p_storage_path);
$$;
revoke all on function public.is_attachment_path_referenced(text) from public;
grant execute on function public.is_attachment_path_referenced(text) to authenticated;
