"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { AssigneeChecklistEntry } from "@/lib/useAssigneeChecklists";
import { StatusBox, checklistTextStyle } from "@/components/GoalChecklist";

/**
 * The ASSIGNEE's checklist, as the assigner sees it on an accepted assigned-out Task. Strictly read-only: there is no
 * checkbox, edit, delete or add control, and nothing here writes anywhere. It sits next to (never merged with) the
 * assigner's own "My checklist". Completed counts toward the progress; Missing and Pending do not.
 */
export default function AssigneeChecklist({ assigneeName, entry }: { assigneeName: string | null; entry: AssigneeChecklistEntry }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const name = assigneeName?.trim() || t("assignee.fallbackName");
  const items = entry.state === "ready" ? [...entry.items].sort((a, b) => a.position - b.position) : [];
  const completed = items.filter((i) => i.status === "completed").length;
  const title = t("assignee.checklistToggle", { name });
  const progress = entry.state === "ready" && items.length > 0 ? ` (${completed}/${items.length})` : "";

  return (
    <div className={expanded ? "goal-toolbar-expandable goal-toolbar-expandable-open" : "goal-toolbar-expandable"} data-testid="assignee-checklist">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="btn btn-tint btn-blue goal-toolbar-btn"
        title={title}
      >
        <ListChecks size={13} />
        <span className="goal-toolbar-label">
          {title}
          {progress}
        </span>
        {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5" style={{ minWidth: 0 }}>
          {entry.state === "loading" && <div className="text-xs text-white/50">{t("assignee.loading")}</div>}
          {entry.state === "error" && (
            <div role="alert" className="text-xs text-red-300">
              {t("assignee.error")}
            </div>
          )}
          {entry.state === "unavailable" && <div className="text-xs text-white/50 italic">{t("assignee.unavailable")}</div>}
          {entry.state === "ready" && items.length === 0 && <div className="text-xs text-white/40 italic">{t("assignee.empty")}</div>}
          {items.map((item) => {
            const label = t(`checklist.status.${item.status}`);
            return (
              <div key={item.id} className="flex items-center gap-1" data-testid="assignee-checklist-row" data-status={item.status}>
                <span role="img" aria-label={label} title={label} className="inline-flex items-center justify-center flex-shrink-0" style={{ width: 28, height: 28 }}>
                  <StatusBox status={item.status} />
                </span>
                <span className="flex-1 min-w-0 text-sm" style={{ overflowWrap: "anywhere", ...checklistTextStyle(item.status) }}>
                  {item.text}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
