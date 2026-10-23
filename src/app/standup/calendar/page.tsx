"use client";

import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronUp, ChevronDown, TriangleAlert, Ticket, Check, CheckCircle2, Sun, Wrench } from "lucide-react";
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
  // Genuinely canceled Commitments on this day -- same already-fetched
  // `status` field as completedGoals/rescheduledGoals below, no extra
  // query. Used only by the mobile proportional progress ring (see
  // ringSegments()); never read elsewhere, so this adds no new meaning
  // to any existing calculation.
  canceledCount: number;
  // Same already-fetched `status` field, same pattern as canceledCount
  // above -- but unlike blocked/attempted/in_progress (which stay
  // lumped into the ring's generic "pending" bucket), missed is a
  // reviewed, terminal outcome same as completed/rescheduled/canceled,
  // so it gets its own tracked count and its own ring/legend color
  // rather than being folded into "pending" (which would misleadingly
  // read as "not yet reviewed").
  missedCount: number;
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
        bg: "color-mix(in srgb, var(--calendar-status-today) 10%, transparent)",
        border: "color-mix(in srgb, var(--calendar-status-today) 30%, transparent)",
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

// Universal proportional progress ring (every viewport -- desktop,
// tablet, mobile all use the same ring now): the REAL distribution of a
// day's goal outcomes, mapped from the exact same `status` values
// already fetched/aggregated into DayData above -- no new stored
// status, no DB change, no lifecycle change. "postponed" is this
// schema's one and only rescheduled-away status (same mapping
// DayData.rescheduledCount above already uses); "pending" is simply
// everything left over once completed/rescheduled/canceled/missed are
// subtracted from the total (e.g. in_progress, blocked, attempted, or a
// plan with no status recorded yet) -- not a new status, just
// "whatever isn't one of the other four."
type RingSegment = { color: string; pct: number };

function ringSegments(data: DayData | undefined): RingSegment[] {
  const total = data?.commitmentCount ?? 0;
  if (!data || total === 0) return [];

  const pending = Math.max(
    0,
    total - data.completedCount - data.rescheduledCount - data.canceledCount - data.missedCount
  );
  const raw: { count: number; color: string }[] = [
    { count: data.completedCount, color: "var(--calendar-status-completed)" },
    { count: data.rescheduledCount, color: "var(--calendar-status-rescheduled)" },
    { count: data.canceledCount, color: "var(--calendar-status-canceled)" },
    { count: data.missedCount, color: "var(--calendar-status-missed)" },
    { count: pending, color: "var(--calendar-status-pending)" },
  ];

  // Dynamically computed from the real counts above -- never a
  // hardcoded percentage. Zero-count segments are dropped so the
  // conic-gradient stop list only contains real boundaries.
  return raw.filter((s) => s.count > 0).map((s) => ({ color: s.color, pct: (s.count / total) * 100 }));
}

function conicGradientFromSegments(segments: RingSegment[]): string | undefined {
  if (segments.length === 0) return undefined;
  let cursor = 0;
  const stops = segments.map((s) => {
    const start = cursor;
    cursor += s.pct;
    return `${s.color} ${start}% ${cursor}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

type DominantStatus = "completed" | "rescheduled" | "canceled" | "missed" | "pending";

// Tile glass-glow accent ONLY -- picks the single largest of the same
// five counts ringSegments() already breaks the ring into. Never
// changes the ring itself (still fully multi-segment/proportional, see
// ringSegments above) or any stored status -- purely which existing
// count is biggest. Ties are broken by this fixed visual precedence
// (canceled > missed > rescheduled > completed > pending), listed in
// that exact order below so the first `count > best.count` comparison
// that can win is always the higher-precedence one. missed sits right
// below canceled -- both are terminal non-completions worth standing
// out over a neutral reschedule or a win.
function dominantRingStatus(data: DayData | undefined): DominantStatus | null {
  const total = data?.commitmentCount ?? 0;
  if (!data || total === 0) return null;

  const pending = Math.max(
    0,
    total - data.completedCount - data.rescheduledCount - data.canceledCount - data.missedCount
  );
  const candidates: { key: DominantStatus; count: number }[] = [
    { key: "canceled", count: data.canceledCount },
    { key: "missed", count: data.missedCount },
    { key: "rescheduled", count: data.rescheduledCount },
    { key: "completed", count: data.completedCount },
    { key: "pending", count: pending },
  ];

  let best = candidates[0];
  for (const c of candidates) {
    if (c.count > best.count) best = c;
  }
  return best.count > 0 ? best.key : null;
}

const DOMINANT_GLOW_COLOR: Record<DominantStatus, string> = {
  completed: "var(--calendar-status-completed)",
  rescheduled: "var(--calendar-status-rescheduled)",
  canceled: "var(--calendar-status-canceled)",
  missed: "var(--calendar-status-missed)",
  pending: "var(--calendar-status-pending)",
};

export default function CalendarPage() {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dayData, setDayData] = useState<Record<string, DayData>>({});
  const [overdueDays, setOverdueDays] = useState<OverdueDay[]>([]);
  const [passBalance, setPassBalance] = useState<StreakPassBalance | null>(null);
  const searchParams = useSearchParams();
  const [showOverdueList, setShowOverdueList] = useState(() => searchParams.get("unreviewed") === "1");
  // SSR/hydration guard for the fixed command bar's mobile portal — same
  // convention Today's/Tomorrow's own fixed action bars already use.
  const [mounted, setMounted] = useState(false);

  const todayISO = useMemo(() => toISODate(new Date()), []);

  useEffect(() => {
    setMounted(true);
  }, []);

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
          // Same already-fetched status field; the orphaned-continuation
          // filter above (canceledIds/orphanIds) already ran before this
          // loop, so a goal counted here is genuinely user/system
          // canceled, not a stale auto-canceled continuation.
          const canceledGoals = planGoals.filter((g) => g.status === "canceled");
          // Same already-fetched status field as the others above.
          const missedGoals = planGoals.filter((g) => g.status === "missed");

          dataMap[plan.plan_date] = {
            date: plan.plan_date,
            hasCommitments: planGoals.length > 0,
            commitmentCount: planGoals.length,
            reviewed: !!plan.reviewed_at,
            completedCount: completedGoals.length,
            rescheduledCount: rescheduledGoals.length,
            canceledCount: canceledGoals.length,
            missedCount: missedGoals.length,
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
    <div className="card card-highlight calendar-page-card">
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
              <button onClick={previousMonth} className="btn standup-metal-btn calendar-nav-btn">
                {t("calendar.prev")}
              </button>
              <button onClick={goToToday} className="btn standup-metal-btn calendar-nav-btn">
                {t("calendar.today")}
              </button>
              <button onClick={nextMonth} className="btn standup-metal-btn calendar-nav-btn">
                {t("calendar.next")}
              </button>
            </div>
            {(overdueDays.length > 0 || passBalance !== null) && (
              <div className="calendar-status-cluster">
                {overdueDays.length > 0 && (
                  <button
                    onClick={() => setShowOverdueList((v) => !v)}
                    className="btn standup-metal-btn standup-metal-btn--danger"
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

        <div className="calendar-grid grid grid-cols-7 gap-1 sm:gap-3">
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
            if (!date) return <div key={`empty-${idx}`} className="aspect-square calendar-cell-empty calendar-grid-cell" />;

            const dateISO = toISODate(date);
            const data = dayData[dateISO];
            const isToday = dateISO === todayISO;
            const isPast = dateISO < todayISO;
            const hasCommitments = !!data?.hasCommitments;
            const completed = data?.completedCount ?? 0;
            const count = data?.commitmentCount ?? 0;
            const rescheduled = data?.rescheduledCount ?? 0;
            // A FULLY completed day only -- not "some goals completed".
            const isFullyCompleted = hasCommitments && count > 0 && completed === count;
            // Preserved as-is (status mapping, unchanged) even though the
            // tile's own background/border no longer reads from the old
            // tone system below -- see the glass-glow block instead.
            const isCovered = isPast && !!data?.coveredByPass;
            const isOverdue = isPast && hasCommitments && !data?.reviewed && !data?.allCommitmentsHandled && !isCovered;

            // Glass-glow accent: Today is always purple (the strongest
            // identity layer); every other populated day's glow color is
            // its DOMINANT ring segment (dominantRingStatus, see above --
            // same counts the ring itself uses, tile color only, ring
            // itself is untouched); a day with no Commitments gets no
            // glow class at all and keeps the old quiet neutral look.
            const dominantStatus = dominantRingStatus(data);
            const glowColor = isToday ? "var(--calendar-status-today)" : dominantStatus ? DOMINANT_GLOW_COLOR[dominantStatus] : undefined;

            // Proportional ring -- dynamically computed from the real
            // counts above (ringSegments), never a hardcoded percentage.
            // A day with zero Commitments gets no segments at all
            // (ringSegments returns []), which the CSS below renders as a
            // flat, very subtle "inactive" ring instead of a
            // conic-gradient -- never fake progress on an empty day. This
            // is now the ONE Calendar cell presentation at every
            // viewport -- the previous separate desktop text/icon layout
            // was removed entirely rather than hidden behind a
            // breakpoint; responsive CSS below only resizes the ring/
            // cell/typography, it never swaps back to that old design.
            const segments = ringSegments(data);
            const ringBackground = conicGradientFromSegments(segments);

            return (
              <Link
                key={dateISO}
                href={isToday ? "/standup/today" : `/standup/date/${dateISO}`}
                className={[
                  "aspect-square calendar-grid-cell rounded-2xl border transition-all duration-200 relative",
                  "flex flex-col items-center justify-center text-center gap-0.5",
                  "hover:scale-[1.04] active:scale-[0.98]",
                  "focus:outline-none focus:ring-2 focus:ring-white/40",
                  // Glass-glow structure (background tint/border/inner
                  // highlight/outer glow), colored via the --glow-color
                  // custom property set below -- only applied when there's
                  // an actual glow color (Today, or a populated day with a
                  // dominant status). A day with no Commitments skips this
                  // entirely and keeps the plain quiet neutral tile.
                  glowColor ? "calendar-cell-glow" : "calendar-cell-glow-none",
                  // Today ADDS a stronger outer glow on top of the same
                  // glass structure above -- the "strongest identity
                  // layer" -- it never replaces it.
                  isToday ? "calendar-cell-today" : "",
                ].join(" ")}
                style={glowColor ? ({ "--glow-color": glowColor } as React.CSSProperties) : undefined}
                title={formatDateDisplay(dateISO)}
              >
                {isToday && <span className="calendar-today-badge">{t("calendar.today")}</span>}
                {/* Reschedule count -- a small cyan corner badge, upper-
                    right, independent of (never replacing) the ring's own
                    amber segment: the ring shows the PROPORTION
                    rescheduled, this shows the exact COUNT. Shown for any
                    day (Today included) with rescheduled > 0. Absolutely
                    positioned against the Link's own `relative` above, so
                    it never affects the day number or the ring's own
                    centering. */}
                {rescheduled > 0 && (
                  <span className="calendar-cell-reschedule-badge" aria-label={`${rescheduled} rescheduled`}>
                    ↪{rescheduled}
                  </span>
                )}
                <div className="calendar-ring-wrap">
                  <div
                    className={`calendar-ring${ringBackground ? "" : " calendar-ring-empty"}`}
                    style={ringBackground ? { background: ringBackground } : undefined}
                  />
                  <span className="calendar-ring-number">{date.getDate()}</span>
                </div>
                {hasCommitments && (
                  <div className="calendar-ring-fraction">
                    {completed}/{count}
                    {/* Fully-completed days only -- never for "some
                        goals completed". Small and secondary to the
                        ring, per spec. */}
                    {isFullyCompleted && <Check size={10} className="calendar-ring-fraction-check" />}
                  </div>
                )}
              </Link>
            );
          })}
        </div>

        {/* Legend -- explains the proportional ring's 4 segment colors
            (same mapping as ringSegments() above) plus Today's purple
            tile accent. Applies at every viewport now -- the ring is the
            one Calendar cell presentation everywhere, not a mobile-only
            variant. Wrapped in its own glass housing (.calendar-legend-
            housing) so it reads as one belonging-to-the-Calendar unit
            rather than loose text floating under the grid; the housing
            is purely a visual shell around the EXISTING .calendar-legend
            layout/children below, nothing about the grid/flex structure
            or its items changed. */}
        <div className="calendar-legend-housing">
          <div className="calendar-legend text-sm text-white/60">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-4 h-4 rounded-full border flex-shrink-0 calendar-legend-swatch-today" />
              <span>{t("calendar.today")}</span>
            </div>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-4 h-4 rounded-full border flex-shrink-0 calendar-legend-swatch-completed" />
              <span>{t("status.completed")}</span>
            </div>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-4 h-4 rounded-full border flex-shrink-0 calendar-legend-swatch-rescheduled" />
              <span>{t("status.rescheduled")}</span>
            </div>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-4 h-4 rounded-full border flex-shrink-0 calendar-legend-swatch-canceled" />
              <span>{t("status.canceled")}</span>
            </div>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-4 h-4 rounded-full border flex-shrink-0 calendar-legend-swatch-missed" />
              <span>{t("status.missed")}</span>
            </div>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-4 h-4 rounded-full border flex-shrink-0 calendar-legend-swatch-pending" />
              <span>{t("status.notStarted")}</span>
            </div>
          </div>
        </div>

        {/* Same fixed-bottom-bar architecture as Today's/Tomorrow's own
            command bars — explicit user call to match their design and
            move these three actions to a fixed mobile bar. .calendar-page-
            card (like .today-page-card/.tomorrow-page-card) carries
            backdrop-filter via the shared .card class, which makes it a
            containing block and breaks position:fixed for an in-flow
            descendant — rendering the SAME content a second time through a
            portal straight to document.body escapes that, and a >640px
            media query (matching Today's/Tomorrow's own breakpoint) picks
            exactly one of the two to actually render at a time. All three
            links/hrefs/labels are unchanged from before, just relocated
            and reskinned to the shared accent pill style. */}
        {(() => {
          const content = (
            <div className="calendar-command-grid">
              <Link className="btn standup-metal-btn standup-metal-btn--accent calendar-command-btn" href="/standup/today">
                <CheckCircle2 size={14} />
                {t("nav.reviewToday")}
              </Link>
              <Link className="btn standup-metal-btn standup-metal-btn--accent calendar-command-btn" href="/standup/tomorrow">
                <Sun size={14} />
                {t("nav.planTomorrow")}
              </Link>
              <Link className="btn standup-metal-btn standup-metal-btn--accent calendar-command-btn" href="/standup/tools">
                <Wrench size={14} />
                {t("calendar.storeInBacklog")}
              </Link>
            </div>
          );
          return (
            <>
              <div className="calendar-command-bar calendar-command-bar-desktop">{content}</div>
              {mounted && createPortal(<div className="calendar-command-bar calendar-command-bar-mobile">{content}</div>, document.body)}
            </>
          );
        })()}
      </div>
  );
}
