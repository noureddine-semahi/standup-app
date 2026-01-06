import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm text-zinc-400">StandUp</p>

        <h1 className="mt-4 text-4xl font-semibold">
          Meet yourself. Daily.
        </h1>

        <p className="mt-4 text-zinc-300">
          Set at least <strong>3 goals</strong> for tomorrow.
          Check in today.
          Build discipline through consistency.
        </p>

        <div className="mt-8 flex gap-4">
          <Link
            href="/dashboard"
            className="rounded-xl bg-zinc-50 px-5 py-3 text-sm font-semibold text-zinc-950"
          >
            Go to Dashboard
          </Link>

          <Link
            href="/standup/today"
            className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold"
          >
            Today’s StandUp
          </Link>
        </div>
      </div>
    </main>
  );
}
