"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  addBacklogGoal,
  deleteBacklogGoal,
  getBacklogGoals,
  promoteBacklogGoal,
  toISODate,
  type BacklogGoal,
} from "@/lib/supabase/db";
import { getPriorityMeta } from "@/lib/priorityStyles";

export default function BacklogPage() {
  const [items, setItems] = useState<BacklogGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftDetails, setDraftDetails] = useState("");
  const [draftPriority, setDraftPriority] = useState(3);
  const [adding, setAdding] = useState(false);

  const [pushDate, setPushDate] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const todayISO = toISODate(new Date());

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setMsg(null);
    try {
      setItems(await getBacklogGoals());
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load backlog");
    } finally {
      setLoading(false);
    }
  }

  function setBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleAdd() {
    const title = draftTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    setMsg(null);
    try {
      const created = await addBacklogGoal(title, draftDetails, draftPriority);
      setItems((prev) => [...prev, created]);
      setDraftTitle("");
      setDraftDetails("");
      setDraftPriority(3);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to add goal");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(item: BacklogGoal) {
    if (busyIds.has(item.id)) return;
    setBusy(item.id, true);
    setMsg(null);
    try {
      await deleteBacklogGoal(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to remove goal");
    } finally {
      setBusy(item.id, false);
    }
  }

  async function handlePush(item: BacklogGoal) {
    const date = pushDate[item.id];
    if (!date || busyIds.has(item.id)) return;
    setBusy(item.id, true);
    setMsg(null);
    try {
      await promoteBacklogGoal(item, date);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setMsg(`"${item.title}" moved to ${date}.`);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to schedule goal");
    } finally {
      setBusy(item.id, false);
    }
  }

  return (
    <div className="card card-highlight">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">Backlog</h1>
        <p className="text-white/70">
          Goals you know you want to do, without committing them to a day yet. Push one onto the
          calendar whenever time opens up.
        </p>
      </div>

      {msg && (
        <div className="mb-6 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
          {msg}
        </div>
      )}

      <div className="space-y-3 mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={draftPriority}
            onChange={(e) => setDraftPriority(Number(e.target.value))}
            disabled={adding}
            className="priority-select"
            style={
              {
                "--p-bg": getPriorityMeta(draftPriority).bg,
                "--p-border": getPriorityMeta(draftPriority).border,
                "--p-color": getPriorityMeta(draftPriority).color,
              } as React.CSSProperties
            }
          >
            {[1, 2, 3, 4, 5].map((v) => (
              <option key={v} value={v}>
                P{v}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            placeholder="New backlog goal..."
            disabled={adding}
            className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
          />
        </div>
        <input
          type="text"
          value={draftDetails}
          onChange={(e) => setDraftDetails(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder="Details (optional)..."
          disabled={adding}
          className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !draftTitle.trim()}
          className="btn btn-primary"
        >
          {adding ? "Adding…" : "+ Add to backlog"}
        </button>
      </div>

      {loading ? (
        <div className="text-white/60 text-center py-8">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-white/70 text-center py-12">
          <div className="text-4xl mb-4">🗂️</div>
          <p className="text-lg mb-2">Nothing in the backlog</p>
          <p className="text-sm text-white/50">Goals added here stay put until you push them to a day.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const meta = getPriorityMeta(item.priority);
            const busy = busyIds.has(item.id);
            return (
              <div
                key={item.id}
                className="goal-row"
                style={{ "--p-color": meta.color } as React.CSSProperties}
              >
                <div className="flex items-start flex-wrap gap-4">
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="text-white text-lg font-medium mb-1">{item.title}</div>
                    {item.details && <div className="text-sm text-white/60">{item.details}</div>}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <input
                      type="date"
                      value={pushDate[item.id] ?? ""}
                      min={todayISO}
                      disabled={busy}
                      onChange={(e) =>
                        setPushDate((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      className="rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white outline-none focus:border-white/40 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => handlePush(item)}
                      disabled={busy || !pushDate[item.id]}
                      className="btn"
                      style={{ padding: "0.375rem 0.9rem", fontSize: "0.8rem" }}
                    >
                      Push
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      disabled={busy}
                      className="flex-shrink-0 flex items-center justify-center text-white/50 hover:text-white/90 text-sm"
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "8px",
                        background: "rgba(255, 255, 255, 0.06)",
                        border: "1px solid rgba(255, 255, 255, 0.15)",
                      }}
                      title="Remove from backlog"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-4 items-center justify-between">
        <Link className="btn btn-ghost bottom-nav-btn" href="/standup/tomorrow">
          ← Plan Tomorrow
        </Link>
        <Link className="btn btn-ghost bottom-nav-btn" href="/standup/dashboard">
          Dashboard →
        </Link>
      </div>
    </div>
  );
}
