"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, X } from "lucide-react";
import {
  addBacklogGoal,
  addDays,
  deleteBacklogGoal,
  getBacklogGoals,
  promoteBacklogGoal,
  toISODate,
  getRecurringGoalTemplates,
  addRecurringGoalTemplate,
  setRecurringGoalTemplateActive,
  deleteRecurringGoalTemplate,
  type BacklogGoal,
  type RecurringGoalTemplate,
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

export default function BacklogPage() {
  const { t } = useLanguage();
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

  const todayISO = toISODate(new Date());
  const tomorrowISO = toISODate(addDays(new Date(), 1));

  useEffect(() => {
    refresh();
    refreshTemplates();
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

  return (
    <div className="space-y-6">
    <div className="card card-highlight">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">{t("nav.backlog")}</h1>
        <p className="text-white/70">
          {t("backlog.subtitle")}
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
      ) : items.length === 0 ? (
        <div className="text-white/70 text-center py-12">
          <Archive className="mx-auto mb-4 text-white/40" size={40} strokeWidth={1.5} />
          <p className="text-lg mb-2">{t("backlog.nothingInBacklog")}</p>
          <p className="text-sm text-white/50">{t("backlog.staysPutMsg")}</p>
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
