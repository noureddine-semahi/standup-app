"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, X, Repeat, ListChecks, Target, NotebookPen } from "lucide-react";
import GoalsManagementPanel, { type ManagementView } from "@/components/GoalsManagementPanel";
import GoalNumberOrb from "@/components/GoalNumberOrb";
import NotesTab from "@/components/tools/NotesTab";
import { readStoredTab, writeStoredTab, readStoredTabRaw, FINANCE_TAB_REDIRECT, LEGACY_TOOLS_TAB } from "@/lib/toolsTabStorage";
import { useFixedSubNav } from "@/lib/useFixedSubNav";
import {
  addBacklogGoal,
  addLongTermGoal,
  addDays,
  deleteBacklogGoal,
  getBacklogGoals,
  promoteBacklogGoal,
  toISODate,
  getRecurringGoalTemplates,
  addRecurringGoalTemplate,
  setRecurringGoalTemplateActive,
  deleteRecurringGoalTemplate,
  formatDateDisplay,
  getLists,
  createList,
  deleteList,
  getListItemsForLists,
  addListItem,
  deleteListItem,
  pushListToGoal,
  type BacklogGoal,
  type RecurringGoalTemplate,
  type ShoppingList,
  type ShoppingListItem,
} from "@/lib/supabase/db";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { FREE_LIMITS, type AccountTier } from "@/lib/entitlements";
import { isRoutineLimitError, routineLimitReached } from "@/lib/routineLimit";
import { getMyEntitlement } from "@/lib/supabase/entitlements";
import { hexToRgbTriple } from "@/lib/color";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useLimitReachedText } from "@/lib/useFeatureFlags";
import type { TranslationKey } from "@/lib/i18n/en";

const WEEKDAY_KEYS: TranslationKey[] = [
  "calendar.daySun",
  "calendar.dayMon",
  "calendar.dayTue",
  "calendar.dayWed",
  "calendar.dayThu",
  "calendar.dayFri",
  "calendar.daySat",
];

// Phase 11B: a template active on most/all weekdays used to render its
// stored days one-per-line at 320px (7 lines for an every-day template),
// squeezing the title beside it. Common patterns get a named summary
// instead of a literal day list; anything else still lists the actual
// selected days (abbreviated, "Mon · Wed · Fri"), never a label that
// doesn't match what's actually stored.
function summarizeWeekdays(days: number[], t: (key: TranslationKey) => string): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return t("backlog.recurringEveryDay");
  if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) return t("backlog.recurringWeekdays");
  if (sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6) return t("backlog.recurringWeekends");
  return sorted.map((d) => t(WEEKDAY_KEYS[d])).join(" · ");
}

type ToolsTab = "goals" | "backlog" | "routines" | "lists" | "notes";

// Per-tab accent colors, same folder-tab theme and palette approach as
// Social's tab bar — explicit user call to apply it here too.
// descriptionKey backs the Tools card's own description, which now
// swaps per-tab instead of the page keeping one fixed subtitle.
// Tools -> Goals Phase 2: "goals" added as the FIRST entry -- the new
// central Goal management workspace. Pink/#f472b6 reuses this app's own
// existing "Goal" color identity (Dashboard's Target icon, Goal Detail's
// active-status chip) rather than picking an arbitrary new accent.
const TABS: { key: ToolsTab; labelKey: TranslationKey; headingKey: TranslationKey; icon: typeof Archive; color: string; descriptionKey: TranslationKey }[] = [
  { key: "goals", headingKey: "tools.headingGoals", labelKey: "backlog.tabGoals", icon: Target, color: "#f472b6", descriptionKey: "tools.descGoals" },
  { key: "backlog", headingKey: "tools.headingBacklog", labelKey: "backlog.tabBacklog", icon: Archive, color: "#60a5fa", descriptionKey: "tools.descBacklog" },
  { key: "routines", headingKey: "tools.headingRoutines", labelKey: "backlog.tabRecurring", icon: Repeat, color: "#22d3ee", descriptionKey: "tools.descRecurring" },
  { key: "lists", headingKey: "tools.headingLists", labelKey: "backlog.tabLists", icon: ListChecks, color: "#34d399", descriptionKey: "tools.descLists" },
  { key: "notes", headingKey: "tools.headingNotes", labelKey: "backlog.tabNotes", icon: NotebookPen, color: "#f59e0b", descriptionKey: "tools.descNotes" },
];

export default function ToolsPage() {
  const { t } = useLanguage();
  const limitText = useLimitReachedText();
  const router = useRouter();
  const [activeTab, setActiveTabState] = useState<ToolsTab>("goals");
  // Which view Goals opens on (a legacy Long-Term tab or link opens its Long-Term view).
  const [goalsView, setGoalsView] = useState<ManagementView | undefined>(undefined);
  // Restore the tab that was open before a refresh. This runs before the first paint, and only
  // the click handler writes the choice back, so the default can never overwrite the saved tab.
  // Finances used to be four tabs here (payments / planner / calculator / salary). A remembered
  // one, or a ?tab= link to one, now lands on the same tab of the Finances section instead.
  useLayoutEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("tab") ?? readStoredTabRaw() ?? "";
    const moved = FINANCE_TAB_REDIRECT[raw];
    if (moved) {
      writeStoredTab("goals");
      router.replace(`/standup/finances?${moved}`);
      return;
    }
    // Recurring is now Routines; Long-Term is a view inside Goals.
    const legacy = LEGACY_TOOLS_TAB[raw];
    if (legacy) {
      writeStoredTab(legacy.tab);
      setActiveTabState(legacy.tab as ToolsTab);
      if (legacy.view) setGoalsView(legacy.view as ManagementView);
      return;
    }
    const linked = readStoredTab(TABS.map((tab) => tab.key));
    const saved = TABS.some((tab) => tab.key === raw) ? (raw as ToolsTab) : linked;
    if (saved) setActiveTabState(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setActiveTab = (next: ToolsTab) => {
    setActiveTabState(next);
    writeStoredTab(next);
  };
  // Fixed-on-scroll for the Tools sub-tab bar -- active at every
  // viewport width, not just mobile (see useFixedSubNav's own comment).
  // activeTab is passed through so the hook can correct scroll position
  // under the pinned bar when the user switches sub-tabs.
  const { sentinelRef, barRef, wrapperRef, contentRef, barStyle, wrapperStyle } = useFixedSubNav(activeTab);
  const [items, setItems] = useState<BacklogGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftDetails, setDraftDetails] = useState("");
  const [draftPriority, setDraftPriority] = useState(3);
  const [adding, setAdding] = useState(false);

  const [pushDate, setPushDate] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const [templates, setTemplates] = useState<RecurringGoalTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateMsg, setTemplateMsg] = useState<string | null>(null);
  // Free plan: at most 3 ACTIVE routines. The database enforces it; these only say so up front.
  const [tier, setTier] = useState<AccountTier | null>(null);
  const [routineRefused, setRoutineRefused] = useState(false);
  const [newTemplateTitle, setNewTemplateTitle] = useState("");
  const [newTemplateDays, setNewTemplateDays] = useState<Set<number>>(new Set());
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [busyTemplateIds, setBusyTemplateIds] = useState<Set<string>>(new Set());
  // Phase 11B: Delete is permanent (unlike Retire, which just toggles
  // `active`) and previously fired with zero confirmation, styled
  // identically to Retire -- at most one row's inline "are you sure"
  // step open at a time, same pattern GoalAssignmentsPanel's cancel
  // flow already established for this codebase.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const [longTermMsg, setLongTermMsg] = useState<string | null>(null);
  const [ltDraftTitle, setLtDraftTitle] = useState("");
  const [ltDraftDetails, setLtDraftDetails] = useState("");
  const [ltDraftPriority, setLtDraftPriority] = useState(3);
  const [ltDraftTargetDate, setLtDraftTargetDate] = useState("");
  const [ltDraftCategory, setLtDraftCategory] = useState("");
  const [addingLongTerm, setAddingLongTerm] = useState(false);
  const [ltPushDate, setLtPushDate] = useState<Record<string, string>>({});
  const [busyLongTermIds, setBusyLongTermIds] = useState<Set<string>>(new Set());

  // Standing lists (grocery lists, packing lists) — separate from the
  // backlog/long-term goals above, no date or priority, just a name and an
  // ordered set of items added to whenever something comes to mind.
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [listItemsByListId, setListItemsByListId] = useState<Record<string, ShoppingListItem[]>>({});
  const [listsLoading, setListsLoading] = useState(true);
  const [listsMsg, setListsMsg] = useState<string | null>(null);
  const [newListName, setNewListName] = useState("");
  const [addingList, setAddingList] = useState(false);
  const [newListItemDraft, setNewListItemDraft] = useState<Record<string, string>>({});
  const [addingItemListId, setAddingItemListId] = useState<string | null>(null);
  // One new-item input per list, so Add / Next can leave the cursor in the
  // field ready for the next item.
  const listItemInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [busyListIds, setBusyListIds] = useState<Set<string>>(new Set());
  const [busyListItemIds, setBusyListItemIds] = useState<Set<string>>(new Set());
  const [listPushDate, setListPushDate] = useState<Record<string, string>>({});

  const todayISO = toISODate(new Date());
  const tomorrowISO = toISODate(addDays(new Date(), 1));

  useEffect(() => {
    refresh();
    refreshTemplates();
    refreshLists();
    getMyEntitlement().then((e) => setTier(e.tier), () => {});
  }, []);

  async function refreshTemplates() {
    setTemplatesLoading(true);
    setTemplateMsg(null);
    try {
      setTemplates(await getRecurringGoalTemplates());
    } catch (e: any) {
      setTemplateMsg(e?.message ?? t("backlog.failedLoadTemplates"));
    } finally {
      setTemplatesLoading(false);
    }
  }

  function toggleTemplateDay(day: number) {
    setNewTemplateDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function setTemplateBusy(id: string, busy: boolean) {
    setBusyTemplateIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleAddTemplate() {
    const title = newTemplateTitle.trim();
    if (!title || newTemplateDays.size === 0 || addingTemplate) return;
    setAddingTemplate(true);
    setTemplateMsg(null);
    try {
      const created = await addRecurringGoalTemplate({
        title,
        days_of_week: [...newTemplateDays].sort(),
      });
      setTemplates((prev) => [...prev, created]);
      setNewTemplateTitle("");
      setNewTemplateDays(new Set());
    } catch (e: any) {
      if (isRoutineLimitError(e)) setRoutineRefused(true);
      else setTemplateMsg(e?.message ?? t("backlog.failedAddTemplate"));
    } finally {
      setAddingTemplate(false);
    }
  }

  async function handleToggleTemplateActive(template: RecurringGoalTemplate) {
    if (busyTemplateIds.has(template.id)) return;
    setTemplateBusy(template.id, true);
    setTemplateMsg(null);
    try {
      await setRecurringGoalTemplateActive(template.id, !template.active);
      setTemplates((prev) => prev.map((t2) => (t2.id === template.id ? { ...t2, active: !template.active } : t2)));
      if (template.active) setRoutineRefused(false); // retiring one frees a slot
    } catch (e: any) {
      if (isRoutineLimitError(e)) setRoutineRefused(true);
      else setTemplateMsg(e?.message ?? t("backlog.failedUpdateTemplate"));
    } finally {
      setTemplateBusy(template.id, false);
    }
  }

  async function handleDeleteTemplate(template: RecurringGoalTemplate) {
    if (busyTemplateIds.has(template.id)) return;
    setTemplateBusy(template.id, true);
    setTemplateMsg(null);
    try {
      await deleteRecurringGoalTemplate(template.id);
      setTemplates((prev) => prev.filter((t2) => t2.id !== template.id));
      setConfirmingDeleteId((cur) => (cur === template.id ? null : cur));
      setRoutineRefused(false);
    } catch (e: any) {
      setTemplateMsg(e?.message ?? t("backlog.failedDeleteTemplate"));
    } finally {
      setTemplateBusy(template.id, false);
    }
  }

  async function refresh() {
    setLoading(true);
    setMsg(null);
    try {
      setItems(await getBacklogGoals());
    } catch (e: any) {
      setMsg(e?.message ?? t("backlog.failedLoad"));
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
      setMsg(e?.message ?? t("backlog.failedAdd"));
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
      setMsg(e?.message ?? t("backlog.failedRemove"));
    } finally {
      setBusy(item.id, false);
    }
  }

  async function handlePush(item: BacklogGoal, explicitDate?: string) {
    const date = explicitDate ?? pushDate[item.id];
    if (!date || busyIds.has(item.id)) return;
    setBusy(item.id, true);
    setMsg(null);
    try {
      await promoteBacklogGoal(item, date);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setMsg(t("backlog.movedTo", { title: item.title, date }));
    } catch (e: any) {
      setMsg(e?.message ?? t("backlog.failedSchedule"));
    } finally {
      setBusy(item.id, false);
    }
  }

  function setLongTermBusy(id: string, busy: boolean) {
    setBusyLongTermIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleAddLongTerm() {
    const title = ltDraftTitle.trim();
    if (!title || !ltDraftTargetDate || addingLongTerm) return;
    setAddingLongTerm(true);
    setLongTermMsg(null);
    try {
      const created = await addLongTermGoal(title, ltDraftDetails, ltDraftPriority, ltDraftTargetDate, ltDraftCategory);
      setItems((prev) => [...prev, created]);
      setLtDraftTitle("");
      setLtDraftDetails("");
      setLtDraftPriority(3);
      setLtDraftTargetDate("");
      setLtDraftCategory("");
    } catch (e: any) {
      setLongTermMsg(e?.message ?? t("backlog.failedAddLongTerm"));
    } finally {
      setAddingLongTerm(false);
    }
  }

  async function handleDeleteLongTerm(item: BacklogGoal) {
    if (busyLongTermIds.has(item.id)) return;
    setLongTermBusy(item.id, true);
    setLongTermMsg(null);
    try {
      await deleteBacklogGoal(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (e: any) {
      setLongTermMsg(e?.message ?? t("backlog.failedRemove"));
    } finally {
      setLongTermBusy(item.id, false);
    }
  }

  async function handlePushLongTerm(item: BacklogGoal) {
    const date = ltPushDate[item.id] ?? item.target_date ?? "";
    if (!date || busyLongTermIds.has(item.id)) return;
    setLongTermBusy(item.id, true);
    setLongTermMsg(null);
    try {
      await promoteBacklogGoal(item, date);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setLongTermMsg(t("backlog.movedTo", { title: item.title, date }));
    } catch (e: any) {
      setLongTermMsg(e?.message ?? t("backlog.failedSchedule"));
    } finally {
      setLongTermBusy(item.id, false);
    }
  }

  async function refreshLists() {
    setListsLoading(true);
    setListsMsg(null);
    try {
      const ls = await getLists();
      setLists(ls);
      setListItemsByListId(await getListItemsForLists(ls.map((l) => l.id)));
    } catch (e: any) {
      setListsMsg(e?.message ?? t("backlog.failedLoadLists"));
    } finally {
      setListsLoading(false);
    }
  }

  async function handleAddList() {
    const name = newListName.trim();
    if (!name || addingList) return;
    setAddingList(true);
    setListsMsg(null);
    try {
      const created = await createList(name);
      setLists((prev) => [...prev, created]);
      setListItemsByListId((prev) => ({ ...prev, [created.id]: [] }));
      setNewListName("");
    } catch (e: any) {
      setListsMsg(e?.message ?? t("backlog.failedAddList"));
    } finally {
      setAddingList(false);
    }
  }

  function setListBusy(id: string, busy: boolean) {
    setBusyListIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleDeleteList(list: ShoppingList) {
    if (busyListIds.has(list.id)) return;
    setListBusy(list.id, true);
    setListsMsg(null);
    try {
      await deleteList(list.id);
      setLists((prev) => prev.filter((l) => l.id !== list.id));
      setListItemsByListId((prev) => {
        const next = { ...prev };
        delete next[list.id];
        return next;
      });
    } catch (e: any) {
      setListsMsg(e?.message ?? t("backlog.failedDeleteList"));
      setListBusy(list.id, false);
    }
  }

  async function handleAddListItem(listId: string) {
    const text = (newListItemDraft[listId] ?? "").trim();
    if (!text || addingItemListId === listId) return;
    // Synchronous (inside the tap / Enter gesture) so a mobile keyboard
    // stays open; the input is read-only, not disabled, while adding.
    listItemInputRefs.current[listId]?.focus();
    setAddingItemListId(listId);
    setListsMsg(null);
    try {
      const existingItems = listItemsByListId[listId] ?? [];
      const nextPosition = existingItems.length > 0 ? Math.max(...existingItems.map((i) => i.position)) + 1 : 0;
      const created = await addListItem(listId, text, nextPosition);
      setListItemsByListId((prev) => ({ ...prev, [listId]: [...(prev[listId] ?? []), created] }));
      // Only clear what was just added -- anything typed while it saved stays.
      setNewListItemDraft((prev) => ({ ...prev, [listId]: (prev[listId] ?? "").trim() === text ? "" : prev[listId] ?? "" }));
    } catch (e: any) {
      setListsMsg(e?.message ?? t("backlog.failedAddListItem"));
    } finally {
      setAddingItemListId(null);
    }
  }

  async function handleDeleteListItem(listId: string, item: ShoppingListItem) {
    if (busyListItemIds.has(item.id)) return;
    setBusyListItemIds((prev) => new Set(prev).add(item.id));
    setListsMsg(null);
    try {
      await deleteListItem(item.id);
      setListItemsByListId((prev) => ({ ...prev, [listId]: (prev[listId] ?? []).filter((i) => i.id !== item.id) }));
    } catch (e: any) {
      setListsMsg(e?.message ?? t("backlog.failedDeleteListItem"));
    } finally {
      setBusyListItemIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function handlePushList(list: ShoppingList, explicitDate?: string) {
    const date = explicitDate ?? listPushDate[list.id];
    if (!date || busyListIds.has(list.id)) return;
    setListBusy(list.id, true);
    setListsMsg(null);
    try {
      const listItems = listItemsByListId[list.id] ?? [];
      await pushListToGoal(list.name, listItems, date);
      setListsMsg(t("backlog.listPushed", { name: list.name, date }));
    } catch (e: any) {
      setListsMsg(e?.message ?? t("backlog.failedPushList"));
    } finally {
      setListBusy(list.id, false);
    }
  }

  const routinesAtLimit = routineLimitReached(tier, templates, routineRefused);
  const plainItems = items.filter((i) => !i.target_date);
  const longTermItems = items.filter((i) => !!i.target_date);

  // Long-Term goals now live inside Goals (its third view next to My Goals and Assigned). Same records, same handlers; only
  // where it is shown changed.
  const longTermView = (
    <div data-testid="tools-longterm">
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-1">{t("backlog.longTermTitle")}</h2>
        <p className="text-sm text-white/70">{t("backlog.longTermSubtitle")}</p>
      </div>

      {longTermMsg && (
        <div className="mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
          {longTermMsg}
        </div>
      )}

      <div className="space-y-3 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={ltDraftPriority}
            onChange={(e) => setLtDraftPriority(Number(e.target.value))}
            disabled={addingLongTerm}
            className="priority-select"
            style={
              {
                "--p-bg": getPriorityMeta(ltDraftPriority).bg,
                "--p-border": getPriorityMeta(ltDraftPriority).border,
                "--p-color": getPriorityMeta(ltDraftPriority).color,
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
            value={ltDraftTitle}
            onChange={(e) => setLtDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddLongTerm();
            }}
            placeholder={t("backlog.longTermTitlePlaceholder")}
            disabled={addingLongTerm}
            className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <input
            type="date"
            value={ltDraftTargetDate}
            onChange={(e) => setLtDraftTargetDate(e.target.value)}
            disabled={addingLongTerm}
            className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40 disabled:opacity-50"
          />
          <input
            type="text"
            value={ltDraftCategory}
            onChange={(e) => setLtDraftCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddLongTerm();
            }}
            placeholder={t("backlog.categoryPlaceholder")}
            disabled={addingLongTerm}
            className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
          />
        </div>
        <input
          type="text"
          value={ltDraftDetails}
          onChange={(e) => setLtDraftDetails(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddLongTerm();
          }}
          placeholder={t("backlog.detailsPlaceholder")}
          disabled={addingLongTerm}
          className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleAddLongTerm}
          disabled={addingLongTerm || !ltDraftTitle.trim() || !ltDraftTargetDate}
          className="btn standup-metal-btn standup-metal-btn--accent"
        >
          {addingLongTerm ? t("backlog.adding") : t("backlog.addLongTermGoal")}
        </button>
      </div>

      {loading ? (
        <div className="text-white/60 text-center py-8">{t("backlog.loading")}</div>
      ) : longTermItems.length === 0 ? (
        <p className="text-sm text-white/50 italic">{t("backlog.noLongTermGoalsYet")}</p>
      ) : (
        <div className="space-y-4">
          {longTermItems.map((item, idx) => {
            const meta = getPriorityMeta(item.priority);
            const busy = busyLongTermIds.has(item.id);
            const isOverdue = !!item.target_date && item.target_date < todayISO;
            return (
              <div
                key={item.id}
                className="goal-row"
                style={{ "--p-color": meta.color } as React.CSSProperties}
              >
                <GoalNumberOrb number={idx + 1} />
                <button
                  type="button"
                  onClick={() => handleDeleteLongTerm(item)}
                  disabled={busy}
                  className="goal-delete-corner-btn"
                  title={t("backlog.removeFromBacklog")}
                >
                  <X size={12} />
                </button>
                <div className="goal-row-body" style={{ paddingTop: "1.25rem" }}>
                <div className="flex items-start flex-wrap gap-4">
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="text-white text-lg font-medium mb-1">{item.title}</div>
                    {item.details && <div className="text-sm text-white/60 mb-1">{item.details}</div>}
                    <div className="flex items-center flex-wrap gap-2">
                      <span
                        className={isOverdue ? "text-xs text-amber-300/80" : "text-xs text-white/50"}
                        title={isOverdue ? t("backlog.overdueTag") : undefined}
                      >
                        {formatDateDisplay(item.target_date as string)}
                      </span>
                      {item.category && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-white/70">
                          {item.category}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <input
                      type="date"
                      value={ltPushDate[item.id] ?? item.target_date ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        setLtPushDate((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      className="rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white outline-none focus:border-white/40 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => handlePushLongTerm(item)}
                      disabled={busy || !(ltPushDate[item.id] ?? item.target_date)}
                      className="btn standup-metal-btn"
                      style={{ padding: "0.375rem 0.9rem", fontSize: "0.8rem" }}
                    >
                      {t("backlog.push")}
                    </button>
                  </div>
                </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
    {/* Browser-tab / hanging-folder navigation, now sitting directly on
        top of (and visually merged with) the Tools heading card right
        below it, instead of a separate heading card above a separate
        tab bar — explicit user call, "tabs attached to the card like
        file-folder tabs." This wrapper (not space-y-6) is what lets the
        tab bar sit flush against the card that follows it — see
        .folder-tabbar's negative margin-bottom in globals.css. */}
    <div ref={wrapperRef} style={wrapperStyle}>
      <div ref={sentinelRef} style={{ height: 0 }} />
      <div ref={barRef} className="folder-tabbar folder-tabbar-tools tools-bar-fit" style={barStyle} role="tablist">
        {(() => {
          // CodePen-reference segmented nav: the tabs immediately LEFT
          // and RIGHT of the active one each get their own transition
          // shape (a glowing vertical line reaching into the gap toward
          // the active tab), derived purely from index -- the exact
          // "prev()/next() of whichever button was just clicked" rule
          // the reference's own jQuery used, done here declaratively
          // from React state instead. --active-glow-color carries the
          // ACTIVE tab's own accent color onto its neighbors (who each
          // have their OWN --tab-color already) -- the glow in the gap
          // represents light leaking from whichever tab is lit, not the
          // neighbor's own color, matching the reference's own render
          // (its glow sits on the ADJACENT button but visually "belongs"
          // to the active one next to it).
          const activeIndex = TABS.findIndex((t) => t.key === activeTab);
          const activeColor = TABS[activeIndex]?.color;
          return TABS.map((tab, idx) => {
            const isActive = idx === activeIndex;
            const isLeftOfActive = idx === activeIndex - 1;
            const isRightOfActive = idx === activeIndex + 1;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.key)}
                className={`folder-tab folder-tab-tools${isActive ? " folder-tab-active" : ""}${
                  isLeftOfActive ? " folder-tab-tools-left-of-active" : ""
                }${isRightOfActive ? " folder-tab-tools-right-of-active" : ""}`}
                style={
                  {
                    "--tab-color": tab.color,
                    "--tab-color-rgb": hexToRgbTriple(tab.color),
                    "--active-glow-color": activeColor,
                  } as React.CSSProperties
                }
              >
                <tab.icon size={15} />
                <span>{t(tab.labelKey)}</span>
              </button>
            );
          });
        })()}
      </div>

      {/* contentRef: the landmark useFixedSubNav scrolls to the top of on
          a tab switch while the bar is pinned -- always present
          regardless of which sub-tab is active. */}
      <div ref={contentRef} className="card card-highlight folder-tabbar-panel">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">{t(TABS.find((tab) => tab.key === activeTab)!.headingKey)}</h1>
        <p className="text-white/70">{t(TABS.find((tab) => tab.key === activeTab)!.descriptionKey)}</p>
      </div>

      {/* This outer wrapper (opened above, around the tab bar) now
          extends down to enclose all tab content too, instead of
          closing right after the hero card -- required for
          .folder-tabbar-tools' position:sticky (mobile) to work at
          all. A sticky element can never remain visible past its OWN
          DIRECT PARENT's bottom edge; when this div closed right after
          the hero card, that parent was only ~150px tall, so the tab
          bar stopped sticking almost immediately regardless of how
          much content followed as its sibling. Each tab-content block
          below gets an explicit mt-6 to replace the 1.5rem gap it used
          to get for free from being a direct child of the ROOT
          space-y-6 wrapper -- it's now a child of this plain
          (non-space-y) div instead. */}
    {activeTab === "goals" && (
      <div className="mt-6">
        <GoalsManagementPanel longTermView={longTermView} initialView={goalsView} />
      </div>
    )}

    {activeTab === "backlog" && (
    <div className="card card-highlight mt-6">
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
            placeholder={t("backlog.newGoalPlaceholder")}
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
          placeholder={t("backlog.detailsPlaceholder")}
          disabled={adding}
          className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !draftTitle.trim()}
          className="btn standup-metal-btn standup-metal-btn--accent"
        >
          {adding ? t("backlog.adding") : t("backlog.addToBacklog")}
        </button>
      </div>

      {loading ? (
        <div className="text-white/60 text-center py-8">{t("backlog.loading")}</div>
      ) : plainItems.length === 0 ? (
        <div className="text-white/70 text-center py-12">
          <Archive className="mx-auto mb-4 text-white/40" size={40} strokeWidth={1.5} />
          <p className="text-lg mb-2">{t("backlog.nothingInBacklog")}</p>
          <p className="text-sm text-white/50">{t("backlog.staysPutMsg")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {plainItems.map((item, idx) => {
            const meta = getPriorityMeta(item.priority);
            const busy = busyIds.has(item.id);
            return (
              <div
                key={item.id}
                className="goal-row"
                style={{ "--p-color": meta.color } as React.CSSProperties}
              >
                <GoalNumberOrb number={idx + 1} />
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  disabled={busy}
                  className="goal-delete-corner-btn"
                  title={t("backlog.removeFromBacklog")}
                >
                  <X size={12} />
                </button>
                <div className="goal-row-body" style={{ paddingTop: "1.25rem" }}>
                <div className="flex items-start flex-wrap gap-3 justify-between mb-3">
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="text-white text-lg font-medium mb-1">{item.title}</div>
                    {item.details && <div className="text-sm text-white/60">{item.details}</div>}
                  </div>
                </div>

                {/* Push to Tomorrow + date picker share a line; Push sits
                    full-width below them (spanning the same combined width)
                    and is the one colored (btn-primary) control in this
                    card, since it's the actual commit action — the other
                    two are just setting up what/when. */}
                <div className="flex items-stretch gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => handlePush(item, tomorrowISO)}
                    disabled={busy}
                    className="btn standup-metal-btn flex-1 min-w-0 flex items-center justify-center"
                    style={{ height: "36px", padding: "0 0.9rem", fontSize: "0.8rem", minWidth: "130px" }}
                    title={t("backlog.pushToTomorrowTitle", { date: tomorrowISO })}
                  >
                    <span className="tools-push-btn-label">{t("backlog.pushToTomorrow")}</span>
                  </button>
                  <input
                    type="date"
                    value={pushDate[item.id] ?? ""}
                    min={todayISO}
                    disabled={busy}
                    onChange={(e) =>
                      setPushDate((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    className="flex-1 min-w-0 rounded-lg border border-white/20 bg-white/10 px-2 text-sm text-white outline-none focus:border-white/40 disabled:opacity-50"
                    style={{ height: "36px" }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handlePush(item)}
                  disabled={busy || !pushDate[item.id]}
                  className="btn standup-metal-btn standup-metal-btn--accent w-full"
                  style={{ padding: "0.375rem 0.9rem", fontSize: "0.8rem" }}
                >
                  {t("backlog.push")}
                </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
    )}

    {activeTab === "routines" && (
    <div className="card card-highlight mt-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-1">{t("backlog.recurringTitle")}</h2>
        <p className="text-sm text-white/70">{t("backlog.recurringSubtitle")}</p>
      </div>

      {templateMsg && (
        <div className="mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
          {templateMsg}
        </div>
      )}

      {routinesAtLimit && (
        <div role="status" className="mb-4 rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-sm" data-testid="routines-limit">
          {limitText("routines", FREE_LIMITS.routines)}
        </div>
      )}

      <div className="space-y-3 mb-6">
        <input
          type="text"
          value={newTemplateTitle}
          onChange={(e) => setNewTemplateTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddTemplate();
          }}
          placeholder={t("backlog.recurringTitlePlaceholder")}
          disabled={addingTemplate}
          className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
        />
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_KEYS.map((key, day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleTemplateDay(day)}
              disabled={addingTemplate}
              className="btn"
              style={{
                padding: "0.3rem 0.7rem",
                fontSize: "0.8rem",
                background: newTemplateDays.has(day) ? "rgba(245, 158, 11, 0.2)" : undefined,
                borderColor: newTemplateDays.has(day) ? "rgba(245, 158, 11, 0.6)" : undefined,
              }}
            >
              {t(key)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleAddTemplate}
          disabled={addingTemplate || !newTemplateTitle.trim() || newTemplateDays.size === 0 || routinesAtLimit}
          className="btn standup-metal-btn standup-metal-btn--accent"
        >
          {addingTemplate ? t("backlog.addingTemplate") : t("backlog.addTemplate")}
        </button>
      </div>

      {templatesLoading ? (
        <div className="text-white/60 text-center py-6">{t("backlog.loading")}</div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-white/50 italic">{t("backlog.noTemplatesYet")}</p>
      ) : (
        <div className="space-y-2">
          {templates.map((template) => {
            const busy = busyTemplateIds.has(template.id);
            const confirmingDelete = confirmingDeleteId === template.id;
            return (
              <div key={template.id} className="recurring-row" data-active={template.active}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-white/85 truncate">{template.title}</span>
                    <span className="recurring-state-badge" data-active={template.active}>
                      {template.active ? t("backlog.recurringActive") : t("backlog.recurringRetired")}
                    </span>
                  </div>
                  <div className="text-[11px] text-white/40 mt-0.5">
                    {summarizeWeekdays(template.days_of_week, t)}
                  </div>
                </div>
                {confirmingDelete ? (
                  <div className="flex items-center gap-1.5 flex-wrap" style={{ flexShrink: 0 }}>
                    <span className="text-xs text-white/60">{t("backlog.confirmDeleteTemplateQuestion")}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(template)}
                      disabled={busy}
                      className="btn standup-metal-btn standup-metal-btn--danger"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                    >
                      {t("backlog.confirmDeleteTemplateYes")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                      disabled={busy}
                      className="btn standup-metal-btn"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                    >
                      {t("backlog.confirmDeleteTemplateNo")}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleTemplateActive(template)}
                      disabled={busy || (!template.active && routinesAtLimit)}
                      className="btn standup-metal-btn"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                    >
                      {template.active ? t("backlog.retireTemplate") : t("backlog.reactivateTemplate")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(template.id)}
                      disabled={busy}
                      className="btn standup-metal-btn standup-metal-btn--danger"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                    >
                      {t("backlog.deleteTemplate")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    )}

    {activeTab === "lists" && (
    <div className="card card-highlight mt-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-1">{t("backlog.listsTitle")}</h2>
        <p className="text-sm text-white/70">{t("backlog.listsSubtitle")}</p>
      </div>

      {listsMsg && (
        <div className="mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
          {listsMsg}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddList();
          }}
          placeholder={t("backlog.newListPlaceholder")}
          disabled={addingList}
          className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleAddList}
          disabled={addingList || !newListName.trim()}
          className="btn standup-metal-btn standup-metal-btn--accent"
        >
          {addingList ? t("backlog.adding") : t("backlog.addList")}
        </button>
      </div>

      {listsLoading ? (
        <div className="text-white/60 text-center py-6">{t("backlog.loading")}</div>
      ) : lists.length === 0 ? (
        <p className="text-sm text-white/50 italic">{t("backlog.noListsYet")}</p>
      ) : (
        <div className="space-y-4">
          {lists.map((list, idx) => {
            const listItems = listItemsByListId[list.id] ?? [];
            const busy = busyListIds.has(list.id);
            return (
              <div key={list.id} className="rounded-xl border border-white/10 bg-white/5 pt-6 px-4 pb-4" style={{ position: "relative" }}>
                <GoalNumberOrb number={idx + 1} />
                <button
                  type="button"
                  onClick={() => handleDeleteList(list)}
                  disabled={busy}
                  className="goal-delete-corner-btn"
                  title={t("backlog.deleteList")}
                >
                  <X size={12} />
                </button>
                <div className="mb-3">
                  <div className="text-white font-medium">
                    {list.name}
                    <span className="ml-2 text-xs text-white/40">
                      {t(listItems.length === 1 ? "backlog.listItemCount.one" : "backlog.listItemCount.other", { count: listItems.length })}
                    </span>
                  </div>
                </div>

                {/* Same layout as the Backlog cards: Push to Tomorrow +
                    date picker share a line, Push sits full-width below
                    spanning that same combined width, colored (btn-primary)
                    as the one actual commit action in the card. */}
                <div className="flex items-stretch gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => handlePushList(list, tomorrowISO)}
                    disabled={busy}
                    className="btn standup-metal-btn flex-1 min-w-0 flex items-center justify-center"
                    style={{ height: "36px", padding: "0 0.6rem", fontSize: "0.75rem", minWidth: "116px" }}
                    title={t("backlog.pushToTomorrowTitle", { date: tomorrowISO })}
                  >
                    <span className="tools-push-btn-label">{t("backlog.pushToTomorrow")}</span>
                  </button>
                  <input
                    type="date"
                    value={listPushDate[list.id] ?? ""}
                    min={todayISO}
                    disabled={busy}
                    onChange={(e) => setListPushDate((prev) => ({ ...prev, [list.id]: e.target.value }))}
                    className="flex-1 min-w-0 rounded-lg border border-white/20 bg-white/10 px-2 text-sm text-white outline-none focus:border-white/40 disabled:opacity-50"
                    style={{ height: "36px" }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handlePushList(list)}
                  disabled={busy || !listPushDate[list.id]}
                  className="btn standup-metal-btn standup-metal-btn--accent w-full mb-3"
                  style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                >
                  {t("backlog.push")}
                </button>

                {listItems.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {listItems.map((item) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 text-sm text-white/80">{item.text}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteListItem(list.id, item)}
                          disabled={busyListItemIds.has(item.id)}
                          className="flex-shrink-0 text-white/30 hover:text-white/70"
                          title={t("backlog.removeListItem")}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-stretch gap-2">
                  <input
                    ref={(el) => {
                      listItemInputRefs.current[list.id] = el;
                    }}
                    type="text"
                    value={newListItemDraft[list.id] ?? ""}
                    onChange={(e) => setNewListItemDraft((prev) => ({ ...prev, [list.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddListItem(list.id);
                      }
                    }}
                    // Shows "Next"/an arrow instead of a generic checkmark
                    // on mobile virtual keyboards -- explicit user call so
                    // it's visibly clear that Enter moves on to the next
                    // item, matching the already-wired onKeyDown above.
                    enterKeyHint="next"
                    placeholder={t("backlog.newListItemPlaceholder")}
                    aria-busy={addingItemListId === list.id}
                    className={`flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 ${addingItemListId === list.id ? "opacity-50" : ""}`}
                    style={{ height: "36px" }}
                  />
                  <button
                    type="button"
                    onClick={() => handleAddListItem(list.id)}
                    // Keeps focus (and the mobile keyboard) in the input
                    // when the button is tapped.
                    onMouseDown={(e) => e.preventDefault()}
                    disabled={addingItemListId === list.id || !(newListItemDraft[list.id] ?? "").trim()}
                    className="btn standup-metal-btn flex-shrink-0 flex items-center justify-center"
                    style={{ height: "36px", padding: "0 0.75rem", fontSize: "0.75rem" }}
                  >
                    {addingItemListId === list.id ? t("backlog.adding") : t("backlog.addItem")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    )}


    {activeTab === "notes" && (
      <div className="mt-6">
        <NotesTab />
      </div>
    )}
    </div>
    </div>
  );
}
