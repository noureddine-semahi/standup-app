"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, X, CalendarClock, Repeat, ListChecks, ClipboardList, CreditCard, History } from "lucide-react";
import GoalAssignmentsPanel from "@/components/GoalAssignmentsPanel";
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
  getPaymentAccounts,
  createPaymentAccount,
  updatePaymentAccount,
  deletePaymentAccount,
  computeNextDueDate,
  getPaymentTransactions,
  formatDateTimeDisplay,
  type BacklogGoal,
  type RecurringGoalTemplate,
  type ShoppingList,
  type ShoppingListItem,
  type PaymentAccount,
  type PaymentTransaction,
} from "@/lib/supabase/db";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
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

type ToolsTab = "backlog" | "longTerm" | "recurring" | "lists" | "payments" | "assignments";

const TABS: { key: ToolsTab; labelKey: TranslationKey; icon: typeof Archive }[] = [
  { key: "backlog", labelKey: "backlog.tabBacklog", icon: Archive },
  { key: "longTerm", labelKey: "backlog.tabLongTerm", icon: CalendarClock },
  { key: "recurring", labelKey: "backlog.tabRecurring", icon: Repeat },
  { key: "lists", labelKey: "backlog.tabLists", icon: ListChecks },
  { key: "payments", labelKey: "backlog.tabPayments", icon: CreditCard },
  { key: "assignments", labelKey: "backlog.tabAssignments", icon: ClipboardList },
];

export default function ToolsPage() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<ToolsTab>("backlog");
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
  const [newTemplateTitle, setNewTemplateTitle] = useState("");
  const [newTemplateDays, setNewTemplateDays] = useState<Set<number>>(new Set());
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [busyTemplateIds, setBusyTemplateIds] = useState<Set<string>>(new Set());

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
  const [busyListIds, setBusyListIds] = useState<Set<string>>(new Set());
  const [busyListItemIds, setBusyListItemIds] = useState<Set<string>>(new Set());
  const [listPushDate, setListPushDate] = useState<Record<string, string>>({});

  // Payment reminders (credit cards, bills) — balance/minimum/due-day per
  // account, no date of its own; the next due date is computed on read
  // (computeNextDueDate), never stored.
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentsMsg, setPaymentsMsg] = useState<string | null>(null);
  const [newPaymentName, setNewPaymentName] = useState("");
  const [newPaymentBalance, setNewPaymentBalance] = useState("");
  const [newPaymentMinimum, setNewPaymentMinimum] = useState("");
  const [newPaymentDueDay, setNewPaymentDueDay] = useState("");
  const [newPaymentRemindDays, setNewPaymentRemindDays] = useState("3");
  const [addingPayment, setAddingPayment] = useState(false);
  const [busyPaymentIds, setBusyPaymentIds] = useState<Set<string>>(new Set());

  // Payment history — collapsed by default per account, fetched lazily on
  // first expand rather than loading every account's whole ledger up
  // front (most accounts will never be expanded in a given visit).
  const [expandedPaymentHistoryId, setExpandedPaymentHistoryId] = useState<string | null>(null);
  const [paymentHistoryByAccount, setPaymentHistoryByAccount] = useState<Record<string, PaymentTransaction[]>>({});
  const [paymentHistoryLoadingId, setPaymentHistoryLoadingId] = useState<string | null>(null);

  const todayISO = toISODate(new Date());
  const tomorrowISO = toISODate(addDays(new Date(), 1));

  useEffect(() => {
    refresh();
    refreshTemplates();
    refreshLists();
    refreshPayments();
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
      setTemplateMsg(e?.message ?? t("backlog.failedAddTemplate"));
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
    } catch (e: any) {
      setTemplateMsg(e?.message ?? t("backlog.failedUpdateTemplate"));
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
    setAddingItemListId(listId);
    setListsMsg(null);
    try {
      const existingItems = listItemsByListId[listId] ?? [];
      const nextPosition = existingItems.length > 0 ? Math.max(...existingItems.map((i) => i.position)) + 1 : 0;
      const created = await addListItem(listId, text, nextPosition);
      setListItemsByListId((prev) => ({ ...prev, [listId]: [...(prev[listId] ?? []), created] }));
      setNewListItemDraft((prev) => ({ ...prev, [listId]: "" }));
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

  async function refreshPayments() {
    setPaymentsLoading(true);
    setPaymentsMsg(null);
    try {
      setPaymentAccounts(await getPaymentAccounts());
    } catch (e: any) {
      setPaymentsMsg(e?.message ?? t("backlog.failedLoadPayments"));
    } finally {
      setPaymentsLoading(false);
    }
  }

  function setPaymentBusy(id: string, busy: boolean) {
    setBusyPaymentIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleAddPayment() {
    const name = newPaymentName.trim();
    const dueDay = Number(newPaymentDueDay);
    if (!name || !dueDay || dueDay < 1 || dueDay > 31 || addingPayment) return;
    setAddingPayment(true);
    setPaymentsMsg(null);
    try {
      const created = await createPaymentAccount({
        name,
        balance: Number(newPaymentBalance) || 0,
        minimumPayment: Number(newPaymentMinimum) || 0,
        dueDay,
        remindDaysBefore: Number(newPaymentRemindDays) || 0,
      });
      setPaymentAccounts((prev) => [...prev, created]);
      setNewPaymentName("");
      setNewPaymentBalance("");
      setNewPaymentMinimum("");
      setNewPaymentDueDay("");
      setNewPaymentRemindDays("3");
    } catch (e: any) {
      setPaymentsMsg(e?.message ?? t("backlog.failedAddPayment"));
    } finally {
      setAddingPayment(false);
    }
  }

  async function handleUpdatePaymentField(
    account: PaymentAccount,
    field: "name" | "balance" | "minimumPayment" | "dueDay" | "remindDaysBefore",
    rawValue: string
  ) {
    let value: string | number = rawValue;
    if (field !== "name") {
      value = Number(rawValue);
      if (!Number.isFinite(value)) return;
      if (field === "dueDay" && (value < 1 || value > 31)) return;
    }
    if (busyPaymentIds.has(account.id)) return;
    setPaymentBusy(account.id, true);
    setPaymentsMsg(null);
    try {
      const updated = await updatePaymentAccount(account.id, { [field]: value } as Partial<PaymentAccount>);
      setPaymentAccounts((prev) => prev.map((a) => (a.id === account.id ? updated : a)));
    } catch (e: any) {
      setPaymentsMsg(e?.message ?? t("backlog.failedUpdatePayment"));
    } finally {
      setPaymentBusy(account.id, false);
    }
  }

  async function handleDeletePayment(account: PaymentAccount) {
    if (busyPaymentIds.has(account.id)) return;
    setPaymentBusy(account.id, true);
    setPaymentsMsg(null);
    try {
      await deletePaymentAccount(account.id);
      setPaymentAccounts((prev) => prev.filter((a) => a.id !== account.id));
    } catch (e: any) {
      setPaymentsMsg(e?.message ?? t("backlog.failedDeletePayment"));
      setPaymentBusy(account.id, false);
    }
  }

  function toggleHistory(account: PaymentAccount) {
    if (expandedPaymentHistoryId === account.id) {
      setExpandedPaymentHistoryId(null);
      return;
    }
    setExpandedPaymentHistoryId(account.id);
    if (paymentHistoryByAccount[account.id]) return; // already fetched once this visit
    setPaymentHistoryLoadingId(account.id);
    getPaymentTransactions(account.id)
      .then((rows) => setPaymentHistoryByAccount((prev) => ({ ...prev, [account.id]: rows })))
      .catch((e: any) => setPaymentsMsg(e?.message ?? t("backlog.failedLoadPaymentHistory")))
      .finally(() => setPaymentHistoryLoadingId((cur) => (cur === account.id ? null : cur)));
  }

  const plainItems = items.filter((i) => !i.target_date);
  const longTermItems = items.filter((i) => !!i.target_date);

  return (
    <div className="space-y-6">
    <div className="card card-highlight">
      <div className="mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">{t("nav.tools")}</h1>
        <p className="text-white/70">
          {t("tools.subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className="btn inline-flex items-center gap-1.5"
            style={{
              background: activeTab === tab.key ? "rgba(245, 158, 11, 0.2)" : undefined,
              borderColor: activeTab === tab.key ? "rgba(245, 158, 11, 0.6)" : undefined,
            }}
          >
            <tab.icon size={14} /> {t(tab.labelKey)}
          </button>
        ))}
      </div>
    </div>

    {activeTab === "backlog" && (
    <div className="card card-highlight">
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
          className="btn btn-primary"
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
          {plainItems.map((item) => {
            const meta = getPriorityMeta(item.priority);
            const busy = busyIds.has(item.id);
            return (
              <div
                key={item.id}
                className="goal-row"
                style={{ "--p-color": meta.color } as React.CSSProperties}
              >
                <div className="goal-row-body" style={{ paddingTop: "1.25rem" }}>
                <div className="flex items-start flex-wrap gap-4">
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="text-white text-lg font-medium mb-1">{item.title}</div>
                    {item.details && <div className="text-sm text-white/60">{item.details}</div>}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handlePush(item, tomorrowISO)}
                      disabled={busy}
                      className="btn"
                      style={{ padding: "0.375rem 0.9rem", fontSize: "0.8rem" }}
                      title={t("backlog.pushToTomorrowTitle", { date: tomorrowISO })}
                    >
                      {t("backlog.pushToTomorrow")}
                    </button>
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
                      {t("backlog.push")}
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
                        background: "rgba(var(--tint-rgb), 0.06)",
                        border: "1px solid rgba(var(--tint-rgb), 0.15)",
                      }}
                      title={t("backlog.removeFromBacklog")}
                    >
                      <X size={14} />
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
    )}

    {activeTab === "longTerm" && (
    <div className="card card-highlight">
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
          className="btn btn-primary"
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
          {longTermItems.map((item) => {
            const meta = getPriorityMeta(item.priority);
            const busy = busyLongTermIds.has(item.id);
            const isOverdue = !!item.target_date && item.target_date < todayISO;
            return (
              <div
                key={item.id}
                className="goal-row"
                style={{ "--p-color": meta.color } as React.CSSProperties}
              >
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
                      className="btn"
                      style={{ padding: "0.375rem 0.9rem", fontSize: "0.8rem" }}
                    >
                      {t("backlog.push")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteLongTerm(item)}
                      disabled={busy}
                      className="flex-shrink-0 flex items-center justify-center text-white/50 hover:text-white/90 text-sm"
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "8px",
                        background: "rgba(var(--tint-rgb), 0.06)",
                        border: "1px solid rgba(var(--tint-rgb), 0.15)",
                      }}
                      title={t("backlog.removeFromBacklog")}
                    >
                      <X size={14} />
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
    )}

    {activeTab === "recurring" && (
    <div className="card card-highlight">
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-1">{t("backlog.recurringTitle")}</h2>
        <p className="text-sm text-white/70">{t("backlog.recurringSubtitle")}</p>
      </div>

      {templateMsg && (
        <div className="mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
          {templateMsg}
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
          disabled={addingTemplate || !newTemplateTitle.trim() || newTemplateDays.size === 0}
          className="btn btn-primary"
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
            return (
              <div
                key={template.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2"
                style={{ opacity: template.active ? 1 : 0.5 }}
              >
                <div className="min-w-0">
                  <div className="text-sm text-white/85 truncate">{template.title}</div>
                  <div className="text-[11px] text-white/40">
                    {template.days_of_week.map((d) => t(WEEKDAY_KEYS[d])).join(" ")}
                  </div>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleTemplateActive(template)}
                    disabled={busy}
                    className="btn"
                    style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                  >
                    {template.active ? t("backlog.retireTemplate") : t("backlog.reactivateTemplate")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTemplate(template)}
                    disabled={busy}
                    className="btn"
                    style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                  >
                    {t("backlog.deleteTemplate")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    )}

    {activeTab === "lists" && (
    <div className="card card-highlight">
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
          className="btn btn-primary"
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
          {lists.map((list) => {
            const listItems = listItemsByListId[list.id] ?? [];
            const busy = busyListIds.has(list.id);
            return (
              <div key={list.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start flex-wrap gap-3 justify-between mb-3">
                  <div className="text-white font-medium">
                    {list.name}
                    <span className="ml-2 text-xs text-white/40">
                      {t(listItems.length === 1 ? "backlog.listItemCount.one" : "backlog.listItemCount.other", { count: listItems.length })}
                    </span>
                  </div>
                  {/* flex-wrap (not flex-shrink-0) so this cluster breaks
                      onto its own lines on a narrow viewport instead of
                      overflowing past the card edge; every control here is
                      also sized down from the desktop defaults so the full
                      row has a real chance of fitting on one line first. */}
                  <div className="flex items-center flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => handlePushList(list, tomorrowISO)}
                      disabled={busy}
                      className="btn"
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.7rem" }}
                      title={t("backlog.pushToTomorrowTitle", { date: tomorrowISO })}
                    >
                      {t("backlog.pushToTomorrow")}
                    </button>
                    <input
                      type="date"
                      value={listPushDate[list.id] ?? ""}
                      min={todayISO}
                      disabled={busy}
                      onChange={(e) => setListPushDate((prev) => ({ ...prev, [list.id]: e.target.value }))}
                      className="rounded-lg border border-white/20 bg-white/10 px-1.5 py-1 text-xs text-white outline-none focus:border-white/40 disabled:opacity-50"
                      style={{ width: "118px" }}
                    />
                    <button
                      type="button"
                      onClick={() => handlePushList(list)}
                      disabled={busy || !listPushDate[list.id]}
                      className="btn"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                    >
                      {t("backlog.push")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteList(list)}
                      disabled={busy}
                      className="flex-shrink-0 flex items-center justify-center text-white/50 hover:text-white/90"
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "8px",
                        background: "rgba(var(--tint-rgb), 0.06)",
                        border: "1px solid rgba(var(--tint-rgb), 0.15)",
                      }}
                      title={t("backlog.deleteList")}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>

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

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newListItemDraft[list.id] ?? ""}
                    onChange={(e) => setNewListItemDraft((prev) => ({ ...prev, [list.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddListItem(list.id);
                    }}
                    placeholder={t("backlog.newListItemPlaceholder")}
                    disabled={addingItemListId === list.id}
                    className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddListItem(list.id)}
                    disabled={addingItemListId === list.id || !(newListItemDraft[list.id] ?? "").trim()}
                    className="btn"
                    style={{ padding: "0.3rem 0.75rem", fontSize: "0.75rem" }}
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

    {activeTab === "payments" && (
    <div className="card card-highlight">
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-1">{t("backlog.paymentsTitle")}</h2>
        <p className="text-sm text-white/70">{t("backlog.paymentsSubtitle")}</p>
      </div>

      {paymentsMsg && (
        <div className="mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
          {paymentsMsg}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 mb-6">
        <input
          type="text"
          value={newPaymentName}
          onChange={(e) => setNewPaymentName(e.target.value)}
          placeholder={t("backlog.paymentNamePlaceholder")}
          disabled={addingPayment}
          className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
          style={{ minWidth: "130px" }}
        />
        <input
          type="number"
          value={newPaymentBalance}
          onChange={(e) => setNewPaymentBalance(e.target.value)}
          placeholder={t("backlog.paymentBalancePlaceholder")}
          disabled={addingPayment}
          className="rounded-xl border border-white/20 bg-white/10 px-2 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
          style={{ width: "92px" }}
        />
        <input
          type="number"
          value={newPaymentMinimum}
          onChange={(e) => setNewPaymentMinimum(e.target.value)}
          placeholder={t("backlog.paymentMinimumPlaceholder")}
          disabled={addingPayment}
          className="rounded-xl border border-white/20 bg-white/10 px-2 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
          style={{ width: "92px" }}
        />
        <input
          type="number"
          min={1}
          max={31}
          value={newPaymentDueDay}
          onChange={(e) => setNewPaymentDueDay(e.target.value)}
          placeholder={t("backlog.paymentDueDayPlaceholder")}
          disabled={addingPayment}
          className="rounded-xl border border-white/20 bg-white/10 px-2 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
          style={{ width: "76px" }}
        />
        <input
          type="number"
          min={0}
          value={newPaymentRemindDays}
          onChange={(e) => setNewPaymentRemindDays(e.target.value)}
          placeholder={t("backlog.paymentRemindPlaceholder")}
          disabled={addingPayment}
          className="rounded-xl border border-white/20 bg-white/10 px-2 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
          style={{ width: "76px" }}
        />
        <button
          type="button"
          onClick={handleAddPayment}
          disabled={addingPayment || !newPaymentName.trim() || !newPaymentDueDay}
          className="btn btn-primary"
          style={{ padding: "0.5rem 0.9rem", fontSize: "0.85rem" }}
        >
          {addingPayment ? t("backlog.adding") : t("backlog.addPayment")}
        </button>
      </div>

      {paymentsLoading ? (
        <div className="text-white/60 text-center py-6">{t("backlog.loading")}</div>
      ) : paymentAccounts.length === 0 ? (
        <p className="text-sm text-white/50 italic">{t("backlog.noPaymentsYet")}</p>
      ) : (
        <div className="space-y-3">
          {paymentAccounts.map((account) => {
            const dueDate = computeNextDueDate(account.dueDay, todayISO);
            const daysUntilDue = Math.round(
              (new Date(`${dueDate}T00:00:00`).getTime() - new Date(`${todayISO}T00:00:00`).getTime()) / 86400000
            );
            const isDueToday = daysUntilDue === 0;
            const isDueSoon = !isDueToday && daysUntilDue <= account.remindDaysBefore;
            const chipStyle = isDueToday
              ? { "--chip-bg": "rgba(239, 68, 68, 0.12)", "--chip-border": "rgba(239, 68, 68, 0.35)", "--chip-color": "#fca5a5" }
              : isDueSoon
              ? { "--chip-bg": "rgba(245, 158, 11, 0.1)", "--chip-border": "rgba(245, 158, 11, 0.35)", "--chip-color": "#fcd34d" }
              : { "--chip-bg": "rgba(var(--tint-rgb),0.06)", "--chip-border": "rgba(var(--tint-rgb),0.15)", "--chip-color": "rgba(var(--tint-rgb),0.7)" };
            const busy = busyPaymentIds.has(account.id);
            return (
              <div key={account.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                {/* Buttons get their own row at the top, separate from the
                    name — sharing a line meant a long name pushed them
                    around (or vice versa) instead of each having its own
                    predictable spot. flex-wrap still breaks this onto two
                    lines on a very narrow viewport rather than overflowing. */}
                <div className="flex items-center flex-wrap justify-end gap-1.5 mb-2">
                  <span className="status-chip-sm" style={chipStyle as React.CSSProperties}>
                    {isDueToday ? t("backlog.paymentDueToday") : t("backlog.paymentDueOn", { date: formatDateDisplay(dueDate) })}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleHistory(account)}
                    className="flex-shrink-0 flex items-center justify-center text-white/50 hover:text-white/90"
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "8px",
                      background: expandedPaymentHistoryId === account.id ? "rgba(245, 158, 11, 0.15)" : "rgba(var(--tint-rgb), 0.06)",
                      border: "1px solid rgba(var(--tint-rgb), 0.15)",
                    }}
                    title={t("backlog.paymentHistoryToggle")}
                  >
                    <History size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeletePayment(account)}
                    disabled={busy}
                    className="flex-shrink-0 flex items-center justify-center text-white/50 hover:text-white/90"
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "8px",
                      background: "rgba(var(--tint-rgb), 0.06)",
                      border: "1px solid rgba(var(--tint-rgb), 0.15)",
                    }}
                    title={t("backlog.deletePayment")}
                  >
                    <X size={13} />
                  </button>
                </div>

                <textarea
                  rows={1}
                  defaultValue={account.name}
                  key={`${account.id}-name-${account.name}`}
                  ref={(el) => {
                    if (!el) return;
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                  }}
                  onBlur={(e) => handleUpdatePaymentField(account, "name", e.target.value)}
                  disabled={busy}
                  className="w-full mb-3 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-white font-medium outline-none focus:border-white/25 focus:bg-white/5 disabled:opacity-50 resize-none"
                  style={{ overflow: "hidden", lineHeight: 1.3 }}
                />

                <div className="flex flex-wrap gap-2">
                  <label className="text-xs text-white/50">
                    {t("backlog.paymentBalanceLabel")}
                    <input
                      type="number"
                      defaultValue={account.balance}
                      key={`${account.id}-balance-${account.balance}`}
                      onBlur={(e) => handleUpdatePaymentField(account, "balance", e.target.value)}
                      disabled={busy}
                      className="block mt-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white outline-none focus:border-white/25 disabled:opacity-50"
                      style={{ width: "92px" }}
                    />
                  </label>
                  <label className="text-xs text-white/50">
                    {t("backlog.paymentMinimumLabel")}
                    <input
                      type="number"
                      defaultValue={account.minimumPayment}
                      key={`${account.id}-min-${account.minimumPayment}`}
                      onBlur={(e) => handleUpdatePaymentField(account, "minimumPayment", e.target.value)}
                      disabled={busy}
                      className="block mt-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white outline-none focus:border-white/25 disabled:opacity-50"
                      style={{ width: "92px" }}
                    />
                  </label>
                  <label className="text-xs text-white/50">
                    {t("backlog.paymentDueDayLabel")}
                    <input
                      type="number"
                      min={1}
                      max={31}
                      defaultValue={account.dueDay}
                      key={`${account.id}-due-${account.dueDay}`}
                      onBlur={(e) => handleUpdatePaymentField(account, "dueDay", e.target.value)}
                      disabled={busy}
                      className="block mt-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white outline-none focus:border-white/25 disabled:opacity-50"
                      style={{ width: "68px" }}
                    />
                  </label>
                  <label className="text-xs text-white/50">
                    {t("backlog.paymentRemindLabel")}
                    <input
                      type="number"
                      min={0}
                      defaultValue={account.remindDaysBefore}
                      key={`${account.id}-remind-${account.remindDaysBefore}`}
                      onBlur={(e) => handleUpdatePaymentField(account, "remindDaysBefore", e.target.value)}
                      disabled={busy}
                      className="block mt-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white outline-none focus:border-white/25 disabled:opacity-50"
                      style={{ width: "68px" }}
                    />
                  </label>
                </div>

                {expandedPaymentHistoryId === account.id && (
                  <div className="mt-3 pt-3 border-t border-white/10">
                    {paymentHistoryLoadingId === account.id ? (
                      <p className="text-xs text-white/50">{t("backlog.paymentHistoryLoading")}</p>
                    ) : (paymentHistoryByAccount[account.id]?.length ?? 0) === 0 ? (
                      <p className="text-xs text-white/50 italic">{t("backlog.paymentHistoryEmpty")}</p>
                    ) : (
                      <div className="space-y-1">
                        {paymentHistoryByAccount[account.id].map((txn) => (
                          <div key={txn.id} className="flex items-center justify-between text-xs text-white/70">
                            <span>{formatDateTimeDisplay(txn.paidAt)}</span>
                            <span className="font-medium">${txn.amount.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    )}

    {activeTab === "assignments" && <GoalAssignmentsPanel />}

      <div className="flex flex-wrap gap-4 items-center justify-between">
        <Link className="btn btn-ghost bottom-nav-btn" href="/standup/tomorrow">
          {t("backlog.planTomorrowArrow")}
        </Link>
        <Link className="btn btn-ghost bottom-nav-btn" href="/standup/dashboard">
          {t("nav.dashboard")} →
        </Link>
      </div>
    </div>
  );
}
