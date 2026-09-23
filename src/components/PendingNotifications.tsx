"use client";

import { useState } from "react";
import {
  respondToConnectionRequest,
  respondToGoalAssignment,
  markConnectionSeen,
  markGoalAssignmentSeen,
  connectionDisplayName,
  type Connection,
  type GoalAssignment,
} from "@/lib/supabase/db";
import { computeNotificationBuckets } from "@/lib/notificationBuckets";
import { notifyNotificationsUpdated } from "@/lib/notificationsBus";
import { statusLabel } from "@/lib/goalStatus";
import StatusIcon from "@/components/StatusIcon";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const ACTION_BTN_STYLE = { padding: "0.25rem 0.6rem", fontSize: "0.7rem" } as const;

/**
 * Dashboard-only summary of connection requests and goal assignments that
 * need the user's attention: incoming ones awaiting Accept/Decline, plus
 * resolved ones the user sent out that they haven't acknowledged yet. The
 * full history for all of this still lives on Social's Friends tab —
 * "Got it" here only sets a seen timestamp (markConnectionSeen /
 * markGoalAssignmentSeen), it never deletes anything, unlike Social's own
 * Dismiss button on assigned goals.
 */
export default function PendingNotifications({
  connections,
  goalAssignments,
  onChange,
}: {
  connections: Connection[];
  goalAssignments: GoalAssignment[];
  onChange: () => void;
}) {
  const { t } = useLanguage();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function setBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const {
    pendingConnections,
    pendingAssignments,
    pendingAssignedByYou,
    resolvedConnections,
    resolvedAssignments,
  } = computeNotificationBuckets(connections, goalAssignments);

  const total =
    pendingConnections.length +
    pendingAssignments.length +
    pendingAssignedByYou.length +
    resolvedConnections.length +
    resolvedAssignments.length;
  if (total === 0) return null;

  async function run(id: string, action: () => Promise<void>) {
    if (busyIds.has(id)) return;
    setBusy(id, true);
    setError(null);
    try {
      await action();
      onChange();
      notifyNotificationsUpdated();
    } catch (e: any) {
      setError(e?.message ?? t("dashboard.notificationActionFailed"));
    } finally {
      setBusy(id, false);
    }
  }

  return (
    <div className="card card-highlight">
      <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
        {t("dashboard.notificationsTitle")}
      </div>
      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}

      <div className="space-y-1.5">
        {pendingConnections.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm text-white/85 truncate">{connectionDisplayName(c, t)}</div>
              <div className="text-[11px] text-white/50 truncate">{t("dashboard.connectionRequestLabel")}</div>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => run(c.id, () => respondToConnectionRequest(c.id, true))}
                disabled={busyIds.has(c.id)}
                className="btn"
                style={ACTION_BTN_STYLE}
              >
                {t("social.accept")}
              </button>
              <button
                type="button"
                onClick={() => run(c.id, () => respondToConnectionRequest(c.id, false))}
                disabled={busyIds.has(c.id)}
                className="btn"
                style={ACTION_BTN_STYLE}
              >
                {t("social.decline")}
              </button>
            </div>
          </div>
        ))}

        {pendingAssignments.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm text-white/85 truncate">{a.snapshotTitle}</div>
              <div className="text-[11px] text-white/50 truncate">
                {t("social.assignedByLabel", { name: a.assignerDisplayName ?? t("social.anonymousUser") })}
              </div>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => run(a.id, () => respondToGoalAssignment(a.id, true))}
                disabled={busyIds.has(a.id)}
                className="btn"
                style={ACTION_BTN_STYLE}
              >
                {t("social.accept")}
              </button>
              <button
                type="button"
                onClick={() => run(a.id, () => respondToGoalAssignment(a.id, false))}
                disabled={busyIds.has(a.id)}
                className="btn"
                style={ACTION_BTN_STYLE}
              >
                {t("social.decline")}
              </button>
            </div>
          </div>
        ))}

        {pendingAssignedByYou.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm text-white/85 truncate">{a.snapshotTitle}</div>
              <div className="text-[11px] text-white/50 truncate">
                {t("dashboard.assignmentWaitingStatus", {
                  name: a.recipientDisplayName ?? t("social.anonymousUser"),
                })}
              </div>
            </div>
          </div>
        ))}

        {resolvedConnections.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm text-white/85 truncate">{connectionDisplayName(c, t)}</div>
              <div className="text-[11px] text-white/50 truncate">
                {c.status === "accepted" ? t("dashboard.connectionAcceptedStatus") : t("dashboard.connectionDeclinedStatus")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => run(c.id, () => markConnectionSeen(c.id))}
              disabled={busyIds.has(c.id)}
              className="btn flex-shrink-0"
              style={ACTION_BTN_STYLE}
            >
              {t("dashboard.acknowledge")}
            </button>
          </div>
        ))}

        {resolvedAssignments.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm text-white/85 truncate">{a.snapshotTitle}</div>
              <div className="text-[11px] text-white/50 truncate inline-flex items-center gap-1">
                {t("social.assignedToLabel", { name: a.recipientDisplayName ?? t("social.anonymousUser") })}
                {a.status === "declined" ? (
                  <span>· {t("social.assignmentDeclined")}</span>
                ) : a.recipientGoalStatus ? (
                  <span className="inline-flex items-center gap-1">
                    · <StatusIcon status={a.recipientGoalStatus} size={12} /> {statusLabel(a.recipientGoalStatus, t)}
                  </span>
                ) : (
                  <span>· {t("dashboard.accepted")}</span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => run(a.id, () => markGoalAssignmentSeen(a.id))}
              disabled={busyIds.has(a.id)}
              className="btn flex-shrink-0"
              style={ACTION_BTN_STYLE}
            >
              {t("dashboard.acknowledge")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
