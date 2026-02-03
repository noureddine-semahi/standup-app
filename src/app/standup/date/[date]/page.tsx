"use client";

// File: src/app/standup/date/[date]/page.tsx
// This allows accessing any date from the calendar

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import {
  getPlanWithGoals,
  isPrevDayReviewedForPlan,
  submitPlan,
  toISODate,
  upsertGoals,
  deleteGoal,
  type Goal,
} from "@/lib/supabase/db";
import { supabase } from "@/lib/supabase/client";

// This is essentially a copy of the Tomorrow page but works for ANY date

export default function DynamicDatePage() {
  const params = useParams();
  const router = useRouter();
  const dateISO = params.date as string; // e.g., "2026-02-15"
  
  const [loading, setLoading] = useState(true);
  const [blocking, setBlocking] = useState(false);
  const [goals, setGoals] = useState<Partial<Goal>[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [planStatus, setPlanStatus] = useState<string>("draft");
  const [msg, setMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  
  // Drag handlers
  function handleDragStart(idx: number) {
    setDraggedIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    setGoals(prev => {
      const newGoals = [...prev];
      const [dragged] = newGoals.splice(draggedIdx, 1);
      newGoals.splice(idx, 0, dragged);
      return newGoals.map((g, i) => ({ ...g, sort_order: i }));
    });
    setDraggedIdx(idx);
  }

  function handleDragEnd() {
    setDraggedIdx(null);
    // Auto-save here
  }
  
  async function refresh() {
    setLoading(true);
    setMsg(null);
    
    // Check if previous day is reviewed
    const ok = await isPrevDayReviewedForPlan(dateISO);
    if (!ok) {
      setMsg(`⚠️ Previous day must be reviewed first`);
      setBlocking(true);
      setLoading(false);
      return;
    }
    
    setBlocking(false);
    
    const { plan, goals: dbGoals } = await getPlanWithGoals(dateISO);
    setPlanId(plan.id);
    setPlanStatus(plan.status);
    
    // Fetch reschedule origins
    const goalIds = dbGoals.map(g => g.id).filter(Boolean) as string[];
    let rescheduleOrigins: Record<string, { from_date: string; reason: string | null }> = {};
    
    if (goalIds.length > 0) {
      const { data: reschedules } = await supabase
        .from("goal_reschedules")
        .select("materialized_goal_id, from_date, reason")
        .in("materialized_goal_id", goalIds)
        .eq("materialized", true);
      
      reschedules?.forEach((item) => {
        if (item.materialized_goal_id) {
          rescheduleOrigins[item.materialized_goal_id] = {
            from_date: item.from_date,
            reason: item.reason,
          };
        }
      });
    }
    
    const goalsWithOrigin = dbGoals.map(g => ({
      ...g,
      rescheduled_from_date: rescheduleOrigins[g.id]?.from_date || null,
      reschedule_reason: rescheduleOrigins[g.id]?.reason || null,
    }));
    
    setGoals(goalsWithOrigin);
    setLoading(false);
  }
  
  useEffect(() => {
    refresh();
  }, [dateISO]);
  
  if (loading) {
    return (
      <AuthGate>
        <div className="card">
          <h1 className="text-3xl font-bold">Loading...</h1>
        </div>
      </AuthGate>
    );
  }
  
  if (blocking) {
    return (
      <AuthGate>
        <div className="card">
          <h1 className="text-3xl font-bold">Goals for {dateISO}</h1>
          <p className="mt-2 text-white/70">
            Before you can plan this date, you must review the previous day.
          </p>
          {msg && <div className="mt-4 text-sm text-amber-400">{msg}</div>}
        </div>
      </AuthGate>
    );
  }
  
  const locked = planStatus === "locked";
  const submitted = planStatus === "submitted";
  
  return (
    <AuthGate>
      <div className="card">
        <div className="flex items-start justify-between mb-8">
          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-2">Goals for {dateISO}</h1>
            <p className="text-white/70">Plan your goals for this date</p>
          </div>
          
          {!locked && !submitted && (
            <button
              onClick={() => setEditMode(!editMode)}
              style={{
                background: editMode ? "rgba(168, 85, 247, 0.3)" : "rgba(255,255,255,0.05)",
                border: `2px solid ${editMode ? "rgba(168, 85, 247, 0.6)" : "rgba(255,255,255,0.1)"}`,
                minWidth: "140px",
                padding: "0.75rem 1.5rem",
                borderRadius: "0.75rem"
              }}
              className="font-semibold transition-all hover:scale-105"
            >
              {editMode ? "✓ Done" : "✏️ Reorder"}
            </button>
          )}
        </div>
        
        <div className="space-y-4">
          {goals.map((g, idx) => (
            <div
              key={g.id || idx}
              draggable={editMode}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className="p-6 rounded-xl bg-white/5 border border-white/10"
              style={{
                cursor: editMode ? "move" : "default",
                opacity: draggedIdx === idx ? 0.5 : 1
              }}
            >
              {editMode && (
                <div className="absolute left-2 top-1/2 -translate-y-1/2 text-3xl text-white/30">
                  ⋮⋮
                </div>
              )}
              
              <div className="text-white text-xl">{g.title}</div>
              
              {(g as any).rescheduled_from_date && (
                <div className="mt-2 text-xs text-purple-300/70">
                  ↩️ Rescheduled from {(g as any).rescheduled_from_date}
                  {(g as any).reschedule_reason && (
                    <span className="italic ml-2">- "{(g as any).reschedule_reason}"</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        
        {msg && <div className="mt-4 text-sm text-blue-400">{msg}</div>}
      </div>
    </AuthGate>
  );
}