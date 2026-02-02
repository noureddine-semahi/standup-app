"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import AuthGate from "@/components/AuthGate";
import { supabase } from "@/lib/supabase/client";
import { toISODate, addDays, getCurrentUserId } from "@/lib/supabase/db";

type DayData = {
  date: string;
  hasGoals: boolean;
  goalCount: number;
  reviewed: boolean;
  completedCount: number;
};

export default function CalendarPage() {
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dayData, setDayData] = useState<Record<string, DayData>>({});

  const today = useMemo(() => toISODate(new Date()), []);

  const monthStart = useMemo(() => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    return date;
  }, [currentDate]);

  const monthEnd = useMemo(() => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    return date;
  }, [currentDate]);

  const monthName = currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  useEffect(() => {
    async function loadMonthData() {
      setLoading(true);
      try {
        const userId = await getCurrentUserId();
        
        const startISO = toISODate(monthStart);
        const endISO = toISODate(monthEnd);

        // Fetch plans for this month
        const { data: plans, error: plansErr } = await supabase
          .from("daily_plans")
          .select("id, plan_date, reviewed_at")
          .eq("user_id", userId)
          .gte("plan_date", startISO)
          .lte("plan_date", endISO);

        if (plansErr) throw plansErr;

        // Fetch goals for these plans
        const planIds = (plans || []).map(p => p.id);
        
        let goalsData: any[] = [];
        if (planIds.length > 0) {
          const { data: goals, error: goalsErr } = await supabase
            .from("goals")
            .select("plan_id, status")
            .in("plan_id", planIds);

          if (goalsErr) throw goalsErr;
          goalsData = goals || [];
        }

        // Build day data map
        const dataMap: Record<string, DayData> = {};
        
        (plans || []).forEach((plan) => {
          const planGoals = goalsData.filter(g => g.plan_id === plan.id);
          const completedGoals = planGoals.filter(g => g.status === "completed");

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

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const days: (Date | null)[] = [];
    
    // Get first day of month (0 = Sunday, 6 = Saturday)
    const firstDayOfWeek = monthStart.getDay();
    
    // Add empty cells for days before month starts
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add all days of the month
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

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-2">
          {/* Day headers */}
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="text-center text-sm font-semibold text-white/60 py-2">
              {day}
            </div>
          ))}

          {/* Calendar days */}
          {calendarDays.map((date, idx) => {
            if (!date) {
              return <div key={`empty-${idx}`} className="aspect-square" />;
            }

            const dateISO = toISODate(date);
            const data = dayData[dateISO];
            const isToday = dateISO === today;
            const isPast = date < new Date(today);
            const isFuture = date > new Date(today);

            return (
              <Link
                key={dateISO}
                href={`/standup/today?date=${dateISO}`}
                className={[
                  "aspect-square rounded-xl border p-2 transition hover:border-white/30",
                  isToday
                    ? "border-white/30 bg-white/10"
                    : data?.reviewed
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : data?.hasGoals
                    ? "border-amber-500/30 bg-amber-500/10"
                    : "border-white/10 bg-white/5",
                ].join(" ")}
              >
                <div className="flex flex-col h-full">
                  <div className={["text-sm font-semibold", isToday ? "text-white" : "text-white/80"].join(" ")}>
                    {date.getDate()}
                  </div>

                  {data && (
                    <div className="mt-auto space-y-1">
                      {data.reviewed && (
                        <div className="text-xs text-emerald-400">✅ Closed</div>
                      )}
                      {data.hasGoals && (
                        <div className="text-xs text-white/60">
                          {data.completedCount}/{data.goalCount} goals
                        </div>
                      )}
                    </div>
                  )}

                  {isToday && (
                    <div className="mt-1 text-xs text-white/50">Today</div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-6 flex flex-wrap gap-4 text-xs text-white/60">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border border-white/30 bg-white/10" />
            <span>Today</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border border-emerald-500/30 bg-emerald-500/10" />
            <span>Day Closed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border border-amber-500/30 bg-amber-500/10" />
            <span>Has Goals</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border border-white/10 bg-white/5" />
            <span>No Plan</span>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}