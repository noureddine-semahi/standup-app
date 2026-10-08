"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import RescheduleModal from "@/components/RescheduleModal";
import BlockedReasonModal from "@/components/BlockedReasonModal";
import PaymentConfirmModal from "@/components/PaymentConfirmModal";
import GoalTimeline from "@/components/GoalTimeline";
import GoalChecklist from "@/components/GoalChecklist";
import GoalAttachments from "@/components/GoalAttachments";
import PageLoadingState from "@/components/PageLoadingState";
import PortalDropdownMenu from "@/components/PortalDropdownMenu";
import GoalNumberOrb from "@/components/GoalNumberOrb";
import MarqueeText from "@/components/MarqueeText";
import GoalTypeSelect from "@/components/GoalTypeSelect";
import GoalTypeInfoModal from "@/components/GoalTypeInfoModal";
import { buildGoalTimeline } from "@/lib/goalTimeline";
import {
  addDays,
  addGoalNote,
  awardAwarenessPoints,
  deleteGoal,
  awardClosurePoints,
  computeClosurePoints,
  enforceSingleP1,
  getAttachmentsForGoals,
  getChecklistItemsForGoals,
  getNotesForGoals,
  getPlanWithGoals,
  getStreak,
  getStreakPassCoveredDates,
  hoursUntilMidnight,
  markGoalReviewed,
  markPlanReviewed,
  updateGoalPriority,
  updateGoalStatus,
  updateGoalLink,
  toISODate,
  formatDateDisplay,
  formatTimeOfDay,
  formatDateTimeDisplay,
  upsertGoals,
  publishGoalGlimpse,
  unpublishGoalGlimpse,
  getMyGoalGlimpsePost,
  listConnections,
  connectionDisplayName,
  createGoalAssignment,
  getMyGoalAssignments,
  respondToGoalAssignment,
  ensurePaymentReminderGoals,
  getPaymentAccounts,
  confirmPaymentGoalCompletion,
  createOutcomeGoal,
  getOutcomeGoals,
  getConceptualTasksByOutcomeGoalIds,
  type PaymentAccount,
  type ChecklistItem,
  type DailyPlan,
  type Goal,
  type GoalAttachment,
  type GoalStatus,
  type PostVisibility,
  type Connection,
  type GoalAssignment,
  type GoalAssignmentType,
  type OutcomeGoal,
  type OutcomeGoalType,
  type ArchivedGoal,
  type ConceptualTask,
} from "@/lib/supabase/db";
import { supabase } from "@/lib/supabase/client";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { statusLabel, statusChipColors } from "@/lib/goalStatus";
import StatusIcon from "@/components/StatusIcon";
import {
  ClipboardList, CheckCircle2, Settings2, Ban, XCircle, CalendarClock, Check,
  Clock, Link2, Plus, SquareCheck, Square, MessageCircle,
  AlarmClock, Hourglass, Lock, Unlock, Ticket, X, ChevronUp, ChevronDown, UserPlus,
  Target, Trash2, ChevronRight, TriangleAlert,
} from "lucide-react";
import { notifyPointsUpdated } from "@/lib/pointsBus";
import { notifyNotificationsUpdated } from "@/lib/notificationsBus";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

// Priority options matching Tomorrow page
const PRIORITY_OPTIONS = [
  { 
    v: 1, 
    label: "Highest Priority", 
    icon: "🔴",
    bgGradient: "linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(225, 29, 72, 0.15))",
    borderColor: "rgba(239, 68, 68, 0.3)",
    buttonBg: "linear-gradient(135deg, #dc2626, #b91c1c)",
    buttonBorder: "#991b1b",
    buttonShadow: "0 4px 16px rgba(220, 38, 38, 0.4)"
  },
  { 
    v: 2, 
    label: "High Priority", 
    icon: "🟠",
    bgGradient: "linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(251, 146, 60, 0.15))",
    borderColor: "rgba(249, 115, 22, 0.3)",
    buttonBg: "linear-gradient(135deg, #ea580c, #c2410c)",
    buttonBorder: "#9a3412",
    buttonShadow: "0 4px 16px rgba(234, 88, 12, 0.4)"
  },
  { 
    v: 3, 
    label: "Medium Priority", 
    icon: "🟡",
    bgGradient: "linear-gradient(135deg, rgba(250, 204, 21, 0.15), rgba(253, 224, 71, 0.15))",
    borderColor: "rgba(250, 204, 21, 0.3)",
    buttonBg: "linear-gradient(135deg, #ca8a04, #a16207)",
    buttonBorder: "#854d0e",
    buttonShadow: "0 4px 16px rgba(202, 138, 4, 0.4)"
  },
  { 
    v: 4, 
    label: "Low Priority", 
    icon: "⚪",
    bgGradient: "linear-gradient(135deg, rgba(148, 163, 184, 0.12), rgba(203, 213, 225, 0.12))",
    borderColor: "rgba(148, 163, 184, 0.25)",
    buttonBg: "linear-gradient(135deg, rgba(100, 116, 139, 0.8), rgba(71, 85, 105, 0.8))",
    buttonBorder: "rgba(100, 116, 139, 0.9)",
    buttonShadow: "0 4px 16px rgba(100, 116, 139, 0.3)"
  },
  { 
    v: 5, 
    label: "Lowest Priority", 
    icon: "⚫",
    bgGradient: "linear-gradient(135deg, rgba(71, 85, 105, 0.12), rgba(51, 65, 85, 0.12))",
    borderColor: "rgba(71, 85, 105, 0.25)",
    buttonBg: "linear-gradient(135deg, rgba(71, 85, 105, 0.7), rgba(51, 65, 85, 0.7))",
    buttonBorder: "rgba(71, 85, 105, 0.8)",
    buttonShadow: "0 4px 16px rgba(71, 85, 105, 0.3)"
  },
];


// Phase 6.1: per-status title-space reservation for the collapsed-done
// row's stamp, replacing one blanket worst-case value (which solved
// collision but left too little title room for short-labeled statuses).
// Each number is the stamp's measured rendered width (max of the EN/ES
// translation, whichever is wider -- "Reprogramado" is 12% wider than
// "Rescheduled") plus its right-edge offset (0.65rem) and a small
// safety gap, measured via Playwright against the actual compiled
// .goal-done-banner CSS, not estimated. Only the 5 statuses reachable
// via the collapsed row (see isCollapsible below) are listed; anything
// else falls back to the worst case (postponed/Reprogramado).
const COLLAPSED_STAMP_RESERVE_PX: Partial<Record<GoalStatus, number>> = {
  completed: 137,
  blocked: 129,
  canceled: 129,
  postponed: 152,
  in_progress: 144,
};
const COLLAPSED_STAMP_RESERVE_FALLBACK_PX = 152;

const STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "attempted", label: "Attempted" },
  { value: "blocked", label: "Blocked" },
  { value: "postponed", label: "Postponed" },
];

export default function TodayPage() {
  const { t } = useLanguage();
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const tomorrowISO = useMemo(() => toISODate(addDays(new Date(), 1)), []);
  // Deep-linking in from Dashboard's now-tappable goal rows (?goal=<id>) —
  // scrolls to and briefly highlights that specific goal once it's loaded.
  // One-shot per page load, same guarded-ref pattern Social's own
  // ?post=/&comment= deep link uses.
  const searchParams = useSearchParams();
  const highlightGoalId = searchParams.get("goal");
  const scrolledToHighlightRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  // Set once a streak pass has covered TODAY in advance (see the Plan
  // Tomorrow / date-detail "cover this day in advance" flows) -- treated
  // as equivalent to plan.reviewed_at for the "is today closed" gate
  // everywhere below, so a pre-covered day closes itself the instant its
  // date rolls over into "today", with no reviewing and no waiting on a
  // scheduled job -- purely a consequence of todayISO itself changing.
  const [coveredByPassToday, setCoveredByPassToday] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  // Per-goal busy tracking (a Set, not a single id) — goals are reviewed
  // independently, so marking goal A busy must not block a click on goal B
  // while A's request is still in flight.
  const [busyGoalIds, setBusyGoalIds] = useState<Set<string>>(new Set());
  // Goal ids currently showing the "just completed" celebration animation —
  // transient, cleared automatically after the animation finishes.
  const [celebratingGoalIds, setCelebratingGoalIds] = useState<Set<string>>(new Set());
  // Completed/canceled goals collapse under a status banner by default to
  // keep a reviewed list scannable — this tracks which ones have been
  // manually expanded back open (e.g. to re-read notes or change status).
  const [expandedDoneIds, setExpandedDoneIds] = useState<Set<string>>(new Set());
  const [closing, setClosing] = useState(false);
  const [rescheduleGoal, setRescheduleGoal] = useState<Goal | null>(null);
  // Blocked requires a reason before it's applied — see confirmBlocked().
  // The prompt intercepts selectQuickAction before anything else happens,
  // so canceling it leaves the goal completely untouched.
  const [blockingGoal, setBlockingGoal] = useState<Goal | null>(null);
  const [blockingSaving, setBlockingSaving] = useState(false);
  const [blockingError, setBlockingError] = useState<string | null>(null);
  // A payment-reminder goal (source_payment_account_id set) requires
  // confirming the actual amount paid before it's marked complete — same
  // intercept-before-anything-else shape as blockingGoal above.
  // payingAccount holds the linked account's current name/minimum payment
  // (fetched lazily, only when this specific goal is being completed) so
  // the modal can prefill an amount without Today's page loading every
  // payment account up front.
  const [payingGoal, setPayingGoal] = useState<Goal | null>(null);
  const [payingAccount, setPayingAccount] = useState<PaymentAccount | null>(null);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [myGlimpsePost, setMyGlimpsePost] = useState<{ id: string; visibility: PostVisibility; targetUserId: string | null } | null>(null);
  const [acceptedConnections, setAcceptedConnections] = useState<Connection[]>([]);
  const [goalAssignments, setGoalAssignments] = useState<GoalAssignment[]>([]);
  const [assigningGoalIds, setAssigningGoalIds] = useState<Set<string>>(new Set());
  const [assignError, setAssignError] = useState<string | null>(null);
  // Which type the "Assign to" picker will use for a row's NEXT assignment
  // — chosen via the Lock/Unlock toggle before a recipient is picked.
  // Defaults to "shared" (unset) to match createGoalAssignment's own default.
  const [assignTypeByGoalId, setAssignTypeByGoalId] = useState<Record<string, GoalAssignmentType>>({});
  const [respondingAssignmentIds, setRespondingAssignmentIds] = useState<Set<string>>(new Set());
  // At most one goal's Exclusive/Shared dropdown open at a time -- same
  // single-ref click-outside pattern as Social's connection-card menu.
  const [openPrivacyMenuId, setOpenPrivacyMenuId] = useState<string | null>(null);
  const privacyMenuRef = useRef<HTMLDivElement | null>(null);
  // Assign control, same pattern as Exclusive/Shared above -- replaces the
  // old native <select> (whose own rendered text couldn't be kept from
  // truncating/colliding with its overlaid icon) with a button + dropdown
  // menu listing connections, so the button's own label is just the
  // short, never-truncated word "Assign".
  const [openAssignMenuId, setOpenAssignMenuId] = useState<string | null>(null);
  const assignMenuRef = useRef<HTMLDivElement | null>(null);

  // Notes + the derived history facts render as one merged timeline below
  // the goal now (see the entries computation in the render below) instead
  // of behind Notes/History tabs — both are preloaded up front regardless.
  const [goalNotes, setGoalNotes] = useState<Record<string, any[]>>({});
  const [notesFetched, setNotesFetched] = useState<Record<string, boolean>>({});
  const [checklistItems, setChecklistItems] = useState<Record<string, ChecklistItem[]>>({});
  const [attachments, setAttachments] = useState<Record<string, GoalAttachment[]>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<Record<string, boolean>>({});

  // Per-goal action menu (collapsed behind the gear icon until clicked)
  const [showActions, setShowActions] = useState<Record<string, boolean>>({});
  // Per-goal "Add Note" input, toggled from next to the action controls.
  const [showNoteInput, setShowNoteInput] = useState<Record<string, boolean>>({});
  // Per-goal "Attach a link" input, toggled from the compact Checklist/Files/Link row.
  const [showLinkInput, setShowLinkInput] = useState<Record<string, boolean>>({});
  
  // Quick Add state -- Goal Engine: type-first flow (same model as Plan
  // Tomorrow's Phase 4C), replacing the old fixed 3-row batch form.
  // "closed" collapses to just the trigger button; "choice" shows the
  // Standalone Task / Major Goal picker; "task"/"goal" show that type's
  // structured form.
  type AddFlowStep = "closed" | "choice" | "task" | "goal";
  const [addFlowStep, setAddFlowStep] = useState<AddFlowStep>("closed");

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState(3);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null);

  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalType, setNewGoalType] = useState<OutcomeGoalType>("one_time");
  const [goalTypeInfo, setGoalTypeInfo] = useState<OutcomeGoalType | null>(null);
  const [newGoalTasks, setNewGoalTasks] = useState<{ title: string; priority: number }[]>([
    { title: "", priority: 3 },
    { title: "", priority: 3 },
  ]);
  const [creatingGoal, setCreatingGoal] = useState(false);
  const [goalCreateError, setGoalCreateError] = useState<string | null>(null);

  function resetAddFlow() {
    setAddFlowStep("closed");
    setNewTaskTitle("");
    setNewTaskPriority(3);
    setTaskCreateError(null);
    setNewGoalTitle("");
    setNewGoalType("one_time");
    setNewGoalTasks([
      { title: "", priority: 3 },
      { title: "", priority: 3 },
    ]);
    setGoalCreateError(null);
  }

  // Transient (not permanent) in-flight guard: the awareness-award trigger
  // reads plan.awareness_awarded from React state, which only updates after
  // refresh() resolves — so reviewing two goals in quick succession could
  // otherwise fire the award request twice before either result lands. This
  // resets in a finally block either way, so a failed attempt can still be
  // retried on the next goal reviewed.
  const awarenessInFlightRef = useRef(false);

  // refresh() has no natural request ordering — two overlapping calls (e.g.
  // triggered by reviewing two goals in quick succession) can resolve out of
  // order. Without this, a slower-but-earlier-started refresh can land AFTER
  // a faster-but-later one and clobber its more current goal state. Only the
  // response matching the latest-issued sequence number is applied.
  const refreshSeqRef = useRef(0);

  function markGoalBusy(id: string) {
    setBusyGoalIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function clearGoalBusy(id: string) {
    setBusyGoalIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggleExpandedDone(id: string) {
    setExpandedDoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Permanent delete — explicit user call: Today previously only offered
  // status changes (completed/blocked/canceled/postponed/reschedule),
  // never outright removal, same as Tomorrow/date-detail's own
  // deleteGoal() use. No confirmation step, no undo.
  async function handleDeleteGoal(goal: Goal) {
    if (busyGoalIds.has(goal.id)) return;
    markGoalBusy(goal.id);
    try {
      await deleteGoal(goal.id);
      await refresh({ silent: true });
    } catch (e: any) {
      setMsg(e?.message ?? t("today.failedDeleteGoal"));
    } finally {
      clearGoalBusy(goal.id);
    }
  }

  const locked = plan?.status === "locked";
  // A pass-covered day closes itself the moment its date becomes "today" —
  // no review needed, no waiting on anything, since coveredByPassToday is
  // just a plain date-range query re-evaluated on every load.
  const dayClosed = !!plan?.reviewed_at || coveredByPassToday;
  const published = !!myGlimpsePost;

  function refreshGlimpsePost() {
    return getMyGoalGlimpsePost(todayISO)
      .then(setMyGlimpsePost)
      .catch(() => {});
  }

  useEffect(() => {
    refreshGlimpsePost();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayISO]);

  useEffect(() => {
    listConnections()
      .then((cs) => setAcceptedConnections(cs.filter((c) => c.status === "accepted")))
      .catch(() => {});
  }, []);

  // One-shot scroll-to-and-highlight for a ?goal= deep link (from
  // Dashboard's tappable goal rows) — guarded by a ref so it only fires
  // once per page load, not on every subsequent refresh.
  useEffect(() => {
    if (scrolledToHighlightRef.current || loading || !highlightGoalId) return;
    const el = document.querySelector(`[data-goal-id="${highlightGoalId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      scrolledToHighlightRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, highlightGoalId]);

  // openPrivacyMenuId's own click-outside/scroll-close handling now lives
  // inside PortalDropdownMenu (its panel is portaled to document.body, no
  // longer a DOM descendant of the trigger wrapper this ref points to, so
  // a plain .contains() check here would immediately close it on every
  // click inside the panel itself).

  useEffect(() => {
    if (!openAssignMenuId) return;
    function handleClickOutside(e: MouseEvent) {
      if (assignMenuRef.current && !assignMenuRef.current.contains(e.target as Node)) {
        setOpenAssignMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openAssignMenuId]);

  // Goal Engine — Goal hierarchy/grouping. Loaded once (all statuses, so
  // a Task linked to a Goal that's since gone completed/abandoned still
  // shows its real title instead of silently losing its label).
  const [outcomeGoals, setOutcomeGoals] = useState<OutcomeGoal[]>([]);
  useEffect(() => {
    getOutcomeGoals()
      .then(setOutcomeGoals)
      .catch(() => {});
  }, []);
  const outcomeGoalTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of outcomeGoals) map.set(o.id, o.title);
    return map;
  }, [outcomeGoals]);

  // Goal Engine — incremental update: a Major Goal card must represent
  // the FULL ongoing Goal, not just whatever Tasks happen to be loaded
  // for today's review. Fetches every Task ever linked to each Outcome
  // Goal shown today (across all days) so completion/reviewed counts and
  // the historical children list reflect the real, whole Goal. Re-fetched
  // only when the actual SET of linked Goal ids changes (not on every
  // `goals` reference change from an unrelated refresh), since this is a
  // real network query.
  const activeGoalIdsToday = useMemo(() => {
    const ids = new Set<string>();
    for (const g of goals) {
      const gid = (g as any).outcome_goal_id as string | null | undefined;
      if (gid) ids.add(gid);
    }
    return Array.from(ids);
  }, [goals]);
  const activeGoalIdsTodayKey = activeGoalIdsToday.join(",");

  const [goalChildrenById, setGoalChildrenById] = useState<Record<string, ConceptualTask<ArchivedGoal>[]>>({});
  useEffect(() => {
    if (activeGoalIdsToday.length === 0) {
      setGoalChildrenById({});
      return;
    }
    let cancelled = false;
    getConceptualTasksByOutcomeGoalIds(activeGoalIdsToday)
      .then((tasks) => {
        if (cancelled) return;
        const byGoal: Record<string, ConceptualTask<ArchivedGoal>[]> = {};
        for (const ct of tasks) {
          const gid = (ct.terminal as any).outcome_goal_id as string | null | undefined;
          if (!gid) continue;
          if (!byGoal[gid]) byGoal[gid] = [];
          byGoal[gid].push(ct);
        }
        setGoalChildrenById(byGoal);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGoalIdsTodayKey]);

  // Collapsed state per Major Goal card -- empty by default (expanded),
  // matching how these cards already rendered before this card gained a
  // collapse toggle.
  const [collapsedGoalGroupIds, setCollapsedGoalGroupIds] = useState<Set<string>>(new Set());

  // Rendering-treatment correction: a Task nested inside a Goal defaults
  // to a compact row (see renderTaskCard's `compact` param) instead of
  // the full standalone card -- this tracks which nested Tasks the user
  // has explicitly expanded back to the full card for its secondary
  // controls (checklist/link/assign/notes/timeline). Standalone Tasks
  // never consult this set at all.
  const [expandedCompactTaskIds, setExpandedCompactTaskIds] = useState<Set<string>>(new Set());

  function refreshGoalAssignments() {
    return getMyGoalAssignments()
      .then(setGoalAssignments)
      .catch(() => {});
  }

  useEffect(() => {
    refreshGoalAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Goals assigned out to a connection (declined ones excluded -- a
  // decline voids the delegation and the goal reverts to fully normal),
  // keyed by the assigner's own goals.id so a row can look itself up in
  // O(1) and switch to read-only + the recipient's live status.
  const assignedOutByGoalId = useMemo(() => {
    const map = new Map<string, GoalAssignment>();
    for (const a of goalAssignments) {
      if (a.direction === "assigned" && a.status !== "declined" && a.status !== "canceled" && a.assignerGoalId) {
        map.set(a.assignerGoalId, a);
      }
    }
    return map;
  }, [goalAssignments]);

  // The mirror of the map above: goals of MINE that are themselves the
  // materialized product of an assignment I received and accepted. Only
  // "accepted" matters here (a pending assignment hasn't materialized a
  // real goal yet — that's the separate pendingReceivedForToday banner).
  // Keyed by the recipient's own goals.id so a row can recognize itself
  // and lock its own Assign-to control — re-assigning a goal that was
  // assigned to you isn't a scenario this data model represents.
  const receivedByGoalId = useMemo(() => {
    const map = new Map<string, GoalAssignment>();
    for (const a of goalAssignments) {
      if (a.direction === "received" && a.status === "accepted" && a.recipientGoalId) {
        map.set(a.recipientGoalId, a);
      }
    }
    return map;
  }, [goalAssignments]);

  async function handlePublish(visibility: PostVisibility, targetUserId?: string) {
    if (publishing) return;
    setPublishing(true);
    setMsg(null);
    try {
      await publishGoalGlimpse(todayISO, visibility, targetUserId);
      await refreshGlimpsePost();
    } catch (e: any) {
      setMsg(e?.message ?? t("today.failedPublish"));
    } finally {
      setPublishing(false);
    }
  }

  async function handleUnpublish() {
    if (publishing) return;
    setPublishing(true);
    setMsg(null);
    try {
      await unpublishGoalGlimpse(todayISO);
      await refreshGlimpsePost();
    } catch (e: any) {
      setMsg(e?.message ?? t("today.failedUnpublish"));
    } finally {
      setPublishing(false);
    }
  }

  async function handleAssignGoal(goalId: string, recipientId: string) {
    if (assigningGoalIds.has(goalId)) return;
    setAssigningGoalIds((prev) => new Set(prev).add(goalId));
    setAssignError(null);
    try {
      await createGoalAssignment(goalId, recipientId, assignTypeByGoalId[goalId] ?? "exclusive");
      await refreshGoalAssignments();
      notifyNotificationsUpdated();
    } catch (e: any) {
      setAssignError(e?.message ?? t("goalAssign.failed"));
    } finally {
      setAssigningGoalIds((prev) => {
        const next = new Set(prev);
        next.delete(goalId);
        return next;
      });
    }
  }

  // Incoming assignments for today's date, still awaiting this user's
  // response -- surfaced right here rather than only on Social, since
  // they're relevant to today's plan specifically.
  const pendingReceivedForToday = goalAssignments.filter(
    (a) => a.direction === "received" && a.status === "pending" && a.planDate === todayISO
  );

  async function handleRespondReceivedAssignment(assignmentId: string, accept: boolean) {
    if (respondingAssignmentIds.has(assignmentId)) return;
    setRespondingAssignmentIds((prev) => new Set(prev).add(assignmentId));
    setAssignError(null);
    try {
      await respondToGoalAssignment(assignmentId, accept);
      await refreshGoalAssignments();
      notifyNotificationsUpdated();
      if (accept) await refresh({ silent: true });
    } catch (e: any) {
      setAssignError(e?.message ?? t("goalAssign.failed"));
    } finally {
      setRespondingAssignmentIds((prev) => {
        const next = new Set(prev);
        next.delete(assignmentId);
        return next;
      });
    }
  }

  const sortedGoals = useMemo(() => {
    const list = [...goals];
    list.sort((a, b) => {
      const ap = typeof a.priority === "number" ? a.priority : 999;
      const bp = typeof b.priority === "number" ? b.priority : 999;
      if (ap !== bp) return ap - bp;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
    return list;
  }, [goals]);

  // Goals I assigned out whose RECIPIENT's copy is due today -- not
  // necessarily the same as today's date, since the recipient can
  // reschedule their own materialized copy independently. My own goal
  // row for this assignment never moves (it stays frozen on whatever
  // date I originally assigned it), so if the recipient's copy has since
  // moved to a different date, I'd otherwise have no way to see it land
  // on the day it's actually due -- only a read-only view here, since
  // only the recipient can act on their own goal. Excludes anything
  // already visible via my own sortedGoals (my own row for the SAME
  // assignment is still today, e.g. the recipient hasn't moved it), so
  // nothing renders twice.
  const assignedOutDueToday = useMemo(() => {
    const ownGoalIdsToday = new Set(sortedGoals.map((g) => g.id));
    return goalAssignments.filter(
      (a) =>
        a.direction === "assigned" &&
        a.status === "accepted" &&
        a.recipientPlanDate === todayISO &&
        !(a.assignerGoalId && ownGoalIdsToday.has(a.assignerGoalId))
    );
  }, [goalAssignments, sortedGoals, todayISO]);

  // "Total goals today" (for "does the day have any goals at all" gates —
  // empty-state, showing the close/plan-tomorrow buttons) always counts
  // every goal, including exclusive-assigned ones. Review PROGRESS, below,
  // is scoped narrower: an exclusive-assigned goal is the recipient's to
  // review, not this user's, so it's excluded from what "must be reviewed
  // before closing" actually counts — otherwise a day containing one could
  // never close.
  const totalCount = sortedGoals.length;

  const reviewableGoals = useMemo(
    () =>
      sortedGoals.filter((g) => {
        const a = assignedOutByGoalId.get(g.id);
        return !(a?.assignmentType === "exclusive" && a.status === "accepted");
      }),
    [sortedGoals, assignedOutByGoalId]
  );
  const reviewableTotalCount = reviewableGoals.length;
  const reviewedCount = useMemo(
    () => reviewableGoals.filter((g) => !!g.reviewed_at).length,
    [reviewableGoals]
  );
  const pendingGoals = useMemo(() => reviewableGoals.filter((g) => !g.reviewed_at), [reviewableGoals]);
  const allReviewed = reviewableTotalCount === 0 || reviewedCount === reviewableTotalCount;

  // "In Progress" is a real, logged action (reviewed_at gets set same as
  // any other quick action), but it isn't a settled outcome the way
  // Completed/Blocked/Canceled/Rescheduled are — it means "still working on
  // this," which conflicts with closing the day out. Reviewed alone isn't
  // enough to close; nothing can still be actively in progress either.
  const inProgressGoals = useMemo(() => reviewableGoals.filter((g) => g.status === "in_progress"), [reviewableGoals]);
  const canCloseDay = allReviewed && inProgressGoals.length === 0;

  // No push/email in this app — the only "reminder" is this banner, shown
  // while the user has the page open, once 6 or fewer hours remain today.
  const hoursLeftToday = hoursUntilMidnight();
  const showEndOfDayReminder = !dayClosed && totalCount > 0 && !canCloseDay && hoursLeftToday <= 6;

  // silent: true for refetches after an action (reviewing a goal, closing
  // the day, etc.) — the page already has content on screen, so re-showing
  // the full-page loading state would blank everything out and read as a
  // full page reload. Only the very first load (and the manual Refresh
  // button) should show it. Silent refreshes also leave `msg` alone, since
  // the action that triggered them usually just set its own status text.
  async function refresh(opts: { silent?: boolean } = {}) {
    const { silent = false } = opts;
    const mySeq = ++refreshSeqRef.current;
    if (!silent) setLoading(true);
    if (!silent) setMsg(null);

    try {
      const [{ plan: p, goals: gs }, coveredDates] = await Promise.all([
        getPlanWithGoals(todayISO),
        getStreakPassCoveredDates(todayISO, todayISO),
      ]);

      // A newer refresh() was issued after this one — its result is more
      // current, so drop this stale response instead of overwriting state.
      if (mySeq !== refreshSeqRef.current) return;

      setPlan(p);
      setCoveredByPassToday(coveredDates.has(todayISO));

      // Fetch reschedule info, notes, checklist items, and attachments for
      // all goals together — none of these four depend on each other, only
      // on goalIds, so they run as one batch instead of four sequential
      // round-trips. Checklist/attachments keep their own error isolation
      // (a missing/misconfigured table there shouldn't take down the rest).
      const goalIds = gs.map(g => g.id);
      let rescheduleMap: Record<string, { to_date: string; reason: string | null }> = {};

      if (goalIds.length > 0) {
        const [reschedulesResult, notesResult, checklistResult, attachmentsResult] = await Promise.all([
          supabase
            .from("goal_reschedules")
            .select("from_goal_id, to_date, reason")
            .in("from_goal_id", goalIds)
            .eq("materialized", false)
            .order("created_at", { ascending: false }),
          // Preload notes for every goal up front — the Notes tab defaults
          // to showing them, so without this a goal with real note history
          // would still read "No notes yet" until the tab was clicked once.
          // Goes through getNotesForGoals (get_goal_notes RPC), not a plain
          // table query, so an assigned-out goal's timeline also includes
          // the recipient's own logged actions on their separate copy.
          getNotesForGoals(goalIds).catch((e) => {
            console.error("Failed to load goal notes", e);
            return {} as Record<string, any[]>;
          }),
          getChecklistItemsForGoals(goalIds).catch((e) => {
            console.error("Failed to load checklist items", e);
            return {} as Record<string, ChecklistItem[]>;
          }),
          getAttachmentsForGoals(goalIds).catch((e) => {
            console.error("Failed to load attachments", e);
            return {} as Record<string, GoalAttachment[]>;
          }),
        ]);

        reschedulesResult.data?.forEach((item) => {
          if (!rescheduleMap[item.from_goal_id]) {
            rescheduleMap[item.from_goal_id] = {
              to_date: item.to_date,
              reason: item.reason,
            };
          }
        });

        if (mySeq !== refreshSeqRef.current) return;

        setGoalNotes(notesResult);
        setNotesFetched((prev) => {
          const next = { ...prev };
          goalIds.forEach((id) => (next[id] = true));
          return next;
        });
        setChecklistItems(checklistResult);
        setAttachments(attachmentsResult);
      }

      if (mySeq !== refreshSeqRef.current) return;

      // Attach reschedule info to goals
      const goalsWithReschedule = gs.map(g => ({
        ...g,
        rescheduled_to: rescheduleMap[g.id]?.to_date || null,
        reschedule_reason: rescheduleMap[g.id]?.reason || null,
      }));

      setGoals(goalsWithReschedule);
    } catch (e: any) {
      if (mySeq !== refreshSeqRef.current) return;
      if (!silent) setMsg(e?.message ?? t("today.failedLoad"));
    } finally {
      if (mySeq === refreshSeqRef.current && !silent) setLoading(false);
    }
  }

  // Fetch goal notes/history
  async function fetchGoalNotes(goalId: string) {
    const byGoal = await getNotesForGoals([goalId]);
    return byGoal[goalId] ?? [];
  }

  async function submitNote(goalId: string) {
    const text = (noteDraft[goalId] ?? "").trim();
    if (!text) return;
    setSavingNote((prev) => ({ ...prev, [goalId]: true }));
    try {
      await addGoalNote(goalId, text);
      // The note is saved at this point regardless of what happens below —
      // clear the draft now so a re-fetch failure can't be mistaken for the
      // add itself having failed (which would tempt a duplicate re-submit).
      setNoteDraft((prev) => ({ ...prev, [goalId]: "" }));
      try {
        const notes = await fetchGoalNotes(goalId);
        setGoalNotes((prev) => ({ ...prev, [goalId]: notes }));
        setNotesFetched((prev) => ({ ...prev, [goalId]: true }));
      } catch (e: any) {
        setMsg(e?.message ?? t("today.noteSavedRefreshFailed"));
      }
    } catch (e: any) {
      setMsg(e?.message ?? t("today.failedAddNote"));
    } finally {
      setSavingNote((prev) => ({ ...prev, [goalId]: false }));
    }
  }

  useEffect(() => {
    refresh();
    // Payment reminders are auto-created (not a tap-to-add suggestion like
    // recurring templates) -- explicit user call. Silently creates whatever's
    // due for today, then refreshes so it shows up in the goal list, with a
    // one-line notice so a goal appearing unprompted doesn't look like a bug.
    ensurePaymentReminderGoals(todayISO)
      .then((created) => {
        if (created.length > 0) {
          refresh({ silent: true });
          setMsg(t("tomorrow.paymentGoalsAdded", { names: created.map((a) => a.name).join(", ") }));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayISO]);

  // One click from the quick-action dropdown does three things at once:
  // marks the goal reviewed (if it wasn't already), applies the chosen
  // status (or opens the reschedule modal instead, for "reschedule" — that
  // one doesn't set a status, rescheduling is tracked separately), and
  // closes the dropdown. Replaces the old two-step "review, then pick a
  // status" flow.
  async function selectQuickAction(goal: Goal, action: GoalStatus | "reschedule") {
    if (locked || busyGoalIds.has(goal.id) || dayClosed) return;

    // Blocked needs a reason first — hand off to confirmBlocked() instead of
    // applying anything here. Nothing about the goal changes until the
    // prompt is actually confirmed.
    if (action === "blocked") {
      setShowActions((prev) => ({ ...prev, [goal.id]: false }));
      setBlockingError(null);
      setBlockingGoal(goal);
      return;
    }

    // A payment-reminder goal needs the actual amount confirmed before it
    // completes — hand off to confirmPaymentCompletion() instead of
    // applying anything here, same intercept-before-anything-else shape
    // as blocked above.
    if (action === "completed" && goal.source_payment_account_id) {
      setShowActions((prev) => ({ ...prev, [goal.id]: false }));
      setPaymentError(null);
      setPayingAccount(null);
      setPayingGoal(goal);
      getPaymentAccounts()
        .then((accounts) => {
          const account = accounts.find((a) => a.id === goal.source_payment_account_id) ?? null;
          setPayingAccount(account);
        })
        .catch(() => {
          // Account fetch failing just leaves the modal's amount blank
          // (suggestedAmount falls back to 0) — the user can still type
          // one in manually rather than being blocked entirely.
        });
      return;
    }

    markGoalBusy(goal.id);
    setMsg(null);
    setShowActions((prev) => ({ ...prev, [goal.id]: false }));

    try {
      const wasReviewed = !!goal.reviewed_at;

      setGoals((prev) =>
        prev.map((g) =>
          g.id === goal.id
            ? {
                ...g,
                reviewed_at: g.reviewed_at ?? new Date().toISOString(),
                status: action === "reschedule" ? g.status : action,
              }
            : g
        )
      );

      if (!wasReviewed) {
        await markGoalReviewed(goal.id);

        // Same one-time awareness bonus as the old manual review toggle.
        if (plan?.id && !plan.reviewed_at && !plan.awareness_awarded && !awarenessInFlightRef.current) {
          awarenessInFlightRef.current = true;
          try {
            const result = await awardAwarenessPoints(plan.id, 5);
            if (result?.success) notifyPointsUpdated();
          } catch {
            // Non-fatal — retried automatically on the next review action.
          } finally {
            awarenessInFlightRef.current = false;
          }
        }
      }

      if (action === "reschedule") {
        setRescheduleGoal(goal);
      } else {
        await updateGoalStatus(goal.id, action);
        const markedMsg = t("today.markedStatus", { status: statusLabel(action, t) });
        setMsg(markedMsg);
        window.setTimeout(() => setMsg((cur) => (cur === markedMsg ? null : cur)), 1500);

        if (action === "completed") {
          setCelebratingGoalIds((prev) => new Set(prev).add(goal.id));
          window.setTimeout(() => {
            setCelebratingGoalIds((prev) => {
              if (!prev.has(goal.id)) return prev;
              const next = new Set(prev);
              next.delete(goal.id);
              return next;
            });
          }, 900);
        }
      }

      await refresh({ silent: true });
    } catch (e: any) {
      setMsg(e?.message ?? t("today.updateFailed"));
      await refresh({ silent: true });
    } finally {
      clearGoalBusy(goal.id);
    }
  }

  // Mirrors the non-reschedule branch of selectQuickAction above (mark
  // reviewed + award awareness if needed, then apply the status), plus
  // saving the required reason as a real note so a blocked goal always
  // explains itself later in its timeline.
  async function confirmBlocked(reason: string) {
    const goal = blockingGoal;
    const trimmed = reason.trim();
    if (!goal || !trimmed || blockingSaving) return;

    setBlockingSaving(true);
    setBlockingError(null);
    markGoalBusy(goal.id);

    try {
      const wasReviewed = !!goal.reviewed_at;

      setGoals((prev) =>
        prev.map((g) =>
          g.id === goal.id
            ? { ...g, reviewed_at: g.reviewed_at ?? new Date().toISOString(), status: "blocked" }
            : g
        )
      );

      if (!wasReviewed) {
        await markGoalReviewed(goal.id);

        if (plan?.id && !plan.reviewed_at && !plan.awareness_awarded && !awarenessInFlightRef.current) {
          awarenessInFlightRef.current = true;
          try {
            const result = await awardAwarenessPoints(plan.id, 5);
            if (result?.success) notifyPointsUpdated();
          } catch {
            // Non-fatal — retried automatically on the next review action.
          } finally {
            awarenessInFlightRef.current = false;
          }
        }
      }

      await updateGoalStatus(goal.id, "blocked");
      await addGoalNote(goal.id, trimmed);

      const markedMsg = t("today.markedStatus", { status: statusLabel("blocked", t) });
      setMsg(markedMsg);
      window.setTimeout(() => setMsg((cur) => (cur === markedMsg ? null : cur)), 1500);

      setBlockingGoal(null);
      await refresh({ silent: true });
    } catch (e: any) {
      setBlockingError(e?.message ?? t("today.failedMarkBlocked"));
      await refresh({ silent: true });
    } finally {
      setBlockingSaving(false);
      clearGoalBusy(goal.id);
    }
  }

  function cancelBlocked() {
    if (blockingSaving) return;
    setBlockingGoal(null);
    setBlockingError(null);
  }

  // Mirrors the non-reschedule branch of selectQuickAction (mark reviewed
  // + award awareness if needed), but swaps the plain updateGoalStatus for
  // confirmPaymentGoalCompletion so the confirmed amount is logged to the
  // ledger and subtracted from the account's balance atomically.
  async function confirmPaymentCompletion(amount: number) {
    const goal = payingGoal;
    if (!goal || paymentSaving) return;

    setPaymentSaving(true);
    setPaymentError(null);
    markGoalBusy(goal.id);

    try {
      const wasReviewed = !!goal.reviewed_at;

      setGoals((prev) =>
        prev.map((g) =>
          g.id === goal.id
            ? { ...g, reviewed_at: g.reviewed_at ?? new Date().toISOString(), status: "completed" }
            : g
        )
      );

      if (!wasReviewed) {
        await markGoalReviewed(goal.id);

        if (plan?.id && !plan.reviewed_at && !plan.awareness_awarded && !awarenessInFlightRef.current) {
          awarenessInFlightRef.current = true;
          try {
            const result = await awardAwarenessPoints(plan.id, 5);
            if (result?.success) notifyPointsUpdated();
          } catch {
            // Non-fatal — retried automatically on the next review action.
          } finally {
            awarenessInFlightRef.current = false;
          }
        }
      }

      await confirmPaymentGoalCompletion(goal.id, amount);

      const markedMsg = t("today.markedStatus", { status: statusLabel("completed", t) });
      setMsg(markedMsg);
      window.setTimeout(() => setMsg((cur) => (cur === markedMsg ? null : cur)), 1500);

      setCelebratingGoalIds((prev) => new Set(prev).add(goal.id));
      window.setTimeout(() => {
        setCelebratingGoalIds((prev) => {
          if (!prev.has(goal.id)) return prev;
          const next = new Set(prev);
          next.delete(goal.id);
          return next;
        });
      }, 900);

      setPayingGoal(null);
      setPayingAccount(null);
      await refresh({ silent: true });
    } catch (e: any) {
      setPaymentError(e?.message ?? t("paymentConfirm.failed"));
      await refresh({ silent: true });
    } finally {
      setPaymentSaving(false);
      clearGoalBusy(goal.id);
    }
  }

  function cancelPayment() {
    if (paymentSaving) return;
    setPayingGoal(null);
    setPayingAccount(null);
    setPaymentError(null);
  }

  async function closeOutDay() {
    if (!plan?.id || locked || closing || dayClosed) return;

    if (totalCount > 0 && !canCloseDay) {
      setMsg(
        pendingGoals.length > 0
          ? t("today.reviewAllFirst")
          : t("today.finishInProgress")
      );
      return;
    }

    setClosing(true);
    setMsg(t("today.closingDay"));

    try {
      // getStreak() runs before markPlanReviewed(), so it reflects the unbroken
      // streak going into today (not counting today) — that's what sizes today's bonus.
      const streakBeforeToday = await getStreak();
      const closurePoints = computeClosurePoints(streakBeforeToday);

      const result = await awardClosurePoints(plan.id, closurePoints);
      // The RPC awards points but doesn't set reviewed_at itself — do that explicitly
      // so the day actually shows as closed and Tomorrow unlocks.
      await markPlanReviewed(plan.id);
      notifyPointsUpdated();
      // result.success is false when this day already earned closure points before
      // (e.g. reopened then re-closed) — the RPC is a one-time-per-day award, so no
      // extra points were actually added even though the day is closing again.
      setMsg(
        result?.success
          ? t("today.dayClosedPoints", { points: closurePoints })
          : t("today.dayClosedNoPoints")
      );

      await refresh({ silent: true });
    } catch (e: any) {
      setMsg(t("today.errorPrefix", { message: e?.message ?? t("today.couldNotClose") }));
      await refresh({ silent: true });
    } finally {
      setClosing(false);
    }
  }

  // Reopen a closed day
  async function reopenDay() {
    if (!plan?.id || reopening || !dayClosed) return;

    setReopening(true);
    setMsg(t("today.reopeningDay"));

    try {
      const { error: planErr } = await supabase
        .from("daily_plans")
        .update({ reviewed_at: null })
        .eq("id", plan.id);
      if (planErr) throw planErr;

      // Deliberately NOT clearing every goal's reviewed_at here — reopening
      // is for fixing or adding to one or two specific goals, not redoing
      // the whole day's review from scratch. Goals you don't touch stay
      // reviewed, so Close Day is immediately available again; only a goal
      // you actually act on (selectQuickAction) gets a fresh reviewed_at,
      // same as any other status change.
      setMsg(t("today.dayReopened"));
      await refresh({ silent: true });
    } catch (e: any) {
      console.error("Reopen error:", e);
      setMsg(t("today.errorPrefix", { message: e?.message ?? t("today.couldNotReopen") }));
    } finally {
      setReopening(false);
    }
  }

  // Goal Engine current-day Add flow -- both paths below go through the
  // exact same upsertGoals(plan.id, rows)/enforceSingleP1 mechanism the
  // old handleQuickAdd used, against the same current-day plan.id, with
  // the same status/sort_order defaults. That's what makes a Task added
  // here indistinguishable from any other goal added today: same
  // plan_id, same created_at-is-now, same P1-dedup safeguard -- nothing
  // new was introduced to mark "added via this flow" specially.
  async function handleCreateStandaloneTask() {
    if (!plan?.id || creatingTask) return;
    const title = newTaskTitle.trim();
    if (!title) return;
    setCreatingTask(true);
    setTaskCreateError(null);
    try {
      const existingIds = new Set(goals.map((g) => g.id));
      const saved = await upsertGoals(plan.id, [
        {
          title,
          priority: newTaskPriority,
          sort_order: goals.length,
          status: "not_started" as GoalStatus,
          time_of_day: null,
          outcome_goal_id: null,
        },
      ]);
      const newP1 = saved.find((g) => g.priority === 1 && !existingIds.has(g.id));
      if (newP1) {
        await enforceSingleP1(plan.id, newP1.id);
      }
      setMsg(t("today.addedGoals", { count: 1 }));
      resetAddFlow();
      await refresh({ silent: true });
    } catch (e: any) {
      setTaskCreateError(e?.message ?? t("tomorrow.taskCreateFailed"));
    } finally {
      setCreatingTask(false);
    }
  }

  const validTodayGoalTaskCount = newGoalTasks.filter((tk) => tk.title.trim().length > 0).length;
  const canCreateTodayMajorGoal =
    newGoalTitle.trim().length > 0 && validTodayGoalTaskCount >= 2 && !creatingGoal;

  async function handleCreateMajorGoal() {
    if (!plan?.id || creatingGoal) return;
    const title = newGoalTitle.trim();
    const validTasks = newGoalTasks
      .map((tk) => ({ title: tk.title.trim(), priority: tk.priority }))
      .filter((tk) => tk.title.length > 0);
    if (!title || validTasks.length < 2) return;
    setCreatingGoal(true);
    setGoalCreateError(null);
    try {
      const created = await createOutcomeGoal(title, null, 3, newGoalType);
      setOutcomeGoals((prev) => [created, ...prev]);

      const existingIds = new Set(goals.map((g) => g.id));
      const rows = validTasks.map((tk, idx) => ({
        title: tk.title,
        priority: tk.priority,
        sort_order: goals.length + idx,
        status: "not_started" as GoalStatus,
        time_of_day: null,
        outcome_goal_id: created.id,
      }));
      const saved = await upsertGoals(plan.id, rows);
      const newP1 = saved.find((g) => g.priority === 1 && !existingIds.has(g.id));
      if (newP1) {
        await enforceSingleP1(plan.id, newP1.id);
      }
      setMsg(t("today.addedGoals", { count: validTasks.length }));
      resetAddFlow();
      await refresh({ silent: true });
    } catch (e: any) {
      setGoalCreateError(e?.message ?? t("tomorrow.goalCreateFailed"));
    } finally {
      setCreatingGoal(false);
    }
  }

  if (loading) {
    return <PageLoadingState label={t("today.loading")} />;
  }

  // Goal Engine — Goal hierarchy/grouping. Extracted verbatim out of what
  // used to be a single inline sortedGoals.map() callback, so it can be
  // called from both the grouped-by-Goal rendering and the standalone
  // list below without a second copy of this markup ever existing.
  // `idx` is always the task's TRUE position in the full priority-sorted
  // sortedGoals list (passed in by the caller), never recomputed locally
  // -- numbering must stay exactly as it was before grouping existed.
  function renderTaskCard(g: Goal, idx: number, opts?: { compact?: boolean }) {
    const compact = !!opts?.compact;
    const p = typeof g.priority === "number" ? g.priority : 3;
    const isBusy = busyGoalIds.has(g.id);
    const isCelebrating = celebratingGoalIds.has(g.id);
    // Set once this goal has been assigned out to a connection
    // (and they haven't declined) — shows the recipient's live
    // status either way. "shared" always stays a completely normal,
    // fully editable goal. "exclusive" only locks this user's own
    // controls (and excludes it from their own review requirement)
    // once the recipient has actually accepted — while still
    // pending, nothing has been handed off yet, so this user keeps
    // full access until then.
    const assignment = assignedOutByGoalId.get(g.id);
    const received = receivedByGoalId.get(g.id);
    const isExclusive = assignment?.assignmentType === "exclusive" && assignment.status === "accepted";
    // This user's own copy of an exclusive-assigned goal never gets
    // touched again once handed off (they're locked out of it), so
    // its status/reviewed_at would otherwise sit frozen at
    // "not_started"/pending forever regardless of what the recipient
    // actually does. Mirror the recipient's live status instead, and
    // treat it as already reviewed — it's excluded from this user's
    // own review requirement (reviewableGoals, above) so it
    // shouldn't keep showing a "pending review" nag either.
    const effectiveStatus = isExclusive && assignment?.recipientGoalStatus ? assignment.recipientGoalStatus : g.status;
    const reviewed = isExclusive ? true : !!g.reviewed_at;
    // "postponed" always means rescheduled — rescheduleGoalToDate()
    // is the only path that ever sets it, and it unconditionally
    // overwrites whatever status was there before (so a goal that
    // was blocked, then rescheduled, shows up as "postponed" here,
    // not "blocked" — where it's going next matters more than why
    // it stalled). statusLabel/StatusIcon/statusChipColors already
    // render "postponed" as a calendar icon + "Rescheduled", so
    // g.status alone is enough — no separate rescheduled_to check
    // needed for display.
    // The full target date and reason are one tap away in the
    // expanded card's timeline either way.
    const isCollapsible =
      effectiveStatus === "completed" ||
      effectiveStatus === "canceled" ||
      effectiveStatus === "blocked" ||
      effectiveStatus === "in_progress" ||
      effectiveStatus === "postponed";
    // Nested (compact) Tasks track their own reopen/collapse via
    // expandedCompactTaskIds -- the same set goal-child-expanded reads --
    // so a reopened completed nested Task lands on the dedicated expanded
    // layout instead of the compact row. Standalone Tasks are unaffected,
    // still driven entirely by expandedDoneIds as before.
    const isCollapsed = isCollapsible && !(compact ? expandedCompactTaskIds.has(g.id) : expandedDoneIds.has(g.id));
    const doneColors = statusChipColors(effectiveStatus);
    // Phase 7B: corrects perceived card-edge visual WEIGHT, not
    // color identity -- P3's yellow and Completed's green read
    // louder than every other state at the shared mix ratio
    // purely because their hues have much higher perceived luminance, and
    // Canceled/In Progress read too weak in light mode because
    // their hues sit close to the page's own cool gray. See the
    // "Phase 7B edge-weight tiers" rule in globals.css for the
    // actual values; "quiet" only has an effect in dark mode,
    // "boost" only in light mode (each theme's tier is declared
    // only under that theme's own block).
    const edgeWeight = isCollapsible
      ? effectiveStatus === "completed"
        ? "quiet"
        : effectiveStatus === "canceled" || effectiveStatus === "in_progress"
          ? "boost"
          : undefined
      : p === 3
        ? "quiet"
        : undefined;

    if (isCollapsed) {
      return (
        /* Phase 6: GoalNumberOrb now renders as a sibling BEFORE
           the button (not nested inside the small inline wrapper
           the digit-fix pass used), so its position:absolute
           anchors to THIS wrapper's corner instead of a 34x34
           slot -- letting it genuinely overlap the card's visual
           edge (~29% of its own width) instead of sitting fully
           inside it, per explicit request. The button keeps its
           own overflow:hidden (preserves the stamp's existing
           clip-to-rounded-corner behavior); the orb lives outside
           that box specifically so it is NOT clipped. Orb itself
           -- GoalNumberOrb.tsx, .goal-number-badge's own size/
           background/shadow -- is completely untouched; only the
           position override in .goal-row-done-collapsed-wrap
           .goal-number-badge (globals.css) changes where it sits. */
        <div key={g.id} className="goal-row-done-collapsed-wrap">
          <GoalNumberOrb number={idx + 1} />
          <button
            type="button"
            data-goal-id={g.id}
            onClick={() =>
              compact
                ? setExpandedCompactTaskIds((prev) => new Set(prev).add(g.id))
                : toggleExpandedDone(g.id)
            }
            className={`goal-row goal-row-done-collapsed${g.id === highlightGoalId ? " post-card-highlight" : ""}`}
            style={
              {
                "--p-color": getPriorityMeta(p).color,
                "--done-color": doneColors.color,
                "--done-border": doneColors.border,
                "--done-bg": doneColors.bg,
                position: "relative",
              } as React.CSSProperties
            }
            title={t("today.clickToExpand")}
          >
            {/* Left padding reserves the orb's now-larger visual
                footprint (it's no longer an inline flex sibling).
                Right padding is now PER-STATUS (Phase 6.1) instead
                of one blanket worst-case value -- a short label
                like "Blocked" no longer pays Reprogramado's full
                reservation. See COLLAPSED_STAMP_RESERVE_PX above
                for how each number was measured. This per-status value
                was measured against the full-size (desktop) stamp and
                never shrinks with it -- .goal-done-banner itself gets
                smaller below 480px (see globals.css), where
                .goal-done-title's own 72px already covers that smaller
                stamp on its own. Stacking both just over-truncated every
                collapsed title below 480px; goal-done-title-wrap-tight
                cancels most of this outer reservation at that width,
                leaving the already-correct 72px (plus a small shared
                margin) as the real clearance -- same class for standalone
                and nested now, since both were affected the same way. */}
            <div
              className="flex flex-col goal-done-title-wrap-tight"
              style={{
                minWidth: 0,
                paddingLeft: "30px",
                paddingRight: `${COLLAPSED_STAMP_RESERVE_PX[effectiveStatus] ?? COLLAPSED_STAMP_RESERVE_FALLBACK_PX}px`,
              }}
            >
              <div className="goal-done-title flex-1 text-left text-white/50 text-base truncate" style={{ minWidth: 0 }}>
                {g.title}
              </div>
            </div>
            <div className="goal-done-banner" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
              <StatusIcon status={effectiveStatus} size={11} />
              {statusLabel(effectiveStatus, t)}
            </div>
          </button>
        </div>
      );
    }

    // Rendering-treatment correction: a Task nested inside a Goal
    // defaults to this compact row instead of the full card below --
    // number, title, priority, parent Goal identity, status, and the
    // required review action are all directly visible/actionable here;
    // everything else (checklist/link/assign/notes/timeline, priority
    // editing) is one tap away via the expand chevron, which reveals the
    // exact same full card/controls further down, unchanged. Standalone
    // Tasks never pass compact=true, so this branch never runs for them.
    if (compact && !expandedCompactTaskIds.has(g.id)) {
      return (
        <div key={g.id} className="goal-child-row-wrap" data-goal-id={g.id}>
          <div
            className={`goal-child-row${g.id === highlightGoalId ? " post-card-highlight" : ""}`}
            data-pending={!reviewed}
            style={{ "--p-color": getPriorityMeta(p).color } as React.CSSProperties}
            role="button"
            tabIndex={0}
            onClick={() => setExpandedCompactTaskIds((prev) => new Set(prev).add(g.id))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setExpandedCompactTaskIds((prev) => new Set(prev).add(g.id));
              }
            }}
            title={t("today.clickToExpand")}
          >
            <span className="goal-child-number">{idx + 1}</span>

            <div className="goal-child-main">
              <div className="goal-child-title">{g.title}</div>
              <div className="goal-child-status">
                <span
                  className="goal-child-priority"
                  style={{
                    "--p-bg": getPriorityMeta(p).bg,
                    "--p-border": getPriorityMeta(p).border,
                    "--p-color": getPriorityMeta(p).color,
                  } as React.CSSProperties}
                >
                  P{p}
                </span>
                <StatusIcon status={effectiveStatus} size={11} />
                <span>{statusLabel(effectiveStatus, t)}</span>
                {!reviewed && (
                  <span className="goal-child-pending-tag">
                    <Hourglass size={10} /> {t("today.pendingReview")}
                  </span>
                )}
              </div>
            </div>

            <div className="goal-child-actions">
              {!dayClosed && !isExclusive && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowActions((prev) => ({ ...prev, [g.id]: !prev[g.id] }));
                  }}
                  disabled={locked}
                  className="actions-toggle"
                  data-open={!!showActions[g.id]}
                  title={reviewed ? t("today.changeAction") : t("today.chooseAction")}
                >
                  {reviewed ? <SquareCheck size={14} /> : <Square size={14} />}
                </button>
              )}
              <ChevronRight size={14} className="text-white/25 flex-shrink-0" />
            </div>
          </div>

          {/* Required Review Today action — same quick-action dropdown
              and selectQuickAction handler the full card uses, just
              reachable directly from the compact row so reviewing never
              needs a full expand first. */}
          {!dayClosed && !isExclusive && showActions[g.id] && (
            <div className="goal-child-quick-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => selectQuickAction(g, "completed")}
                disabled={locked || isBusy}
                className="action-btn"
                data-current={g.status === "completed"}
                style={{
                  "--btn-bg": g.status === "completed" ? "var(--status-completed-bg-active)" : "var(--status-completed-bg)",
                  "--btn-border": g.status === "completed" ? "var(--status-completed-border-active)" : "var(--status-completed-border)",
                  "--btn-color": "var(--status-completed)",
                } as React.CSSProperties}
              >
                <CheckCircle2 size={14} />
                <span>{t("status.completed")}</span>
              </button>
              <button
                type="button"
                onClick={() => selectQuickAction(g, "in_progress")}
                disabled={locked || isBusy}
                className="action-btn"
                data-current={g.status === "in_progress"}
                style={{
                  "--btn-bg": g.status === "in_progress" ? "var(--status-in-progress-bg-active)" : "var(--status-in-progress-bg)",
                  "--btn-border": g.status === "in_progress" ? "var(--status-in-progress-border-active)" : "var(--status-in-progress-border)",
                  "--btn-color": "var(--status-in-progress)",
                } as React.CSSProperties}
              >
                <Settings2 size={14} />
                <span>{t("today.inProgressAction")}</span>
              </button>
              <button
                type="button"
                onClick={() => selectQuickAction(g, "blocked")}
                disabled={locked || isBusy}
                className="action-btn"
                data-current={g.status === "blocked"}
                style={{
                  "--btn-bg": g.status === "blocked" ? "var(--status-blocked-bg-active)" : "var(--status-blocked-bg)",
                  "--btn-border": g.status === "blocked" ? "var(--status-blocked-border-active)" : "var(--status-blocked-border)",
                  "--btn-color": "var(--status-blocked)",
                } as React.CSSProperties}
              >
                <Ban size={14} />
                <span>{t("status.blocked")}</span>
              </button>
              <button
                type="button"
                onClick={() => selectQuickAction(g, "canceled")}
                disabled={locked || isBusy}
                className="action-btn"
                data-current={g.status === "canceled"}
                style={{
                  "--btn-bg": g.status === "canceled" ? "var(--status-canceled-bg-active)" : "var(--status-canceled-bg)",
                  "--btn-border": g.status === "canceled" ? "var(--status-canceled-border-active)" : "var(--status-canceled-border)",
                  "--btn-color": "var(--status-canceled)",
                } as React.CSSProperties}
              >
                <XCircle size={14} />
                <span>{t("status.canceled")}</span>
              </button>
              <button
                type="button"
                onClick={() => selectQuickAction(g, "reschedule")}
                disabled={locked || isBusy}
                className="action-btn"
                data-current={!!g.rescheduled_to}
                style={{
                  "--btn-bg": g.rescheduled_to ? "var(--status-postponed-bg-active)" : "var(--status-postponed-bg)",
                  "--btn-border": g.rescheduled_to ? "var(--status-postponed-border-active)" : "var(--status-postponed-border)",
                  "--btn-color": "var(--status-postponed)",
                } as React.CSSProperties}
              >
                <CalendarClock size={14} />
                <span>{g.rescheduled_to ? t("today.rescheduledTo", { date: formatDateDisplay(g.rescheduled_to) }) : t("status.rescheduled")}</span>
              </button>
            </div>
          )}
        </div>
      );
    }

    // Dedicated nested-expanded Task layout (NOT the standalone .goal-row
    // card reused in a box) -- same width as the compact row above, no
    // second large card frame, no GoalNumberOrb, no repeated parent Goal
    // name/icon (the Goal card header above already shows it). Every
    // control below calls the exact same handler/state this function
    // already uses elsewhere (updateGoalPriority, selectQuickAction,
    // showActions, GoalChecklist/GoalAttachments, showLinkInput,
    // openPrivacyMenuId/assignTypeByGoalId/handleAssignGoal, GoalTimeline,
    // showNoteInput/submitNote) -- nothing here is new business logic,
    // only new markup wrapping it.
    if (compact && expandedCompactTaskIds.has(g.id)) {
      return (
        <div key={g.id} className="goal-child-row-wrap" data-goal-id={g.id}>
          <div
            className={`goal-child-expanded${g.id === highlightGoalId ? " post-card-highlight" : ""}`}
            data-pending={!reviewed}
            style={{ "--p-color": getPriorityMeta(p).color } as React.CSSProperties}
          >
            {/* Header: number + full wrapping title + priority + collapse */}
            <div className="goal-child-expanded-header">
              <span className="goal-child-number flex-shrink-0">{idx + 1}</span>
              <div className="goal-child-expanded-title">
                {g.title}
                {g.time_of_day && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-white/50">
                    <Clock size={12} />
                    {formatTimeOfDay(g.time_of_day)}
                  </span>
                )}
              </div>
              <select
                value={p}
                disabled={locked || dayClosed || isExclusive}
                onChange={async (e) => {
                  const newPriority = Number(e.target.value);
                  if (!plan?.id) return;
                  markGoalBusy(g.id);
                  try {
                    await updateGoalPriority(g.id, plan.id, newPriority);
                    await refresh({ silent: true });
                  } catch (e: any) {
                    setMsg(e?.message ?? t("today.failedUpdatePriority"));
                  } finally {
                    clearGoalBusy(g.id);
                  }
                }}
                className="priority-select flex-shrink-0"
                style={{
                  "--p-bg": getPriorityMeta(p).bg,
                  "--p-border": getPriorityMeta(p).border,
                  "--p-color": getPriorityMeta(p).color,
                } as React.CSSProperties}
                title={t("today.priorityTitle", { p })}
              >
                {[1, 2, 3, 4, 5].map((v) => (
                  <option key={v} value={v}>
                    P{v}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  setExpandedCompactTaskIds((prev) => {
                    const next = new Set(prev);
                    next.delete(g.id);
                    return next;
                  })
                }
                className="goal-child-collapse-chevron"
                title={t("today.collapseTitle")}
                aria-label={t("today.collapseTitle")}
              >
                <ChevronUp size={14} />
              </button>
            </div>

            {g.details && <div className="text-xs text-white/60">{g.details}</div>}

            {/* Status/review — directly below the header */}
            <div className="goal-child-expanded-status-row">
              <div
                className="status-chip"
                style={{
                  "--chip-bg": statusChipColors(effectiveStatus).bg,
                  "--chip-border": statusChipColors(effectiveStatus).border,
                  "--chip-color": statusChipColors(effectiveStatus).color,
                } as React.CSSProperties}
              >
                <StatusIcon status={effectiveStatus} size={13} />
                <span>{statusLabel(effectiveStatus, t)}</span>
              </div>
              {!dayClosed && !isExclusive && (
                <button
                  type="button"
                  onClick={() => setShowActions((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                  disabled={locked}
                  className="actions-toggle"
                  data-open={!!showActions[g.id]}
                  title={reviewed ? t("today.changeAction") : t("today.chooseAction")}
                >
                  {reviewed ? <SquareCheck size={14} /> : <Square size={14} />}
                </button>
              )}
              {/* Comment/add-note toggle — moved up beside Reviewed
                  (was a separate button down by Actions & Notes,
                  rendered only once, same handler/state either way). */}
              <button
                type="button"
                onClick={() => setShowNoteInput((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                className="actions-toggle"
                data-open={!!showNoteInput[g.id]}
                title={t("today.addNoteTitle")}
              >
                <MessageCircle size={14} />
              </button>
              {!reviewed && (
                <span className="goal-child-pending-tag">
                  <Hourglass size={10} /> {t("today.pendingReview")}
                </span>
              )}
            </div>

            {/* Status action menu — width:100% of this nested child,
                never viewport/card width, per spec. */}
            {!dayClosed && !isExclusive && showActions[g.id] && (
              <div className="goal-child-quick-actions" style={{ width: "100%" }}>
                <button
                  type="button"
                  onClick={() => selectQuickAction(g, "completed")}
                  disabled={locked || isBusy}
                  className="action-btn"
                  data-current={g.status === "completed"}
                  style={{
                    "--btn-bg": g.status === "completed" ? "var(--status-completed-bg-active)" : "var(--status-completed-bg)",
                    "--btn-border": g.status === "completed" ? "var(--status-completed-border-active)" : "var(--status-completed-border)",
                    "--btn-color": "var(--status-completed)",
                  } as React.CSSProperties}
                >
                  <CheckCircle2 size={14} />
                  <span>{t("status.completed")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => selectQuickAction(g, "in_progress")}
                  disabled={locked || isBusy}
                  className="action-btn"
                  data-current={g.status === "in_progress"}
                  style={{
                    "--btn-bg": g.status === "in_progress" ? "var(--status-in-progress-bg-active)" : "var(--status-in-progress-bg)",
                    "--btn-border": g.status === "in_progress" ? "var(--status-in-progress-border-active)" : "var(--status-in-progress-border)",
                    "--btn-color": "var(--status-in-progress)",
                  } as React.CSSProperties}
                >
                  <Settings2 size={14} />
                  <span>{t("today.inProgressAction")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => selectQuickAction(g, "blocked")}
                  disabled={locked || isBusy}
                  className="action-btn"
                  data-current={g.status === "blocked"}
                  style={{
                    "--btn-bg": g.status === "blocked" ? "var(--status-blocked-bg-active)" : "var(--status-blocked-bg)",
                    "--btn-border": g.status === "blocked" ? "var(--status-blocked-border-active)" : "var(--status-blocked-border)",
                    "--btn-color": "var(--status-blocked)",
                  } as React.CSSProperties}
                >
                  <Ban size={14} />
                  <span>{t("status.blocked")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => selectQuickAction(g, "canceled")}
                  disabled={locked || isBusy}
                  className="action-btn"
                  data-current={g.status === "canceled"}
                  style={{
                    "--btn-bg": g.status === "canceled" ? "var(--status-canceled-bg-active)" : "var(--status-canceled-bg)",
                    "--btn-border": g.status === "canceled" ? "var(--status-canceled-border-active)" : "var(--status-canceled-border)",
                    "--btn-color": "var(--status-canceled)",
                  } as React.CSSProperties}
                >
                  <XCircle size={14} />
                  <span>{t("status.canceled")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => selectQuickAction(g, "reschedule")}
                  disabled={locked || isBusy}
                  className="action-btn"
                  data-current={!!g.rescheduled_to}
                  style={{
                    "--btn-bg": g.rescheduled_to ? "var(--status-postponed-bg-active)" : "var(--status-postponed-bg)",
                    "--btn-border": g.rescheduled_to ? "var(--status-postponed-border-active)" : "var(--status-postponed-border)",
                    "--btn-color": "var(--status-postponed)",
                  } as React.CSSProperties}
                >
                  <CalendarClock size={14} />
                  <span>{g.rescheduled_to ? t("today.rescheduledTo", { date: formatDateDisplay(g.rescheduled_to) }) : t("status.rescheduled")}</span>
                </button>
              </div>
            )}

            {/* Checklist / Files / Link / Assign — same wrapping compact
                toolbar and handlers as the standalone card. */}
            <div className="goal-toolbar">
              <GoalChecklist
                compact
                goalId={g.id}
                items={checklistItems[g.id] ?? []}
                onItemsChange={(items) => setChecklistItems((prev) => ({ ...prev, [g.id]: items }))}
                readOnly={dayClosed || isExclusive}
              />
              <GoalAttachments
                compact
                goalId={g.id}
                items={attachments[g.id] ?? []}
                onItemsChange={(items) => setAttachments((prev) => ({ ...prev, [g.id]: items }))}
                readOnly={dayClosed || isExclusive}
              />
              {(g.link_url || (!dayClosed && !isExclusive)) && (
                <button
                  type="button"
                  onClick={() => {
                    if (dayClosed || isExclusive) {
                      if (g.link_url) window.open(g.link_url, "_blank", "noopener,noreferrer");
                      return;
                    }
                    setShowLinkInput((prev) => ({ ...prev, [g.id]: !prev[g.id] }));
                  }}
                  className="btn btn-tint btn-teal goal-toolbar-btn"
                  title={g.link_url || t("today.attachLink")}
                >
                  {g.link_url ? <Link2 size={13} /> : <Plus size={13} />}
                  <span className="goal-toolbar-label">{t("today.link")}</span>
                </button>
              )}

              {!assignment && !received && acceptedConnections.length > 0 && (
                <>
                  <PortalDropdownMenu
                    open={openPrivacyMenuId === g.id}
                    onClose={() => setOpenPrivacyMenuId(null)}
                    anchorRef={privacyMenuRef}
                    panelClassName="conn-card-menu"
                    panelStyle={{ minWidth: "170px", maxWidth: "min(240px, calc(100vw - 4rem))" }}
                    panel={
                      <>
                        {(["exclusive", "shared"] as GoalAssignmentType[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              setAssignTypeByGoalId((prev) => ({ ...prev, [g.id]: option }));
                              setOpenPrivacyMenuId(null);
                            }}
                            className="conn-card-menu-item"
                            style={{ flexDirection: "column", alignItems: "flex-start", gap: "1px" }}
                          >
                            <span className="inline-flex items-center gap-1.5">
                              {option === "exclusive" ? <Lock size={12} /> : <Unlock size={12} />}
                              {option === "exclusive" ? t("goalAssign.exclusiveShort") : t("goalAssign.sharedShort")}
                              {(assignTypeByGoalId[g.id] ?? "exclusive") === option && <Check size={12} className="text-emerald-400" />}
                            </span>
                            <span className="text-[10px] text-white/45">
                              {option === "exclusive" ? t("goalAssign.exclusiveDesc") : t("goalAssign.sharedDesc")}
                            </span>
                          </button>
                        ))}
                      </>
                    }
                  >
                    <div className="relative" ref={openPrivacyMenuId === g.id ? privacyMenuRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setOpenPrivacyMenuId((prev) => (prev === g.id ? null : g.id))}
                        className="btn goal-toolbar-btn"
                      >
                        {(assignTypeByGoalId[g.id] ?? "exclusive") === "exclusive" ? (
                          <Lock size={13} />
                        ) : (
                          <Unlock size={13} />
                        )}
                        <span className="goal-toolbar-label">
                          {(assignTypeByGoalId[g.id] ?? "exclusive") === "exclusive"
                            ? t("goalAssign.exclusiveShort")
                            : t("goalAssign.sharedShort")}
                        </span>
                        <ChevronDown size={12} className="text-white/40" />
                      </button>
                    </div>
                  </PortalDropdownMenu>

                  {/* Assign — a button + dropdown menu (not a native
                      <select>) so its own label is the short, fixed word
                      "Assign", never the select's own truncation-prone
                      rendered text, and the icon/chevron are normal flex
                      children (flex-shrink:0) instead of an absolutely-
                      positioned overlay that could collide with it. */}
                  <div
                    className="relative inline-flex items-center"
                    ref={openAssignMenuId === g.id ? assignMenuRef : undefined}
                  >
                    <button
                      type="button"
                      disabled={assigningGoalIds.has(g.id) || dayClosed}
                      onClick={() => setOpenAssignMenuId((prev) => (prev === g.id ? null : g.id))}
                      className="btn btn-tint btn-amber-tint goal-toolbar-btn goal-toolbar-btn-assign"
                    >
                      <UserPlus size={13} className="flex-shrink-0" />
                      <span className="goal-toolbar-label goal-toolbar-label-keep">{t("goalAssign.assignShort")}</span>
                      <ChevronDown size={12} className="text-white/40 flex-shrink-0" />
                    </button>
                    {openAssignMenuId === g.id && (
                      <div className="conn-card-menu" style={{ minWidth: "130px", maxWidth: "min(150px, calc(100vw - 4rem))" }}>
                        {acceptedConnections.map((c) => (
                          <button
                            key={c.otherUserId}
                            type="button"
                            onClick={() => {
                              handleAssignGoal(g.id, c.otherUserId);
                              setOpenAssignMenuId(null);
                            }}
                            className="conn-card-menu-item"
                            title={connectionDisplayName(c, t)}
                          >
                            <span className="truncate min-w-0 flex-1">{connectionDisplayName(c, t)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {(assignment || received) && (
              <div className="flex items-center gap-1" style={{ flexWrap: "nowrap", overflowX: "auto" }}>
                {assignment ? (
                  <span className="text-[11px] text-white/50 whitespace-nowrap flex-shrink-0 inline-flex items-center gap-1">
                    {assignment.assignmentType === "exclusive" ? <Lock size={11} /> : <Unlock size={11} />}
                    {t("goalAssign.assignedToLabel", {
                      name: assignment.recipientDisplayName ?? t("social.anonymousUser"),
                    })}
                    {assignment.status === "pending" && <span>· {t("social.assignmentPending")}</span>}
                    {assignment.status === "accepted" && assignment.recipientGoalStatus && (
                      <span className="inline-flex items-center gap-1">
                        · <StatusIcon status={assignment.recipientGoalStatus} size={12} />{" "}
                        {statusLabel(assignment.recipientGoalStatus, t)}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-[11px] text-white/50 whitespace-nowrap flex-shrink-0 inline-flex items-center gap-1">
                    <Lock size={11} />
                    {t("social.assignedByLabel", {
                      name: received!.assignerDisplayName ?? t("social.anonymousUser"),
                    })}
                  </span>
                )}
              </div>
            )}
            {assignError && <div className="text-[11px] text-red-400">{assignError}</div>}

            {!dayClosed && !isExclusive && showLinkInput[g.id] && (
              <input
                type="url"
                value={g.link_url ?? ""}
                onChange={(e) =>
                  setGoals((prev) => prev.map((x) => (x.id === g.id ? { ...x, link_url: e.target.value || null } : x)))
                }
                onBlur={() => {
                  updateGoalLink(g.id, g.link_url || null).catch((err) =>
                    setMsg(err?.message ?? t("today.failedSaveLink"))
                  );
                }}
                placeholder={t("today.urlPlaceholder")}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25"
              />
            )}

            {/* The comment/add-note toggle now lives up in the status
                row beside Reviewed; GoalTimeline's own toggle already
                reads "Actions & notes (N)", so nothing else is needed
                here. */}
            <div>
              <GoalTimeline entries={buildGoalTimeline(g, goalNotes[g.id] ?? [], t)} />
              {showNoteInput[g.id] && (
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={noteDraft[g.id] ?? ""}
                    onChange={(e) => setNoteDraft((prev) => ({ ...prev, [g.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitNote(g.id);
                    }}
                    placeholder={t("today.addNotePlaceholder")}
                    disabled={!!savingNote[g.id]}
                    autoFocus
                    className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => submitNote(g.id)}
                    disabled={!!savingNote[g.id] || !(noteDraft[g.id] ?? "").trim()}
                    className="btn"
                    style={{ padding: "0.375rem 1rem" }}
                  >
                    {savingNote[g.id] ? t("today.addingNote") : t("today.add")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        key={g.id}
        data-goal-id={g.id}
        className={`${isCelebrating ? "goal-row goal-row-celebrate" : "goal-row"}${g.id === highlightGoalId ? " post-card-highlight" : ""}`}
        data-pending={!reviewed}
        data-edge-weight={edgeWeight}
        /* A resolved-but-expanded goal (isCollapsible, re-opened via
           toggleExpandedDone) reflects its STATUS color here, same as
           it would show collapsed -- an active/pending goal still
           reflects PRIORITY, same as before. --p-color feeds
           .goal-row's --metal-color (see globals.css). */
        style={{ "--p-color": isCollapsible ? doneColors.color : getPriorityMeta(p).color, position: "relative" } as React.CSSProperties}
      >
        {isCelebrating && <div className="goal-complete-badge"><Check size={14} strokeWidth={3} /></div>}
        {isCollapsible && (
          <>
            {/* Top-right corner tag, mirrors goal-number-badge's
                shape — now a delete action (was the old text
                "Collapse" button) since collapsing moved to its
                own half-circle tab on the top border, below. */}
            <button
              type="button"
              onClick={() => handleDeleteGoal(g)}
              disabled={busyGoalIds.has(g.id)}
              className="goal-delete-corner-btn"
              title={t("today.deleteGoal")}
            >
              <X size={12} />
            </button>
            <button
              type="button"
              onClick={() => toggleExpandedDone(g.id)}
              className="goal-collapse-top-btn"
              title={t("today.collapseTitle")}
            >
              <ChevronUp size={12} />
            </button>
          </>
        )}
        {/* Number badge — a small corner tag flush with the card's
            own top-left border/radius. */}
        <GoalNumberOrb number={idx + 1} />

        <div className="goal-row-body">
        <div className="goal-row-cols">
          {/* Goal content */}
          <div className="flex-1" style={{ minWidth: 0 }}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {!reviewed && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-400 font-semibold">
                  <Hourglass size={11} /> {t("today.pendingReview")}
                </span>
              )}
            </div>

            <div className="text-white text-lg sm:text-xl font-medium mb-2">
              {g.title}
              {g.time_of_day && (
                <span className="ml-2 inline-flex items-center gap-1 text-sm font-normal text-white/50">
                  <Clock size={13} />
                  {formatTimeOfDay(g.time_of_day)}
                </span>
              )}
            </div>
            {g.details && <div className="text-sm text-white/60 mb-2">{g.details}</div>}

            {/* Goal toolbar — Checklist/Files/Link/Exclusive-or-
                Shared/Assign, redesigned into one integrated row
                (was two separate rows of plain gray buttons).
                Visual/layout only: every control below still
                calls the exact same handlers as before. */}
            <div className="goal-toolbar">
              <GoalChecklist
                compact
                goalId={g.id}
                items={checklistItems[g.id] ?? []}
                onItemsChange={(items) =>
                  setChecklistItems((prev) => ({ ...prev, [g.id]: items }))
                }
                readOnly={dayClosed || isExclusive}
              />
              <GoalAttachments
                compact
                goalId={g.id}
                items={attachments[g.id] ?? []}
                onItemsChange={(items) =>
                  setAttachments((prev) => ({ ...prev, [g.id]: items }))
                }
                readOnly={dayClosed || isExclusive}
              />
              {(g.link_url || (!dayClosed && !isExclusive)) && (
                <button
                  type="button"
                  onClick={() => {
                    if (dayClosed || isExclusive) {
                      if (g.link_url) window.open(g.link_url, "_blank", "noopener,noreferrer");
                      return;
                    }
                    setShowLinkInput((prev) => ({ ...prev, [g.id]: !prev[g.id] }));
                  }}
                  className="btn btn-tint btn-teal goal-toolbar-btn"
                  title={g.link_url || t("today.attachLink")}
                >
                  {g.link_url ? <Link2 size={13} /> : <Plus size={13} />}
                  <span className="goal-toolbar-label">{t("today.link")}</span>
                </button>
              )}

              {/* Exclusive/Shared + Assign — same row now instead
                  of a separate line below; both only show pre-
                  assignment, same as before (assignment/received
                  replace them with the status line underneath). */}
              {!assignment && !received && acceptedConnections.length > 0 && (
                <>
                  <PortalDropdownMenu
                    open={openPrivacyMenuId === g.id}
                    onClose={() => setOpenPrivacyMenuId(null)}
                    anchorRef={privacyMenuRef}
                    panelClassName="conn-card-menu"
                    panelStyle={{ minWidth: "210px" }}
                    panel={
                      <>
                        {(["exclusive", "shared"] as GoalAssignmentType[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              setAssignTypeByGoalId((prev) => ({ ...prev, [g.id]: option }));
                              setOpenPrivacyMenuId(null);
                            }}
                            className="conn-card-menu-item"
                            style={{ flexDirection: "column", alignItems: "flex-start", gap: "1px" }}
                          >
                            <span className="inline-flex items-center gap-1.5">
                              {option === "exclusive" ? <Lock size={12} /> : <Unlock size={12} />}
                              {option === "exclusive" ? t("goalAssign.exclusiveShort") : t("goalAssign.sharedShort")}
                              {(assignTypeByGoalId[g.id] ?? "exclusive") === option && <Check size={12} className="text-emerald-400" />}
                            </span>
                            <span className="text-[10px] text-white/45">
                              {option === "exclusive" ? t("goalAssign.exclusiveDesc") : t("goalAssign.sharedDesc")}
                            </span>
                          </button>
                        ))}
                      </>
                    }
                  >
                    <div className="relative" ref={openPrivacyMenuId === g.id ? privacyMenuRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setOpenPrivacyMenuId((prev) => (prev === g.id ? null : g.id))}
                        className="btn goal-toolbar-btn"
                      >
                        {(assignTypeByGoalId[g.id] ?? "exclusive") === "exclusive" ? (
                          <Lock size={13} />
                        ) : (
                          <Unlock size={13} />
                        )}
                        <span className="goal-toolbar-label">
                          {(assignTypeByGoalId[g.id] ?? "exclusive") === "exclusive"
                            ? t("goalAssign.exclusiveShort")
                            : t("goalAssign.sharedShort")}
                        </span>
                        <ChevronDown size={12} className="text-white/40" />
                      </button>
                    </div>
                  </PortalDropdownMenu>

                  {/* Assign — a button + dropdown menu (not a native
                      <select>) so its own label is the short, fixed word
                      "Assign", never the select's own truncation-prone
                      rendered text, and the icon/chevron are normal flex
                      children (flex-shrink:0) instead of an absolutely-
                      positioned overlay that could collide with it. */}
                  <div
                    className="relative inline-flex items-center"
                    ref={openAssignMenuId === g.id ? assignMenuRef : undefined}
                  >
                    <button
                      type="button"
                      disabled={assigningGoalIds.has(g.id) || dayClosed}
                      onClick={() => setOpenAssignMenuId((prev) => (prev === g.id ? null : g.id))}
                      className="btn btn-tint btn-amber-tint goal-toolbar-btn goal-toolbar-btn-assign"
                    >
                      <UserPlus size={13} className="flex-shrink-0" />
                      <span className="goal-toolbar-label goal-toolbar-label-keep">{t("goalAssign.assignShort")}</span>
                      <ChevronDown size={12} className="text-white/40 flex-shrink-0" />
                    </button>
                    {openAssignMenuId === g.id && (
                      <div className="conn-card-menu" style={{ minWidth: "130px", maxWidth: "min(150px, calc(100vw - 4rem))" }}>
                        {acceptedConnections.map((c) => (
                          <button
                            key={c.otherUserId}
                            type="button"
                            onClick={() => {
                              handleAssignGoal(g.id, c.otherUserId);
                              setOpenAssignMenuId(null);
                            }}
                            className="conn-card-menu-item"
                            title={connectionDisplayName(c, t)}
                          >
                            <span className="truncate min-w-0 flex-1">{connectionDisplayName(c, t)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Assignment status — once assigned (either
                direction), replaces the Exclusive/Shared+Assign
                controls above with a read-only status line. */}
            {(assignment || received) && (
              <div className="mt-1.5 flex items-center gap-1" style={{ flexWrap: "nowrap", overflowX: "auto" }}>
                {assignment ? (
                  <span className="text-[11px] text-white/50 whitespace-nowrap flex-shrink-0 inline-flex items-center gap-1">
                    {assignment.assignmentType === "exclusive" ? <Lock size={11} /> : <Unlock size={11} />}
                    {t("goalAssign.assignedToLabel", {
                      name: assignment.recipientDisplayName ?? t("social.anonymousUser"),
                    })}
                    {assignment.status === "pending" && <span>· {t("social.assignmentPending")}</span>}
                    {assignment.status === "accepted" && assignment.recipientGoalStatus && (
                      <span className="inline-flex items-center gap-1">
                        · <StatusIcon status={assignment.recipientGoalStatus} size={12} />{" "}
                        {statusLabel(assignment.recipientGoalStatus, t)}
                      </span>
                    )}
                  </span>
                ) : (
                  // A goal that's itself the product of an assignment
                  // I received — locked from being re-assigned onward
                  // (see receivedByGoalId above), same Lock icon
                  // language as the assigner's own side uses.
                  <span className="text-[11px] text-white/50 whitespace-nowrap flex-shrink-0 inline-flex items-center gap-1">
                    <Lock size={11} />
                    {t("social.assignedByLabel", {
                      name: received!.assignerDisplayName ?? t("social.anonymousUser"),
                    })}
                  </span>
                )}
              </div>
            )}
            {assignError && <div className="mt-1 text-[11px] text-red-400">{assignError}</div>}

            {!dayClosed && !isExclusive && showLinkInput[g.id] && (
              <input
                type="url"
                value={g.link_url ?? ""}
                onChange={(e) =>
                  setGoals((prev) =>
                    prev.map((x) => (x.id === g.id ? { ...x, link_url: e.target.value || null } : x))
                  )
                }
                onBlur={() => {
                  updateGoalLink(g.id, g.link_url || null).catch((err) =>
                    setMsg(err?.message ?? t("today.failedSaveLink"))
                  );
                }}
                placeholder={t("today.urlPlaceholder")}
                className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25"
              />
            )}

            <GoalTimeline entries={buildGoalTimeline(g, goalNotes[g.id] ?? [], t)} />

            {showNoteInput[g.id] && (
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={noteDraft[g.id] ?? ""}
                  onChange={(e) => setNoteDraft((prev) => ({ ...prev, [g.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNote(g.id);
                  }}
                  placeholder={t("today.addNotePlaceholder")}
                  disabled={!!savingNote[g.id]}
                  autoFocus
                  className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => submitNote(g.id)}
                  disabled={!!savingNote[g.id] || !(noteDraft[g.id] ?? "").trim()}
                  className="btn"
                  style={{ padding: "0.375rem 1rem" }}
                >
                  {savingNote[g.id] ? t("today.addingNote") : t("today.add")}
                </button>
              </div>
            )}
          </div>

          {/* Priority + Actions — grouped together instead of two separate columns.
              Priority + status label stay visible even once the day is closed;
              only the editable controls (review/status/reschedule) hide then. */}
          <div className="flex flex-col gap-3" style={{ minWidth: "160px" }}>
            {/* Priority sits right next to the review toggle */}
            <div className="flex items-center gap-3">
              <select
                value={p}
                disabled={locked || dayClosed || isExclusive}
                onChange={async (e) => {
                  const newPriority = Number(e.target.value);
                  if (!plan?.id) return;
                  markGoalBusy(g.id);
                  try {
                    await updateGoalPriority(g.id, plan.id, newPriority);
                    await refresh({ silent: true });
                  } catch (e: any) {
                    setMsg(e?.message ?? t("today.failedUpdatePriority"));
                  } finally {
                    clearGoalBusy(g.id);
                  }
                }}
                className="priority-select"
                style={{
                  "--p-bg": getPriorityMeta(p).bg,
                  "--p-border": getPriorityMeta(p).border,
                  "--p-color": getPriorityMeta(p).color,
                } as React.CSSProperties}
                title={t("today.priorityTitle", { p })}
              >
                {[1, 2, 3, 4, 5].map((v) => (
                  <option key={v} value={v}>
                    P{v}
                  </option>
                ))}
              </select>

              {/* Status chip - same fashion as the priority select, distinct color per status */}
              <div
                className="status-chip"
                style={{
                  "--chip-bg": statusChipColors(effectiveStatus).bg,
                  "--chip-border": statusChipColors(effectiveStatus).border,
                  "--chip-color": statusChipColors(effectiveStatus).color,
                } as React.CSSProperties}
              >
                <StatusIcon status={effectiveStatus} size={13} />
                <span>{statusLabel(effectiveStatus, t)}</span>
              </div>

              {/* Actions checkbox — unchecked until the goal has
                  been reviewed; opens the same 5-action dropdown
                  either way, so you can also use it to change an
                  already-picked action later. Available for shared
                  assignments (independent status, same as any
                  normal goal) but not exclusive ones — those are
                  the recipient's alone to act on, and are excluded
                  from this user's own review requirement (see
                  reviewableGoals above) so locking this out here
                  doesn't block closing the day. */}
              {!dayClosed && !isExclusive && (
                <button
                  type="button"
                  onClick={() => setShowActions((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                  disabled={locked}
                  className="actions-toggle"
                  data-open={!!showActions[g.id]}
                  title={reviewed ? t("today.changeAction") : t("today.chooseAction")}
                >
                  {reviewed ? <SquareCheck size={14} /> : <Square size={14} />}
                </button>
              )}

              {/* Add Note — lives next to the action controls now;
                  entries render in the merged timeline below the
                  goal instead of behind a separate Notes tab. */}
              <button
                type="button"
                onClick={() => setShowNoteInput((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                className="actions-toggle"
                data-open={!!showNoteInput[g.id]}
                title={t("today.addNoteTitle")}
              >
                <MessageCircle size={14} />
              </button>
            </div>

            {/* Quick-action dropdown — picking any of these reviews
                the goal, applies the action, and closes itself in
                one click (see selectQuickAction). */}
            {!dayClosed && !isExclusive && showActions[g.id] && (
              <div className="flex flex-col gap-2" style={{ minWidth: "180px" }}>
                <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">
                  {t("today.updateStatusLabel")}
                </div>
                <button
                  type="button"
                  onClick={() => selectQuickAction(g, "completed")}
                  disabled={locked || isBusy}
                  className="action-btn"
                  data-current={g.status === "completed"}
                  style={{
                    "--btn-bg": g.status === "completed" ? "var(--status-completed-bg-active)" : "var(--status-completed-bg)",
                    "--btn-border": g.status === "completed" ? "var(--status-completed-border-active)" : "var(--status-completed-border)",
                    "--btn-color": "var(--status-completed)",
                  } as React.CSSProperties}
                >
                  <CheckCircle2 size={15} />
                  <span>{t("status.completed")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => selectQuickAction(g, "in_progress")}
                  disabled={locked || isBusy}
                  className="action-btn"
                  data-current={g.status === "in_progress"}
                  style={{
                    "--btn-bg": g.status === "in_progress" ? "var(--status-in-progress-bg-active)" : "var(--status-in-progress-bg)",
                    "--btn-border": g.status === "in_progress" ? "var(--status-in-progress-border-active)" : "var(--status-in-progress-border)",
                    "--btn-color": "var(--status-in-progress)",
                  } as React.CSSProperties}
                >
                  <Settings2 size={15} />
                  <span>{t("today.inProgressAction")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => selectQuickAction(g, "blocked")}
                  disabled={locked || isBusy}
                  className="action-btn"
                  data-current={g.status === "blocked"}
                  style={{
                    "--btn-bg": g.status === "blocked" ? "var(--status-blocked-bg-active)" : "var(--status-blocked-bg)",
                    "--btn-border": g.status === "blocked" ? "var(--status-blocked-border-active)" : "var(--status-blocked-border)",
                    "--btn-color": "var(--status-blocked)",
                  } as React.CSSProperties}
                >
                  <Ban size={15} />
                  <span>{t("status.blocked")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => selectQuickAction(g, "canceled")}
                  disabled={locked || isBusy}
                  className="action-btn"
                  data-current={g.status === "canceled"}
                  style={{
                    "--btn-bg": g.status === "canceled" ? "var(--status-canceled-bg-active)" : "var(--status-canceled-bg)",
                    "--btn-border": g.status === "canceled" ? "var(--status-canceled-border-active)" : "var(--status-canceled-border)",
                    "--btn-color": "var(--status-canceled)",
                  } as React.CSSProperties}
                >
                  <XCircle size={15} />
                  <span>{t("status.canceled")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => selectQuickAction(g, "reschedule")}
                  disabled={locked || isBusy}
                  className="action-btn"
                  data-current={!!g.rescheduled_to}
                  style={{
                    "--btn-bg": g.rescheduled_to ? "var(--status-postponed-bg-active)" : "var(--status-postponed-bg)",
                    "--btn-border": g.rescheduled_to ? "var(--status-postponed-border-active)" : "var(--status-postponed-border)",
                    "--btn-color": "var(--status-postponed)",
                  } as React.CSSProperties}
                >
                  <CalendarClock size={15} />
                  <span>{g.rescheduled_to ? t("today.rescheduledTo", { date: formatDateDisplay(g.rescheduled_to) }) : t("status.rescheduled")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className="card card-highlight"
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">{t("today.title")}</h1>
            <p className="text-white/70">
              {dayClosed
                ? t("today.dayClosedDesc")
                : t("today.reviewFirstDesc")}
            </p>
            {plan?.status && (
              <div className="mt-2 text-sm text-white/60">
                {t("today.datePrefix")}<b>{formatDateDisplay(todayISO)}</b>
              </div>
            )}
            {dayClosed && plan?.reviewed_at && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 inline-flex">
                <CheckCircle2 className="text-emerald-400" size={20} />
                <div className="text-sm text-emerald-300">
                  {t("today.dayClosedAt", { time: new Date(plan.reviewed_at).toLocaleTimeString() })}
                </div>
              </div>
            )}
            {dayClosed && !plan?.reviewed_at && coveredByPassToday && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-2 inline-flex">
                <Ticket className="text-teal-400" size={20} />
                <div className="text-sm text-teal-300">{t("today.dayClosedByPass")}</div>
              </div>
            )}
            {dayClosed && plan?.reviewed_at && (
              <p className="mt-3 text-xs text-white/50">
                {t("today.reopenPrompt")}
              </p>
            )}
            {showEndOfDayReminder && (
              <div
                className="mt-3 rounded-lg px-3 py-2 inline-flex items-center gap-2"
                style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.35)" }}
              >
                <AlarmClock className="text-amber-400" size={18} />
                <div className="text-sm text-amber-300">
                  {hoursLeftToday < 1 ? t("today.lessThanHour") : t("today.hoursLeft", { hours: Math.round(hoursLeftToday) })}{t("today.endOfDaySuffix")}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-start sm:items-end gap-3">
            <div className="text-sm text-white/70">
              {t("today.reviewedCount")}<b>{reviewedCount}/{reviewableTotalCount}</b>
            </div>
            {totalCount > 0 && (
              <div className="flex flex-col items-start sm:items-end gap-1.5">
                <span className="text-xs text-white/50">{t("today.publishLabel")}</span>
                <div className="flex gap-2">
                  <select
                    value={
                      !myGlimpsePost
                        ? ""
                        : myGlimpsePost.visibility === "individual"
                        ? `individual:${myGlimpsePost.targetUserId}`
                        : myGlimpsePost.visibility
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      if (!value) return;
                      if (value.startsWith("individual:")) {
                        handlePublish("individual", value.slice("individual:".length));
                      } else {
                        handlePublish(value as PostVisibility);
                      }
                    }}
                    disabled={publishing}
                    className="rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white outline-none focus:border-white/40 disabled:opacity-50"
                    style={{ maxWidth: "220px" }}
                  >
                    <option value="" disabled>
                      {t("today.publishSelectPlaceholder")}
                    </option>
                    <option value="everyone">{t("today.publishEveryoneBtn")}</option>
                    <option value="connections">{t("today.publishConnectionsBtn")}</option>
                    {acceptedConnections.length > 0 && (
                      <optgroup label={t("today.publishIndividualGroupLabel")}>
                        {acceptedConnections.map((c) => (
                          <option key={c.otherUserId} value={`individual:${c.otherUserId}`}>
                            {connectionDisplayName(c, t)}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {published && (
                    <button
                      type="button"
                      onClick={handleUnpublish}
                      disabled={publishing}
                      className="btn"
                      style={{ padding: "0.4rem 0.7rem", fontSize: "0.8rem", whiteSpace: "nowrap" }}
                    >
                      {publishing ? t("today.unpublishing") : t("today.unpublish")}
                    </button>
                  )}
                </div>
              </div>
            )}
            {dayClosed && plan?.reviewed_at && (
              <div className="flex flex-row gap-2">
                <button
                  onClick={reopenDay}
                  disabled={reopening}
                  className="btn standup-metal-btn metal-orange bottom-nav-btn"
                  style={{
                    fontWeight: "bold",
                    whiteSpace: "nowrap"
                  }}
                >
                  {reopening ? t("today.reopening") : t("today.reopenDay")}
                </button>
                <Link
                  className="btn standup-metal-btn standup-metal-btn--accent whitespace-nowrap bottom-nav-btn"
                  href="/standup/tomorrow"
                  style={{ textAlign: "center" }}
                >
                  {t("today.planTomorrowArrow")}
                </Link>
              </div>
            )}
            {!dayClosed && totalCount > 0 && (
              <div className="flex flex-row gap-2">
                <button
                  type="button"
                  onClick={closeOutDay}
                  disabled={!canCloseDay || closing}
                  title={
                    !canCloseDay
                      ? pendingGoals.length > 0
                        ? t("today.reviewAllGoalsFirstShort")
                        : t("today.finishInProgressShort")
                      : t("today.closeOutDayTitle")
                  }
                  className="btn standup-metal-btn metal-orange bottom-nav-btn"
                  style={{ whiteSpace: "nowrap" }}
                >
                  {closing ? t("today.closing") : t("today.closeOutDayBtn")}
                </button>
                <Link
                  className="btn standup-metal-btn standup-metal-btn--accent whitespace-nowrap bottom-nav-btn"
                  href="/standup/tomorrow"
                  style={{ textAlign: "center" }}
                >
                  {t("today.planTomorrowArrow")}
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Incoming goal assignments for today's date specifically — the
            same pending-received data Social's Friends tab already shows,
            surfaced here too since a same-day assignment is directly
            relevant to the plan on this exact page. */}
        {pendingReceivedForToday.length > 0 && (
          <div className="mb-6 card card-highlight">
            <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
              {t("today.pendingAssignmentsTitle")}
            </div>
            {assignError && <p className="mb-2 text-xs text-red-300">{assignError}</p>}
            <div className="space-y-1.5">
              {pendingReceivedForToday.map((a) => (
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
                      onClick={() => handleRespondReceivedAssignment(a.id, true)}
                      disabled={respondingAssignmentIds.has(a.id)}
                      className="btn"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                    >
                      {t("social.accept")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRespondReceivedAssignment(a.id, false)}
                      disabled={respondingAssignmentIds.has(a.id)}
                      className="btn"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                    >
                      {t("social.decline")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Goals I assigned out whose recipient's copy is due today —
            read-only (only the recipient can act on it), since it may not
            be the goal's original date at all if they rescheduled their
            own copy forward. This is the one place I get to see it land
            on the day it's actually due, not just its original date. */}
        {assignedOutDueToday.length > 0 && (
          <div className="mb-6 card card-highlight">
            <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
              {t("today.assignedOutDueTodayTitle")}
            </div>
            <div className="space-y-1.5">
              {assignedOutDueToday.map((a) => (
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
                      {t("goalAssign.assignedToLabel", { name: a.recipientDisplayName ?? t("social.anonymousUser") })}
                    </div>
                  </div>
                  {a.recipientGoalStatus && (
                    <div
                      className="status-chip-sm flex-shrink-0"
                      style={{
                        "--chip-bg": statusChipColors(a.recipientGoalStatus).bg,
                        "--chip-border": statusChipColors(a.recipientGoalStatus).border,
                        "--chip-color": statusChipColors(a.recipientGoalStatus).color,
                      } as React.CSSProperties}
                    >
                      <StatusIcon status={a.recipientGoalStatus} size={12} />
                      <span>{statusLabel(a.recipientGoalStatus, t)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Add Section — only relevant while the day is still open;
            once closed, the equivalent actions (Reopen Day / Plan Tomorrow)
            live in the header above instead of repeating themselves here. */}
        {!dayClosed && (
        <div
          className="mb-6 rounded-2xl p-6 metal-surface"
          style={{ "--metal-color": "var(--metal-edge-orange)" } as React.CSSProperties}
        >
          {totalCount === 0 ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-bold text-amber-300 mb-1">{t("today.noGoalsToday")}</h3>
                  <p className="text-sm text-white/70">
                    {t("today.forgotYesterday")}
                  </p>
                </div>
                {addFlowStep === "closed" && (
                  <button
                    onClick={() => setAddFlowStep("choice")}
                    className="btn standup-metal-btn"
                    style={{
                      padding: "0.75rem 1.5rem",
                      fontSize: "1rem",
                      fontWeight: "bold"
                    }}
                  >
                    {t("today.quickAddGoals")}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-amber-300">{t("today.needMoreGoals")}</h3>
              </div>
              {addFlowStep === "closed" && (
                <button
                  onClick={() => setAddFlowStep("choice")}
                  className="btn standup-metal-btn day-action-btn-sm"
                  style={{
                    padding: "0.5rem 1rem",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("today.addGoalsBtn")}
                </button>
              )}
            </div>
          )}

          {/* Goal Engine current-day Add flow -- type-first, same model as
              Plan Tomorrow's Phase 4C: pick Standalone Task or Major Goal
              before any title input appears, then a validated structured
              form. Priority control reuses this page's own existing
              PRIORITY_OPTIONS select (unchanged visual language) rather
              than importing Plan Tomorrow's -- only the interaction
              pattern is shared, not the styling, per "do not redesign the
              rest of Review Today". */}
          {addFlowStep !== "closed" && !dayClosed && (
              <div className="space-y-3 mt-4">
                {addFlowStep === "choice" && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAddFlowStep("task")}
                      className="btn"
                      style={{ padding: "0.5rem 0.9rem", fontSize: "0.85rem" }}
                    >
                      {t("tomorrow.addChoiceTask")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddFlowStep("goal")}
                      className="btn inline-flex items-center gap-1.5"
                      style={{ padding: "0.5rem 0.9rem", fontSize: "0.85rem" }}
                    >
                      <Target size={13} /> {t("tomorrow.addChoiceGoal")}
                    </button>
                    <button
                      type="button"
                      onClick={resetAddFlow}
                      className="btn btn-ghost"
                      style={{ padding: "0.5rem 0.6rem" }}
                      title={t("today.cancel")}
                      aria-label={t("today.cancel")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {addFlowStep === "task" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-4">
                      <select
                        value={newTaskPriority}
                        disabled={creatingTask}
                        onChange={(e) => setNewTaskPriority(Number(e.target.value))}
                        className="appearance-none rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-white/30"
                      >
                        {PRIORITY_OPTIONS.map((opt) => (
                          <option key={opt.v} value={opt.v}>
                            {opt.icon} P{opt.v}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={newTaskTitle}
                        disabled={creatingTask}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleCreateStandaloneTask();
                          }
                        }}
                        placeholder={t("tomorrow.taskTitlePlaceholder")}
                        autoFocus
                        className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40"
                      />
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleCreateStandaloneTask}
                        disabled={creatingTask || !newTaskTitle.trim()}
                        className="btn btn-primary"
                      >
                        {creatingTask ? t("today.adding") : t("tomorrow.createTaskButton")}
                      </button>
                      <button onClick={resetAddFlow} className="btn btn-ghost">
                        {t("today.cancel")}
                      </button>
                    </div>
                    {taskCreateError && <div className="text-xs text-red-400">{taskCreateError}</div>}
                  </div>
                )}

                {addFlowStep === "goal" && (
                  <div className="space-y-2">
                    <GoalTypeSelect
                      value={newGoalType}
                      disabled={creatingGoal}
                      onChange={(v) => {
                        setNewGoalType(v);
                        setGoalTypeInfo(v);
                      }}
                    />
                    <input
                      type="text"
                      value={newGoalTitle}
                      disabled={creatingGoal}
                      onChange={(e) => setNewGoalTitle(e.target.value)}
                      placeholder={t("tomorrow.goalTitlePlaceholder")}
                      autoFocus
                      className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40"
                    />

                    <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold">
                      {t("tomorrow.goalTasksLabel")}
                    </div>
                    <div className="space-y-2">
                      {newGoalTasks.map((tk, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <select
                            value={tk.priority}
                            disabled={creatingGoal}
                            onChange={(e) =>
                              setNewGoalTasks((prev) =>
                                prev.map((x, j) => (j === i ? { ...x, priority: Number(e.target.value) } : x))
                              )
                            }
                            className="appearance-none rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-white/30"
                          >
                            {PRIORITY_OPTIONS.map((opt) => (
                              <option key={opt.v} value={opt.v}>
                                {opt.icon} P{opt.v}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={tk.title}
                            disabled={creatingGoal}
                            onChange={(e) =>
                              setNewGoalTasks((prev) =>
                                prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x))
                              )
                            }
                            placeholder={t("tomorrow.goalTaskPlaceholder", { n: i + 1 })}
                            className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40"
                          />
                          {newGoalTasks.length > 2 && (
                            <button
                              type="button"
                              disabled={creatingGoal}
                              onClick={() => setNewGoalTasks((prev) => prev.filter((_, j) => j !== i))}
                              className="btn flex-shrink-0"
                              style={{ padding: "0.45rem" }}
                              title={t("tomorrow.removeGoalTask")}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={creatingGoal}
                      onClick={() => setNewGoalTasks((prev) => [...prev, { title: "", priority: 3 }])}
                      className="btn"
                      style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                    >
                      {t("tomorrow.addAnotherGoalTask")}
                    </button>

                    <div className="flex gap-3">
                      <button
                        onClick={handleCreateMajorGoal}
                        disabled={!canCreateTodayMajorGoal}
                        title={
                          !newGoalTitle.trim()
                            ? t("tomorrow.goalNeedsTitle")
                            : validTodayGoalTaskCount < 2
                            ? t("tomorrow.goalNeedsTwoTasks")
                            : ""
                        }
                        className="btn btn-primary"
                      >
                        {creatingGoal ? t("today.adding") : t("tomorrow.createGoalButton")}
                      </button>
                      <button onClick={resetAddFlow} className="btn btn-ghost">
                        {t("today.cancel")}
                      </button>
                    </div>
                    {goalCreateError && <div className="text-xs text-red-400">{goalCreateError}</div>}
                  </div>
                )}
              </div>
            )}
        </div>
        )}

        {/* Close Out Day Section */}
        {!dayClosed && totalCount > 0 && (
          <div
            className="mb-6 rounded-2xl p-4 metal-surface"
            style={{
              borderLeftWidth: "3px",
              borderLeftColor: "rgba(245, 158, 11, 0.5)",
            }}
          >
            <div className="flex flex-wrap items-center gap-3">
              {pendingGoals.length > 0 ? (
                <>
                  <div className="text-sm text-white/70">{t("today.pendingLabel")}<b>{pendingGoals.length}</b></div>
                  <div className="h-4 w-px bg-white/10" />
                  <div className="text-sm text-white/70">{t("today.reviewToUnlock")}</div>
                </>
              ) : inProgressGoals.length > 0 ? (
                <>
                  <div className="text-sm text-white/70">{t("today.inProgressLabel")}<b>{inProgressGoals.length}</b></div>
                  <div className="h-4 w-px bg-white/10" />
                  <div className="text-sm text-white/70">{t("today.finishBeforeClosing")}</div>
                </>
              ) : (
                <div className="text-sm text-white/70">{t("today.allReviewed")}</div>
              )}
            </div>

            {canCloseDay && (
              <div className="mt-3 text-sm text-white/60">
                {t("today.closeToUnlockTomorrow")}
              </div>
            )}
          </div>
        )}

        {/* Goals List with Beautiful Cards */}
        <div className="space-y-4">
          {sortedGoals.length === 0 && addFlowStep === "closed" && (
            <div className="text-white/70 text-center py-12">
              <ClipboardList className="mx-auto mb-4 text-white/40" size={40} strokeWidth={1.5} />
              <p className="text-lg mb-2">{t("today.noGoalsTodayEmpty")}</p>
              <p className="text-sm text-white/50">
                {t("today.useQuickAdd")}
              </p>
            </div>
          )}

          {/* Goal Engine — group Tasks by outcome_goal_id into their
              parent Major Goal card; standalone Tasks render below,
              unchanged. Numbering stays each task's TRUE position in the
              full priority-sorted list regardless of which container it
              ends up in (see renderTaskCard's own comment) -- grouping
              is presentation only, nothing about review/status/
              persistence changes here. */}
          {(() => {
            const withIdx = sortedGoals.map((g, idx) => ({ g, idx }));
            const grouped = new Map<string, { g: Goal; idx: number }[]>();
            const standalone: { g: Goal; idx: number }[] = [];
            for (const item of withIdx) {
              const gid = (item.g as any).outcome_goal_id as string | null | undefined;
              if (gid) {
                if (!grouped.has(gid)) grouped.set(gid, []);
                grouped.get(gid)!.push(item);
              } else {
                standalone.push(item);
              }
            }

            // Same reviewed definition renderTaskCard uses per-row,
            // generalized to any Goal array (today's + historical) --
            // assignedOutByGoalId is already a global (not date-scoped)
            // map keyed by goal id, so it's valid for historical rows too.
            function reviewedCountFor(gs: Goal[]) {
              return gs.filter((g) => {
                const a = assignedOutByGoalId.get(g.id);
                const isExcl = a?.assignmentType === "exclusive" && a.status === "accepted";
                return isExcl ? true : !!g.reviewed_at;
              }).length;
            }


            return (
              <>
                {Array.from(grouped.entries()).map(([goalId, items]) => {
                  const goalTitle = outcomeGoalTitleById.get(goalId) ?? "";
                  // goalChildrenById holds CONCEPTUAL Tasks (collapseGoalLineages,
                  // via getConceptualTasksByOutcomeGoalIds), one per reschedule
                  // chain rather than one per physical row. Each chain
                  // contributes exactly ONE row -- its `terminal`, which
                  // collapseGoalLineages itself already resolves to whichever
                  // row in the chain is Completed (if any), never both an
                  // ancestor (e.g. one of today's own live rows) and its
                  // continuation as separate entries. `todayLiveById` keyed
                  // by id (not just by the chain's terminal id) catches a
                  // terminal at ANY position in the chain, so today's live
                  // version is used whenever it applies.
                  const todayLiveById = new Map(items.map(({ g }) => [g.id, g]));
                  const conceptualTasks = goalChildrenById[goalId];
                  // lifecycle carried alongside each terminal (not just the
                  // bare row) -- purely additive, so allChildren/totalCount/
                  // completedCount/reviewedInGroup below are byte-identical
                  // to before (they only ever read .status/.reviewed_at,
                  // never lifecycle). Needed so the historical section below
                  // can tell a broken chain apart from an ordinary
                  // Rescheduled Task instead of discarding that distinction
                  // the moment it's reduced to .terminal, same presentation
                  // gap Dashboard's Active Goals already had fixed.
                  const representativeRows =
                    conceptualTasks !== undefined
                      ? conceptualTasks.map((ct) => ({ ...ct.terminal, lifecycle: ct.lifecycle }))
                      : [];
                  // Historical section only ever shows a conceptual Task
                  // whose terminal ISN'T already one of today's own live
                  // rows (those already get their own card below) -- same
                  // identity used for the stats, so a Task never shows up
                  // as independent entries in both places.
                  const historicalOnly = representativeRows.filter((rep) => !todayLiveById.has(rep.id));
                  // Falls back to just today's items while the historical
                  // fetch is still in flight -- a sensible loading state,
                  // not an error (stats just catch up once it resolves).
                  const allChildren: Goal[] =
                    conceptualTasks !== undefined
                      ? representativeRows.map((rep) => todayLiveById.get(rep.id) ?? rep)
                      : items.map(({ g }) => g);
                  const totalCount = allChildren.length;
                  // Completion tracks status==="completed" only -- kept
                  // fully separate from "reviewed" below (a reviewed or
                  // rescheduled Task is not automatically completed).
                  const completedCount = allChildren.filter((g) => g.status === "completed").length;
                  const completionPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
                  const reviewedInGroup = reviewedCountFor(allChildren);
                  const pendingReviewInGroup = totalCount - reviewedInGroup;
                  const isGroupCollapsed = collapsedGoalGroupIds.has(goalId);

                  return (
                    <div key={goalId} className="goal-group-card">
                      <button
                        type="button"
                        className="goal-group-card-header goal-group-card-header-btn"
                        onClick={() =>
                          setCollapsedGoalGroupIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(goalId)) next.delete(goalId);
                            else next.add(goalId);
                            return next;
                          })
                        }
                        aria-expanded={!isGroupCollapsed}
                      >
                        <div className="goal-group-card-title">
                          <Target size={16} className="flex-shrink-0" style={{ color: "#f472b6" }} />
                          <MarqueeText text={goalTitle} className="text-base font-semibold text-white" />
                        </div>
                        {isGroupCollapsed ? (
                          <ChevronDown size={16} className="text-white/40 flex-shrink-0" />
                        ) : (
                          <ChevronUp size={16} className="text-white/40 flex-shrink-0" />
                        )}
                      </button>

                      {/* Summary — always visible regardless of collapse
                          state, per spec. */}
                      <div className="goal-group-card-summary">
                        <div className="goal-group-card-stats">
                          <span>{t("today.goalCompletionStat", { completed: completedCount, total: totalCount })}</span>
                          <span>{t("today.goalPercentStat", { pct: completionPct })}</span>
                          <span>{t("today.goalReviewedStat", { reviewed: reviewedInGroup })}</span>
                          {pendingReviewInGroup > 0 && (
                            <span className="text-amber-400">
                              {t("today.goalPendingReviewStat", { pending: pendingReviewInGroup })}
                            </span>
                          )}
                        </div>
                        <div className="goal-progress-track">
                          <div
                            className="goal-progress-fill"
                            style={{ "--progress": completionPct / 100 } as React.CSSProperties}
                          />
                        </div>
                      </div>

                      {!isGroupCollapsed && (
                        <>
                          {/* Review Today visual nesting correction —
                              today's Task cards render inside this inset
                              tray (not as top-level siblings following the
                              header), so the parent Goal's boundaries
                              visibly enclose them. Purely a wrapper;
                              renderTaskCard's own markup/behavior is
                              unchanged. */}
                          <div className="goal-group-card-children space-y-2">
                            {items.map(({ g, idx }) => renderTaskCard(g, idx, { compact: true }))}
                          </div>

                          {/* Historical children — informational only.
                              Nothing on Today's own page already supports
                              interacting with a different day's goal, so
                              these stay read-only rows rather than reusing
                              renderTaskCard's full interactive card; the
                              link reaches the one place that already does
                              (Calendar's own date-detail page). */}
                          {historicalOnly.length > 0 && (
                            <div className="goal-history-section">
                              <div className="goal-history-section-label">{t("today.goalHistoryLabel")}</div>
                              <div className="goal-history-list">
                                {historicalOnly.map((hg) =>
                                  // Broken (lifecycle: "broken") -- its
                                  // recorded reschedule evidence points at a
                                  // continuation that no longer exists.
                                  // Never rendered as an ordinary Rescheduled
                                  // row (hg.status is still literally
                                  // "postponed", which IS the true historical
                                  // fact for this row on its own original
                                  // day -- not rewritten here, just not
                                  // presented as this Goal's CURRENT state
                                  // for it). Same "Needs Review" semantic
                                  // Dashboard's Active Goals already uses, no
                                  // Resolve action here -- that stays
                                  // Dashboard-only per this task's scope.
                                  hg.lifecycle === "broken" ? (
                                    <div key={hg.id} className="goal-history-row-broken">
                                      {hg.plan_date ? (
                                        <Link href={`/standup/date/${hg.plan_date}`} className="goal-history-row">
                                          <TriangleAlert size={12} className="text-amber-400 flex-shrink-0" />
                                          <span className="goal-history-row-title">{hg.title}</span>
                                          <span className="goal-history-row-date" style={{ color: "#fcd34d" }}>
                                            {t("dashboard.goalTaskNeedsReview")}
                                          </span>
                                        </Link>
                                      ) : (
                                        <div className="goal-history-row">
                                          <TriangleAlert size={12} className="text-amber-400 flex-shrink-0" />
                                          <span className="goal-history-row-title">{hg.title}</span>
                                          <span className="goal-history-row-date" style={{ color: "#fcd34d" }}>
                                            {t("dashboard.goalTaskNeedsReview")}
                                          </span>
                                        </div>
                                      )}
                                      <div className="goal-history-row-broken-hint">{t("dashboard.goalTaskBrokenHint")}</div>
                                    </div>
                                  ) : hg.plan_date ? (
                                    <Link key={hg.id} href={`/standup/date/${hg.plan_date}`} className="goal-history-row">
                                      <StatusIcon status={hg.status} size={12} />
                                      <span className="goal-history-row-title">{hg.title}</span>
                                      <span className="goal-history-row-date">{formatDateDisplay(hg.plan_date)}</span>
                                    </Link>
                                  ) : (
                                    <div key={hg.id} className="goal-history-row">
                                      <StatusIcon status={hg.status} size={12} />
                                      <span className="goal-history-row-title">{hg.title}</span>
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

                {standalone.map(({ g, idx }) => renderTaskCard(g, idx))}
              </>
            );
          })()}
        </div>

        <div className="mt-6 flex items-center gap-2 sm:gap-3">
          <Link className="btn standup-metal-btn bottom-nav-btn" href="/standup/calendar">← {t("nav.calendar")}</Link>
          <button type="button" className="btn standup-metal-btn bottom-nav-btn" onClick={() => refresh()}>{t("today.refresh")}</button>
          <Link className="btn standup-metal-btn bottom-nav-btn" href="/standup/dashboard">{t("nav.dashboard")} →</Link>
        </div>

        {msg && <div className="mt-4 px-4 py-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-sm text-white animate-fadeIn">{msg}</div>}
      </div>

      {rescheduleGoal && (
        <RescheduleModal
          goals={[rescheduleGoal]}
          onClose={() => setRescheduleGoal(null)}
          onSuccess={(kind) => {
            setMsg(kind === "backlog" ? t("today.movedToBacklog") : t("today.goalRescheduled"));
            refresh({ silent: true });
          }}
        />
      )}

      {blockingGoal && (
        <BlockedReasonModal
          goalTitle={blockingGoal.title}
          saving={blockingSaving}
          error={blockingError}
          onCancel={cancelBlocked}
          onConfirm={confirmBlocked}
        />
      )}

      {payingGoal && (
        <PaymentConfirmModal
          accountName={payingAccount?.name ?? payingGoal.title}
          suggestedAmount={payingAccount?.minimumPayment ?? 0}
          saving={paymentSaving}
          error={paymentError}
          onCancel={cancelPayment}
          onConfirm={confirmPaymentCompletion}
        />
      )}

      {goalTypeInfo && (
        <GoalTypeInfoModal goalType={goalTypeInfo} onDismiss={() => setGoalTypeInfo(null)} />
      )}
    </div>
  );
}