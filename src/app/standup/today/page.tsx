"use client";

import { useState } from "react";

export default function TodayStandupPage() {
  const [goals, setGoals] = useState(["", "", ""]);
  const [reflection, setReflection] = useState("");

  const updateGoal = (index: number, value: string) => {
    const updated = [...goals];
    updated[index] = value;
    setGoals(updated);
  };

  const handleSubmit = () => {
    console.log({
      date: new Date().toISOString().slice(0, 10),
      goals,
      reflection,
    });

    alert("StandUp saved (local only for now)");
  };

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="text-4xl font-semibold">Today’s StandUp</h1>
        <p className="mt-2 text-zinc-400">
          Check in with yourself. Be honest. Be consistent.
        </p>

        <section className="mt-10">
          <h2 className="text-lg font-medium">Top 3 goals for today</h2>

          <div className="mt-4 space-y-3">
            {goals.map((goal, i) => (
              <input
                key={i}
                type="text"
                value={goal}
                onChange={(e) => updateGoal(i, e.target.value)}
                placeholder={`Goal ${i + 1}`}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white"
              />
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-medium">Reflection</h2>
          <p className="mt-1 text-sm text-zinc-400">
            How did yesterday go? What did you learn?
          </p>

          <textarea
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            placeholder="Write freely…"
            rows={5}
            className="mt-4 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white"
          />
        </section>

        <div className="mt-10 flex gap-4">
          <button
            onClick={handleSubmit}
            className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200"
          >
            Save StandUp
          </button>

          <a
            href="/dashboard"
            className="rounded-xl border border-zinc-700 px-6 py-3 text-sm font-semibold transition hover:bg-zinc-900"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
