import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-4xl px-6 py-24">
        {/* App Name */}
        <p className="text-sm text-zinc-400">StandUp</p>

        {/* Headline */}
        <h1 className="mt-4 text-5xl font-semibold leading-tight">
          Meet yourself. Daily.
        </h1>

        {/* Subheading */}
        <p className="mt-6 max-w-2xl text-lg text-zinc-300">
          Set at least <strong>3 goals</strong> for tomorrow. Check in today.
          Build discipline through consistency.
        </p>

        {/* Actions */}
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/login"
            className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200"
          >
            Sign in / Sign up
          </Link>

          <Link
            href="/dashboard"
            className="rounded-xl border border-zinc-700 px-6 py-3 text-sm font-semibold transition hover:bg-zinc-900"
          >
            Go to Dashboard
          </Link>

          <Link
            href="/standup/today"
            className="rounded-xl border border-zinc-700 px-6 py-3 text-sm font-semibold transition hover:bg-zinc-900"
          >
            Today’s StandUp
          </Link>

          <Link
            href="/goals/tomorrow"
            className="rounded-xl border border-zinc-700 px-6 py-3 text-sm font-semibold transition hover:bg-zinc-900"
          >
            Tomorrow’s Goals
          </Link>
        </div>

        {/* Footer note */}
        <p className="mt-12 text-sm text-zinc-500">
          Consistency beats motivation.
        </p>
      </div>
    </main>
  );
}
