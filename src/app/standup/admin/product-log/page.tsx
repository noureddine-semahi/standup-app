"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isCurrentUserAdmin } from "@/lib/supabase/db";

// Kept in sync by hand with /PRODUCT_LOG.md at the repo root — this page is
// the in-app view of the same content for admins who don't have the repo
// open. Update both together.

const FRAMEWORK: { label: string; detail: string }[] = [
  {
    label: "Frontend",
    detail:
      "Next.js 16 (App Router, TypeScript), Tailwind CSS v4. Deployed on Vercel, auto-deploying on every push to main.",
  },
  {
    label: "Backend",
    detail:
      "Supabase: Postgres with Row-Level Security as the only access-control layer, Supabase Auth, and Supabase Storage for file attachments (private buckets, accessed only through short-lived signed URLs). One Next.js API route exists (/api/assistant) -- even there, it calls Supabase with the calling user's own access token rather than a service-role key (none exists in this project), so RLS still governs every query.",
  },
  {
    label: "AI",
    detail:
      "The Dashboard assistant calls an LLM directly via fetch (no SDK dependency) with a small fixed set of tools. Two interchangeable providers behind one normalized interface (src/lib/assistant/providers.ts): Gemini (gemini-2.0-flash, genuinely free tier, current default) and Anthropic (claude-haiku-4-5, better tool-use reliability, no free tier -- the target once profitable). Switch via the ASSISTANT_PROVIDER env var; each needs its own key (GEMINI_API_KEY or ANTHROPIC_API_KEY) set server-side.",
  },
  { label: "Testing", detail: "Vitest, unit and smoke tests." },
  {
    label: "Schema changes",
    detail:
      "Applied by hand in the Supabase SQL Editor — this environment has no service-role key, so nothing is scripted or CI-wired. /supabase/migrations documents what's live, reconstructed after the fact.",
  },
  {
    label: "Auth",
    detail: "Uses Supabase's processLock session strategy to avoid cross-tab hangs.",
  },
];

const RELEASE_NOTES: { period: string; summary: string }[] = [
  {
    period: "Foundation",
    summary:
      "Dashboard, Today/Tomorrow planning, authentication, calendar, and the core rescheduling logic.",
  },
  {
    period: "V1.0 & Admin Tools — early September 2026",
    summary:
      "A mobile-friendly layout pass; an Admin panel with member management, points editing, and Member/Admin/Sys Admin role control; landing-page visit tracking and sign-up growth stats; a per-profile theme preference; a logout reliability fix.",
  },
  {
    period: "Accountability & History — September 5",
    summary:
      "Overdue-day warnings and an end-of-day review reminder; a distinct \"missed\" calendar color plus a manual \"Clear this day\" option; the seven-segment LED visual identity applied across the whole app; Notes and History merged into one real, chronological timeline per goal; Points & Usage relaunched as Data & Metrics with drill-down goal lists.",
  },
  {
    period: "Reschedule & Review Depth — September 7–8",
    summary:
      "Whole-day re-attempt for missed days that were never touched; the chronological timeline extended to Plan Tomorrow; per-goal checklists for sub-items; per-goal file attachments backed by private Supabase Storage; a direct unreviewed-days list on the Calendar.",
  },
  {
    period: "Backlog & Reliability — September 9–10",
    summary:
      "An undated goal Backlog; completed/canceled/blocked goals collapse under a status banner on Today; a fix for auth hangs across tabs; an optional time-of-day field on goals; a navigation overflow fix merging Calendar/Backlog into one rotating nav slot.",
  },
  {
    period: "Reschedule Polish & Dashboard Assistant — September 11",
    summary:
      "Move-to-Backlog added to the Reschedule modal; Blocked now requires a reason, saved as a real note; \"postponed\" and \"rescheduled\" unified into one concept everywhere; a mobile truncation fix for the collapsed \"Rescheduled\" banner. Also: a 🤖 Assistant button on the Dashboard for plain-language goal actions -- running on Gemini's free tier for now (not Anthropic, which has no permanent free tier) to keep this at zero ongoing cost. Still ships with a hard cap (20 actions per rolling 30-day period per account) regardless of provider, since it's the app's first feature with a real per-use cost once it does move to a paid provider.",
  },
  {
    period: "Assistant Voice & Cleanup, Goal Details, Card Redesign, Real Light Theme — September 12-16",
    summary:
      "The Dashboard assistant gained voice input (tap the mic and speak) and a remove_goal tool that always asks for confirmation first, since deletion can't be undone. Goals gained an \"All day\" toggle and a single-URL Link field -- alongside checklist/files, all shown as a compact one-line row of small buttons right under the goal's title on Plan Tomorrow, Review Today, and the Calendar's date view. Every goal card was redesigned: the priority color now outlines the whole card instead of a short side strip, the number badge is a small corner tag flush with the card's own border/radius, and cards carry no wasted outer padding -- applied across Today, Tomorrow, Calendar, Backlog, History, and the Dashboard's compact preview lists. The Dashboard also gained a one-time \"just unlocked\" achievement popup and a \"day closed, tomorrow planned\" encouragement banner, and closing the day now blocks while any goal is still unreviewed or in progress. Biggest change: light mode previously only repainted the page background behind otherwise-unchanged dark cards/buttons/text -- it's now a full token-based conversion (cards, the header, and every translucent white overlay across the app genuinely flip to a light surface), plus a quick theme toggle inside the Profile page's \"Profile & Settings\" button and the mobile menu's Profile row.",
  },
  {
    period: "Spanish Translation — September 17",
    summary:
      "A full language system built from scratch rather than a library -- a plain React Context mirroring the existing theme pattern (localStorage plus a same-tab event). The English dictionary is the source of truth; Spanish is typed against it so the build fails if a new string is ever added without a translation. Every page and shared component outside the Admin panel (which stays English-only by design) is now translated -- Dashboard, Today, Tomorrow, Calendar, Backlog, History, Profile, Settings, the landing page, all auth pages, FAQ, Contact, Privacy, About, and every shared modal/component. The toggle sits right next to the theme toggle, in the same two spots. Two things stay untranslated on purpose: historical notes already logged to a goal's timeline, and the Dashboard assistant's own reply text, which comes from the LLM rather than the dictionary. Unlike theme, the language choice is stored per-browser only, not synced to the account yet.",
  },
  {
    period: "Glimpse Sharing & Connections — September 18",
    summary:
      "StandUp's first social surface: send a connection request by email, accept or decline it, then publish today's goal list as a \"glimpse\" post visible to accepted connections (or, added the same day, to Everyone via a public feed). One unified posts table backs three post types -- goal glimpses, achievement unlocks, and freeform motivational posts -- all through the same feed and reaction system. Reactions are a fixed set of four (like/support/fire/clap), one per viewer per post. Connections management moved to its own Social nav tab.",
  },
  {
    period: "Full Social, Long-Term Goals & Icons — September 22",
    summary:
      "Five features shipped as one sequence: connections discovery (browse and request with one tap, replacing manual email search) plus a privacy/discoverability toggle (opt out of email lookup, on by default); an audience dropdown on Review Today's Publish control (Connections / Everyone / one named connection); comments, replies, and comment reactions on any post, splitting Social into 4 tabs (My Feed / Global / My Circle / Friends); weekly streak passes (2 forgiven misses per week for a 5-of-7 pace, derived on read); and recurring goal templates (Phase 1 -- tap-to-add suggestion chips on Plan Tomorrow) plus long-term goals (Phase 2 -- target-dated goals as a Backlog extension). Also this day: the app-wide icon system -- every emoji used as a functional UI icon replaced with lucide-react, via a shared StatusIcon component and a per-achievement icon mapping.",
  },
  {
    period: "Goal Assignments, Notifications & Header Overhaul — September 23",
    summary:
      "Goal sharing/assignment: assign one of your own goals to an accepted connection, who can accept or decline it; once accepted it materializes as a real, independent goal on their own plan. Assignments carry a shared vs. exclusive type (exclusive is the default) -- shared stays fully independent forever; exclusive locks the assigner out of their own copy only once the recipient has actually accepted, and is excluded from the assigner's own day-closure requirement. The assigner can also view the recipient's actual logged actions on a handed-off goal, merged into the same \"Actions & notes\" timeline. A dedicated /standup/assignments page holds the full assignment view. Also this day: a Privacy Policy consent gate at signup; a pending-notifications section on the Dashboard mirrored by a header notification bell; photo attachments on motivational posts; and a header navigation overhaul (small always-visible primary group plus a \"More\" panel; the Social nav tab was also renamed Community). A cluster of same-day fixes: listConnections() had been silently unable to read the other party's display name for the entire lifetime of the connections feature (profiles' RLS only allows reading your own row -- fixed with a security-definer RPC, the same class of fix later needed for posts sharing itself and for cross-user goal-note visibility); a React hooks-order crash on the Dashboard; and an assigned-out goal's status badge reading the assigner's own frozen copy instead of the recipient's live status, in four independent rendering paths before all four were fixed.",
  },
  {
    period: "Moderation, Sharing & @Mentions — September 24",
    summary:
      "An admin moderation view (see and delete any post or comment past its normal visibility, logged to an audit trail) plus a first-time Community Guidelines gate every member has to acknowledge once. Any post you can see can now be shared directly to one specific connection, extending its visibility to them even if they couldn't otherwise see it. @mention an accepted connection in a post or comment to tag them -- surfaced as a Dashboard/header-bell notification. Also: a design pass on the About page, and the docs you're reading now were brought up to date through this point.",
  },
  {
    period: "Video Posts, Assignment Fixes & Cancellation — September 25-26",
    summary:
      "Motivational posts can now carry a short video instead of a photo (one attachment per post, either kind). Fixed: accepting an assigned goal was silently dropping its checklist and file attachments instead of copying them over. Either side of a goal assignment can now back out after the fact -- Retract a still-pending one, or Cancel one already accepted -- notifying the other party with an optional reason and pulling the goal from both plans.",
  },
  {
    period: "Discoverability, Smoother Navigation & Advance Streak Passes — September 25-28",
    summary:
      "A Discoverable toggle in Settings: turn it off and your account becomes unfindable by email lookup for new connection requests (existing connections are unaffected). Every page-to-page navigation lost its blank flash-of-nothing, and common goal actions (complete/cancel/reschedule) got noticeably snappier. A streak pass can now be applied to a future date in advance, not just used after the fact to patch a day already missed.",
  },
  {
    period: "Lists, Payment Tracking & Team Goals — September 28-30",
    summary:
      "The Backlog page became Tools, now a 5-tab hub: Backlog, Long-Term Goals, Lists, Payments, and Assigned Goals. Lists are standing, reusable checklists (groceries, packing, anything repeated) -- push one into a brand-new goal or merge it into an existing goal's checklist without consuming the list itself. Payments tracks a balance, minimum payment, and due day for recurring bills; a due payment now creates its own reminder goal automatically on Dashboard/Today/Tomorrow, and completing it asks you to confirm the amount actually paid, subtracted from the tracked balance (going negative on overpayment is allowed by design). Team Goals: post a goal as an open invite to Community instead of handing it to one person -- everyone who joins shares one checklist, complete once every item is checked by anyone. Also: reopening a day no longer clears every goal's review status, only the ones you actually touch.",
  },
  {
    period: "Header Redesign, Deep-Linking Notifications & Card Consistency — October 1",
    summary:
      "The header's six primary links moved out of the top row entirely into their own always-visible hanging-tab row directly beneath it, each with its own accent color and an icon-only mobile layout; the notification bell, a \"More\" menu, and the profile chip were consolidated into one cluster pinned to the top-right corner, with the brand logo pinned top-left, both independent of scroll. Comments, replies, and reactions on your own posts now generate a notification, the same as an @mention already did. The bell itself gained a dropdown: click it to see your actual notifications, each one linking straight to the exact post (scrolled to and briefly highlighted, with its comment thread opened automatically) or the right page for a connection/assignment -- and clicking a row marks it read immediately, not just on the next refresh. Today's goal cards gained a direct delete option (already-resolved cards only, no confirmation needed since there's nothing to lose), and the same number-badge-top-left / delete-X-top-right layout now applies consistently to every goal-card page. Also: the Dashboard's motivational message card stopped visibly resizing every time the rotating message changed length, and the mobile Sign In/Sign Up buttons and landing page's Get Started/Learn More buttons were fixed to stop overflowing narrow screens.",
  },
  {
    period: "Visual Refresh: Metallic & Glass Design System — October 1-3",
    summary:
      "A sustained, app-wide visual pass rather than a single feature: nav tabs gained a pulled-out 3D look with a real spotlight-style active-tab glow; every button and status control picked up a shared 3D depth treatment, then a glass/mirror finish with a specular glint on top of that. Dashboard (colored button system, mobile Quick Actions, tappable/deep-linking goal rows), Community (per-tab hero banners, livelier reactions), and Plan Tomorrow (compact mobile toolbar, dirty-aware Save, sticky mobile action bar) each got their own interaction-design pass. Goal cards moved onto a \"metallic-surface\" material system, and the old flat number badge became a 3D metallic hemisphere with an amber LED-style digit, reused as the one GoalNumberOrb component everywhere a goal number appears. The landing page got a new 3D neon logo, a new promo video, corrected its messaging to match the real evening-first workflow, and had a full spacing/hierarchy refinement pass. Also: a long-standing mobile bug where the page needed two scroll attempts to actually move (a third, previously-missed scroll container on .app-shell) was fixed app-wide, and the Calendar got its first mobile density/accessibility pass.",
  },
  {
    period: "Community Profiles — October 5",
    summary:
      "Connections gained a real profile: a dedicated connection profile page (replacing the old View Profile modal) with a bio field editable from Settings, and a landing header on Community showing your own profile card -- photo, name, and now-clickable Posts/Connections stat chips -- above the tab row.",
  },
  {
    period: "Goal Engine: Major Goals, Task Types & the 3-10 Commitment Model — October 6-9",
    summary:
      "The biggest structural change since launch: what used to be one flat \"goal\" is now two tiers. A Task is still the single day-to-day thing you plan and review, but it can now optionally link to a Major Goal -- a bigger outcome you create once and build toward over time, picking one of four types: One-Time (a single outcome), Ongoing (maintained continuously, Tasks added as you go), Recurring (work that repeats on a defined cycle, with its own cycle history), or Target (progress tracked against a specific number, like a dollar amount or a mile count). Every Major Goal gets a real detail page -- status, progress, and its own open/completed/canceled/needs-review Task lists -- reachable from the new Active Goals section on the Dashboard or from the Goals page. Plan Tomorrow and Review Today were restructured around this: adding a commitment now asks Standalone Task or Major Goal up front, an existing Task can be linked to a Goal (or reassigned to a different one) via a Move control, and the Calendar now groups a day's Tasks by their parent Goal. The old \"set at least 3 goals\" rule became \"plan 3 to 10 commitments\" -- still the same minimum, but with an explicit cap and the vocabulary now matching what the UI has called this everywhere else (Today's/Tomorrow's Commitments). A cluster of lineage fixes shipped alongside this to keep goal/task ownership intact across rescheduling and reopened days. Also: the Use Streak Pass button was hidden in one case where it should have stayed available (a day whose goals were rescheduled away, not reviewed or cleared).",
  },
  {
    period: "Progress & Insights and a Dedicated Goals Workspace — October 10-11",
    summary:
      "The old Data & Metrics page was rebuilt and renamed Progress & Insights, now its own header nav tab as well as a Profile link: a Follow-Through Rate and current streak up top, a Task Outcomes breakdown, Priority Performance, dedicated Target/Recurring Goal Progress sections, lifetime totals, and the existing Activity Overview. The header's navigation and profile menus were also refreshed, and the desktop profile dropdown now correctly stays hidden on mobile. Separately, a new Goals page (Tools' first tab) became a real management workspace for Major Goals: search, filter by type, an Assigned view for goals shared with you, and quick-add visibility -- replacing Tools' old standalone Assigned Goals tab, whose content moved in here instead. Also: a mobile hamburger-menu bug where taps were silently swallowed got a proper fix (traced with an on-device tap probe before the real cause -- an outside-click listener missing the panel's own ref -- was found).",
  },
  {
    period: "Tools Redesign, Assignment Fixes & Calendar's Proportional Ring — October 12-16",
    summary:
      "Goal assignments were consolidated fully into the Goal Engine model (fixing a handful of lineage/status edge cases across task reschedules in the process), and Tools' tab bar was redesigned as a recessed metallic segmented control to match. The header's primary nav tabs were redesigned again for reliable fit at every desktop width, and the Community/Tools sub-tab bars switched from CSS position:sticky (which kept failing to engage in the real app) to a manually-driven pin-on-scroll that actually works everywhere, correcting scroll position automatically on a tab switch. Biggest visual change: the Calendar's month grid now draws each day as a true proportional multi-segment progress ring (completed/rescheduled/canceled/pending as real conic-gradient arcs sized from that day's actual counts, not a flat color), finished with a glass/specular tile treatment, a richer/more saturated color pass tuned separately for dark and light mode, and a redesigned glass status legend with the same metallic rim treatment as the nav tab bars.",
  },
];

const UP_NEXT: { phase: string; detail: string }[] = [
  {
    phase: "Phase 3 — Challenges (parked, not scoped)",
    detail:
      "Fixed-window, rule-based challenges (\"75 Hard\"-style) with their own streak/badge mechanics. A bigger positioning shift, similar in kind to the network/monetization ideas below — revisit only with a deliberate decision, not as a natural extension of what's shipped.",
  },
];

const PARKED: { title: string; detail: string }[] = [
  {
    title: "Additional languages (French, Arabic, Chinese)",
    detail:
      "English and Spanish shipped September 17 (see Release Notes above); the extraction work that was the real cost of the first two languages is already done, so adding another is now mostly writing a new dictionary file. Arabic will also need RTL layout consideration, which the CSS wasn't built with in mind.",
  },
  {
    title: "Enterprise/team version",
    detail:
      "Concluded this is a separate product, not an extension of StandUp's single-user design. Not to be confused with Team Goals (shipped September 30) -- a single shared goal with a joint checklist, not a multi-user workspace product.",
  },
  {
    title: "Growth monitor",
    detail:
      "Tracking sign-ins and account deletions over time needs new event-log tables (sign-up growth itself is already tracked).",
  },
  {
    title: "Gesture-based review actions",
    detail:
      "Drawing a shape (checkmark, X, reverse-C) over a goal to complete/cancel/reschedule it. A simpler directional-swipe version is the recommended path — true freeform shape recognition fights the browser's native scroll gesture on the same list.",
  },
  {
    title: "Shared goals / connections — monitoring facet",
    detail:
      "Of the three facets originally scoped here, the first two shipped September 18-23: sharing one specific goal (goal assignment, shared/exclusive types) and a broader status/progress view for another person (the connections feed, Discover, comments and reactions). What remains parked is the third and heaviest: active monitoring/notifications for an accountability partner — still blocked on the same missing piece as the Notifications & email entry below.",
  },
  {
    title: "Notifications & email",
    detail:
      "No delivery infrastructure exists today; every reminder is currently an in-app banner. Email is the lower-effort first step if pursued.",
  },
  {
    title: "Monetization",
    detail:
      "Subscriptions or advertising. Advertising would conflict with the Privacy Policy's no-third-party-tracking commitment, so that tension needs resolving before either path is chosen. The Dashboard assistant's free usage cap is the first concrete candidate for a paid tier -- \"unlimited assistant\" -- once this gets picked back up.",
  },
  {
    title: "Google Calendar integration",
    detail:
      "An opt-in, on-demand \"Sync Now\" button rather than automatic real-time sync -- polling on click means neither direction needs Google's push-notification channels (which expire and need a renewal cron) or a public webhook endpoint, collapsing what would otherwise be a two-phase build into one. Still needs a one-time OAuth connect flow per user (a new google_calendar_connections table storing a refresh token, plus a goals.google_event_id column) -- accepted as the cost of an optional convenience feature, not something every user is routed through. Scoped but not started.",
  },
];

export default function ProductLogPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    async function init() {
      let isAdmin = false;
      try {
        isAdmin = await isCurrentUserAdmin();
      } catch {
        isAdmin = false;
      }
      setAuthorized(isAdmin);
      setChecking(false);
      if (!isAdmin) router.push("/standup/dashboard");
    }
    init();
  }, [router]);

  if (checking || !authorized) {
    return <div className="card">Checking access…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="card card-highlight">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Product Log</h1>
            <p className="mt-2 text-white/70">
              What StandUp is built on, what's shipped, and what's been deliberately set aside for
              later.
            </p>
          </div>
          <Link href="/standup/admin" className="btn btn-ghost whitespace-nowrap">
            ← Admin
          </Link>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Framework &amp; Architecture</h2>
        <div className="space-y-3">
          {FRAMEWORK.map((item) => (
            <div key={item.label} className="grid sm:grid-cols-[160px_1fr] gap-1 sm:gap-4">
              <div className="text-sm font-semibold text-amber-300">{item.label}</div>
              <div className="text-sm text-white/70 leading-relaxed">{item.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Release Notes</h2>
        <div className="space-y-5">
          {RELEASE_NOTES.map((note) => (
            <div key={note.period}>
              <div className="text-sm font-semibold text-white">{note.period}</div>
              <p className="mt-1 text-sm text-white/70 leading-relaxed">{note.summary}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-1">Up Next</h2>
        <p className="text-sm text-white/50 mb-4">
          Recurring suggestion chips (Phase 1) and long-term goals (Phase 2) — both previously
          listed here — shipped September 22. Nothing is currently scoped and queued; the next
          candidate needs its own go/no-go.
        </p>
        <div className="space-y-4">
          {UP_NEXT.map((item) => (
            <div
              key={item.phase}
              className="rounded-xl p-3"
              style={{ border: "1px solid rgba(245, 158, 11, 0.2)", background: "rgba(245, 158, 11, 0.04)" }}
            >
              <div className="text-sm font-semibold text-amber-300">{item.phase}</div>
              <p className="mt-1 text-sm text-white/60 leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-1">Parked for Later</h2>
        <p className="text-sm text-white/50 mb-4">
          Not scheduled, but deliberately kept — revisit any of these when there's a real reason
          to.
        </p>
        <div className="space-y-4">
          {PARKED.map((item) => (
            <div key={item.title} className="rounded-xl p-3" style={{ border: "1px solid rgba(var(--tint-rgb), 0.08)", background: "rgba(var(--tint-rgb), 0.02)" }}>
              <div className="text-sm font-semibold text-white">{item.title}</div>
              <p className="mt-1 text-sm text-white/60 leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
