"use client";

import GoalAssignmentsPanel from "@/components/GoalAssignmentsPanel";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/**
 * Dedicated home for goal assignments — previously buried inside Social's
 * Friends tab alongside Discover/Connections, with no direct way to reach
 * it. Reachable via the Calendar<->Backlog nav rotation (now a 3-item
 * loop); Community's own "Goals" tab renders the same GoalAssignmentsPanel
 * as a quick-access shortcut, so both places stay in sync automatically.
 */
export default function AssignmentsPage() {
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-3xl font-bold">{t("nav.assignments")}</h1>
        <p className="mt-2 text-white/70">{t("assignments.subtitle")}</p>
      </div>
      <GoalAssignmentsPanel />
    </div>
  );
}
