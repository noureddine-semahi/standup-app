"use client";

import { useState } from "react";
import {
  addChecklistItem,
  deleteChecklistItem,
  toggleChecklistItem,
  type ChecklistItem,
} from "@/lib/supabase/db";

/** A goal's optional sub-item list (e.g. a grocery list under "Go to HEB"). Shared by Today, Tomorrow, and the date detail page. */
export default function GoalChecklist({
  goalId,
  items,
  onItemsChange,
  readOnly = false,
}: {
  goalId: string;
  items: ChecklistItem[];
  onItemsChange: (items: ChecklistItem[]) => void;
  readOnly?: boolean;
}) {
  const [expanded, setExpanded] = useState(items.length > 0);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const sorted = [...items].sort((a, b) => a.position - b.position);
  const checkedCount = items.filter((i) => i.is_checked).length;

  // Read-only views (past days) with nothing to show shouldn't render an
  // empty, dead toggle — but an editable view always shows it, so there's
  // somewhere to add the first item.
  if (readOnly && items.length === 0) return null;

  function setBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleAdd() {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const nextPosition = items.length > 0 ? Math.max(...items.map((i) => i.position)) + 1 : 0;
      const created = await addChecklistItem(goalId, text, nextPosition);
      onItemsChange([...items, created]);
      setDraft("");
    } catch {
      // Non-fatal — the input just keeps its draft so the user can retry.
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(item: ChecklistItem) {
    if (busyIds.has(item.id)) return;
    setBusy(item.id, true);
    const nextChecked = !item.is_checked;
    onItemsChange(items.map((i) => (i.id === item.id ? { ...i, is_checked: nextChecked } : i)));
    try {
      await toggleChecklistItem(item.id, nextChecked);
    } catch {
      onItemsChange(items.map((i) => (i.id === item.id ? { ...i, is_checked: item.is_checked } : i)));
    } finally {
      setBusy(item.id, false);
    }
  }

  async function handleDelete(item: ChecklistItem) {
    if (busyIds.has(item.id)) return;
    setBusy(item.id, true);
    const prevItems = items;
    onItemsChange(items.filter((i) => i.id !== item.id));
    try {
      await deleteChecklistItem(item.id);
    } catch {
      onItemsChange(prevItems);
    } finally {
      setBusy(item.id, false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-xs text-white/50 hover:text-white/80 transition"
      >
        {expanded ? "▾" : "▸"} Checklist{items.length > 0 ? ` (${checkedCount}/${items.length})` : ""}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {sorted.map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={item.is_checked}
                disabled={readOnly || busyIds.has(item.id)}
                onChange={() => handleToggle(item)}
                className="w-4 h-4 flex-shrink-0 accent-emerald-500"
              />
              <span
                className="flex-1 min-w-0 text-sm"
                style={{
                  color: item.is_checked ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.85)",
                  textDecoration: item.is_checked ? "line-through" : "none",
                }}
              >
                {item.text}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  disabled={busyIds.has(item.id)}
                  className="flex-shrink-0 text-white/30 hover:text-white/70 text-xs"
                  title="Remove item"
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          {sorted.length === 0 && <div className="text-xs text-white/40 italic">No items yet.</div>}

          {!readOnly && (
            <div className="flex gap-2 mt-1.5">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder="Add item…"
                disabled={adding}
                className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={adding || !draft.trim()}
                className="btn"
                style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
              >
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
