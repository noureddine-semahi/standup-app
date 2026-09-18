-- Adds an "everyone" visibility tier alongside the existing connections-only
-- glimpse sharing, and fixes a pre-existing bug: the original
-- glimpse_reactions_insert_viewer policy's EXISTS check on daily_plans was
-- evaluated under the viewer's own RLS, which already restricts daily_plans
-- to auth.uid() = user_id -- so it could never see the owner's row, and no
-- reaction has ever actually been insertable. Fixed here via a SECURITY
-- DEFINER helper, the same pattern already used by get_published_glimpse
-- and find_user_by_email to safely cross an RLS boundary.

alter table public.daily_plans
  add column if not exists published_visibility text
  check (published_visibility in ('connections','everyone'));

-- Keeps the two columns from ever desyncing -- publish always sets both,
-- unpublish always clears both.
alter table public.daily_plans
  add constraint daily_plans_publish_pair_check
  check ((published_at is null) = (published_visibility is null));

create or replace function public.plan_glimpse_visible_to(p_owner_id uuid, p_plan_date date)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.daily_plans dp
    where dp.user_id = p_owner_id
      and dp.plan_date = p_plan_date
      and dp.published_at is not null
      and (
        dp.published_visibility = 'everyone'
        or exists (
          select 1 from public.connections c
          where c.status = 'accepted'
            and ((c.requester_id = auth.uid() and c.recipient_id = p_owner_id)
              or (c.recipient_id = auth.uid() and c.requester_id = p_owner_id))
        )
      )
  );
$$;
revoke all on function public.plan_glimpse_visible_to(uuid, date) from public;
grant execute on function public.plan_glimpse_visible_to(uuid, date) to authenticated;

drop policy "glimpse_reactions_insert_viewer" on public.glimpse_reactions;
create policy "glimpse_reactions_insert_viewer" on public.glimpse_reactions
  for insert with check (
    viewer_id = auth.uid()
    and viewer_id <> owner_id
    and public.plan_glimpse_visible_to(owner_id, plan_date)
  );

-- Supports get_public_feed's ordering/filtering without a full table scan.
create index if not exists idx_daily_plans_public_feed
  on public.daily_plans (plan_date, published_at desc)
  where published_visibility = 'everyone';

-- Unlike get_published_glimpse (single owner, connection-gated, called once
-- per already-known connection), the public feed doesn't know in advance
-- who posted -- one call returns every public post for a date. Capped by
-- owner count (most-recently-published first) since this is an uncapped
-- public read with no per-caller connection gate, unlike the connections
-- path -- a small app today, but no reason to ship an unbounded query.
create or replace function public.get_public_feed(p_plan_date date, p_max_owners int default 100)
returns table(owner_id uuid, display_name text, goal_id uuid, title text, priority int, status text, is_all_day boolean, time_of_day text)
language sql security definer set search_path = public stable
as $$
  with capped_owners as (
    select dp.id as plan_id, dp.user_id
    from public.daily_plans dp
    where dp.plan_date = p_plan_date
      and dp.published_at is not null
      and dp.published_visibility = 'everyone'
      and dp.user_id <> auth.uid()
    order by dp.published_at desc
    limit p_max_owners
  )
  select co.user_id, p.display_name, g.id, g.title, g.priority, g.status, g.is_all_day, g.time_of_day
  from capped_owners co
  join public.goals g on g.plan_id = co.plan_id
  join public.profiles p on p.id = co.user_id
  order by co.user_id, g.sort_order asc;
$$;
revoke all on function public.get_public_feed(date, int) from public;
grant execute on function public.get_public_feed(date, int) to authenticated;
