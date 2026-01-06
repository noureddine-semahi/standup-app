"use client";

import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-4xl px-6 py-20">
        <h1 className="text-4xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-zinc-400">
          Your command center: streak, today’s check-in, and tomorrow’s goals.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            <p className="text-sm text-zinc-400">Current streak</p>
            <p className="mt-2 text-3xl font-semibold">0 🔥</p>
            <p className="mt-2 text-sm text-zinc-500">
              Streak logic will connect once we add Supabase.
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            <p className="text-sm text-zinc-400">Today</p>
            <p className="mt-2 text-lg font-semibold">Daily StandUp</p>
            <p className="mt-2 text-sm text-zinc-500">
              Yesterday / Today / Blockers (personal sprint).
            </p>

            <Link
              href="/standup/today"
              className="mt-4 inline-flex rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold transition hover:bg-zinc-900"
            >
              Open Today’s StandUp →
            </Link>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            <p className="text-sm text-zinc-400">Tomorrow</p>
            <p className="mt-2 text-lg font-semibold">Set 3+ goals</p>
            <p className="mt-2 text-sm text-zinc-500">
              Minimum 3 goals for tomorrow to stay accountable.
            </p>

            <Link
              href="/goals/tomorrow"
              className="mt-4 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-zinc-200"
            >
              Set Tomorrow’s Goals →
            </Link>
          </div>
        </div>

        <div className="mt-10">
          <Link
            href="/"
            className="text-sm text-zinc-400 hover:text-zinc-200"
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
