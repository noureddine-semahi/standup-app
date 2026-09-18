-- Glimpse sharing: connections (email request/accept), a manual per-day
-- publish flag on daily_plans, and reactions a viewer can leave on a
-- published day. See the approved plan for full rationale.

-- Connections: mutual, request/accept. Unique index (not a plain unique
-- constraint) prevents both A->B and B->A existing at once, keyed by the
-- unordered pair, while still allowing re-request after a decline.
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> recipient_id)
);
create unique index connections_unique_pair
  on public.connections (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
  where status <> 'declined';
create index connections_recipient_status_idx on public.connections (recipient_id, status);
create index connections_requester_status_idx on public.connections (requester_id, status);

alter table public.daily_plans add column if not exists published_at timestamptz;

create table public.glimpse_reactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  reaction text not null check (reaction in ('like','support','fire','clap')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, viewer_id, plan_date)
);
create index glimpse_reactions_owner_date_idx on public.glimpse_reactions (owner_id, plan_date);

-- RLS
alter table public.connections enable row level security;
create policy "connections_select_participant" on public.connections
  for select using (auth.uid() in (requester_id, recipient_id));
create policy "connections_insert_requester" on public.connections
  for insert with check (requester_id = auth.uid() and requester_id <> recipient_id);
create policy "connections_update_recipient_pending" on public.connections
  for update
  using (recipient_id = auth.uid() and status = 'pending')
  with check (recipient_id = auth.uid() and status in ('accepted','declined'));
create policy "connections_delete_participant" on public.connections
  for delete using (auth.uid() in (requester_id, recipient_id));

alter table public.glimpse_reactions enable row level security;
create policy "glimpse_reactions_select_participant" on public.glimpse_reactions
  for select using (owner_id = auth.uid() or viewer_id = auth.uid());
create policy "glimpse_reactions_insert_viewer" on public.glimpse_reactions
  for insert with check (
    viewer_id = auth.uid() and viewer_id <> owner_id
    and exists (select 1 from public.connections c where c.status = 'accepted'
      and ((c.requester_id = auth.uid() and c.recipient_id = owner_id)
        or (c.recipient_id = auth.uid() and c.requester_id = owner_id)))
    and exists (select 1 from public.daily_plans dp where dp.user_id = owner_id
      and dp.plan_date = glimpse_reactions.plan_date and dp.published_at is not null)
  );
create policy "glimpse_reactions_update_viewer" on public.glimpse_reactions
  for update using (viewer_id = auth.uid()) with check (viewer_id = auth.uid());
create policy "glimpse_reactions_delete_viewer" on public.glimpse_reactions
  for delete using (viewer_id = auth.uid());

-- No new daily_plans/goals SELECT policy: a viewer never reads those tables
-- directly, only through get_published_glimpse below, so there's exactly
-- one authorization path to audit instead of two that must stay in sync.

create or replace function public.find_user_by_email(p_email text)
returns table(id uuid, display_name text)
language sql security definer set search_path = public stable
as $$
  select p.id, p.display_name
  from auth.users u join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email)) and u.id <> auth.uid()
  limit 1;
$$;
revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

create or replace function public.get_published_glimpse(p_owner_id uuid, p_plan_date date)
returns table(goal_id uuid, title text, priority int, status text, is_all_day boolean, time_of_day text)
language plpgsql security definer set search_path = public stable
as $$
declare v_plan_id uuid;
begin
  if not exists (select 1 from public.connections c where c.status = 'accepted'
    and ((c.requester_id = auth.uid() and c.recipient_id = p_owner_id)
      or (c.recipient_id = auth.uid() and c.requester_id = p_owner_id))) then
    return;
  end if;
  select id into v_plan_id from public.daily_plans
    where user_id = p_owner_id and plan_date = p_plan_date and published_at is not null;
  if v_plan_id is null then return; end if;
  return query select g.id, g.title, g.priority, g.status, g.is_all_day, g.time_of_day
    from public.goals g where g.plan_id = v_plan_id order by g.sort_order asc;
end; $$;
revoke all on function public.get_published_glimpse(uuid, date) from public;
grant execute on function public.get_published_glimpse(uuid, date) to authenticated;
