"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Goal = { text: string };

export default function TomorrowGoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([
    { text: "" },
    { text: "" },
    { text: "" },
  ]);

  const filled = useMemo(
    () => goals.filter((g) => g.text.trim().length > 0).length,
    [goals]
  );

  const canSave = filled >= 3;

  function updateGoal(i: number, text: string) {
    setGoals((prev) => prev.map((g, idx) => (idx === i ? { text } : g)));
  }

  function addGoal() {
    setGoals((prev) => [...prev, { text: "" }]);
  }

  function removeGoal(i: number) {
    setGoals((prev) => prev.filter((_, idx) => idx !== i));
  }

  function save() {
    if (!canSave) return;
    alert("Saved (next step: persist + streaks)");
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold">Tomorrow’s Goals</h1>
          <Link className="text-sm text-zinc-400 hover:text-zinc-200" href="/dashboard">
            Back
          </Link>
        </div>

        <p className="mt-2 text-zinc-400">
          You must set <span className="text-zinc-200 font-medium">at least 3 goals</span>.
        </p>

        <div className="mt-8 space-y-3">
          {goals.map((g, i) => (
            <div key={i} className="flex gap-3">
              <input
                value={g.text}
                onChange={(e) => updateGoal(i, e.target.value)}
                placeholder={`Goal ${i + 1}`}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 outline-none focus:border-zinc-600"
              />
              {goals.length > 3 && (
                <button
                  onClick={() => removeGoal(i)}
                  className="rounded-xl border border-zinc-800 px-4 py-3 text-sm hover:bg-zinc-900"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={addGoal}
            className="rounded-xl border border-zinc-800 px-5 py-3 text-sm font-semibold hover:bg-zinc-900"
          >
            + Add Goal
          </button>

          <button
            onClick={save}
            disabled={!canSave}
            className="rounded-xl bg-zinc-50 px-5 py-3 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save Tomorrow’s Goals
          </button>

          <div className="text-sm text-zinc-400">
            Filled: <span className="text-zinc-200 font-medium">{filled}</span>/3 minimum
          </div>
        </div>
      </div>
    </main>
  );
}
