"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronUp, ChevronDown, TriangleAlert, Ticket, Check, Redo2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import {
  toISODate,
  formatDateDisplay,
  getCurrentUserId,
  getOverdueDays,
  getStreakPassBalance,
  getStreakPassCoveredDates,
  findOrphanedContinuationIds,
  type OverdueDay,
  type StreakPassBalance,
} from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import PageLoadingState from "@/components/PageLoadingState";

type DayData = {
  date: string;
  hasCommitments: boolean;
  commitmentCount: number;
  reviewed: boolean;
  completedCount: number;
  // Rescheduled-away Commitments still on this day's own record --
  // "postponed" always means rescheduled (rescheduleGoalToDate() is the
  // only path that ever sets it). Secondary metadata only, never changes
  // the primary tone by itself.
  rescheduledCount: number;
  // A past, never-closed day still counts as handled once every one of its
  // Commitments has either been reviewed or re-attempted (rescheduled
  // forward) — rescheduling sets a goal's status to "postponed" but never
  // touches reviewed_at (only the same-day review flow does that), so this
  // checks both rather than reviewed_at alone. Also true if the day was
  // manually cleared via the "Clear this day" button on its view-only page.
  allCommitmentsHandled: boolean;
  // Covered by a streak pass — distinct from allCommitmentsHandled/cleared:
  // a covered day actually protects the streak, a cleared one doesn't.
  coveredByPass: boolean;
};

// Reduced from 7 tones to 4: Today, "active" (has Commitments -- future
// planned or past in any resolved/in-progress state that isn't a genuine
// warning), "attention" (past, unreviewed, unhandled -- the one state
// that still needs to visually stand out), and neutral (nothing planned).
// Reviewed/Rescheduled/Cleared/Covered are now compact in-cell indicators
// layered on "active" rather than each getting their own competing
// background color -- see the day-cell render below.
function toneStyles(tone: "neutral" | "today" | "active" | "attention") {
  switch (tone) {
    case "today":
      return {
        bg: "rgba(168, 85, 247, 0.10)",
        border: "rgba(168, 85, 247, 0.3)",
      };
    case "active":
      return {
        bg: "rgba(250, 204, 21, 0.07)",
        border: "rgba(250, 204, 21, 0.24)",
      };
    // Past, has Commitments, unreviewed, and never otherwise handled
    // (not cleared, not covered) -- a genuine actionable warning, so this
    // is the one state that still gets its own distinct, louder tone.
    case "attention":
      return {
        bg: "rgba(239, 68, 68, 0.10)",
        border: "rgba(239, 68, 68, 0.35)",
      };
    case "neutral":
    default:
      return {
        bg: "rgba(var(--tint-rgb), 0.03)",
        border: "rgba(var(--tint-rgb), 0.10)",
      };
  }
}

// Shared by every secondary in-cell indicator (Reviewed/Covered/Cleared/
// Missed/rescheduled) so each one isn't a separate inline conditional.
function renderCellIcon(icon: "check" | "redo" | "ticket" | "warn") {
  if (icon === "check") return <Check size={8} className="flex-shrink-0" />;
  if (icon === "redo") return <Redo2 size={8} className="flex-shrink-0" />;
  if (icon === "ticket") return <Ticket size={8} className="flex-shrink-0" />;
  return <TriangleAlert size={8} className="flex-shrink-0" />;
}

export default function CalendarPage() {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dayData, setDayData] = useState<Record<string, DayData>>({});
  const [overdueDays, setOverdueDays] = useState<OverdueDay[]>([]);
  const [passBalance, setPassBalance] = useState<StreakPassBalance | null>(null);
  const searchParams = useSearchParams();
  const [showOverdueList, setShowOverdueList] = useState(() => searchParams.get("unreviewed") === "1");

  const todayISO = useMemo(() => toISODate(new Date()), []);

  useEffect(() => {
    getOverdueDays(todayISO)
      .then(setOverdueDays)
      .catch((error) => console.error("Error loading unreviewed days:", error));
    getStreakPassBalance()
      .then(setPassBalance)
      .catch((error) => console.error("Error loading streak pass balance:", error));
  }, [todayISO]);

  const monthStart = useMemo(() => {
    return new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  }, [currentDate]);

  const monthEnd = useMemo(() => {
    return new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  }, [currentDate]);

  const monthName = currentDate.toLocaleDateString(language === "es" ? "es-ES" : "en-US", {
    month: "long",
    year: "numeric",
  });

  useEffect(() => {
    async function loadMonthData() {
      setLoading(true);
      try {
        const userId = await getCurrentUserId();

        const startISO = toISODate(monthStart);
        const endISO = toISODate(monthEnd);

        const [{ data: plans, error: plansErr }, coveredDates] = await Promise.all([
          supabase
            .from("daily_plans")
            .select("id, plan_date, reviewed_at, cleared_at")
            .eq("user_id", userId)
            .gte("plan_date", startISO)
            .lte("plan_date", endISO),
          getStreakPassCoveredDates(startISO, endISO),
        ]);

        if (plansErr) throw plansErr;

        const planIds = (plans || []).map((p) => p.id);

        let goalsData: any[] = [];
        if (planIds.length > 0) {
          const { data: goals, error: goalsErr } = await supabase
            .from("goals")
            .select("id, plan_id, status, reviewed_at")
            .in("plan_id", planIds);

          if (goalsErr) throw goalsErr;
          goalsData = goals || [];

          // Same lifecycle-consistency rule as Plan Tomorrow/date-detail: a
          // materialized continuation whose own source has since been
          // resolved (completed/canceled) gets auto-canceled by
          // cancelOrphanedReschedules, and must not inflate this month
          // view's day-level commitment counts/status either. Reuses the
          // same shared helper rather than a second definition; an
          // ordinary, independently user-canceled Task never matches an
          // edge here and is untouched.
          const canceledIds = new Set(goalsData.filter((g) => g.status === "canceled").map((g) => g.id));
          if (canceledIds.size > 0) {
            const { data: edgeRows } = await supabase
              .from("goal_reschedules")
              .select("from_goal_id, materialized_goal_id")
              .eq("materialized", true)
              .in("materialized_goal_id", Array.from(canceledIds));
            const edges = edgeRows ?? [];
            if (edges.length > 0) {
              const sourceIds = [...new Set(edges.map((e) => e.from_goal_id))];
              const { data: sourceRows } = await supabase.from("goals").select("id, status").in("id", sourceIds);
              const sourceStatusById = new Map((sourceRows ?? []).map((g) => [g.id, g.status as string]));
              const orphanIds = findOrphanedContinuationIds(edges, sourceStatusById);
              if (orphanIds.size > 0) {
                goalsData = goalsData.filter((g) => !orphanIds.has(g.id));
              }
            }
          }
        }

        const dataMap: Record<string, DayData> = {};

        (plans || []).forEach((plan) => {
          const planGoals = goalsData.filter((g) => g.plan_id === plan.id);
          const completedGoals = planGoals.filter((g) => g.status === "completed");
          // Derived from the same already-fetched `status` field -- no
          // additional query. "postponed" always means rescheduled away
          // from this day (rescheduleGoalToDate() is the only path that
          // ever sets it), so this is a plain, read-only count already
          // implied by data this view fetches regardless.
          const rescheduledGoals = planGoals.filter((g) => g.status === "postponed");

          dataMap[plan.plan_date] = {
            date: plan.plan_date,
            hasCommitments: planGoals.length > 0,
            commitmentCount: planGoals.length,
            reviewed: !!plan.reviewed_at,
            completedCount: completedGoals.length,
            rescheduledCount: rescheduledGoals.length,
            allCommitmentsHandled:
              !!plan.cleared_at ||
              (planGoals.length > 0 &&
                planGoals.every((g) => g.status === "postponed" || !!g.reviewed_at)),
            coveredByPass: coveredDates.has(plan.plan_date),
          };
        });

        setDayData(dataMap);
      } catch (error) {
        console.error("Error loading calendar data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadMonthData();
  }, [currentDate, monthStart, monthEnd]);

  function previousMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  }

  function nextMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  }

  function goToToday() {
    setCurrentDate(new Date());
  }

  const calendarDays = useMemo(() => {
    const days: (Date | null)[] = [];
    const firstDayOfWeek = monthStart.getDay();

    for (let i = 0; i < firstDayOfWeek; i++) days.push(null);

    const daysInMonth = monthEnd.getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), day));
    }

    return days;
  }, [monthStart, monthEnd, currentDate]);

  if (loading) {
    return <PageLoadingState label={t("calendar.loading")} />;
  }

  return (
    <div className="card card-highlight">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <h1 className="text-3xl font-bold">{t("nav.calendar")}</h1>
          {/* Phase 10B: was one flat `flex flex-wrap` of 5 siblings (3 nav
              buttons + 2 conditional status pills), which wrapped wherever
              it happened to run out of room -- measured at ~190px tall at
              320px. Split into two intentional clusters instead: month
              navigation (always a single row) and status/info (its own
              row, allowed to wrap on its own if a translation needs it).
              See .calendar-controls/-nav-cluster/-status-cluster in
              globals.css -- new, Calendar-scoped, nothing shared touched. */}
          <div className="calendar-controls">
            <div className="calendar-nav-cluster">
              <button onClick={previousMonth} className="btn btn-ghost calendar-nav-btn">
                {t("calendar.prev")}
              </button>
              <button onClick={goToToday} className="btn calendar-nav-btn">
                {t("calendar.today")}
              </button>
              <button onClick={nextMonth} className="btn btn-ghost calendar-nav-btn">
                {t("calendar.next")}
              </button>
            </div>
            {(overdueDays.length > 0 || passBalance !== null) && (
              <div className="calendar-status-cluster">
                {overdueDays.length > 0 && (
                  <button
                    onClick={() => setShowOverdueList((v) => !v)}
                    className="btn"
                    style={{ background: "rgba(239, 68, 68, 0.15)", borderColor: "rgba(239, 68, 68, 0.4)" }}
                    aria-expanded={showOverdueList}
                    aria-controls="calendar-overdue-list"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <TriangleAlert size={13} /> {t("calendar.unreviewedCount", { count: overdueDays.length })} {showOverdueList ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </span>
                  </button>
                )}
                {passBalance !== null && (
                  <span
                    className="calendar-passes-pill inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
                    title={t("calendar.streakPassHint")}
                  >
                    <Ticket size={13} />
                    {t(passBalance.available === 1 ? "calendar.passesAvailable.one" : "calendar.passesAvailable.other", { count: passBalance.available })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {showOverdueList && overdueDays.length > 0 && (
          <div
            id="calendar-overdue-list"
            className="mb-6 rounded-2xl p-4"
            style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.3)" }}
          >
            <div className="text-sm font-semibold text-red-300 mb-3">
              {t("calendar.missedDaysTitle")}
            </div>
            <div className="flex flex-col gap-2">
              {overdueDays.map((day) => (
                <Link
                  key={day.date}
                  href={`/standup/date/${day.date}`}
                  className="flex items-center justify-between rounded-xl px-4 py-2.5 text-sm hover:bg-white/5 transition-colors"
                  style={{ border: "1px solid rgba(239, 68, 68, 0.25)" }}
                >
                  <span className="font-medium text-white/90">{formatDateDisplay(day.date)}</span>
                  <span className="text-white/60">
                    {t(day.goalCount === 1 ? "calendar.goalCount.one" : "calendar.goalCount.other", { count: day.goalCount })}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="text-center text-xl font-semibold mb-6">{monthName}</div>

        <div className="grid grid-cols-7 gap-1 sm:gap-3">
          {/* Day headers */}
          {(["calendar.daySun", "calendar.dayMon", "calendar.dayTue", "calendar.dayWed", "calendar.dayThu", "calendar.dayFri", "calendar.daySat"] as const).map((dayKey) => (
            <div
              key={dayKey}
              className="text-center text-sm font-semibold text-white/60 py-2"
            >
              {t(dayKey)}
            </div>
          ))}

          {/* Days */}
          {calendarDays.map((date, idx) => {
            if (!date) return <div key={`empty-${idx}`} className="aspect-square" />;

            const dateISO = toISODate(date);
            const data = dayData[dateISO];
            const isToday = dateISO === todayISO;
            const isPast = dateISO < todayISO;
            const hasCommitments = !!data?.hasCommitments;
            const completed = data?.completedCount ?? 0;
            const count = data?.commitmentCount ?? 0;
            const rescheduled = data?.rescheduledCount ?? 0;
            const isCovered = isPast && !!data?.coveredByPass;
            const isCleared = isPast && hasCommitments && !data?.reviewed && data?.allCommitmentsHandled && !isCovered;
            const isOverdue = isPast && hasCommitments && !data?.reviewed && !data?.allCommitmentsHandled && !isCovered;

            // Reduced to 4 tones (see toneStyles) -- "attention" is the one
            // state that still needs to visually stand out; everything
            // else that has real Commitments (future-planned, reviewed,
            // cleared, covered) shares one calm "active" tone, with the
            // actual distinction spelled out in-cell below instead of
            // through a dedicated background color each.
            const tone = isToday ? "today" : isOverdue ? "attention" : hasCommitments ? "active" : "neutral";
            const toneStyle = toneStyles(tone);

            // Primary line: a past (or already-reviewed) day always shows
            // its truthful completion fraction, even 0/N -- that's real,
            // meaningful data once the day has actually happened. A
            // future/current day with nothing completed yet shows a bare
            // Commitment count instead of an ambiguous "0/3".
            // Today always shows the bare plan count here -- its own
            // completed-so-far count renders as a separate row below
            // (todayStatsParts), never folded into a fraction.
            const showFraction = hasCommitments && !isToday && (isPast || !!data?.reviewed || completed > 0);
            const primaryValue = showFraction ? `${completed}/${count}` : hasCommitments ? `${count}` : "";
            const primaryWord = showFraction ? t("calendar.completedWord") : t("calendar.commitmentsWord");

            // Secondary row (non-today): at most ONE row total. A status
            // word (Reviewed/Covered/Cleared/Missed) plus, horizontally
            // alongside it on the SAME row, a bare icon+count for any
            // rescheduled work -- never spelled out as its own word, so
            // this never grows past one row regardless of how many things
            // apply. Reviewed/Covered/Cleared/Missed are mutually
            // exclusive by construction (isCovered/isCleared/isOverdue
            // above already exclude each other and a reviewed day).
            type Part = { icon?: "check" | "redo" | "ticket" | "warn"; text: string };
            let secondary: { parts: Part[]; tone: "good" | "muted" | "warn" } | null = null;
            if (!isToday) {
              if (data?.reviewed) {
                secondary = {
                  parts:
                    rescheduled > 0
                      ? [{ icon: "check", text: t("calendar.reviewedShort") }, { icon: "redo", text: String(rescheduled) }]
                      : [{ icon: "check", text: t("calendar.reviewedShort") }],
                  tone: "good",
                };
              } else if (isCovered) {
                secondary = { parts: [{ icon: "ticket", text: t("calendar.dayCovered") }], tone: "muted" };
              } else if (isCleared) {
                secondary = { parts: [{ icon: "redo", text: t("calendar.dayCleared") }], tone: "muted" };
              } else if (isOverdue) {
                secondary = { parts: [{ icon: "warn", text: t("calendar.dayMissed") }], tone: "warn" };
              } else if (rescheduled > 0) {
                secondary = { parts: [{ icon: "redo", text: String(rescheduled) }], tone: "muted" };
              }
            }

            // Today gets two rows instead of one combined row: its own
            // completed-so-far count (+ rescheduled, combined onto the
            // same row as a bare icon+count) is a distinct concept from
            // Reviewed (today's own plan can already be closed same-day),
            // which always gets its own final row rather than merging
            // with the reschedule count -- matches the target layout.
            const todayStatsParts: Part[] = [];
            if (isToday) {
              if (completed > 0) todayStatsParts.push({ text: `${completed} ${t("calendar.completedWord")}` });
              if (rescheduled > 0) todayStatsParts.push({ icon: "redo", text: String(rescheduled) });
            }
            const todayReviewed = isToday && !!data?.reviewed;

            return (
              <Link
                key={dateISO}
                href={isToday ? "/standup/today" : `/standup/date/${dateISO}`}
                className={[
                  "aspect-square rounded-2xl border transition-all duration-200",
                  "flex flex-col items-center justify-center text-center gap-0.5",
                  "hover:scale-[1.04] active:scale-[0.98]",
                  "focus:outline-none focus:ring-2 focus:ring-white/40",
                ].join(" ")}
                style={{
                  background: toneStyle.bg,
                  borderColor: toneStyle.border,
                }}
                title={formatDateDisplay(dateISO)}
              >
                {/* Date + compact Today badge -- date stays the strongest
                    element (unchanged size); the badge is a small inline
                    pill, not a second oversized label. */}
                <div className="flex items-center gap-1 leading-none">
                  <span className="select-none text-white/85 font-bold text-sm sm:text-2xl">{date.getDate()}</span>
                  {isToday && <span className="calendar-today-badge">{t("calendar.today")}</span>}
                </div>

                {/* Primary line -- the Commitment/completion summary.
                    calendar-cell-label keeps the existing sub-360px font
                    override (globals.css); calendar-cell-word is the
                    descriptive word, hidden only at that same narrowest
                    width so the number itself is never cramped out. */}
                {primaryValue && (
                  <div className="calendar-cell-label text-[8px] sm:text-[10px] font-semibold text-white/90 leading-none">
                    {primaryValue} <span className="calendar-cell-word">{primaryWord}</span>
                  </div>
                )}

                {/* Today's completed-so-far + rescheduled, combined onto
                    one row (each part its own color -- completed in the
                    same green as "good" status elsewhere, rescheduled
                    muted). Reviewed (below) never merges into this row. */}
                {todayStatsParts.length > 0 && (
                  <div className="calendar-cell-secondary inline-flex items-center gap-1 flex-wrap justify-center leading-none">
                    {todayStatsParts.map((part, i) => (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-0.5 ${part.icon ? "calendar-cell-secondary-muted" : "calendar-cell-secondary-good"}`}
                      >
                        {part.icon && renderCellIcon(part.icon)}
                        <span className="calendar-cell-word">{part.text}</span>
                      </span>
                    ))}
                  </div>
                )}

                {todayReviewed && (
                  <div className="calendar-cell-secondary calendar-cell-secondary-good inline-flex items-center gap-0.5 leading-none">
                    <Check size={8} className="flex-shrink-0" />
                    <span className="calendar-cell-word">{t("calendar.reviewedShort")}</span>
                  </div>
                )}

                {secondary && (
                  <div
                    className={`calendar-cell-secondary calendar-cell-secondary-${secondary.tone} inline-flex items-center gap-1 flex-wrap justify-center leading-none`}
                  >
                    {secondary.parts.map((part, i) => (
                      <span key={i} className="inline-flex items-center gap-0.5">
                        {part.icon && renderCellIcon(part.icon)}
                        <span className="calendar-cell-word">{part.text}</span>
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            );
          })}
        </div>

        {/* Legend -- P5A: reduced from 7 entries to 3. Every cell now
            spells out its own state in text (count/fraction, "Reviewed",
            "Missed", "Cleared", "Covered", rescheduled count) rather than
            relying on color alone, so Reviewed/Cleared/Covered/No-Plan no
            longer need a dedicated legend row to be understood -- only the
            3 primary tones themselves (toneStyles) are left ambiguous
            without a key, and only "Missed" genuinely needs calling out
            as the one state meant to catch the eye. */}
        <div className="calendar-legend text-xs text-white/60">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-4 h-4 rounded-md border flex-shrink-0"
              style={{
                background: toneStyles("today").bg,
                borderColor: toneStyles("today").border,
              }}
            />
            <span>{t("calendar.today")}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-4 h-4 rounded-md border flex-shrink-0"
              style={{
                background: toneStyles("active").bg,
                borderColor: toneStyles("active").border,
              }}
            />
            <span>{t("calendar.legendActive")}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-4 h-4 rounded-md border flex-shrink-0"
              style={{
                background: toneStyles("attention").bg,
                borderColor: toneStyles("attention").border,
              }}
            />
            <span>{t("calendar.legendMissed")}</span>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 sm:gap-3 flex-wrap">
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/today">
            {t("nav.reviewToday")}
          </Link>
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/tomorrow">
            {t("nav.planTomorrow")}
          </Link>
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/tools">
            {t("calendar.storeInBacklog")}
          </Link>
        </div>
      </div>
  );
}
