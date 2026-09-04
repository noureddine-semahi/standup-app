"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  isCurrentUserAdmin,
  getAdminMembers,
  adminSetPoints,
  adminWipeMemberData,
  getAdminAuditLog,
  getAdminLandingVisitStats,
  formatDateTimeDisplay,
  type AdminMember,
  type AdminAuditEntry,
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
};

function describeAuditDetails(entry: AdminAuditEntry): string {
  if (entry.action === "set_points" && entry.details) {
    return `${entry.details.old_points ?? "?"} → ${entry.details.new_points ?? "?"}`;
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

      <div className="card overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: "820px" }}>
          <thead>
            <tr className="text-left text-white/50 text-xs uppercase tracking-wide">
              <th className="pb-3 pr-4">Member</th>
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
                    <div className="text-xs text-white/50">
                      {m.email}
                      {m.isAdmin && (
                        <span className="ml-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-purple-300">
                          Admin
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    Lv {level.level} · {level.name}
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
