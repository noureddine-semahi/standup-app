"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronUp, ChevronDown, TriangleAlert, Ticket } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import {
  toISODate,
  formatDateDisplay,
  getCurrentUserId,
  getOverdueDays,
  getStreakPassBalance,
  getStreakPassCoveredDates,
  type OverdueDay,
  type StreakPassBalance,
} from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type DayData = {
  date: string;
  hasGoals: boolean;
  goalCount: number;
  reviewed: boolean;
  completedCount: number;
  // A past, never-closed day still counts as handled once every one of its
  // goals has either been reviewed or re-attempted (rescheduled forward) —
  // rescheduling sets a goal's status to "postponed" but never touches
  // reviewed_at (only the same-day review flow does that), so this checks
  // both rather than reviewed_at alone. Also true if the day was manually
  // cleared via the "Clear this day" button on its view-only page.
  allGoalsHandled: boolean;
  // Covered by a streak pass — distinct from allGoalsHandled/cleared: a
  // covered day actually protects the streak, a cleared one doesn't.
  coveredByPass: boolean;
};

function toneStyles(tone: "neutral" | "today" | "closed" | "hasGoals" | "overdue" | "cleared" | "covered") {
  // Flat, quiet tint per state — no layered radial "sphere" gradients or heavy glow.
  switch (tone) {
    case "today":
      return {
        bg: "rgba(168, 85, 247, 0.10)",
        border: "rgba(168, 85, 247, 0.35)",
        glow: "none",
      };
    case "closed":
      return {
        bg: "rgba(16, 185, 129, 0.08)",
        border: "rgba(16, 185, 129, 0.28)",
        glow: "none",
      };
    case "hasGoals":
      return {
        bg: "rgba(250, 204, 21, 0.07)",
        border: "rgba(250, 204, 21, 0.24)",
        glow: "none",
      };
    // A past day that had goals but was never reviewed/closed — distinct
    // from the yellow "hasGoals" tone, which future/upcoming planned days
    // also use and isn't a warning.
    case "overdue":
      return {
        bg: "rgba(239, 68, 68, 0.10)",
        border: "rgba(239, 68, 68, 0.35)",
        glow: "none",
      };
    // Every goal on a missed day has since been reviewed or re-attempted
    // (rescheduled forward) — no longer a warning, but distinct from
    // "closed" since the day itself was never formally closed (no streak/
    // points credit for it).
    case "cleared":
      return {
        bg: "rgba(59, 130, 246, 0.08)",
        border: "rgba(59, 130, 246, 0.28)",
        glow: "none",
      };
    // A missed day retroactively covered by a streak pass — unlike
    // "cleared", this one genuinely protects the streak, so it gets its
    // own distinct tone rather than being folded into "cleared".
    case "covered":
      return {
        bg: "rgba(45, 212, 191, 0.10)",
        border: "rgba(45, 212, 191, 0.35)",
        glow: "none",
      };
    case "neutral":
    default:
      return {
        bg: "rgba(var(--tint-rgb), 0.03)",
        border: "rgba(var(--tint-rgb), 0.10)",
        glow: "none",
      };
  }
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
            .select("plan_id, status, reviewed_at")
            .in("plan_id", planIds);

          if (goalsErr) throw goalsErr;
          goalsData = goals || [];
        }

        const dataMap: Record<string, DayData> = {};

        (plans || []).forEach((plan) => {
          const planGoals = goalsData.filter((g) => g.plan_id === plan.id);
          const completedGoals = planGoals.filter((g) => g.status === "completed");

          dataMap[plan.plan_date] = {
            date: plan.plan_date,
            hasGoals: planGoals.length > 0,
            goalCount: planGoals.length,
            reviewed: !!plan.reviewed_at,
            completedCount: completedGoals.length,
            allGoalsHandled:
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
    return <div className="card">{t("calendar.loading")}</div>;
  }

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <h1 className="text-3xl font-bold">{t("nav.calendar")}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={previousMonth} className="btn btn-ghost">
              {t("calendar.prev")}
            </button>
            <button onClick={goToToday} className="btn">
              {t("calendar.today")}
            </button>
            <button onClick={nextMonth} className="btn btn-ghost">
              {t("calendar.next")}
            </button>
            {overdueDays.length > 0 && (
              <button
                onClick={() => setShowOverdueList((v) => !v)}
                className="btn"
                style={{ background: "rgba(239, 68, 68, 0.15)", borderColor: "rgba(239, 68, 68, 0.4)" }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <TriangleAlert size={13} /> {t("calendar.unreviewedCount", { count: overdueDays.length })} {showOverdueList ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </span>
              </button>
            )}
            {passBalance !== null && (
              <span
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
                style={{ background: "rgba(45, 212, 191, 0.10)", border: "1px solid rgba(45, 212, 191, 0.3)", color: "rgb(94, 234, 212)" }}
                title={t("calendar.streakPassHint")}
              >
                <Ticket size={13} />
                {t(passBalance.available === 1 ? "calendar.passesAvailable.one" : "calendar.passesAvailable.other", { count: passBalance.available })}
              </span>
            )}
          </div>
        </div>

        {showOverdueList && overdueDays.length > 0 && (
          <div
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
            const isCovered = isPast && !!data?.coveredByPass;
            const isCleared = isPast && !!data?.hasGoals && !data?.reviewed && data?.allGoalsHandled && !isCovered;
            const isOverdue = isPast && !!data?.hasGoals && !data?.reviewed && !data?.allGoalsHandled && !isCovered;

            const tone = isToday
              ? "today"
              : data?.reviewed
              ? "closed"
              : isCovered
              ? "covered"
              : isOverdue
              ? "overdue"
              : isCleared
              ? "cleared"
              : data?.hasGoals
              ? "hasGoals"
              : "neutral";

            const toneStyle = toneStyles(tone);

            // one compact label line
            const label = isToday
              ? t("calendar.today")
              : data?.reviewed
              ? t("calendar.dayClosed")
              : isCovered
              ? t("calendar.dayCovered")
              : isOverdue
              ? t("calendar.dayMissed")
              : isCleared
              ? t("calendar.dayCleared")
              : data?.hasGoals
              ? `${data.completedCount}/${data.goalCount}`
              : "";

            return (
              <Link
                key={dateISO}
                href={isToday ? "/standup/today" : `/standup/date/${dateISO}`}
                className={[
                  "aspect-square rounded-2xl border transition-all duration-200",
                  "flex flex-col items-center justify-center text-center",
                  "hover:scale-[1.04] active:scale-[0.98]",
                  "focus:outline-none focus:ring-2 focus:ring-white/40",
                ].join(" ")}
                style={{
                  background: toneStyle.bg,
                  borderColor: toneStyle.border,
                }}
                title={formatDateDisplay(dateISO)}
              >
                {/* Number */}
                <div className="leading-none select-none text-white/85 font-bold text-sm sm:text-2xl">
                    {date.getDate()}
                </div>

                {/* Text under number */}
                <div className="mt-1 text-[8px] sm:text-[10px] font-semibold text-white/90 leading-none">
                  {label || "\u00A0"}
                </div>
              </Link>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-6 flex flex-wrap gap-4 text-xs text-white/60">
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-md border"
              style={{
                background: toneStyles("today").bg,
                borderColor: toneStyles("today").border,
              }}
            />
            <span>{t("calendar.today")}</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-md border"
              style={{
                background: toneStyles("closed").bg,
                borderColor: toneStyles("closed").border,
              }}
            />
            <span>{t("calendar.legendDayClosed")}</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-md border"
              style={{
                background: toneStyles("hasGoals").bg,
                borderColor: toneStyles("hasGoals").border,
              }}
            />
            <span>{t("calendar.legendHasGoals")}</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-md border"
              style={{
                background: toneStyles("overdue").bg,
                borderColor: toneStyles("overdue").border,
              }}
            />
            <span>{t("calendar.legendMissed")}</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-md border"
              style={{
                background: toneStyles("cleared").bg,
                borderColor: toneStyles("cleared").border,
              }}
            />
            <span>{t("calendar.legendCleared")}</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-md border"
              style={{
                background: toneStyles("covered").bg,
                borderColor: toneStyles("covered").border,
              }}
            />
            <span>{t("calendar.legendCovered")}</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-md border"
              style={{
                background: toneStyles("neutral").bg,
                borderColor: toneStyles("neutral").border,
              }}
            />
            <span>{t("calendar.legendNoPlan")}</span>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 sm:gap-3 flex-wrap">
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/today">
            {t("nav.reviewToday")}
          </Link>
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/tomorrow">
            {t("nav.planTomorrow")}
          </Link>
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/backlog">
            {t("calendar.storeInBacklog")}
          </Link>
        </div>
      </div>
  );
}
