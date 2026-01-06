export default function TodayStandUpPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold">Today’s StandUp</h1>
        <p className="mt-2 text-zinc-400">
          Yesterday ✅ / Today 🎯 / Blockers 🚧
        </p>

        <div className="mt-8 space-y-4">
          <section className="rounded-2xl border border-zinc-800 p-5">
            <label className="text-sm text-zinc-400">What did you achieve yesterday?</label>
            <textarea className="mt-2 w-full rounded-xl bg-zinc-900 p-3 outline-none" rows={4} />
          </section>

          <section className="rounded-2xl border border-zinc-800 p-5">
            <label className="text-sm text-zinc-400">What are you trying to achieve today?</label>
            <textarea className="mt-2 w-full rounded-xl bg-zinc-900 p-3 outline-none" rows={4} />
          </section>

          <section className="rounded-2xl border border-zinc-800 p-5">
            <label className="text-sm text-zinc-400">What are your blockers?</label>
            <textarea className="mt-2 w-full rounded-xl bg-zinc-900 p-3 outline-none" rows={3} />
          </section>

          <button className="rounded-xl bg-zinc-50 px-5 py-3 text-sm font-semibold text-zinc-950">
            Save Check-in (next step)
          </button>
        </div>
      </div>
    </main>
  );
}
