import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-zinc-400">
          Your streak + tomorrow’s goals will live here.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            className="rounded-xl bg-zinc-50 px-5 py-3 text-sm font-semibold text-zinc-950"
            href="/goals/tomorrow"
          >
            Set Tomorrow’s Goals
          </Link>

          <Link
            className="rounded-xl border border-zinc-800 px-5 py-3 text-sm font-semibold"
            href="/standup/today"
          >
            Today’s StandUp
          </Link>
        </div>
      </div>
    </main>
  );
}
