"use client";

import { useMemo, useState } from "react";

export default function TomorrowGoalsPage() {
  const [goals, setGoals] = useState(["", "", ""]);
  const [msg, setMsg] = useState<string | null>(null);

  const filledCount = useMemo(
    () => goals.filter((g) => g.trim().length > 0).length,
    [goals]
  );

  const updateGoal = (index: number, value: string) => {
    const updated = [...goals];
    updated[index] = value;
    setGoals(updated);
  };

  const addGoal = () => setGoals((prev) => [...prev, ""]);
  const removeGoal = (index: number) =>
    setGoals((prev) => prev.filter((_, i) => i !== index));

  const handleSave = () => {
    setMsg(null);

    if (filledCount < 3) {
      setMsg("You need at least 3 goals for tomorrow.");
      return;
    }

    // Placeholder for Supabase insert later
    console.log({
      goalDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      goals: goals.filter((g) => g.trim().length > 0),
    });

    setMsg("Tomorrow goals saved (local only for now).");
  };

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="text-4xl font-semibold">Tomorrow’s Goals</h1>
        <p className="mt-2 text-zinc-400">
          Set at least <strong>3</strong>. This is your contract with yourself.
        </p>

        <div className="mt-10 space-y-3">
          {goals.map((goal, i) => (
            <div key={i} className="flex gap-3">
              <input
                value={goal}
                onChange={(e) => updateGoal(i, e.target.value)}
                placeholder={`Goal ${i + 1}`}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white"
              />

              {goals.length > 3 && (
                <button
                  onClick={() => removeGoal(i)}
                  className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold transition hover:bg-zinc-900"
                  title="Remove"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={addGoal}
            className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold transition hover:bg-zinc-900"
          >
            + Add another goal
          </button>

          <button
            onClick={handleSave}
            className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200"
          >
            Save Tomorrow Goals
          </button>
        </div>

        <div className="mt-4">
          <p className="text-sm text-zinc-400">
            Filled goals: <span className="font-semibold">{filledCount}</span>
          </p>
          {msg && <p className="mt-2 text-sm text-zinc-300">{msg}</p>}
        </div>

        <div className="mt-10">
          <a
            href="/dashboard"
            className="text-sm text-zinc-400 hover:text-zinc-200"
          >
            ← Back to Dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
