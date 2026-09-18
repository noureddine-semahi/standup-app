# StandUp — Product Log

_Last updated: 2026-09-17. Also viewable in-app: Admin → Product Log._

This is the running record of what StandUp is built on, what's shipped, and
what's been deliberately set aside for later. Not wired into CI or any build
step — a hand-maintained snapshot, updated alongside major feature work.

## Framework & Architecture

- **Frontend** — Next.js 16 (App Router, TypeScript), Tailwind CSS v4. Deployed
  on Vercel, auto-deploying on every push to `main`.
- **Backend** — Supabase: Postgres with Row-Level Security as the only
  access-control layer, Supabase Auth, and Supabase Storage for file
  attachments (private buckets, accessed only through short-lived signed
  URLs — never a public link). One Next.js API route exists
  (`/api/assistant`, added September 11 for the Dashboard assistant) — even
  there, it calls Supabase with the calling user's own access token rather
  than a service-role key (none exists in this project), so RLS still
  governs every query the same way it does from the browser.
- **AI** — the Dashboard assistant calls an LLM directly via `fetch` (no SDK
  dependency) with a small fixed set of tools mapped onto existing goal
  actions. Two interchangeable providers behind one normalized interface
  (`src/lib/assistant/providers.ts`): **Gemini** (`gemini-2.0-flash`,
  genuinely free tier, current default) and **Anthropic** (`claude-haiku-4-5`,
  better tool-use reliability, no free tier — the target once this is
  profitable enough to justify the cost). Switch via the `ASSISTANT_PROVIDER`
  env var (`gemini` or `anthropic`); each needs its own key
  (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`) set server-side.
- **Testing** — Vitest, unit and smoke tests.
- **Schema changes** are applied by hand in the Supabase SQL Editor — this
  environment has no service-role key, so nothing is scripted or CI-wired.
  `/supabase/migrations` documents what's live, reconstructed after the fact
  rather than generated from a real migration history.
- **Auth** uses Supabase's `processLock` session strategy to avoid cross-tab
  hangs.

## Release Notes

### Foundation
Dashboard, Today/Tomorrow planning, authentication, calendar, and the core
rescheduling logic.

### V1.0 & Admin Tools — early September 2026
A mobile-friendly layout pass; an Admin panel with member management, points
editing, and Member/Admin/Sys Admin role control; landing-page visit tracking
and sign-up growth stats; a per-profile theme preference (dark by default);
a logout reliability fix.

### Accountability & History — September 5
Overdue-day warnings and an end-of-day review reminder; a distinct "missed"
calendar color plus a manual "Clear this day" option; the seven-segment LED
visual identity applied across the whole app; Notes and History merged into
one real, chronologically-ordered timeline per goal; Points & Usage relaunched
as Data & Metrics, with lifetime stats and drill-down goal lists.

### Reschedule & Review Depth — September 7–8
Whole-day re-attempt for missed days that were never touched; the
chronological timeline extended to Plan Tomorrow; per-goal checklists for
sub-items (e.g. a grocery list under "Go to HEB"); per-goal file attachments
(receipts, documents) backed by private Supabase Storage; a direct
unreviewed-days list on the Calendar.

### Backlog & Reliability — September 9–10
An undated goal Backlog — park a goal, push it onto a date later; completed,
canceled, and blocked goals collapse under a status banner to keep Today
readable; a fix for auth hangs across tabs; an optional time-of-day field on
goals; a navigation overflow fix that merged Calendar/Backlog into one
rotating nav slot and folded the avatar into the profile chip.

### Reschedule Polish & Dashboard Assistant — September 11
Move-to-Backlog added to the Reschedule modal; Blocked now requires a
reason, saved as a real note; "postponed" and "rescheduled" unified into
one concept everywhere (they were always the same event under the hood —
see Framework note below); a mobile truncation fix for the collapsed
"Rescheduled" banner. Also: a 🤖 Assistant button on the Dashboard — type a
plain request ("add a goal to call the dentist tomorrow," "mark my workout
done") and it adds or updates the matching goal. Running on Gemini's free
tier for now (not Anthropic, which has no permanent free tier) to keep this
at zero ongoing cost — see the AI entry under Framework above for how to
switch providers later. Still ships with a hard cap (20 actions per rolling
30-day period per account) regardless of provider, since it's the app's
first feature with a real per-use cost once it does move to a paid
provider — see the Monetization entry below for how this connects.

### Assistant Voice & Cleanup, Goal Details, Card Redesign, Real Light Theme — September 12–16
The Dashboard assistant gained voice input (tap the mic and speak instead of
typing) and a `remove_goal` tool that always asks for confirmation first,
since deletion can't be undone. Goals gained an "All day" toggle and a
single-URL Link field — alongside checklist/files, all three now show as a
compact one-line row of small buttons right under the goal's title on Plan
Tomorrow, Review Today, and the Calendar's date view. Every goal card was
redesigned: the priority color now outlines the whole card instead of a
short side strip, the number badge is a small corner tag flush with the
card's own border/radius, and cards carry no wasted outer padding — applied
consistently across Today, Tomorrow, Calendar, Backlog, History, and the
Dashboard's compact preview lists. The Dashboard also gained a one-time
"just unlocked" achievement popup and a "day closed, tomorrow planned"
encouragement banner, and closing the day now blocks while any goal is
still unreviewed or in progress. Biggest change: light mode previously only
repainted the page background behind otherwise-unchanged dark cards,
buttons, and text — it's now a full token-based conversion (cards, the
header, and every translucent white overlay across the app genuinely flip
to a light surface), plus a quick theme toggle inside the Profile page's
"Profile & Settings" button and the mobile menu's Profile row.

### Spanish Translation — September 17
A full language system, built from scratch rather than a library
(`next-intl` wasn't pulled in — a plain React Context mirroring the
existing theme pattern: `localStorage` plus a same-tab event, so any
component reacts to a change immediately). The English dictionary
(`src/lib/i18n/en.ts`) is the source of truth; the Spanish dictionary is
typed against it so the build fails if a new string is ever added without
a translation, which is what makes this safe to extend later. Every page
and shared component outside the Admin panel — which stays English-only
by design, since it's an internal tool — is now translated: Dashboard,
Today, Tomorrow, Calendar, Backlog, History, Profile, Settings, the
landing page, all auth pages, FAQ, Contact, Privacy, About, and every
shared modal/component (checklists, attachments, the goal timeline,
reschedule and blocked-reason modals, the Dashboard assistant panel). The
toggle sits right next to the theme toggle, in the same two spots. Two
things stay untranslated on purpose: historical notes already logged to a
goal's timeline (translating recorded history after the fact isn't
possible), and the Dashboard assistant's own reply text, which comes back
from the LLM itself rather than from the dictionary. Unlike the theme
preference, the language choice is stored per-browser only — not synced
to the account yet.

## Up Next

Scoped and ready to build, not started yet.

### Phase 1 — Recurring suggestion chips
The gym-motivation use case: "Workout" (or any goal) reappears as a
tap-to-add suggestion on the days it's due, instead of retyping it daily.
- New `recurring_goal_templates` table: title, details, default priority,
  optional time-of-day, days-of-week, active flag.
- A small management screen to create/edit/retire templates.
- Plan Tomorrow gets a "Suggested" row of chips for templates due tomorrow;
  tapping one creates a real goal for that date. Decision made up front: add
  a nullable `source_template_id` on `goals` for a clean "already added"
  check, rather than matching by title.
- Deliberately **not** automatic goal creation — every principle this app
  already runs on ("review before plan," a conscious daily choice) argues
  for a tap, not a silent injection.

### Phase 2 — Long-term goals (resolutions, monthly goals)
"Learn Spanish this year," New Year's resolutions, monthly goals — same
park-it-then-act-on-it mechanic as Backlog, just longer horizon.
- Likely an extension of Backlog rather than a new table: add an optional
  `target_date` and a `category` label to `goal_backlog` first, and only
  build a dedicated table if that proves insufficient.
- Can attach the existing checklist feature for milestones once a goal
  exists.

### Phase 3 — Challenges (parked deliberately, not scoped)
Fixed-window, rule-based challenges ("75 Hard"-style) with their own
streak/badge mechanics distinct from the daily streak. This is a bigger
positioning shift, similar in kind to the network/monetization ideas below
— revisit only with a deliberate decision to go there, not as a natural
extension of Phase 1/2.

**Build order:** Phase 1 first (small, high-value, already scoped down to
implementation detail), Phase 2 next (cheap once Phase 1's template
thinking exists), Phase 3 stays parked.

## Parked for Later

Not scheduled, but deliberately kept — revisit any of these when there's a
real reason to, not just because the list exists.

- **Additional languages (French, Arabic, Chinese)** — English and Spanish
  shipped September 17 (see Release Notes above); the extraction work that
  was the real cost of the first two languages is already done, so adding
  another is now mostly writing a new dictionary file. Arabic will also
  need RTL layout consideration, which the CSS wasn't built with in mind.
- **Enterprise/team version** — concluded this is a separate product, not an
  extension of StandUp's single-user design.
- **Growth monitor** — tracking sign-ins and account deletions over time
  needs new event-log tables (sign-up growth itself is already tracked).
- **Gesture-based review actions** — drawing a shape (checkmark, X, reverse-C)
  over a goal to complete/cancel/reschedule it. A simpler directional-swipe
  version is the recommended path if this gets revisited — true freeform
  shape recognition fights the browser's native scroll gesture on the same
  list.
- **Shared goals / connections** — three distinct facets, not equal in cost:
  sharing one specific goal (smallest slice), a broader status/progress view
  for another person (needs a real "what's visible" decision), and active
  monitoring by an accountability partner (heaviest — depends on
  notifications existing first, since it implies notifying *them*, not just
  giving read access). Build in that order if revisited; don't start with
  a full connections/permissions graph.
- **Notifications & email** — no delivery infrastructure exists today; every
  reminder is currently an in-app banner. Email is the lower-effort first
  step if this gets pursued.
- **Monetization** — subscriptions or advertising. Advertising would conflict
  with the Privacy Policy's current no-third-party-tracking commitment, so
  that tension needs resolving before either path is chosen. The Dashboard
  assistant's free usage cap (see Release Notes above) is the first concrete
  candidate for a paid tier — "unlimited assistant" — once this gets picked
  back up.
