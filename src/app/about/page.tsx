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
            A daily execution and accountability system built on awareness, reflection, and consistency.
          </p>
        </div>

        {/* Philosophy */}
        <div className="card mb-8">
          <h2 className="text-2xl font-bold mb-4">Our Philosophy</h2>
          <div className="space-y-4 text-white/80">
            <div className="flex gap-4">
              <div className="text-3xl">🧠</div>
              <div>
                <h3 className="font-semibold text-white mb-1">Awareness Before Action</h3>
                <p className="text-sm text-white/70">
                  You must review your goals before acting on them. Conscious engagement leads to better execution.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="text-3xl">🔄</div>
              <div>
                <h3 className="font-semibold text-white mb-1">Reflection Before Planning</h3>
                <p className="text-sm text-white/70">
                  You cannot plan tomorrow unless yesterday has been reviewed. This enforces deliberate learning.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="text-3xl">📈</div>
              <div>
                <h3 className="font-semibold text-white mb-1">Consistency Over Intensity</h3>
                <p className="text-sm text-white/70">
                  Small daily engagement is rewarded more than perfect completion. Progress beats perfection.
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
              Review each goal from yesterday. Track status, add notes, and reschedule when needed. Every goal gets conscious attention.
            </p>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-3">🎯 Intentional Planning</h3>
            <p className="text-sm text-white/70">
              Set at least 3 goals for tomorrow with priority levels. Only one P1 allowed to maintain focus on what truly matters.
            </p>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-3">🔥 Points & Streaks</h3>
            <p className="text-sm text-white/70">
              Earn awareness points for opening Today, closure points for completing review. Build streaks through daily consistency.
            </p>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-3">📅 Smart Rescheduling</h3>
            <p className="text-sm text-white/70">
              Reschedule goals to future dates with optional reasons. They automatically appear when that date arrives.
            </p>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-3">🚫 Review Gating</h3>
            <p className="text-sm text-white/70">
              Tomorrow's planning is locked until today is reviewed. This prevents planning without learning from the past.
            </p>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-3">⏰ Timestamps</h3>
            <p className="text-sm text-white/70">
              Every goal is stamped with creation time. Track when you set goals and see your execution patterns.
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
                  Every evening, set at least 3 goals for tomorrow. Assign priorities (P1 = highest, only one P1 allowed). Submit your plan.
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
                  Each morning, review yesterday's goals. Mark them as reviewed, update status (completed/blocked/postponed), and close out the day.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold">
                3
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1">Build Consistency</h3>
                <p className="text-sm text-white/70">
                  Earn points for awareness and closure. Build streaks by closing out each day. Track your progress over time.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Vision */}
        <div className="card mb-8">
          <h2 className="text-2xl font-bold mb-4">Our Vision</h2>
          <p className="text-white/80 mb-4">
            StandUp is more than a todo list. It's a daily operating system for intentional work. We believe that:
          </p>
          <ul className="space-y-2 text-white/70 text-sm">
            <li>• Awareness precedes effective action</li>
            <li>• Reflection enables continuous improvement</li>
            <li>• Consistency compounds into mastery</li>
            <li>• Small daily wins build lasting habits</li>
            <li>• Intentionality beats reactivity</li>
          </ul>
          <p className="text-white/80 mt-4">
            We're building a follow-up operating system that extends beyond daily goals to help you track job applications, 
            manage follow-ups, and execute on what matters most.
          </p>
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