"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import AuthGate from "@/components/AuthGate";
import { supabase } from "@/lib/supabase/client";
import { toISODate, getCurrentUserId } from "@/lib/supabase/db";

type DayData = {
  date: string;
  hasGoals: boolean;
  goalCount: number;
  reviewed: boolean;
  completedCount: number;
};

function toneStyles(tone: "neutral" | "today" | "closed" | "hasGoals") {
  // Single “3D sphere” look using:
  // - layered radial + linear gradients
  // - subtle highlight + shadow
  // - slightly different tints per state
  switch (tone) {
    case "today":
      return {
        bg: `
          radial-gradient(circle at 30% 25%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.02) 38%, rgba(0,0,0,0.12) 72%),
          radial-gradient(circle at 70% 75%, rgba(168, 85, 247, 0.22) 0%, rgba(59, 130, 246, 0.16) 45%, rgba(0,0,0,0.20) 100%),
          linear-gradient(135deg, rgba(168, 85, 247, 0.20), rgba(59, 130, 246, 0.18))
        `,
        border: "rgba(255,255,255,0.22)",
        glow: "0 12px 30px rgba(168, 85, 247, 0.18)",
      };
    case "closed":
      return {
        bg: `
          radial-gradient(circle at 30% 25%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.02) 40%, rgba(0,0,0,0.12) 74%),
          radial-gradient(circle at 70% 75%, rgba(16, 185, 129, 0.20) 0%, rgba(52, 211, 153, 0.16) 50%, rgba(0,0,0,0.20) 100%),
          linear-gradient(135deg, rgba(16, 185, 129, 0.18), rgba(52, 211, 153, 0.16))
        `,
        border: "rgba(16, 185, 129, 0.28)",
        glow: "0 12px 30px rgba(16, 185, 129, 0.12)",
      };
    case "hasGoals":
      return {
        bg: `
          radial-gradient(circle at 30% 25%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.02) 40%, rgba(0,0,0,0.12) 74%),
          radial-gradient(circle at 70% 75%, rgba(250, 204, 21, 0.18) 0%, rgba(253, 224, 71, 0.14) 50%, rgba(0,0,0,0.20) 100%),
          linear-gradient(135deg, rgba(250, 204, 21, 0.14), rgba(253, 224, 71, 0.12))
        `,
        border: "rgba(250, 204, 21, 0.26)",
        glow: "0 12px 30px rgba(202, 138, 4, 0.10)",
      };
    case "neutral":
    default:
      return {
        bg: `
          radial-gradient(circle at 30% 25%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.02) 42%, rgba(0,0,0,0.14) 76%),
          linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))
        `,
        border: "rgba(255,255,255,0.14)",
        glow: "0 12px 30px rgba(0,0,0,0.20)",
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
            .select("plan_id, status")
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
    return (
      <AuthGate>
        <div className="card">Loading calendar...</div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">Calendar</h1>
          <div className="flex items-center gap-2">
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

        <div className="grid grid-cols-7 gap-3">
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

            const tone = isToday
              ? "today"
              : data?.reviewed
              ? "closed"
              : data?.hasGoals
              ? "hasGoals"
              : "neutral";

            const t = toneStyles(tone);

            // one compact label line
            const label = isToday
              ? "Today"
              : data?.reviewed
              ? "Closed"
              : data?.hasGoals
              ? `${data.completedCount}/${data.goalCount}`
              : "";

            return (
              <Link
                key={dateISO}
                href={`/standup/today?date=${dateISO}`}
                className={[
                  "aspect-square rounded-full border transition-all duration-300",
                  "flex flex-col items-center justify-center text-center",
                  "hover:scale-[1.06] active:scale-[0.98]",
                  "focus:outline-none focus:ring-2 focus:ring-white/40",
                ].join(" ")}
                style={{
                  background: t.bg,
                  borderColor: t.border,
                  boxShadow: `${t.glow}, inset 0 2px 10px rgba(255,255,255,0.06), inset 0 -10px 18px rgba(0,0,0,0.20)`,
                }}
                title={dateISO}
              >
                {/* Number */}
                <div
                    className="leading-none select-none"
                    style={{
                        fontSize: "1.8rem",
                        fontWeight: 900,
                        letterSpacing: "-0.05em",
                        color: "#e71313",
                        WebkitTextStroke: "0.6px rgba(0,0,0,0.35)",
                        textShadow: `
                        0 1px 0 rgba(255,255,255,0.35),
                        0 4px 10px rgba(0,0,0,0.45)
                        `,
                    }}
                    >
                    {date.getDate()}
                </div>

                {/* Text under number */}
                <div className="mt-1 text-[10px] font-semibold text-white/90 leading-none">
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
              className="w-4 h-4 rounded-full border"
              style={{
                background: toneStyles("today").bg,
                borderColor: toneStyles("today").border,
              }}
            />
            <span>Today</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-full border"
              style={{
                background: toneStyles("closed").bg,
                borderColor: toneStyles("closed").border,
              }}
            />
            <span>Day Closed</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-full border"
              style={{
                background: toneStyles("hasGoals").bg,
                borderColor: toneStyles("hasGoals").border,
              }}
            />
            <span>Has Goals</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-full border"
              style={{
                background: toneStyles("neutral").bg,
                borderColor: toneStyles("neutral").border,
              }}
            />
            <span>No Plan</span>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
