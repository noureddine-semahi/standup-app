"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  isCurrentUserAdmin,
  isCurrentUserSysAdmin,
  getCurrentUserId,
  getAdminMembers,
  adminSetPoints,
  adminSetRole,
  adminWipeMemberData,
  getAdminAuditLog,
  getAdminLandingVisitStats,
  formatDateTimeDisplay,
  type AdminMember,
  type AdminAuditEntry,
  type AdminRole,
  type LandingVisitStats,
} from "@/lib/supabase/db";
import { getLevelInfo } from "@/lib/levels";

// Supabase throws plain {message, details, hint, code} objects, not native
// Error instances — `err instanceof Error` would silently swallow these.
function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as any).message === "string") {
    return (err as any).message;
  }
  return "Something went wrong.";
}

const ACTION_LABELS: Record<string, string> = {
  set_points: "Set Points",
  wipe_data: "Wipe Data",
  set_role: "Change Role",
};

const ROLE_LABELS: Record<AdminRole, string> = {
  member: "Member",
  admin: "Admin",
  sys_admin: "Sys Admin",
};

function describeAuditDetails(entry: AdminAuditEntry): string {
  if (entry.action === "set_points" && entry.details) {
    return `${entry.details.old_points ?? "?"} → ${entry.details.new_points ?? "?"}`;
  }
  if (entry.action === "set_role" && entry.details) {
    const oldRole = ROLE_LABELS[entry.details.old_role as AdminRole] ?? entry.details.old_role ?? "?";
    const newRole = ROLE_LABELS[entry.details.new_role as AdminRole] ?? entry.details.new_role ?? "?";
    return `${oldRole} → ${newRole}`;
  }
  return "—";
}

// Derived entirely from the member list we already fetch — no new table or
// RPC needed. Sign-ins and account deletions would need their own event log
// (accounts vanish on delete, and Supabase only keeps the latest sign-in
// timestamp), so those are left as a future addition, not built here.
const DAY_MS = 24 * 60 * 60 * 1000;
function computeSignupGrowth(members: AdminMember[]) {
  const now = Date.now();
  let daily = 0;
  let weekly = 0;
  let monthly = 0;
  for (const m of members) {
    const age = now - new Date(m.createdAt).getTime();
    if (age <= DAY_MS) daily++;
    if (age <= 7 * DAY_MS) weekly++;
    if (age <= 30 * DAY_MS) monthly++;
  }
  return { daily, weekly, monthly, total: members.length };
}

export default function AdminPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [sysAdmin, setSysAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [auditLog, setAuditLog] = useState<AdminAuditEntry[]>([]);
  const [visitStats, setVisitStats] = useState<LandingVisitStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [pointsDrafts, setPointsDrafts] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function init() {
      let isAdmin = false;
      try {
        isAdmin = await isCurrentUserAdmin();
      } catch {
        isAdmin = false;
      }
      setAuthorized(isAdmin);
      setChecking(false);

      if (!isAdmin) {
        router.push("/standup/dashboard");
        return;
      }

      try {
        setSysAdmin(await isCurrentUserSysAdmin());
      } catch {
        setSysAdmin(false);
      }

      try {
        setCurrentUserId(await getCurrentUserId());
      } catch {
        setCurrentUserId(null);
      }

      await refresh();
    }
    init();
  }, [router]);

  async function refresh() {
    setLoading(true);
    try {
      const [rows, log, visits] = await Promise.all([
        getAdminMembers(),
        getAdminAuditLog(),
        getAdminLandingVisitStats(),
      ]);
      setMembers(rows);
      setAuditLog(log);
      setVisitStats(visits);
      const drafts: Record<string, string> = {};
      rows.forEach((m) => (drafts[m.id] = String(m.points)));
      setPointsDrafts(drafts);
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function markBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      busy ? next.add(id) : next.delete(id);
      return next;
    });
  }

  async function handleSavePoints(member: AdminMember) {
    const raw = pointsDrafts[member.id];
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setMsg("Points must be a non-negative number.");
      return;
    }

    markBusy(member.id, true);
    setMsg(null);
    try {
      await adminSetPoints(member.id, Math.round(parsed));
      await refresh();
      setMsg(`Updated ${member.email}'s points.`);
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      markBusy(member.id, false);
    }
  }

  async function handleWipeData(member: AdminMember) {
    if (
      !window.confirm(
        `Wipe all app data for ${member.email}? This deletes their goals and resets their points and plans. Their login is not affected.`
      )
    ) {
      return;
    }

    markBusy(member.id, true);
    setMsg(null);
    try {
      await adminWipeMemberData(member.id);
      await refresh();
      setMsg(`Wiped data for ${member.email}.`);
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      markBusy(member.id, false);
    }
  }

  async function handleSetRole(member: AdminMember, role: AdminRole) {
    if (role === member.role) return;
    if (
      !window.confirm(
        `Change ${member.email}'s role from ${ROLE_LABELS[member.role]} to ${ROLE_LABELS[role]}?`
      )
    ) {
      return;
    }

    markBusy(member.id, true);
    setMsg(null);
    try {
      await adminSetRole(member.id, role);
      await refresh();
      setMsg(`Updated ${member.email}'s role to ${ROLE_LABELS[role]}.`);
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      markBusy(member.id, false);
    }
  }

  if (checking || (!authorized && !checking)) {
    return <div className="card">Checking access…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="card card-highlight">
        <h1 className="text-3xl font-bold">Admin — Members</h1>
        <p className="mt-2 text-white/70">
          {loading ? "Loading members…" : `${members.length} member${members.length === 1 ? "" : "s"}`}
        </p>
        {msg && <p className="mt-3 text-sm text-purple-300">{msg}</p>}
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-1">Growth — Sign-ups</h2>
        <p className="text-sm text-white/50 mb-4">New accounts created, based on join date.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {(() => {
            const growth = computeSignupGrowth(members);
            return (
              <>
                <div>
                  <div className="text-2xl font-bold gradient-text">{growth.daily}</div>
                  <div className="text-xs text-white/50 uppercase tracking-wide">Last 24h</div>
                </div>
                <div>
                  <div className="text-2xl font-bold gradient-text">{growth.weekly}</div>
                  <div className="text-xs text-white/50 uppercase tracking-wide">Last 7 days</div>
                </div>
                <div>
                  <div className="text-2xl font-bold gradient-text">{growth.monthly}</div>
                  <div className="text-xs text-white/50 uppercase tracking-wide">Last 30 days</div>
                </div>
                <div>
                  <div className="text-2xl font-bold gradient-text">{growth.total}</div>
                  <div className="text-xs text-white/50 uppercase tracking-wide">All time</div>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Mobile: one card per member, everything stacked vertically instead
          of crammed into table columns — the table below needs 920px of
          horizontal scroll room, which pushed Role/Level out of view on
          phones. Desktop/tablet keep the table (hidden below sm:). */}
      <div className="card sm:hidden space-y-3">
        {members.map((m) => {
          const level = getLevelInfo(m.points);
          const busy = busyIds.has(m.id);
          return (
            <div
              key={m.id}
              className="rounded-xl p-3"
              style={{ border: "1px solid rgba(255, 255, 255, 0.08)", background: "rgba(255, 255, 255, 0.02)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-white truncate">{m.displayName || m.email}</div>
                  <div className="text-xs text-white/50 truncate">{m.email}</div>
                </div>
                <div className="flex-shrink-0">
                  {sysAdmin && m.id !== currentUserId ? (
                    <select
                      value={m.role}
                      onChange={(e) => handleSetRole(m, e.target.value as AdminRole)}
                      disabled={busy}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      <option value="sys_admin">Sys Admin</option>
                    </select>
                  ) : (
                    <span
                      className={
                        m.role === "member"
                          ? "text-xs text-white/50"
                          : "rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-300"
                      }
                    >
                      {ROLE_LABELS[m.role]}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-sm">
                <div>
                  <div className="text-white/90">Lv {level.level}</div>
                  <div className="text-xs text-white/50">{level.name}</div>
                </div>
                <div className="text-right text-xs text-white/60">
                  {m.totalDaysClosed} days closed
                  <br />
                  {m.totalGoalsCompleted} goals completed
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={pointsDrafts[m.id] ?? ""}
                  onChange={(e) => setPointsDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))}
                  disabled={busy}
                  className="w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-white"
                />
                <button
                  onClick={() => handleSavePoints(m)}
                  disabled={busy || pointsDrafts[m.id] === String(m.points)}
                  className="btn text-xs px-3 py-1.5"
                >
                  Save Points
                </button>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-xs text-white/50">Joined {formatDateTimeDisplay(m.createdAt)}</span>
                <button
                  onClick={() => handleWipeData(m)}
                  disabled={busy}
                  className="btn text-xs px-3 py-1.5"
                  style={{ borderColor: "rgba(239, 68, 68, 0.4)", color: "#fca5a5" }}
                >
                  Wipe Data
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card overflow-x-auto hidden sm:block">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: "920px" }}>
          <thead>
            <tr className="text-left text-white/50 text-xs uppercase tracking-wide">
              <th className="pb-3 pr-4">Member</th>
              <th className="pb-3 pr-4">Role</th>
              <th className="pb-3 pr-4">Level</th>
              <th className="pb-3 pr-4">Points</th>
              <th className="pb-3 pr-4">Days Closed</th>
              <th className="pb-3 pr-4">Goals Completed</th>
              <th className="pb-3 pr-4">Joined</th>
              <th className="pb-3 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const level = getLevelInfo(m.points);
              const busy = busyIds.has(m.id);
              return (
                <tr key={m.id} style={{ borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-white">{m.displayName || m.email}</div>
                    <div className="text-xs text-white/50">{m.email}</div>
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    {sysAdmin && m.id !== currentUserId ? (
                      <select
                        value={m.role}
                        onChange={(e) => handleSetRole(m, e.target.value as AdminRole)}
                        disabled={busy}
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        <option value="sys_admin">Sys Admin</option>
                      </select>
                    ) : (
                      <span
                        className={
                          m.role === "member"
                            ? "text-xs text-white/50"
                            : "rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-300"
                        }
                      >
                        {ROLE_LABELS[m.role]}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <div>Lv {level.level}</div>
                    <div className="text-xs text-white/50">{level.name}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={pointsDrafts[m.id] ?? ""}
                        onChange={(e) =>
                          setPointsDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))
                        }
                        disabled={busy}
                        className="w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-white"
                      />
                      <button
                        onClick={() => handleSavePoints(m)}
                        disabled={busy || pointsDrafts[m.id] === String(m.points)}
                        className="btn text-xs px-3 py-1.5"
                      >
                        Save
                      </button>
                    </div>
                  </td>
                  <td className="py-3 pr-4">{m.totalDaysClosed}</td>
                  <td className="py-3 pr-4">{m.totalGoalsCompleted}</td>
                  <td className="py-3 pr-4 whitespace-nowrap text-white/70">
                    {formatDateTimeDisplay(m.createdAt)}
                  </td>
                  <td className="py-3 pr-4">
                    <button
                      onClick={() => handleWipeData(m)}
                      disabled={busy}
                      className="btn text-xs px-3 py-1.5"
                      style={{ borderColor: "rgba(239, 68, 68, 0.4)", color: "#fca5a5" }}
                    >
                      Wipe Data
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-1">Audit Log</h2>
        <p className="text-sm text-white/50 mb-4">Every points change and data wipe, most recent first.</p>

        {auditLog.length === 0 ? (
          <p className="text-sm text-white/50">No admin actions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: "640px" }}>
              <thead>
                <tr className="text-left text-white/50 text-xs uppercase tracking-wide">
                  <th className="pb-3 pr-4">When</th>
                  <th className="pb-3 pr-4">Admin</th>
                  <th className="pb-3 pr-4">Action</th>
                  <th className="pb-3 pr-4">Target</th>
                  <th className="pb-3 pr-4">Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((entry) => (
                  <tr key={entry.id} style={{ borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
                    <td className="py-3 pr-4 whitespace-nowrap text-white/70">
                      {formatDateTimeDisplay(entry.createdAt)}
                    </td>
                    <td className="py-3 pr-4">{entry.adminEmail ?? "—"}</td>
                    <td className="py-3 pr-4">{ACTION_LABELS[entry.action] ?? entry.action}</td>
                    <td className="py-3 pr-4">{entry.targetEmail ?? "—"}</td>
                    <td className="py-3 pr-4 text-white/70">{describeAuditDetails(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-1">Landing Page Visits</h2>
        <p className="text-sm text-white/50 mb-4">
          Signed-out visitors who landed on the homepage, whether or not they signed up.
        </p>

        {visitStats === null ? (
          <p className="text-sm text-white/50">Loading…</p>
        ) : (
          <>
            <div className="text-4xl font-bold gradient-text mb-4">{visitStats.total}</div>
            {visitStats.byDay.length === 0 ? (
              <p className="text-sm text-white/50">No visits recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: "320px" }}>
                  <thead>
                    <tr className="text-left text-white/50 text-xs uppercase tracking-wide">
                      <th className="pb-3 pr-4">Date</th>
                      <th className="pb-3 pr-4">Visits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitStats.byDay.map((row) => (
                      <tr key={row.date} style={{ borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
                        <td className="py-3 pr-4 whitespace-nowrap text-white/70">{row.date}</td>
                        <td className="py-3 pr-4">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
