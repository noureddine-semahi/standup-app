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
      "Supabase: Postgres with Row-Level Security as the only access-control layer, Supabase Auth, and Supabase Storage for file attachments (private buckets, accessed only through short-lived signed URLs).",
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
];

const PARKED: { title: string; detail: string }[] = [
  {
    title: "Multi-language support",
    detail:
      "The framework side is straightforward (next-intl with locale routing); the real cost is extracting hardcoded UI strings across an app that's grown large.",
  },
  {
    title: "Enterprise/team version",
    detail: "Concluded this is a separate product, not an extension of StandUp's single-user design.",
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
    title: "Shared goals / connections",
    detail:
      "Friends, visibility permissions, and task sharing. Scope small (a single shareable read-only link) before building any connections graph.",
  },
  {
    title: "Notifications & email",
    detail:
      "No delivery infrastructure exists today; every reminder is currently an in-app banner. Email is the lower-effort first step if pursued.",
  },
  {
    title: "Monetization",
    detail:
      "Subscriptions or advertising. Advertising would conflict with the Privacy Policy's no-third-party-tracking commitment, so that tension needs resolving before either path is chosen.",
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
        <h2 className="text-lg font-semibold mb-1">Parked for Later</h2>
        <p className="text-sm text-white/50 mb-4">
          Not scheduled, but deliberately kept — revisit any of these when there's a real reason
          to.
        </p>
        <div className="space-y-4">
          {PARKED.map((item) => (
            <div key={item.title} className="rounded-xl p-3" style={{ border: "1px solid rgba(255, 255, 255, 0.08)", background: "rgba(255, 255, 255, 0.02)" }}>
              <div className="text-sm font-semibold text-white">{item.title}</div>
              <p className="mt-1 text-sm text-white/60 leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
