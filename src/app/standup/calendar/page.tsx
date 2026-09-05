"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { toISODate, formatDateDisplay, getCurrentUserId } from "@/lib/supabase/db";

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
  // both rather than reviewed_at alone.
  allGoalsHandled: boolean;
};

function toneStyles(tone: "neutral" | "today" | "closed" | "hasGoals" | "overdue" | "cleared") {
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
    case "neutral":
    default:
      return {
        bg: "rgba(255, 255, 255, 0.03)",
        border: "rgba(255, 255, 255, 0.10)",
        glow: "none",
      };
  }
}

export default function CalendarPage() {
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dayData, setDayData] = useState<Record<string, DayData>>({});

  const todayISO = useMemo(() => toISODate(new Date()), []);

  const monthStart = useMemo(() => {
    return new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  }, [currentDate]);

  const monthEnd = useMemo(() => {
    return new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  }, [currentDate]);

  const monthName = currentDate.toLocaleDateString("en-US", {
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

        const { data: plans, error: plansErr } = await supabase
          .from("daily_plans")
          .select("id, plan_date, reviewed_at")
          .eq("user_id", userId)
          .gte("plan_date", startISO)
          .lte("plan_date", endISO);

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
              planGoals.length > 0 &&
              planGoals.every((g) => g.status === "postponed" || !!g.reviewed_at),
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
    return <div className="card">Loading calendar...</div>;
  }

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <h1 className="text-3xl font-bold">Calendar</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={previousMonth} className="btn btn-ghost">
              ← Prev
            </button>
            <button onClick={goToToday} className="btn">
              Today
            </button>
            <button onClick={nextMonth} className="btn btn-ghost">
              Next →
            </button>
          </div>
        </div>

        <div className="text-center text-xl font-semibold mb-6">{monthName}</div>

        <div className="grid grid-cols-7 gap-1 sm:gap-3">
          {/* Day headers */}
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div
              key={day}
              className="text-center text-sm font-semibold text-white/60 py-2"
            >
              {day}
            </div>
          ))}

          {/* Days */}
          {calendarDays.map((date, idx) => {
            if (!date) return <div key={`empty-${idx}`} className="aspect-square" />;

            const dateISO = toISODate(date);
            const data = dayData[dateISO];
            const isToday = dateISO === todayISO;
            const isPast = dateISO < todayISO;
            const isCleared = isPast && !!data?.hasGoals && !data?.reviewed && data?.allGoalsHandled;
            const isOverdue = isPast && !!data?.hasGoals && !data?.reviewed && !data?.allGoalsHandled;

            const tone = isToday
              ? "today"
              : data?.reviewed
              ? "closed"
              : isOverdue
              ? "overdue"
              : isCleared
              ? "cleared"
              : data?.hasGoals
              ? "hasGoals"
              : "neutral";

            const t = toneStyles(tone);

            // one compact label line
            const label = isToday
              ? "Today"
              : data?.reviewed
              ? "Closed"
              : isOverdue
              ? "Missed"
              : isCleared
              ? "Cleared"
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
                  background: t.bg,
                  borderColor: t.border,
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
            <span>Today</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-md border"
              style={{
                background: toneStyles("closed").bg,
                borderColor: toneStyles("closed").border,
              }}
            />
            <span>Day Closed</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-md border"
              style={{
                background: toneStyles("hasGoals").bg,
                borderColor: toneStyles("hasGoals").border,
              }}
            />
            <span>Has Goals</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-md border"
              style={{
                background: toneStyles("overdue").bg,
                borderColor: toneStyles("overdue").border,
              }}
            />
            <span>Missed (unreviewed)</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-md border"
              style={{
                background: toneStyles("cleared").bg,
                borderColor: toneStyles("cleared").border,
              }}
            />
            <span>Cleared (rescheduled)</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-md border"
              style={{
                background: toneStyles("neutral").bg,
                borderColor: toneStyles("neutral").border,
              }}
            />
            <span>No Plan</span>
          </div>
        </div>
      </div>
  );
}
