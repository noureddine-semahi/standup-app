# StandUp — Product Log

_Last updated: 2026-09-24. Also viewable in-app: Admin → Product Log._

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

### Glimpse Sharing & Connections — September 18
StandUp's first social surface: send a connection request by email, accept
or decline it, then publish today's goal list as a "glimpse" post visible
to your accepted connections (or, added the same day, to Everyone via a
public feed). One unified `posts` table backs three post types — goal
glimpses, achievement unlocks, and freeform motivational posts — all
rendered through the same feed and reaction system rather than three
separate ones. Reactions are a fixed set of four (like/support/fire/clap),
one per viewer per post. Connections management moved to its own Social
nav tab. Several same-day migration-ordering fixes (a policy depending on
a function that had to drop first, a backfill needed before a new
constraint could be added) reflect that this shipped as one continuous
push rather than a pre-planned schema.

### Full Social, Long-Term Goals & Icons — September 22
Five features agreed as one sequence, all shipped this day: **connections
discovery** (browse a paged list of other members and send a request with
one tap, replacing manual email search) plus a **privacy/discoverability
toggle** (opt out of being found by email lookup, on by default, and
indistinguishable from not existing when off); an **audience dropdown** on
Review Today's Publish control (Connections / Everyone / a single named
connection); **comments, replies, and comment reactions** on any post,
which split Social into 4 tabs (My Feed / Global / My Circle / Friends) to
keep Discover and Connections from crowding the same view; **weekly streak
passes** (2 forgiven misses per week for a 5-of-7-days-reviewed pace,
derived on read rather than stored as a balance); and **recurring goal
templates** (Phase 1 of the roadmap below — a template reappears as a
tap-to-add suggestion chip on Plan Tomorrow for the days it's due) plus
**long-term goals** (Phase 2 — target-dated goals with a longer horizon,
built as a Backlog extension rather than a new table). Also this day: the
**app-wide icon system** — every emoji used as a functional UI icon
(status glyphs, achievement badges, reaction icons, nav icons) replaced
with `lucide-react`, via a new shared `StatusIcon` component and a
per-achievement icon mapping. Priority-dot emoji inside native
`<select>` options, and emoji baked into historical toast/message text,
were left as-is on purpose (see the Icons entry's own notes for why).

### Goal Assignments, Notifications & Header Overhaul — September 23
**Goal sharing/assignment**: assign one of your own goals to an accepted
connection, who can accept or decline it; once accepted it materializes as
a real, independent goal on their own plan for the same date. Assignments
carry a **shared vs. exclusive** type (exclusive is the default) — shared
stays a fully normal, independently-editable goal on both sides forever;
exclusive locks the assigner out of their own copy (checklist, files,
priority, link, status/review) but **only once the recipient has actually
accepted**, and is excluded from the assigner's own day-closure
requirement so a handed-off goal can never block "Close out day." This
went through several same-day corrections before landing here — an
earlier pass locked the assigner out immediately on send (before
accept/decline), which was wrong. The assigner can also **view the
recipient's actual logged actions** (status changes, reviews, etc.) on a
goal they've handed off, merged into the same "Actions & notes" timeline
and attributed by name — viewing only, unrelated to the exclusive lock,
which governs editing. A dedicated **`/standup/assignments` page** holds
the full Assignments-for-you / assigned-by-you / assigned-to-you view,
reachable via the header's Calendar↔Backlog nav rotation (now a 3-item
loop) and a "Goals" shortcut tab on Community.

Also this day: a **Privacy Policy consent gate at signup** (scroll to the
bottom, explicit Agree click, before an account can be created); a
**pending notifications section on the Dashboard** (incoming connection
requests and goal assignments awaiting a response, plus resolved-but-
unacknowledged ones you sent) mirrored by a badge-count **notification
bell** in the header; **photo attachments on motivational posts**; and a
**header navigation overhaul** — the original overflow bug turned out to
be `.nav-link`'s own minimum width preventing children from shrinking
inside `.nav`'s own box, not the gap between them, so nav items were split
into a small always-visible primary group plus a "More" panel for
everything else; the Social nav tab was also renamed **Community**.

A cluster of same-day bug fixes worth noting for what they reveal about
this stretch of work: `listConnections()` had been silently unable to
read the *other* party's display name for the entire lifetime of the
connections feature (`profiles`' only RLS policy is "read your own row,"
which a plain client join can never see past — fixed with a
security-definer RPC, the same fix later needed again for `posts` sharing
itself, where `INSERT ... ON CONFLICT DO UPDATE` under RLS rejected the
write outright, and again for goal-note visibility across users); a React
hooks-order violation crashed the Dashboard when a `useMemo` was declared
after an early loading return; and an assigned-out goal's status
chip/"Pending review" badge could read the assigner's own frozen,
never-touched-again copy instead of the recipient's live status, in four
independent rendering paths (Today's own page, and three separate spots
on the Dashboard) before all four were caught and fixed.

## Up Next

Recurring suggestion chips (Phase 1) and long-term goals (Phase 2) — both
previously listed here — shipped September 22 (see Release Notes above).
Nothing is currently scoped and queued; the next candidate needs its own
go/no-go rather than being picked up as a natural continuation.

### Phase 3 — Challenges (parked deliberately, not scoped)
Fixed-window, rule-based challenges ("75 Hard"-style) with their own
streak/badge mechanics distinct from the daily streak. This is a bigger
positioning shift, similar in kind to the network/monetization ideas below
— revisit only with a deliberate decision to go there, not as a natural
extension of what's shipped.

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
- **Shared goals / connections** — of the three facets originally scoped
  here, the first two shipped September 18–23: sharing one specific goal
  (goal assignment, shared/exclusive types) and a broader status/progress
  view for another person (the connections feed, Discover, comments and
  reactions). What remains parked is the third and heaviest: **active
  monitoring/notifications** for an accountability partner — still blocked
  on the same missing piece as the entry below (no delivery infrastructure
  exists to actually notify someone outside the app).
- **Notifications & email** — no delivery infrastructure exists today; every
  reminder is currently an in-app banner. Email is the lower-effort first
  step if this gets pursued.
- **Monetization** — subscriptions or advertising. Advertising would conflict
  with the Privacy Policy's current no-third-party-tracking commitment, so
  that tension needs resolving before either path is chosen. The Dashboard
  assistant's free usage cap (see Release Notes above) is the first concrete
  candidate for a paid tier — "unlimited assistant" — once this gets picked
  back up.
