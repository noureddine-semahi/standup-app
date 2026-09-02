# Supabase schema — reconstructed, not authoritative

**These migration files are a reconstruction, not an export.** No migrations or schema
files existed in this repo when they were written (2026-08). They were built by
auditing every `supabase.from(...)`/`supabase.rpc(...)` call across `src/`, plus a
handful of live API responses captured while browser-testing the app against the real
project. They are **not wired to CI or any deploy step**, and there is no
`supabase/config.toml` — this folder is intentionally not CLI-linked to any project, so
nobody runs `supabase db push` against production out of habit.

**Do not apply these files to the live Supabase project without reviewing them against
the actual schema first.** Treat this as disaster-recovery / onboarding documentation,
not a source of truth.

## What's verified vs. assumed

- **Table columns**: high confidence — every column listed is one the client code
  actually reads or writes (or, for `daily_plans.checked_in_at` /
  `checkin_awarded` / `checkin_points`, was seen in one live API response even though
  no client code ever touches it — included for parity, marked `OBSERVED ONLY`).
- **The `daily_plans (user_id, plan_date)` unique constraint**: high confidence — the
  client explicitly catches Postgres error `23505` on insert and re-fetches, which only
  makes sense if this constraint exists.
- **RPC function bodies** (`materialize_reschedules`, `award_awareness_points`,
  `award_closure_points`, `award_points`): **low confidence**. Their actual SQL was
  never inspected. Bodies here are best-effort reconstructions from call sites and
  observed side effects, marked with confidence banners in
  `migrations/20260101000300_rpc_functions.sql`. Notably, `award_closure_points` was
  live-tested and confirmed to return `{"success": true, "points": 5}` — **not** the
  `{awarded, new_points}` shape the client casts it to — and confirmed to **not** set
  `daily_plans.reviewed_at` itself (the client compensates with a separate `.update()`
  call). `award_points` has zero call sites anywhere in the client and its signature is
  unverifiable from usage.
- **RLS policies**: **not inspectable from client code at all**. Every table is
  scoped by `user_id`/`auth.uid()` in every query, which implies (but does not prove)
  "users can only touch their own rows" policies exist. The policies in
  `migrations/20260101000400_rls_policies.sql` are a documented best guess.

## Layout

```
supabase/
  README.md                                  # this file
  migrations/
    20260101000000_extensions.sql            # pgcrypto for gen_random_uuid()
    20260101000100_tables.sql                # 5 tables, high-confidence columns
    20260101000200_indexes.sql               # indexes for observed query patterns
    20260101000300_rpc_functions.sql         # 4 RPCs, confidence-banner comments
    20260101000400_rls_policies.sql          # best-guess RLS, loudly marked ASSUMED
```

Audited from (as of 2026-08-05): `src/lib/supabase/db.ts` plus direct
`supabase.from()`/`.rpc()` calls in `calendar/page.tsx`, `today/page.tsx`,
`tomorrow/page.tsx`, and `date/[date]/page.tsx`.
