-- Unifies today's earlier glimpse-sharing tables into one generic "posts"
-- feed covering three content types: goal_glimpse (daily progress, same
-- content as before), achievement (auto-posted on unlock), and
-- motivational (freeform text a user writes). Supersedes glimpse_reactions,
-- daily_plans.published_at/published_visibility, and the
-- get_published_glimpse/get_public_feed/plan_glimpse_visible_to functions
-- shipped in the two migrations earlier today.
--
-- Dropping glimpse_reactions and the published_at/published_visibility
-- columns discards any glimpse/reaction data created while testing those
-- earlier today -- expected and fine, this is same-day pre-production
-- testing, not real user data.

drop function if exists public.get_published_glimpse(uuid, date);
drop function if exists public.get_public_feed(date, int);
drop function if exists public.plan_glimpse_visible_to(uuid, date);
drop table if exists public.glimpse_reactions cascade;
alter table public.daily_plans drop constraint if exists daily_plans_publish_pair_check;
alter table public.daily_plans drop column if exists published_at;
alter table public.daily_plans drop column if exists published_visibility;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('goal_glimpse','achievement','motivational')),
  visibility text not null check (visibility in ('connections','everyone')),
  created_at timestamptz not null default now(),
  -- goal_glimpse payload -- plan_id stored directly so get_feed never has
  -- to join through daily_plans (whose own RLS is owner-only and would
  -- silently hide the row from anyone else, the same bug class fixed
  -- earlier today) just to resolve which goals belong to this post.
  plan_id uuid references public.daily_plans(id) on delete cascade,
  plan_date date,
  -- achievement payload -- just the id; titleKey/descriptionKey/icon are
  -- resolved client-side from src/lib/achievements.ts's ACHIEVEMENTS array
  -- (translation keys can't be resolved server-side anyway).
  achievement_id text,
  -- motivational payload
  body text,
  check (
    (type = 'goal_glimpse' and plan_id is not null and plan_date is not null and achievement_id is null and body is null)
    or (type = 'achievement' and achievement_id is not null and plan_id is null and plan_date is null and body is null)
    or (type = 'motivational' and body is not null and plan_id is null and plan_date is null and achievement_id is null)
  )
);
-- Re-publishing the same day updates in place rather than duplicating;
-- the unique index also IS the auto-post idempotency guarantee for
-- achievements -- no separate "already posted" tracking table needed.
create unique index posts_one_glimpse_per_day on public.posts (user_id, plan_date) where type = 'goal_glimpse';
create unique index posts_one_per_achievement on public.posts (user_id, achievement_id) where type = 'achievement';
create index posts_feed_idx on public.posts (created_at desc);

alter table public.posts enable row level security;
create policy "posts_select_visible" on public.posts
  for select using (
    user_id = auth.uid()
    or visibility = 'everyone'
    or (visibility = 'connections' and exists (
      select 1 from public.connections c where c.status = 'accepted'
        and ((c.requester_id = auth.uid() and c.recipient_id = posts.user_id)
          or (c.recipient_id = auth.uid() and c.requester_id = posts.user_id))
    ))
  );
create policy "posts_insert_own" on public.posts for insert with check (user_id = auth.uid());
create policy "posts_update_own" on public.posts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "posts_delete_own" on public.posts for delete using (user_id = auth.uid());

create table public.post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('like','support','fire','clap')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, viewer_id)
);
create index post_reactions_post_idx on public.post_reactions (post_id);

alter table public.post_reactions enable row level security;
-- Safe as plain RLS (not a bypass function): the owner-of-the-post check
-- resolves through posts_select_visible's own `user_id = auth.uid()`
-- clause, which is always true for the true owner -- no cross-user read
-- of an owner-restricted table is happening here.
create policy "post_reactions_select_participant" on public.post_reactions
  for select using (
    viewer_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_reactions.post_id and p.user_id = auth.uid())
  );
-- All writes go through set_post_reaction() below instead of direct
-- insert/update/delete policies -- one audited place doing the "is this
-- post actually visible to this viewer" check, rather than re-deriving
-- that logic in a second RLS policy the way today's bug happened.

create or replace function public.set_post_reaction(p_post_id uuid, p_reaction text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_visible boolean;
begin
  select user_id into v_owner from public.posts where id = p_post_id;
  if v_owner is null then raise exception 'post not found'; end if;
  if v_owner = auth.uid() then raise exception 'cannot react to your own post'; end if;

  select exists(
    select 1 from public.posts p where p.id = p_post_id and (
      p.visibility = 'everyone'
      or exists (select 1 from public.connections c where c.status = 'accepted'
        and ((c.requester_id = auth.uid() and c.recipient_id = p.user_id)
          or (c.recipient_id = auth.uid() and c.requester_id = p.user_id)))
    )
  ) into v_visible;
  if not v_visible then raise exception 'post not visible'; end if;

  if p_reaction is null then
    delete from public.post_reactions where post_id = p_post_id and viewer_id = auth.uid();
  else
    if p_reaction not in ('like','support','fire','clap') then raise exception 'invalid reaction'; end if;
    insert into public.post_reactions (post_id, viewer_id, reaction, updated_at)
      values (p_post_id, auth.uid(), p_reaction, now())
      on conflict (post_id, viewer_id) do update set reaction = excluded.reaction, updated_at = now();
  end if;
end; $$;
revoke all on function public.set_post_reaction(uuid, text) from public;
grant execute on function public.set_post_reaction(uuid, text) to authenticated;

-- One call renders the whole feed: visibility-filtered posts, author name,
-- the caller's own reaction, and (for goal_glimpse posts) the live current
-- goal list -- not a snapshot, so progress updates as the owner works
-- through their day, matching today's earlier behavior via
-- get_published_glimpse.
create or replace function public.get_feed(p_limit int default 30, p_before timestamptz default null)
returns table(
  post_id uuid, user_id uuid, display_name text, avatar_url text, type text, visibility text, created_at timestamptz,
  plan_date date, achievement_id text, body text, my_reaction text, goals jsonb
)
language plpgsql security definer set search_path = public stable
as $$
begin
  return query
  select p.id, p.user_id, pr.display_name, pr.avatar_url, p.type, p.visibility, p.created_at, p.plan_date, p.achievement_id, p.body,
    (select rx.reaction from public.post_reactions rx where rx.post_id = p.id and rx.viewer_id = auth.uid()),
    case when p.type = 'goal_glimpse' then (
      select jsonb_agg(jsonb_build_object(
        'goal_id', g.id, 'title', g.title, 'priority', g.priority,
        'status', g.status, 'is_all_day', g.is_all_day, 'time_of_day', g.time_of_day
      ) order by g.sort_order)
      from public.goals g where g.plan_id = p.plan_id
    ) else null end
  from public.posts p
  join public.profiles pr on pr.id = p.user_id
  where (p_before is null or p.created_at < p_before)
    and (
      p.user_id = auth.uid()
      or p.visibility = 'everyone'
      or (p.visibility = 'connections' and exists (
        select 1 from public.connections c where c.status = 'accepted'
          and ((c.requester_id = auth.uid() and c.recipient_id = p.user_id)
            or (c.recipient_id = auth.uid() and c.requester_id = p.user_id))
      ))
    )
  order by p.created_at desc
  limit p_limit;
end; $$;
revoke all on function public.get_feed(int, timestamptz) from public;
grant execute on function public.get_feed(int, timestamptz) to authenticated;

-- PostgREST's upsert onConflict only supplies a column list, which can't
-- target a *partial* unique index (posts_one_glimpse_per_day requires
-- `where type = 'goal_glimpse'` in the ON CONFLICT clause itself, which
-- the JS client has no way to pass) -- a plain client-side .upsert() call
-- would fail at runtime. security invoker, not definer: no RLS bypass
-- needed since the row being written is always the caller's own, which
-- posts_insert_own/posts_update_own already permit.
create or replace function public.upsert_daily_glimpse(p_plan_id uuid, p_plan_date date, p_visibility text)
returns public.posts
language plpgsql security invoker set search_path = public
as $$
declare v_row public.posts;
begin
  insert into public.posts (user_id, type, plan_id, plan_date, visibility)
  values (auth.uid(), 'goal_glimpse', p_plan_id, p_plan_date, p_visibility)
  on conflict (user_id, plan_date) where type = 'goal_glimpse'
  do update set plan_id = excluded.plan_id, visibility = excluded.visibility
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.upsert_daily_glimpse(uuid, date, text) to authenticated;
