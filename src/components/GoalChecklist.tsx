"use client";

import { useRef, useState } from "react";
import { X, Check, Pencil, Trash2, ChevronDown, ChevronRight, ListPlus, ListChecks } from "lucide-react";
import {
  addChecklistItem,
  deleteChecklistItem,
  setChecklistItemStatus,
  updateChecklistItemText,
  type ChecklistItemStatus,
  getLists,
  getListItemsForLists,
  attachListToGoal,
  type ChecklistItem,
  type ShoppingList,
  type ShoppingListItem,
} from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const NEXT_STATUS: Record<ChecklistItemStatus, ChecklistItemStatus> = { pending: "completed", completed: "missing", missing: "pending" };
// Older rows/clients may lack `status`; derive it from the legacy boolean.
const statusOf = (i: ChecklistItem): ChecklistItemStatus => i.status ?? (i.is_checked ? "completed" : "pending");
const RED = "#f87171";
const GREEN = "#34d399";

/** Text colour / strike-through per status (shared with the read-only assignee view so both always look the same). */
export function checklistTextStyle(status: ChecklistItemStatus): React.CSSProperties {
  return status === "completed"
    ? { color: "rgba(var(--tint-rgb),0.4)", textDecoration: "line-through" }
    : status === "missing"
      ? { color: RED, textDecoration: "line-through", textDecorationColor: RED }
      : { color: "rgba(var(--tint-rgb),0.85)", textDecoration: "none" };
}

/** The box: empty (pending), green check (completed), red X (missing). Purely visual; the surrounding button/img carries the accessible name. */
export function StatusBox({ status }: { status: ChecklistItemStatus }) {
  const color = status === "completed" ? GREEN : status === "missing" ? RED : "rgba(255,255,255,0.45)";
  return (
    <span
      aria-hidden="true"
      data-status={status}
      className="inline-flex items-center justify-center rounded"
      style={{ width: 18, height: 18, border: `1.5px solid ${color}`, color }}
    >
      {status === "completed" && <Check size={13} strokeWidth={3} />}
      {status === "missing" && <X size={13} strokeWidth={3} />}
    </span>
  );
}

/** A goal's optional sub-item list (e.g. a grocery list under "Go to HEB"). Shared by Today, Tomorrow, and the date detail page. */
export default function GoalChecklist({
  goalId,
  items,
  onItemsChange,
  readOnly = false,
  compact = false,
  label,
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
  // Overrides the toggle's text (e.g. "My checklist" when an assignee's checklist is shown next to it).
  label?: string;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(items.length > 0);
  const [draft, setDraft] = useState("");
  const draftInputRef = useRef<HTMLInputElement | null>(null);
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
  // Missing is NOT completed: only completed items count toward the progress.
  const checkedCount = items.filter((i) => statusOf(i) === "completed").length;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const editSavingRef = useRef(false);
  const [editError, setEditError] = useState<string | null>(null);

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
    // Focus the field synchronously (still inside the tap / Enter gesture,
    // so a mobile keyboard stays open) -- the input is read-only, not
    // disabled, while adding, so it keeps focus and the cursor is ready
    // for the next item the moment this one lands.
    draftInputRef.current?.focus();
    setAdding(true);
    try {
      const nextPosition = items.length > 0 ? Math.max(...items.map((i) => i.position)) + 1 : 0;
      const created = await addChecklistItem(goalId, text, nextPosition);
      onItemsChange([...items, created]);
      // Only clear what was just added -- anything typed while it saved stays.
      setDraft((d) => (d.trim() === text ? "" : d));
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

  async function handleStatus(item: ChecklistItem) {
    if (busyIds.has(item.id)) return;
    setBusy(item.id, true);
    const next = NEXT_STATUS[statusOf(item)];
    onItemsChange(items.map((i) => (i.id === item.id ? { ...i, status: next, is_checked: next === "completed" } : i)));
    try {
      await setChecklistItemStatus(item.id, next);
    } catch {
      onItemsChange(items.map((i) => (i.id === item.id ? item : i)));
    } finally {
      setBusy(item.id, false);
    }
  }

  function startEdit(item: ChecklistItem) {
    setEditingId(item.id);
    setEditText(item.text);
    setEditError(null);
  }

  function cancelEdit() {
    if (editSavingRef.current) return;
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(item: ChecklistItem) {
    const text = editText.trim();
    if (!text || editSavingRef.current) return; // empty: nothing is written
    if (text === item.text) {
      setEditingId(null); // unchanged: nothing is written
      return;
    }
    editSavingRef.current = true;
    setEditSaving(true);
    setEditError(null);
    try {
      await updateChecklistItemText(item.id, text);
      // Text only: every other field of the row (id, position, status) is kept as it is in state.
      onItemsChange(items.map((i) => (i.id === item.id ? { ...i, text } : i)));
      setEditingId(null);
    } catch {
      setEditError(t("checklist.editFailed"));
    } finally {
      editSavingRef.current = false;
      setEditSaving(false);
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
    <div className={compact ? (expanded ? "goal-toolbar-expandable goal-toolbar-expandable-open" : "goal-toolbar-expandable") : "mt-3"}>
      {compact ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="btn btn-tint btn-blue goal-toolbar-btn"
          title={t("checklist.toggleCompact")}
        >
          <ListChecks size={13} />
          <span className="goal-toolbar-label">
            {label ?? t("checklist.toggleCompact")}{items.length > 0 ? ` (${checkedCount}/${items.length})` : ""}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-white/50 hover:text-white/80 transition"
        >
          <span className="inline-flex items-center gap-1">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {label ?? t("checklist.toggle")}{items.length > 0 ? ` (${checkedCount}/${items.length})` : ""}
          </span>
        </button>
      )}

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {sorted.map((item) => {
            const status = statusOf(item);
            const statusLabel = t(`checklist.status.${status}`);
            const isEditing = !readOnly && editingId === item.id;
            const textStyle = checklistTextStyle(status);
            return (
              <div key={item.id} className="flex items-center gap-1" data-testid="checklist-row" data-status={status}>
                {readOnly ? (
                  <span role="img" aria-label={statusLabel} title={statusLabel} className="inline-flex items-center justify-center flex-shrink-0" style={{ width: 28, height: 28 }}>
                    <StatusBox status={status} />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleStatus(item)}
                    disabled={busyIds.has(item.id) || isEditing}
                    aria-label={t("checklist.statusAria", { text: item.text, status: statusLabel, next: t(`checklist.status.${NEXT_STATUS[status]}`) })}
                    title={statusLabel}
                    className="inline-flex items-center justify-center flex-shrink-0 disabled:opacity-50"
                    style={{ width: 32, height: 32 }}
                  >
                    <StatusBox status={status} />
                  </button>
                )}
                {isEditing ? (
                  <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
                    <input
                      type="text"
                      autoFocus
                      aria-label={t("checklist.editLabel")}
                      value={editText}
                      disabled={editSaving}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveEdit(item);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      className="flex-1 min-w-0 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-sm text-white outline-none focus:border-white/40 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => void saveEdit(item)}
                      disabled={editSaving || !editText.trim()}
                      className="btn standup-metal-btn standup-metal-btn--accent"
                      style={{ padding: "0.3rem 0.7rem", fontSize: "0.75rem", minHeight: 32 }}
                    >
                      {editSaving ? t("checklist.saving") : t("checklist.save")}
                    </button>
                    <button type="button" onClick={cancelEdit} disabled={editSaving} className="btn standup-metal-btn" style={{ padding: "0.3rem 0.7rem", fontSize: "0.75rem", minHeight: 32 }}>
                      {t("checklist.cancel")}
                    </button>
                    {editError && (
                      <span role="alert" className="w-full text-xs text-red-300">
                        {editError}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="flex-1 min-w-0 text-sm" style={{ overflowWrap: "anywhere", ...textStyle }}>
                    {item.text}
                  </span>
                )}
                {!readOnly && !isEditing && (
                  <span className="inline-flex items-center flex-shrink-0" style={{ gap: 2 }}>
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      disabled={busyIds.has(item.id)}
                      className="inline-flex items-center justify-center text-white/40 hover:text-white/80 disabled:opacity-50"
                      style={{ width: 32, height: 32 }}
                      title={t("checklist.editItem")}
                      aria-label={t("checklist.editItem")}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      disabled={busyIds.has(item.id)}
                      className="inline-flex items-center justify-center text-white/40 hover:text-white/80 disabled:opacity-50"
                      style={{ width: 32, height: 32 }}
                      title={t("checklist.removeItem")}
                      aria-label={t("checklist.removeItem")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                )}
              </div>
            );
          })}

          {sorted.length === 0 && <div className="text-xs text-white/40 italic">{t("checklist.noItemsYet")}</div>}

          {!readOnly && (
            <div className="flex gap-2 mt-1.5 w-full" style={{ minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}>
              <input
                ref={draftInputRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                // Shows "Next"/an arrow instead of a generic checkmark on
                // mobile virtual keyboards -- explicit user call so it's
                // visibly clear that Enter moves on to the next item,
                // matching the already-wired onKeyDown behavior above.
                enterKeyHint="next"
                placeholder={t("checklist.addPlaceholder")}
                aria-busy={adding}
                className={`flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 ${adding ? "opacity-50" : ""}`}
              />
              <button
                type="button"
                onClick={handleAdd}
                // Keeps focus (and the mobile keyboard) in the input when
                // the button is tapped.
                onMouseDown={(e) => e.preventDefault()}
                disabled={adding || !draft.trim()}
                className="btn standup-metal-btn flex-shrink-0"
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
                  style={{
                    position: "absolute",
                    top: "calc(100% + 0.25rem)",
                    left: 0,
                    // Was a fixed 220px -- wider than a Task card's own
                    // available inner width on a narrow phone, so it
                    // overflowed past the card's right edge the same
                    // way the checklist rows did. min() caps it at
                    // whatever width the card actually has left.
                    width: "min(220px, 100%)",
                    maxWidth: "100%",
                    boxSizing: "border-box",
                    zIndex: 30,
                    padding: "0.35rem",
                  }}
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
