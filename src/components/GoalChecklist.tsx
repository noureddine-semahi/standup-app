"use client";

import { useState } from "react";
import { X, ChevronDown, ChevronRight, ListPlus, ListChecks } from "lucide-react";
import {
  addChecklistItem,
  deleteChecklistItem,
  toggleChecklistItem,
  getLists,
  getListItemsForLists,
  attachListToGoal,
  type ChecklistItem,
  type ShoppingList,
  type ShoppingListItem,
} from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** A goal's optional sub-item list (e.g. a grocery list under "Go to HEB"). Shared by Today, Tomorrow, and the date detail page. */
export default function GoalChecklist({
  goalId,
  items,
  onItemsChange,
  readOnly = false,
  compact = false,
}: {
  goalId: string;
  items: ChecklistItem[];
  onItemsChange: (items: ChecklistItem[]) => void;
  readOnly?: boolean;
  // Small "+ Checklist" pill instead of the plain text toggle, and no
  // outer top margin — for callers placing this inline alongside other
  // compact controls (e.g. Plan Tomorrow's row under the time picker)
  // rather than stacked in its own block.
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(items.length > 0);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  // Standing lists (Backlog page) can be attached here to bulk-load their
  // items into this goal's checklist -- "select it directly from the
  // actual goal", the other half of Lists' push/attach pair. Fetched
  // lazily on first open rather than passed as a prop, so every caller
  // (Today/Tomorrow/date detail) gets this for free.
  const [showListPicker, setShowListPicker] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerLists, setPickerLists] = useState<ShoppingList[] | null>(null);
  const [pickerItemsByListId, setPickerItemsByListId] = useState<Record<string, ShoppingListItem[]>>({});
  const [attachingListId, setAttachingListId] = useState<string | null>(null);

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

  async function toggleListPicker() {
    const next = !showListPicker;
    setShowListPicker(next);
    if (next && pickerLists === null) {
      setPickerLoading(true);
      try {
        const ls = await getLists();
        setPickerLists(ls);
        setPickerItemsByListId(await getListItemsForLists(ls.map((l) => l.id)));
      } catch {
        setPickerLists([]);
      } finally {
        setPickerLoading(false);
      }
    }
  }

  async function handleAttachList(list: ShoppingList) {
    if (attachingListId) return;
    setAttachingListId(list.id);
    try {
      const listItems = pickerItemsByListId[list.id] ?? [];
      const created = await attachListToGoal(goalId, listItems);
      if (created.length > 0) onItemsChange([...items, ...created]);
      setShowListPicker(false);
    } catch {
      // Non-fatal — the picker just stays open so the user can retry.
    } finally {
      setAttachingListId(null);
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
    <div className={compact ? "" : "mt-3"}>
      {compact ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="btn btn-tint btn-blue goal-toolbar-btn"
          title={t("checklist.toggleCompact")}
        >
          <ListChecks size={13} />
          <span className="goal-toolbar-label">
            {t("checklist.toggleCompact")}{items.length > 0 ? ` (${checkedCount}/${items.length})` : ""}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-white/50 hover:text-white/80 transition"
        >
          <span className="inline-flex items-center gap-1">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {t("checklist.toggle")}{items.length > 0 ? ` (${checkedCount}/${items.length})` : ""}
          </span>
        </button>
      )}

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
                  color: item.is_checked ? "rgba(var(--tint-rgb),0.4)" : "rgba(var(--tint-rgb),0.85)",
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
                  title={t("checklist.removeItem")}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}

          {sorted.length === 0 && <div className="text-xs text-white/40 italic">{t("checklist.noItemsYet")}</div>}

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
                placeholder={t("checklist.addPlaceholder")}
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
                {adding ? t("checklist.adding") : t("checklist.add")}
              </button>
            </div>
          )}

          {!readOnly && (
            <div className="relative mt-1.5">
              <button
                type="button"
                onClick={toggleListPicker}
                className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white/80 transition"
              >
                <ListPlus size={12} /> {t("checklist.loadFromList")}
              </button>

              {showListPicker && (
                <div
                  className="card"
                  style={{ position: "absolute", top: "calc(100% + 0.25rem)", left: 0, width: "220px", zIndex: 30, padding: "0.35rem" }}
                >
                  {pickerLoading ? (
                    <div className="px-2 py-1.5 text-xs text-white/50">{t("checklist.loadingLists")}</div>
                  ) : !pickerLists || pickerLists.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-white/50 italic">{t("checklist.noListsToLoad")}</div>
                  ) : (
                    pickerLists.map((list) => {
                      const count = (pickerItemsByListId[list.id] ?? []).length;
                      return (
                        <button
                          key={list.id}
                          type="button"
                          onClick={() => handleAttachList(list)}
                          disabled={attachingListId !== null}
                          className="w-full text-left rounded-lg px-2 py-1.5 text-sm text-white/85 hover:bg-white/5 transition truncate disabled:opacity-50"
                        >
                          {attachingListId === list.id ? t("checklist.loadingLists") : `${list.name} (${count})`}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
