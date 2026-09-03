"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import SocialShareButtons from "@/components/SocialShareButtons";
import { supabase } from "@/lib/supabase/client";

const cardTitleFont = Playfair_Display({
  subsets: ["latin"],
  weight: ["700"],
});

export default function AboutPage() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setSignedIn(!!user);
    });
  }, []);

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4">About StandUp</h1>
          <p className="text-xl text-page-secondary max-w-2xl mx-auto">
            StandUp is a daily execution and reflection system built to help you
            work with intention — not pressure.
          </p>
          <p className="mt-4 text-sm text-page-tertiary max-w-2xl mx-auto">
            It’s not about doing more. It’s about doing what matters, on purpose —
            and building consistency one day at a time.
          </p>
        </div>

        {/* Two cards per row max — these are text-heavy sections, not
            compact stat tiles, so they need real width to read comfortably. */}
        <div className="mt-6 grid gap-3 grid-cols-1 sm:grid-cols-2">
          {/* Philosophy — paired side-by-side with Vision */}
          <div
            className="card card-highlight"
          >
          <div className="p-0 sm:p-6">
            <h2 className={`${cardTitleFont.className} text-2xl text-purple-300 mb-4`}>Our Philosophy</h2>

            <div className="mb-6 pl-4" style={{ borderLeft: "2px solid rgba(168, 85, 247, 0.3)" }}>
              <p className="text-sm text-white/70">
                Most productivity tools focus on checking boxes. StandUp focuses on{" "}
                <b>awareness</b>, <b>review</b>, and <b>follow-through</b>. Completion
                matters — but reflection is what compounds.
              </p>
              <p className="mt-3 text-sm text-white/70">
                One simple rule keeps the system honest:
              </p>
              <p className="mt-2 text-sm font-semibold text-white">
                You can’t plan tomorrow until you’ve reviewed today.
              </p>
            </div>

            <div className="space-y-4 text-white/80">
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white mb-1">
                  <span className="text-xl">🧠</span>
                  Awareness Before Action
                </h3>
                <p className="text-sm text-white/70">
                  You must review your goals before acting on them. Conscious
                  engagement leads to better decisions and stronger execution.
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white mb-1">
                  <span className="text-xl">🔄</span>
                  Reflection Before Planning
                </h3>
                <p className="text-sm text-white/70">
                  You can always draft tomorrow's goals, but finalizing them stays
                  locked until today is reviewed. This prevents committing to a new
                  day on top of an unprocessed one and keeps your system real.
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white mb-1">
                  <span className="text-xl">📈</span>
                  Consistency Over Intensity
                </h3>
                <p className="text-sm text-white/70">
                  StandUp rewards daily engagement more than perfect completion.
                  Progress beats perfection, and consistency compounds.
                </p>
              </div>
            </div>
          </div>
          </div>

          {/* Vision — paired side-by-side with Philosophy */}
          <div
            className="card card-highlight"
          >
          <div className="p-0 sm:p-6">
            <h2 className={`${cardTitleFont.className} text-2xl text-purple-300 mb-4`}>Our Vision</h2>
            <p className="text-white/80 mb-4">
              StandUp is more than a todo list. It’s a daily operating system for
              intentional work. We believe:
            </p>
            <ul className="space-y-2 text-white/70 text-sm list-disc list-inside">
              <li>Awareness precedes effective action</li>
              <li>Reflection enables continuous improvement</li>
              <li>Consistency compounds into mastery</li>
              <li>Small daily wins build lasting habits</li>
              <li>Intentionality beats reactivity</li>
            </ul>

            <p className="text-white/80 mt-4">
              StandUp is also the foundation for a broader follow-up operating
              system — a place to track real-world commitments like job search
              activity, recruiter conversations, and time-sensitive follow-ups,
              with AI assistance where it genuinely helps.
            </p>

            <div className="mt-6 pl-4" style={{ borderLeft: "2px solid rgba(168, 85, 247, 0.3)" }}>
              <p className="text-sm text-white/70">
                <span className="font-semibold text-white">North Star:</span>{" "}
                Awareness before action. Progress begins with review.
              </p>
            </div>
          </div>
          </div>

          {/* The Bigger Picture — full-width band below the pair */}
          <div
            className="card card-highlight"
          >
          <div className="p-0 sm:p-6">
            <h2 className={`${cardTitleFont.className} text-2xl text-purple-300 mb-6`}>The Bigger Picture</h2>
            <div className="space-y-5">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">📋</span>
                  Daily Review
                </h3>
                <p className="text-sm text-white/60">
                  Review each goal with intention — even if it didn’t go perfectly.
                  Update status, add notes, and reschedule when needed.
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">🎯</span>
                  Intentional Planning
                </h3>
                <p className="text-sm text-white/60">
                  Set at least 3 goals for tomorrow and assign priority. Only one
                  P1 is allowed so you stay focused on what truly matters.
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">🔥</span>
                  Points &amp; Streaks
                </h3>
                <p className="text-sm text-white/60">
                  Earn points for showing up and for closing the loop. Build
                  streaks through daily consistency — not unrealistic perfection.
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">📅</span>
                  Smart Rescheduling
                </h3>
                <p className="text-sm text-white/60">
                  Reschedule goals to a future date. They automatically appear
                  when that date arrives — no manual copying.
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">🚫</span>
                  Review Gating
                </h3>
                <p className="text-sm text-white/60">
                  Draft any date's goals whenever you like — even weeks out via the
                  Calendar. Submitting a plan, though, only unlocks the evening
                  before it arrives, once the day before has been reviewed — no
                  drifting into endless planning without learning from today.
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">🗓️</span>
                  Full Calendar History
                </h3>
                <p className="text-sm text-white/60">
                  Every day you've planned lives on the Calendar. Past days open
                  read-only, exactly as they happened — the only action left is to
                  "re-attempt" a goal by rescheduling it onto a future date.
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">🧾</span>
                  Honest Outcomes
                </h3>
                <p className="text-sm text-white/60">
                  StandUp separates <b>review</b> from <b>completion</b>. A goal
                  can be marked attempted, blocked, or postponed — without guilt.
                </p>
              </div>
            </div>
          </div>
          </div>

          {/* The Story — paired side-by-side with How It Works */}
          <div
            className="card card-highlight"
          >
          <div className="p-0 sm:p-6">
            <h2 className={`${cardTitleFont.className} text-2xl text-purple-300 mb-4`}>The Story</h2>
            <p className="text-white/80 mb-4">
              StandUp started with a familiar office ritual: the daily standup meeting. Every
              morning, the team would gather for a few minutes and each person answered the
              same three things — what got done yesterday, what's the plan for today, and
              what's blocking you.
            </p>
            <p className="text-sm text-white/70">
              It sounds small, but that daily rhythm of reporting progress, committing to
              today's goals out loud, and naming blockers before they turned into excuses
              created real accountability. Nobody could quietly slip for a week — the next
              day's standup would surface it.
            </p>

            <div className="mt-6 pl-4" style={{ borderLeft: "2px solid rgba(168, 85, 247, 0.3)" }}>
              <p className="text-sm text-white/70">
                <span className="font-semibold text-white">The idea:</span> bring that same
                daily discipline to your own goals — report on yesterday, commit to today,
                name what's blocking you. No team required.
              </p>
            </div>
          </div>
          </div>

          {/* How It Works — paired side-by-side with The Story */}
          <div
            className="card card-highlight"
          >
          <div className="p-0 sm:p-6">
            <h2 className={`${cardTitleFont.className} text-2xl text-purple-300 mb-6`}>How It Works</h2>
            <div className="space-y-8">
              <div>
                <h3 className="font-semibold text-white mb-1">Plan Tomorrow</h3>
                <p className="text-sm text-white/70">
                  Set at least 3 goals for tomorrow. Assign priorities
                  (P1 = highest; only one P1). Save your draft or submit your plan.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-white mb-1">Review Today</h3>
                <p className="text-sm text-white/70">
                  Start the day by reviewing goals. Pending goals stay visually
                  distinct until reviewed. Once reviewed, update status and add
                  follow-up notes if needed.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-white mb-1">Close the Loop</h3>
                <p className="text-sm text-white/70">
                  When all goals are reviewed, you earn closure. That closure
                  unlocks tomorrow’s planning and helps you build a streak.
                </p>
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* CTA — the signup push only makes sense for a signed-out visitor */}
        <div className="text-center">
          {!signedIn && (
            <>
              <Link href="/signup" className="btn btn-primary text-lg px-8 py-4">
                Get Started with StandUp
              </Link>
              <p className="mt-4 text-sm text-page-tertiary">
                Join and start building your daily execution habit today.
              </p>
            </>
          )}
          <p className="mt-6 text-sm text-page-tertiary">
            Have questions? Check the{" "}
            <Link href="/faq" className="text-purple-300 hover:text-purple-200 underline">
              FAQ
            </Link>{" "}
            or{" "}
            <Link href="/contact" className="text-purple-300 hover:text-purple-200 underline">
              contact us
            </Link>
            . See our{" "}
            <Link href="/privacy" className="text-purple-300 hover:text-purple-200 underline">
              Privacy Policy
            </Link>
            .
          </p>

          <SocialShareButtons className="mt-8" onPage />
        </div>
      </div>
    </div>
  );
}
