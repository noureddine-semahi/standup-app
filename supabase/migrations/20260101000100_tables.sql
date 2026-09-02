-- Reconstructed from client-usage auditing. See ../README.md before applying anywhere.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  points integer not null default 0
);

create table if not exists public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_date date not null,
  status text not null default 'draft', -- 'draft' | 'submitted' | 'locked'
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  -- ASSUMED: no verified auto-update trigger observed from client behavior;
  -- add a trigger to keep this current only if you confirm the live DB has one.
  updated_at timestamptz not null default now(),

  -- OBSERVED ONLY: seen in one live API response, never read or written by any
  -- client code in this repo. Included for schema parity; semantics unverified.
  checked_in_at timestamptz,
  checkin_awarded boolean not null default false,
  checkin_points integer not null default 0,

  -- Two-phase scoring flags, set by the award_* RPCs (see 20260101000300).
  awareness_awarded boolean not null default false,
  closure_awarded boolean not null default false,
  awareness_points integer not null default 0,
  closure_points integer not null default 0,

  -- Confirmed via client behavior: getOrCreatePlan() explicitly catches Postgres
  -- error 23505 on insert against this exact constraint and re-fetches.
  constraint daily_plans_user_id_plan_date_key unique (user_id, plan_date)
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.daily_plans (id) on delete cascade,
  title text not null,
  details text,
  status text not null default 'not_started',
  -- 'not_started' | 'in_progress' | 'completed' | 'attempted' | 'postponed' | 'blocked'
  sort_order integer not null default 0,
  priority integer not null default 3, -- 1 (highest) .. 5 (lowest); app enforces <=1 P1 per plan
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goal_notes (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
  -- Append-only from the client: never updated or deleted anywhere in src/.
);

create table if not exists public.goal_reschedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_goal_id uuid not null references public.goals (id) on delete cascade,
  -- LEGACY: db.ts sets this to the same value as from_goal_id with an inline
  -- "// legacy keep" comment. Never read anywhere in the client. Kept for parity.
  to_goal_id uuid references public.goals (id) on delete set null,
  from_date date not null,
  to_date date not null,
  reason text,
  materialized boolean not null default false,
  materialized_goal_id uuid references public.goals (id) on delete set null,
  snapshot_title text not null,
  snapshot_details text,
  snapshot_priority integer not null default 3,
  created_at timestamptz not null default now()
);
