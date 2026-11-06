# Beta & monetization feature flags (Phase 5.3)

Three server-controlled flags, **all off by default**. They live in `public.feature_flags` (migration
`supabase/migrations/20261117000100_feature_flags.sql`). Browsers cannot read or write that table; the app only asks
`get_feature_flags()` what the values are. Any failure to read them is treated as **all off**.

| Flag                               | Off (the free beta)                                              | On                                              |
| ---------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| `premium_promotion_enabled`        | No Premium comparison, pricing or "upgrade to Premium" wording   | Settings shows Free vs Premium and pricing      |
| `premium_trial_activation_enabled` | No trial offer, and **the database refuses to start a trial**    | Users can start their one 14-day trial          |
| `billing_checkout_enabled`         | Reserved: nothing implements checkout yet                        | (needs promotion on too; not built yet)         |

What never changes with the flags: existing Premium accounts, active trials, trial history, subscription data, the Free-tier limits
(3 Goals, 3 routines, 10 notes) and the current-plan display in Settings.

## Changing a flag (project owner, Supabase SQL Editor)

```sql
-- turn on / off
update public.feature_flags set enabled = true  where key = 'premium_trial_activation_enabled';
update public.feature_flags set enabled = false where key = 'premium_trial_activation_enabled';

-- check
select key, enabled, updated_at from public.feature_flags order by key;
```

The app caches the answer for about 30 seconds per page load, so a change shows up on the next load. Trial activation is enforced
in the database (`start_my_premium_trial()` raises `TRIAL_ACTIVATION_DISABLED`), so it takes effect immediately for everyone,
whatever a browser does.
