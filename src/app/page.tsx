"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { logLandingPageVisit } from "@/lib/supabase/db";
import { SevenSegmentDigit, SevenSegmentReadout } from "@/components/SevenSegmentDigit";

const VISITED_KEY = "standup-landing-visited";

const READOUTS = [
  { label: "Points", value: "247", color: "var(--led-amber)" },
  { label: "Streak", value: "12", color: "var(--led-red)" },
  { label: "Complete", value: "85", color: "var(--led-green)" },
];

const FEATURES = [
  {
    color: "var(--led-amber)",
    title: "Awareness First",
    body: "Review before acting. Every goal gets conscious attention before execution.",
  },
  {
    color: "var(--led-green)",
    title: "Daily Reflection",
    body: "Learn from yesterday. Plan tomorrow only after reviewing today.",
  },
  {
    color: "var(--led-red)",
    title: "Progress Tracking",
    body: "Earn points, build streaks, and watch your consistency compound.",
  },
  {
    color: "var(--led-amber)",
    title: "Priority Focus",
    body: "One P1 goal per day keeps you focused on what truly matters.",
  },
  {
    color: "var(--led-green)",
    title: "Smart Scheduling",
    body: "Reschedule goals seamlessly. They appear automatically on the right day.",
  },
  {
    color: "var(--led-red)",
    title: "Daily Habits",
    body: "Small wins compound. Build lasting habits through daily engagement.",
  },
];

const STEPS = [
  {
    n: "1",
    color: "var(--led-amber)",
    title: "Plan Tomorrow",
    body: "Every evening, set at least 3 goals. Assign priorities (only one P1). Submit your plan.",
  },
  {
    n: "2",
    color: "var(--led-green)",
    title: "Review Today",
    body: "Each morning, review yesterday's goals. Update status, add notes, close out the day.",
  },
  {
    n: "3",
    color: "var(--led-red)",
    title: "Build Momentum",
    body: "Earn points, track streaks, and watch your daily execution habit strengthen over time.",
  },
];

export default function LandingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  // Digits light in from ghost cells on mount rather than appearing lit —
  // the one authored motion moment for this surface (see craft-floor.md).
  const [lit, setLit] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setLit(true), 300);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    async function checkAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        router.push("/standup/dashboard");
      } else {
        setLoading(false);
        // Only for actual visitors landing here signed out — logged-in
        // users get redirected above before ever seeing this page. A local
        // flag (not a cookie, never sent anywhere) keeps a repeat visit from
        // the same browser from being logged again, so the count reflects
        // unique visitors rather than every page load/refresh.
        try {
          if (!window.localStorage.getItem(VISITED_KEY)) {
            window.localStorage.setItem(VISITED_KEY, "1");
            logLandingPageVisit();
          }
        } catch {
          logLandingPageVisit();
        }
      }
    }

    checkAuth();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="led-world min-h-screen">
      {/* Hero — the day itself rendered as a bank of scoreboard digits,
          lit segments in ghost-cell mode until they light on load. */}
      <div className="max-w-5xl mx-auto px-4 py-20 sm:py-28 text-center">
        <div className="flex items-end justify-center gap-6 sm:gap-10 mb-10 flex-wrap">
          {READOUTS.map((r) => (
            <div key={r.label} className="flex flex-col items-center gap-3">
              <SevenSegmentReadout value={lit ? r.value : "0".repeat(r.value.length)} color={r.color} size={36} />
              <div
                className="led-mono text-[11px] tracking-widest uppercase"
                style={{ color: "var(--led-text-dim)" }}
              >
                {r.label}
              </div>
            </div>
          ))}
        </div>

        <h1 className="led-headline text-3xl sm:text-5xl font-bold mb-5 leading-tight">
          Build Consistency. Execute Daily.
        </h1>

        <p className="led-mono text-sm sm:text-base mb-10 max-w-2xl mx-auto" style={{ color: "var(--led-text-dim)" }}>
          Transform your goals into daily habits with awareness-driven planning and reflection.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/signup" className="led-switch led-switch-primary">
            Get Started →
          </Link>
          <Link href="/about" className="led-switch">
            Learn More
          </Link>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="led-headline text-3xl font-bold mb-3">Why StandUp?</h2>
          <p className="led-mono text-sm" style={{ color: "var(--led-text-dim)" }}>
            Built on proven principles of execution
          </p>
        </div>

        {/* min-w-0 on every grid item — a CSS Grid item's default min-width:auto
            let unbreakable content stretch a track past the viewport on the
            Dashboard earlier this session; cheap insurance against a repeat. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
          {FEATURES.map((f) => (
            <div key={f.title} className="led-cell p-6">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="led-dot"
                  style={{ background: f.color, boxShadow: `0 0 8px ${f.color}` }}
                />
                <h3 className="led-mono text-sm font-bold uppercase tracking-wide">{f.title}</h3>
              </div>
              <p className="text-sm" style={{ color: "var(--led-text-dim)" }}>
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* How It Works */}
      <div className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="led-headline text-3xl font-bold mb-3">How It Works</h2>
          <p className="led-mono text-sm" style={{ color: "var(--led-text-dim)" }}>
            Three steps to daily execution
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
          {STEPS.map((s) => (
            <div key={s.n} className="led-cell p-6">
              <div className="mb-4">
                <SevenSegmentDigit char={s.n} color={s.color} size={28} />
              </div>
              <h3 className="led-mono text-sm font-bold uppercase tracking-wide mb-2">{s.title}</h3>
              <p className="text-sm" style={{ color: "var(--led-text-dim)" }}>
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <div className="led-cell p-10" style={{ borderColor: "rgba(245, 158, 11, 0.35)" }}>
          <h2 className="led-headline text-3xl font-bold mb-3">Ready to Build Your Habit?</h2>
          <p className="led-mono text-sm mb-8" style={{ color: "var(--led-text-dim)" }}>
            Join StandUp today and start your daily execution journey.
          </p>
          <Link href="/signup" className="led-switch led-switch-primary">
            Get Started →
          </Link>
          <p className="led-mono text-xs mt-4" style={{ color: "var(--led-text-dim)" }}>
            No credit card required
          </p>
        </div>
      </div>
    </div>
  );
}
