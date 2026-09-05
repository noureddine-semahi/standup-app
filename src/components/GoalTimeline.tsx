"use client";

import { useState } from "react";
import { formatDateTimeDisplay } from "@/lib/supabase/db";
import type { TimelineEntry } from "@/lib/goalTimeline";

/** Renders a goal's chronological history/notes list with a collapse toggle. Shared by Review Today, a past day's archive view, and the Data & Metrics goal lists. */
export default function GoalTimeline({
  entries,
  defaultExpanded = true,
}: {
  entries: TimelineEntry[];
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-xs text-white/50 hover:text-white/80 transition"
      >
        {expanded ? "▾" : "▸"} History &amp; notes{entries.length > 0 ? ` (${entries.length})` : ""}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {entries.length === 0 ? (
            <div className="text-xs text-white/40 italic">Nothing recorded yet.</div>
          ) : (
            entries.map((e) => (
              <div key={e.key} className="flex items-start gap-2">
                <span
                  className="flex-shrink-0 rounded uppercase font-semibold tracking-wide"
                  style={{
                    fontSize: "9px",
                    padding: "2px 5px",
                    background: e.kind === "note" ? "rgba(34, 211, 238, 0.12)" : "rgba(255, 255, 255, 0.06)",
                    color: e.kind === "note" ? "#67e8f9" : "rgba(255, 255, 255, 0.5)",
                  }}
                >
                  {e.kind === "note" ? "Note" : "History"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white/70">{e.label}</div>
                  <div className="text-[10px] text-white/35 mt-0.5">{formatDateTimeDisplay(e.timestamp)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
