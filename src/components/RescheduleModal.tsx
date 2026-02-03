"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { toISODate, addDays, rescheduleGoalToDate, type Goal } from "@/lib/supabase/db";

type RescheduleModalProps = {
  goal: Goal;
  onClose: () => void;
  onSuccess: () => void;
};

export default function RescheduleModal({ goal, onClose, onSuccess }: RescheduleModalProps) {
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  // Generate date options (today + next 30 days)
  const dateOptions: { value: string; label: string }[] = [];
  const today = new Date();
  
  for (let i = 0; i <= 30; i++) {
    const date = addDays(today, i);
    const isoDate = toISODate(date);
    const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
    const monthDay = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    
    let label = `${dayName}, ${monthDay}`;
    if (i === 0) label += " (Today)";
    if (i === 1) label += " (Tomorrow)";
    
    dateOptions.push({ value: isoDate, label });
  }

  async function handleReschedule() {
    if (!selectedDate) {
      setError("Please select a date");
      return;
    }

    console.log("🔍 Starting reschedule:", {
      goal: goal.title,
      goalId: goal.id,
      toDate: selectedDate,
      reason: reason
    });

    setSaving(true);
    setError(null);

    try {
      await rescheduleGoalToDate({
        goal,
        toDateISO: selectedDate,
        reason: reason.trim() || undefined,
      });

      console.log("✅ Reschedule successful");
      onSuccess();
      onClose();
    } catch (e: any) {
      console.error("❌ Reschedule failed:", e);
      setError(e?.message ?? "Failed to reschedule");
      setSaving(false);
    }
  }

  const modalContent = (
    <div 
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(8px)",
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      onClick={(e) => {
        // Close if clicking backdrop
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="card"
        style={{
          maxWidth: '500px',
          width: '100%',
          maxHeight: "90vh",
          overflowY: "auto",
          position: 'relative',
          zIndex: 10000
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold">Reschedule Goal</h2>
            <p className="mt-1 text-sm text-white/70">Move this goal to a future date</p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-white/50 hover:text-white/80 text-2xl leading-none"
            style={{
              background: "rgba(255,255,255,0.1)",
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            ×
          </button>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-3 mb-4">
          <div className="text-sm text-white/60">Goal:</div>
          <div className="mt-1 font-medium">{goal.title}</div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Reschedule to:
            </label>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              disabled={saving}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-white/25 disabled:opacity-50"
            >
              <option value="">Select a date...</option>
              {dateOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Reason (optional):
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              placeholder="Why are you rescheduling this goal?"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50 resize-none"
              rows={3}
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleReschedule}
              disabled={saving || !selectedDate}
              className="btn btn-primary flex-1"
            >
              {saving ? "Rescheduling..." : "Reschedule Goal"}
            </button>
            <button
              onClick={onClose}
              disabled={saving}
              className="btn btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>

        <div className="mt-4 text-xs text-white/50">
          The goal will be marked as "postponed" and will appear automatically on the selected date.
        </div>
      </div>
    </div>
  );

  // Render in portal to escape any positioning contexts
  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}