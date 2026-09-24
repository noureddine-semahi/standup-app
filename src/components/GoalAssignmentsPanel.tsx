"use client";

import { useEffect, useState } from "react";
import {
  getMyGoalAssignments,
  respondToGoalAssignment,
  removeGoalAssignment,
  type GoalAssignment,
} from "@/lib/supabase/db";
import { notifyNotificationsUpdated } from "@/lib/notificationsBus";
import { statusLabel, statusChipColors } from "@/lib/goalStatus";
import { getPriorityMeta } from "@/lib/priorityStyles";
import StatusIcon from "@/components/StatusIcon";
import { Hourglass, XCircle, Lock, Unlock } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const ACTION_BTN_STYLE = { padding: "0.25rem 0.6rem", fontSize: "0.7rem" } as const;

/**
 * The full "Goal Assignments" experience — self-contained (fetches its
 * own data) so it can be dropped into more than one place: the dedicated
 * /standup/assignments page (its primary home) and Community's own
 * "Goals" tab (a quick-access shortcut to the same thing), without
 * duplicating the fetch/handler logic between them.
 */
export default function GoalAssignmentsPanel() {
  const { t } = useLanguage();
  const [goalAssignments, setGoalAssignments] = useState<GoalAssignment[]>([]);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [busyAssignmentIds, setBusyAssignmentIds] = useState<Set<string>>(new Set());

  function refreshGoalAssignments() {
    return getMyGoalAssignments()
      .then(setGoalAssignments)
      .catch((e: any) => setAssignmentError(e?.message ?? t("social.failedLoadAssignments")));
  }

  useEffect(() => {
    refreshGoalAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setAssignmentBusy(id: string, busy: boolean) {
    setBusyAssignmentIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleRespondAssignment(id: string, accept: boolean) {
    if (busyAssignmentIds.has(id)) return;
    setAssignmentBusy(id, true);
    setAssignmentError(null);
    try {
      await respondToGoalAssignment(id, accept);
      await refreshGoalAssignments();
      notifyNotificationsUpdated();
    } catch (e: any) {
      setAssignmentError(e?.message ?? t("social.failedAssignRespond"));
    } finally {
      setAssignmentBusy(id, false);
    }
  }

  async function handleDismissAssignment(id: string) {
    if (busyAssignmentIds.has(id)) return;
    setAssignmentBusy(id, true);
    setAssignmentError(null);
    try {
      await removeGoalAssignment(id);
      await refreshGoalAssignments();
      notifyNotificationsUpdated();
    } catch (e: any) {
      setAssignmentError(e?.message ?? t("social.failedDismissAssignment"));
    } finally {
      setAssignmentBusy(id, false);
    }
  }

  const assignmentsForYou = goalAssignments.filter((a) => a.direction === "received" && a.status === "pending");
  const goalsAssignedToYou = goalAssignments.filter((a) => a.direction === "received" && a.status !== "pending");
  const assignedByYou = goalAssignments.filter((a) => a.direction === "assigned");

  return (
    <div
      className="card"
      style={{ background: "rgba(var(--tint-rgb), 0.03)", border: "1px solid rgba(var(--tint-rgb), 0.08)" }}
    >
      <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-2">
        {t("social.goalAssignmentsTitle")}
      </div>
      <p className="text-xs text-white/60 mb-3">{t("social.goalAssignmentsSubtitle")}</p>
      {assignmentError && <p className="mt-2 text-xs text-red-300">{assignmentError}</p>}

      <div className="mt-4 space-y-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold mb-1.5">
            {t("social.assignmentsForYou")}
          </div>
          {assignmentsForYou.length === 0 ? (
            <p className="text-xs text-white/40 italic">{t("social.noAssignmentsForYou")}</p>
          ) : (
            <div className="space-y-1.5">
              {assignmentsForYou.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5">
                  <div
                    className="priority-chip-sm"
                    style={{
                      "--p-bg": getPriorityMeta(a.snapshotPriority).bg,
                      "--p-border": getPriorityMeta(a.snapshotPriority).border,
                      "--p-color": getPriorityMeta(a.snapshotPriority).color,
                    } as React.CSSProperties}
                  >
                    P{a.snapshotPriority}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-white/90 truncate">{a.snapshotTitle}</div>
                    <div className="text-[11px] text-white/50 truncate">
                      {t("social.assignedByLabel", { name: a.assignerDisplayName ?? t("social.anonymousUser") })}
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRespondAssignment(a.id, true)}
                      disabled={busyAssignmentIds.has(a.id)}
                      className="btn"
                      style={ACTION_BTN_STYLE}
                    >
                      {t("social.accept")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRespondAssignment(a.id, false)}
                      disabled={busyAssignmentIds.has(a.id)}
                      className="btn"
                      style={ACTION_BTN_STYLE}
                    >
                      {t("social.decline")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold mb-1.5">
            {t("social.goalsAssignedToYouTitle")}
          </div>
          {goalsAssignedToYou.length === 0 ? (
            <p className="text-xs text-white/40 italic">{t("social.noGoalsAssignedToYou")}</p>
          ) : (
            <div className="space-y-1.5">
              {goalsAssignedToYou.map((a) => {
                const chip =
                  a.status === "declined" ? statusChipColors("canceled") : statusChipColors(a.recipientGoalStatus ?? "not_started");
                return (
                  <div key={a.id} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5">
                    <div
                      className="priority-chip-sm"
                      style={{
                        "--p-bg": getPriorityMeta(a.snapshotPriority).bg,
                        "--p-border": getPriorityMeta(a.snapshotPriority).border,
                        "--p-color": getPriorityMeta(a.snapshotPriority).color,
                      } as React.CSSProperties}
                    >
                      P{a.snapshotPriority}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-white/90 truncate">{a.snapshotTitle}</div>
                      <div className="text-[11px] text-white/50 truncate inline-flex items-center gap-1">
                        {a.assignmentType === "exclusive" ? <Lock size={10} /> : <Unlock size={10} />}
                        {t("social.assignedByLabel", { name: a.assignerDisplayName ?? t("social.anonymousUser") })}
                      </div>
                    </div>
                    <div
                      className="status-chip-sm"
                      style={{ "--chip-bg": chip.bg, "--chip-border": chip.border, "--chip-color": chip.color } as React.CSSProperties}
                    >
                      {a.status === "declined" ? (
                        <>
                          <XCircle size={12} />
                          <span>{t("social.assignmentDeclined")}</span>
                        </>
                      ) : (
                        a.recipientGoalStatus && (
                          <>
                            <StatusIcon status={a.recipientGoalStatus} size={12} />
                            <span>{statusLabel(a.recipientGoalStatus, t)}</span>
                          </>
                        )
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDismissAssignment(a.id)}
                      disabled={busyAssignmentIds.has(a.id)}
                      className="btn flex-shrink-0"
                      style={ACTION_BTN_STYLE}
                    >
                      {t("social.dismiss")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold mb-1.5">
            {t("social.assignedByYou")}
          </div>
          {assignedByYou.length === 0 ? (
            <p className="text-xs text-white/40 italic">{t("social.noAssignedGoals")}</p>
          ) : (
            <div className="space-y-1.5">
              {assignedByYou.map((a) => {
                // Declined reuses "canceled"'s established slate treatment --
                // semantically the same thing (didn't happen), not an alarm.
                const chip =
                  a.status === "pending"
                    ? { bg: "rgba(245, 158, 11, 0.1)", border: "rgba(245, 158, 11, 0.35)", color: "#fcd34d" }
                    : a.status === "declined"
                    ? statusChipColors("canceled")
                    : a.recipientGoalStatus
                    ? statusChipColors(a.recipientGoalStatus)
                    : null;
                return (
                  <div key={a.id} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5">
                    <div
                      className="priority-chip-sm"
                      style={{
                        "--p-bg": getPriorityMeta(a.snapshotPriority).bg,
                        "--p-border": getPriorityMeta(a.snapshotPriority).border,
                        "--p-color": getPriorityMeta(a.snapshotPriority).color,
                      } as React.CSSProperties}
                    >
                      P{a.snapshotPriority}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-white/90 truncate">{a.snapshotTitle}</div>
                      <div className="text-[11px] text-white/50 truncate inline-flex items-center gap-1">
                        {a.assignmentType === "exclusive" ? <Lock size={10} /> : <Unlock size={10} />}
                        {t("social.assignedToLabel", { name: a.recipientDisplayName ?? t("social.anonymousUser") })}
                      </div>
                    </div>
                    {chip && (
                      <div
                        className="status-chip-sm"
                        style={{ "--chip-bg": chip.bg, "--chip-border": chip.border, "--chip-color": chip.color } as React.CSSProperties}
                      >
                        {a.status === "pending" ? (
                          <>
                            <Hourglass size={12} />
                            <span>{t("social.assignmentPending")}</span>
                          </>
                        ) : a.status === "declined" ? (
                          <>
                            <XCircle size={12} />
                            <span>{t("social.assignmentDeclined")}</span>
                          </>
                        ) : (
                          a.recipientGoalStatus && (
                            <>
                              <StatusIcon status={a.recipientGoalStatus} size={12} />
                              <span>{statusLabel(a.recipientGoalStatus, t)}</span>
                            </>
                          )
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDismissAssignment(a.id)}
                      disabled={busyAssignmentIds.has(a.id)}
                      className="btn flex-shrink-0"
                      style={ACTION_BTN_STYLE}
                    >
                      {t("social.dismiss")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
