// src/app/standup/today/page.tsx
export default function TodayStandupPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
        Today&apos;s StandUp
      </h1>
      <p className="mt-4 text-white/70 max-w-2xl">
        Check in on the goals you set yesterday. Mark progress, reflect, and keep the streak alive.
      </p>

      <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-white/70">
          Next step: we’ll wire this to Supabase (goals table + check-ins) and show today’s goals here.
        </p>
      </div>
    </div>
  );
}
