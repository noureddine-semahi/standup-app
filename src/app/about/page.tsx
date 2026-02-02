"use client";

import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4">About StandUp</h1>
          <p className="text-xl text-white/70 max-w-2xl mx-auto">
            StandUp is a daily execution and reflection system built to help you
            work with intention — not pressure.
          </p>
          <p className="mt-4 text-sm text-white/60 max-w-2xl mx-auto">
            It’s not about doing more. It’s about doing what matters, on purpose —
            and building consistency one day at a time.
          </p>
        </div>

        {/* Philosophy */}
        <div className="card mb-8">
          <h2 className="text-2xl font-bold mb-4">Our Philosophy</h2>

          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-white/80">
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
            <div className="flex gap-4">
              <div className="text-3xl">🧠</div>
              <div>
                <h3 className="font-semibold text-white mb-1">
                  Awareness Before Action
                </h3>
                <p className="text-sm text-white/70">
                  You must review your goals before acting on them. Conscious
                  engagement leads to better decisions and stronger execution.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="text-3xl">🔄</div>
              <div>
                <h3 className="font-semibold text-white mb-1">
                  Reflection Before Planning
                </h3>
                <p className="text-sm text-white/70">
                  Tomorrow stays locked until today is reviewed. This prevents
                  planning on top of unprocessed days and keeps your system real.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="text-3xl">📈</div>
              <div>
                <h3 className="font-semibold text-white mb-1">
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

        {/* Features */}
        <div className="grid gap-6 md:grid-cols-2 mb-8">
          <div className="card">
            <h3 className="text-lg font-semibold mb-3">📋 Daily Review</h3>
            <p className="text-sm text-white/70">
              Review each goal with intention — even if it didn’t go perfectly.
              Update status, add notes, and reschedule when needed. Every goal
              gets conscious attention.
            </p>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-3">🎯 Intentional Planning</h3>
            <p className="text-sm text-white/70">
              Set at least 3 goals for tomorrow and assign priority. Only one
              P1 is allowed so you stay focused on what truly matters.
            </p>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-3">🔥 Points & Streaks</h3>
            <p className="text-sm text-white/70">
              Earn points for showing up (awareness) and for closing the loop
              (review + action). Build streaks through daily consistency — not
              unrealistic perfection.
            </p>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-3">📅 Smart Rescheduling</h3>
            <p className="text-sm text-white/70">
              Reschedule goals to a future date (with an optional reason). They
              automatically appear when that date arrives — no manual copying.
            </p>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-3">🚫 Review Gating</h3>
            <p className="text-sm text-white/70">
              Tomorrow’s planning is locked until today is reviewed. This
              prevents drifting into endless planning without learning from the
              day you just lived.
            </p>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-3">🧾 Honest Outcomes</h3>
            <p className="text-sm text-white/70">
              StandUp separates <b>review</b> from <b>completion</b>. A goal can
              be reviewed and marked attempted, blocked, or postponed — without
              guilt. Reflection is still progress.
            </p>
          </div>
        </div>

        {/* How It Works */}
        <div className="card mb-8">
          <h2 className="text-2xl font-bold mb-6">How It Works</h2>
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold">
                1
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1">Plan Tomorrow</h3>
                <p className="text-sm text-white/70">
                  Set at least 3 goals for tomorrow. Assign priorities
                  (P1 = highest; only one P1). Save your draft or submit your plan.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold">
                2
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1">Review Today</h3>
                <p className="text-sm text-white/70">
                  Start the day by reviewing goals. Pending goals stay visually
                  distinct until reviewed. Once reviewed, update status and add
                  follow-up notes if needed.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold">
                3
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

        {/* Vision */}
        <div className="card mb-8">
          <h2 className="text-2xl font-bold mb-4">Our Vision</h2>
          <p className="text-white/80 mb-4">
            StandUp is more than a todo list. It’s a daily operating system for
            intentional work. We believe:
          </p>
          <ul className="space-y-2 text-white/70 text-sm">
            <li>• Awareness precedes effective action</li>
            <li>• Reflection enables continuous improvement</li>
            <li>• Consistency compounds into mastery</li>
            <li>• Small daily wins build lasting habits</li>
            <li>• Intentionality beats reactivity</li>
          </ul>

          <p className="text-white/80 mt-4">
            StandUp is also the foundation for a broader follow-up operating
            system — a place to track real-world commitments like job search
            activity, recruiter conversations, and time-sensitive follow-ups,
            with AI assistance where it genuinely helps.
          </p>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-white/70">
              <span className="font-semibold text-white">North Star:</span>{" "}
              Awareness before action. Progress begins with review.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <Link href="/signup" className="btn btn-primary text-lg px-8 py-4">
            Get Started with StandUp
          </Link>
          <p className="mt-4 text-sm text-white/60">
            Join and start building your daily execution habit today.
          </p>
        </div>
      </div>
    </div>
  );
}
