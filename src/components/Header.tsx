"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOrCreateProfile,
  updateThemePreference,
  consumePendingReferral,
  listConnections,
  getMyGoalAssignments,
  getMyMentions,
  getMyPostActivityNotifications,
  markConnectionSeen,
  markGoalAssignmentSeen,
  markGoalAssignmentSeenByRecipient,
  markMentionSeen,
  markPostActivityNotificationSeen,
  connectionDisplayName,
  type Profile,
  type Connection,
  type GoalAssignment,
  type Mention,
  type PostActivityNotification,
} from "@/lib/supabase/db";
import { onPointsUpdated } from "@/lib/pointsBus";
import { onNotificationsUpdated, notifyNotificationsUpdated } from "@/lib/notificationsBus";
import { countNotifications, computeNotificationBuckets } from "@/lib/notificationBuckets";
import { getStoredTheme, setTheme } from "@/lib/theme";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import Avatar from "@/components/Avatar";
import { MoreHorizontal, Bell, LayoutDashboard, Users, CheckCircle2, Sun, Calendar, Wrench, Info, HelpCircle, Mail } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";

// A profile's theme defaults to "dark" (DB column default), so this can't
// tell "explicitly chosen dark" apart from "never chosen" — but it doesn't
// need to. It only fires when the DB still says the default AND this
// browser's local value says otherwise, which only happens for someone who
// picked light mode before per-account themes existed; that one-time nudge
// carries their existing choice into their profile instead of discarding it.
function applyAccountTheme(p: Profile) {
  if (p.theme === "dark" && getStoredTheme() === "light") {
    setTheme("light");
    updateThemePreference("light").catch(() => {});
  } else {
    setTheme(p.theme);
  }
}

// Still used by infoLinks() below for logged-out visitors only — they
// never see NAV_TABS (none of its routes work without an account), so
// this space-saving rotation is their only way to reach About/FAQ/
// Contact from the header row. A logged-in user reaches the same three
// pages via NAV_TABS instead.
const INFO_ROTATION: Record<string, { labelKey: TranslationKey; href: string }> = {
  "/about": { labelKey: "nav.faq", href: "/faq" },
  "/faq": { labelKey: "nav.contact", href: "/contact" },
  "/contact": { labelKey: "nav.about", href: "/about" },
};
const INFO_PAGES = Object.keys(INFO_ROTATION);

// Every destination the header used to split across the primary row, the
// Assignments icon shortcut, and the About/FAQ/Contact rotation hidden
// behind "More" — all ten now live as their own tab in the hanging row
// below the header (navTabs()), each with its own accent color, same
// folder-tab theme as Social/Tools' own tab bars but inverted (hangs
// down, rounded-bottom, merges upward into the header instead of
// downward into a content panel) — explicit user call, applies to every
// breakpoint (icon-only below 640px, same as the other two folder-tab
// bars, which is what makes ten tabs fit at all on a phone width).
// infoGroup marks About/FAQ/Contact — on mobile (below 640px) these three
// collapse into the one combined tab rendered separately in navTabs()
// below (reusing INFO_ROTATION's existing link-to-the-next-one logic),
// instead of eating 3 of the available icon slots on a phone-width row.
// Desktop still shows all three as their own full tab.
const NAV_TABS: { href: string; labelKey: TranslationKey; icon: typeof LayoutDashboard; color: string; infoGroup?: boolean }[] = [
  { href: "/standup/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, color: "#60a5fa" },
  { href: "/standup/social", labelKey: "nav.social", icon: Users, color: "#a78bfa" },
  { href: "/standup/today", labelKey: "nav.reviewToday", icon: CheckCircle2, color: "#34d399" },
  { href: "/standup/tomorrow", labelKey: "nav.planTomorrow", icon: Sun, color: "#f59e0b" },
  { href: "/standup/calendar", labelKey: "nav.calendar", icon: Calendar, color: "#22d3ee" },
  { href: "/standup/tools", labelKey: "nav.tools", icon: Wrench, color: "#f43f5e" },
  // Goal Assignments removed from here per explicit follow-up — still
  // reachable via Social's Goals tab and Tools' Assignments tab, same as
  // before this whole nav restructure ever started.
  { href: "/about", labelKey: "nav.about", icon: Info, color: "#94a3b8", infoGroup: true },
  { href: "/faq", labelKey: "nav.faq", icon: HelpCircle, color: "#38bdf8", infoGroup: true },
  { href: "/contact", labelKey: "nav.contact", icon: Mail, color: "#f472b6", infoGroup: true },
];

export default function Header() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  // Raw data behind notificationCount -- kept around (not just the
  // tally) so the bell's own dropdown can render actual rows instead of
  // re-fetching everything again on open.
  const [connections, setConnections] = useState<Connection[]>([]);
  const [goalAssignments, setGoalAssignments] = useState<GoalAssignment[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [postActivity, setPostActivity] = useState<PostActivityNotification[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  // Entries clicked from the bell dropdown this session, hidden from it
  // immediately rather than waiting on a refetch round-trip -- for the
  // four bucket types with a real seen_at (mentions, post activity,
  // resolved connections/assignments, canceled-for-recipient) the click
  // also calls the matching mark-seen RPC, so the dismissal is real and
  // persists; for the three still-pending/actionable buckets (a
  // connection request, a received/sent goal assignment awaiting a
  // decision) there's no "seen" concept to persist -- those stay on
  // Dashboard and in the badge count until actually resolved, this only
  // stops the dropdown itself from re-showing something already looked at.
  const [dismissedEntryIds, setDismissedEntryIds] = useState<Set<string>>(new Set());
  const moreRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
      // Signed-out visitors always see dark by default — reset here rather
      // than leaving whatever this account had chosen.
      setTheme("dark");
      // A full reload (not router.push) so the fresh page load reads the
      // now-cleared session from scratch — client-side navigation right
      // after signOut() could still see the stale in-memory session for a
      // moment and bounce back to the dashboard, which is what made logout
      // look like it "didn't work" until a second click.
      window.location.href = "/";
    } catch (error) {
      console.error("Logout error:", error);
      setLoggingOut(false);
    }
  }

  useEffect(() => {
    async function loadUser() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user) {
          setUser(session.user);
          consumePendingReferral().catch(() => {});

          try {
            const p = await getOrCreateProfile();
            setProfile(p);
            applyAccountTheme(p);
          } catch {
            // ignore if profile fails
          }
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (error) {
        console.error("Error loading user:", error);
      } finally {
        setLoading(false);
      }
    }

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        consumePendingReferral().catch(() => {});
        getOrCreateProfile()
          .then((p) => {
            setProfile(p);
            applyAccountTheme(p);
          })
          .catch(() => {});
      } else {
        setUser(null);
        setProfile(null);
      }
    });

    const unsubscribePoints = onPointsUpdated(() => {
      getOrCreateProfile()
        .then((p) => setProfile(p))
        .catch(() => {});
    });

    return () => {
      subscription.unsubscribe();
      unsubscribePoints();
    };
  }, []);

  // Any navigation (desktop link or mobile dropdown link) closes the
  // mobile dropdown, so it never stays open across a page change.
  useEffect(() => {
    setMenuOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  // The header stays mounted across client-side navigation (it lives in
  // the root layout, not per-page), so its notification count needs its
  // own refresh triggers rather than a plain mount-only fetch: the
  // notificationsBus event (fired by whatever action actually changed a
  // count — Social/Today/Tomorrow/Dashboard) is the primary one, and a
  // refetch on every pathname change is a cheap safety net for any action
  // this session didn't get around to wiring up explicitly.
  function refreshNotificationCount() {
    if (!user) return;
    Promise.all([
      listConnections(),
      getMyGoalAssignments(),
      getMyMentions().catch(() => []),
      getMyPostActivityNotifications().catch(() => []),
    ])
      .then(([conns, assignments, newMentions, newPostActivity]) => {
        setConnections(conns);
        setGoalAssignments(assignments);
        setMentions(newMentions);
        setPostActivity(newPostActivity);
        setNotificationCount(countNotifications(conns, assignments, newMentions, newPostActivity));
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (!user) {
      setNotificationCount(0);
      return;
    }
    refreshNotificationCount();
    return onNotificationsUpdated(refreshNotificationCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    refreshNotificationCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // The "More" panel floats over the page rather than pushing content down
  // (unlike the full-width mobile dropdown), so it needs an explicit
  // click-outside to close — otherwise it'd stay open until another nav
  // link was clicked.
  useEffect(() => {
    if (!moreOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [moreOpen]);

  // Same click-outside treatment as the More panel above.
  useEffect(() => {
    if (!bellOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [bellOpen]);

  // Closes the bell dropdown on route change -- without this, navigating
  // via one of its own rows would leave it rendered (just invisible
  // behind the new page) until the next outside click.
  useEffect(() => {
    setBellOpen(false);
  }, [pathname]);

  type NotificationEntry = {
    id: string;
    label: string;
    sublabel?: string;
    href: string;
    // null for the three still-pending/actionable buckets, which have no
    // seen_at to persist -- see the dismissedEntryIds comment above.
    markSeen: (() => Promise<void>) | null;
  };

  // Flattens the same eight "needs your attention" buckets Dashboard's
  // PendingNotifications renders into one read-only, click-to-jump list
  // for the bell dropdown -- no accept/decline/acknowledge actions here
  // (that stays Dashboard's job), just "what's new" + where to see it.
  // Clicking a row still acknowledges it (see handleEntryClick below),
  // it just does so via the same mark-seen RPC Dashboard's "Got it"
  // button calls, not a dedicated dropdown action.
  function buildNotificationEntries(): NotificationEntry[] {
    const {
      pendingConnections,
      pendingAssignments,
      pendingAssignedByYou,
      resolvedConnections,
      resolvedAssignments,
      canceledForRecipient,
      unseenMentions,
      unseenPostActivity,
    } = computeNotificationBuckets(connections, goalAssignments, mentions, postActivity);

    const entries: NotificationEntry[] = [];

    pendingConnections.forEach((c) =>
      entries.push({
        id: `pconn-${c.id}`,
        label: connectionDisplayName(c, t),
        sublabel: t("dashboard.connectionRequestLabel"),
        href: "/standup/social?tab=friends",
        markSeen: null,
      })
    );
    pendingAssignments.forEach((a) =>
      entries.push({
        id: `pasg-${a.id}`,
        label: a.snapshotTitle,
        sublabel: t("social.assignedByLabel", { name: a.assignerDisplayName ?? t("social.anonymousUser") }),
        href: "/standup/assignments",
        markSeen: null,
      })
    );
    pendingAssignedByYou.forEach((a) =>
      entries.push({
        id: `pasgby-${a.id}`,
        label: a.snapshotTitle,
        sublabel: t("dashboard.assignmentWaitingStatus", { name: a.recipientDisplayName ?? t("social.anonymousUser") }),
        href: "/standup/assignments",
        markSeen: null,
      })
    );
    resolvedConnections.forEach((c) =>
      entries.push({
        id: `rconn-${c.id}`,
        label: connectionDisplayName(c, t),
        sublabel: c.status === "accepted" ? t("dashboard.connectionAcceptedStatus") : t("dashboard.connectionDeclinedStatus"),
        href: "/standup/social?tab=friends",
        markSeen: () => markConnectionSeen(c.id),
      })
    );
    resolvedAssignments.forEach((a) =>
      entries.push({
        id: `rasg-${a.id}`,
        label: a.snapshotTitle,
        sublabel: t("social.assignedToLabel", { name: a.recipientDisplayName ?? t("social.anonymousUser") }),
        href: "/standup/assignments",
        markSeen: () => markGoalAssignmentSeen(a.id),
      })
    );
    canceledForRecipient.forEach((a) =>
      entries.push({
        id: `casg-${a.id}`,
        label: a.snapshotTitle,
        sublabel: t("dashboard.assignmentCanceledForYouLabel", { name: a.assignerDisplayName ?? t("social.anonymousUser") }),
        href: "/standup/assignments",
        markSeen: () => markGoalAssignmentSeenByRecipient(a.id),
      })
    );
    unseenMentions.forEach((m) =>
      entries.push({
        id: `men-${m.id}`,
        label: t("dashboard.mentionLabel", { name: m.mentionedByDisplayName ?? t("social.anonymousUser") }),
        sublabel: m.preview ?? undefined,
        href: `/standup/social?tab=myFeed&post=${m.postId}${m.commentId ? `&comment=${m.commentId}` : ""}`,
        markSeen: () => markMentionSeen(m.id),
      })
    );
    unseenPostActivity.forEach((p) => {
      const labelKey: TranslationKey =
        p.activityType === "comment"
          ? "dashboard.postCommentLabel"
          : p.activityType === "reply"
          ? "dashboard.postReplyLabel"
          : p.activityType === "post_reaction"
          ? "dashboard.postReactionLabel"
          : "dashboard.commentReactionLabel";
      entries.push({
        id: `pa-${p.id}`,
        label: t(labelKey, { name: p.actorDisplayName ?? t("social.anonymousUser") }),
        sublabel: p.preview ?? undefined,
        href: `/standup/social?tab=myFeed&post=${p.postId}${p.commentId ? `&comment=${p.commentId}` : ""}`,
        markSeen: () => markPostActivityNotificationSeen(p.id),
      });
    });

    return entries;
  }

  // Clicking a row acknowledges it immediately (hidden from this
  // dropdown right away, not waiting on a refetch) and, for the four
  // bucket types that have one, persists that via the real mark-seen
  // RPC -- the same action Dashboard's "Got it" button performs, just
  // triggered by following the link instead of a dedicated button.
  function handleEntryClick(entry: NotificationEntry) {
    setDismissedEntryIds((prev) => new Set(prev).add(entry.id));
    setBellOpen(false);
    if (entry.markSeen) {
      entry
        .markSeen()
        .then(() => {
          notifyNotificationsUpdated();
        })
        .catch(() => {
          // Best-effort -- worst case it just reappears next refresh,
          // same fallback every other mark-seen call site in this app
          // already accepts.
        });
    }
  }

  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const isRecoveryPage = pathname === "/reset-password";

  // Rendered once for the desktop row and once for the mobile dropdown, so
  // the active-page logic lives in one place instead of being duplicated
  // across two layouts. The About/FAQ/Contact rotation exists to save
  // horizontal space in the desktop row — the mobile dropdown is a vertical
  // stack with room to spare, so `expanded` renders all three as separate
  // links there instead of the single rotating slot.
  function infoLinks(expanded: boolean) {
    if (!expanded) {
      return (
        <Link
          href={INFO_ROTATION[pathname]?.href ?? "/about"}
          className={INFO_PAGES.includes(pathname) ? "nav-link font-semibold" : "nav-link"}
        >
          {t(INFO_ROTATION[pathname]?.labelKey ?? "nav.about")}
        </Link>
      );
    }

    return (
      <>
        <Link href="/about" className={pathname === "/about" ? "nav-link font-semibold" : "nav-link"}>
          {t("nav.about")}
        </Link>
        <Link href="/faq" className={pathname === "/faq" ? "nav-link font-semibold" : "nav-link"}>
          {t("nav.faq")}
        </Link>
        <Link href="/contact" className={pathname === "/contact" ? "nav-link font-semibold" : "nav-link"}>
          {t("nav.contact")}
        </Link>
      </>
    );
  }

  // Logged-out visitors never see NAV_TABS (none of those six routes are
  // reachable without an account) — this is what used to be primaryLinks'
  // other branch, kept as its own small function now that the
  // authenticated case moved to navTabs() below.
  function authLinks() {
    if (loading || user || isAuthPage) return null;
    return (
      <>
        <Link
          href="/login"
          className={pathname === "/login" ? "nav-link nav-link-auth font-semibold" : "nav-link nav-link-auth"}
        >
          {t("nav.signIn")}
        </Link>
        <Link
          href="/signup"
          className={pathname === "/signup" ? "nav-link nav-link-auth font-semibold" : "nav-link nav-link-auth"}
        >
          {t("nav.signUp")}
        </Link>
      </>
    );
  }

  // The hanging tab row below the main header — same folder-tab theme as
  // Social/Tools (see .folder-tab-hanging* in globals.css), inverted to
  // hang down and merge upward into the header instead of down into a
  // content panel. Lives inside the same sticky <header>, so it scrolls
  // with it automatically rather than needing its own sticky offset.
  function navTabs() {
    if (!user) return null;
    const isInfoPage = INFO_PAGES.includes(pathname);
    return (
      <nav className="folder-tabbar-hanging" aria-label={t("nav.dashboard")}>
        {NAV_TABS.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={`folder-tab-hanging${tab.infoGroup ? " folder-tab-hanging-info-individual" : ""}${isActive ? " folder-tab-hanging-active" : ""}`}
              style={{ "--tab-color": tab.color } as React.CSSProperties}
            >
              <tab.icon size={15} />
              <span>{t(tab.labelKey)}</span>
            </Link>
          );
        })}
        {/* Mobile-only combined stand-in for the three infoGroup tabs
            above (hidden there via CSS, see .folder-tab-hanging-info-*).
            Reuses INFO_ROTATION so tapping it always goes to whichever
            of About/FAQ/Contact isn't the current page, same link-to-
            the-next-one behavior infoLinks() already has for logged-out
            visitors. */}
        <Link
          href={INFO_ROTATION[pathname]?.href ?? "/about"}
          aria-current={isInfoPage ? "page" : undefined}
          className={`folder-tab-hanging folder-tab-hanging-info-combined${isInfoPage ? " folder-tab-hanging-active" : ""}`}
          style={{ "--tab-color": "#94a3b8" } as React.CSSProperties}
        >
          <Info size={15} />
          <span>{t("nav.about")}</span>
        </Link>
      </nav>
    );
  }

  // For a logged-in user there's nothing left here but Theme/Language —
  // every nav destination (including About/FAQ/Contact, which used to
  // live in this panel via infoLinks) now lives in navTabs() instead.
  // Logged-out visitors don't get navTabs() at all (none of those routes
  // work without an account), so they still get infoLinks() here, same
  // as before this change.
  function secondaryLinks(expanded: boolean) {
    if (loading) return null;

    if (user) {
      return (
        <div className="flex items-center gap-2 px-3 py-1.5">
          <ThemeToggle size="sm" />
          <LanguageToggle size="sm" />
        </div>
      );
    }

    return infoLinks(expanded);
  }

  // Always visible regardless of breakpoint, right next to the
  // notification bell — this used to be the sole way to reach Profile on
  // desktop before it got folded into secondaryLinks/the More panel;
  // moved back out since losing the name inline was a regression.
  function profileLink() {
    if (!user) return null;
    return (
      <Link
        href="/standup/profile"
        className={
          pathname === "/standup/profile"
            ? "nav-link nav-profile font-semibold flex items-center gap-2"
            : "nav-link nav-profile flex items-center gap-2"
        }
      >
        <Avatar avatarUrl={profile?.avatar_url} label={profile?.display_name || user.email || "U"} size={22} />
        {profile?.display_name || user.email?.split("@")[0] || t("common.user")}
      </Link>
    );
  }

  function avatar() {
    if (!user) return null;
    return (
      <Link href="/standup/profile" aria-label={t("nav.profileAriaLabel")}>
        <Avatar avatarUrl={profile?.avatar_url} label={profile?.display_name || user.email || "U"} />
      </Link>
    );
  }

  // Always visible regardless of breakpoint (unlike the primary/secondary
  // split) — a pending-notification indicator is exactly the kind of thing
  // that shouldn't disappear into a menu. Rendered right next to
  // profileLink()/avatar() now rather than in the utility cluster —
  // explicit user call.
  //
  // Desktop click opens an attached dropdown listing the actual
  // notifications (buildNotificationEntries() above) — explicit user
  // call, each row links straight to the goal/post/comment it's about.
  // Mobile keeps the old plain Link-to-Dashboard behavior instead of also
  // getting the dropdown: Dashboard's PendingNotifications already shows
  // the identical list (plus Accept/Decline/Got it, which this read-only
  // dropdown deliberately doesn't have), and a floating panel has much
  // less room to work with on a phone-width header.
  function notificationBell(variant: "desktop" | "mobile") {
    if (!user) return null;
    if (variant === "mobile") {
      return (
        <Link href="/standup/dashboard" className="nav-bell-btn" aria-label={t("nav.notificationsAriaLabel")}>
          <Bell size={18} />
          {notificationCount > 0 && (
            <span className="nav-bell-badge">{notificationCount > 9 ? "9+" : notificationCount}</span>
          )}
        </Link>
      );
    }
    const entries = bellOpen ? buildNotificationEntries().filter((e) => !dismissedEntryIds.has(e.id)) : [];
    return (
      <div className="nav-bell-wrap" ref={bellRef}>
        <button
          type="button"
          className="nav-bell-btn"
          aria-label={bellOpen ? t("nav.closeMenu") : t("nav.notificationsAriaLabel")}
          aria-expanded={bellOpen}
          onClick={() => {
            setBellOpen((v) => !v);
            setMoreOpen(false);
          }}
        >
          <Bell size={18} />
          {notificationCount > 0 && (
            <span className="nav-bell-badge">{notificationCount > 9 ? "9+" : notificationCount}</span>
          )}
        </button>
        {bellOpen && (
          <div className="nav-bell-panel">
            <div className="nav-bell-panel-title">{t("dashboard.notificationsTitle")}</div>
            {entries.length === 0 ? (
              <div className="nav-bell-empty">{t("nav.noNotifications")}</div>
            ) : (
              <div className="nav-bell-list">
                {entries.map((entry) => (
                  <Link key={entry.id} href={entry.href} className="nav-bell-row" onClick={() => handleEntryClick(entry)}>
                    <div className="min-w-0">
                      <div className="nav-bell-row-label">{entry.label}</div>
                      {entry.sublabel && <div className="nav-bell-row-sublabel">{entry.sublabel}</div>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
            <Link href="/standup/dashboard" className="nav-bell-view-all" onClick={() => setBellOpen(false)}>
              {t("nav.viewAllNotifications")}
            </Link>
          </div>
        )}
      </div>
    );
  }

  // Assignments used to need its own persistent shortcut here because the
  // Calendar/Backlog rotation made it too easy to miss entirely — it's now
  // just another NAV_TABS tab, so that workaround is gone too.

  if (isRecoveryPage) {
    return (
      <header className="app-header">
        <div className="app-header-inner">
          <Link href={user ? "/standup/dashboard" : "/"} className="brand flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="w-5 h-5 rounded-sm flex-shrink-0" />
            StandUp
          </Link>
        </div>
      </header>
    );
  }

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href={user ? "/standup/dashboard" : "/"} className="brand flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="w-5 h-5 rounded-sm flex-shrink-0" />
          StandUp
        </Link>

        {/* Logged-out only — Sign In/Sign Up. Logged-in users get the same
            destinations via navTabs()'s hanging row below instead. */}
        {authLinks()}

        {/* Bell + More(⋯) + Profile grouped together at the very end of
            the row, all three right next to each other, flush against one
            another with no daylight between the cluster and the profile
            chip — explicit user call. A shared wrapper (.nav-end-cluster)
            is what makes this actually attached: as two separate
            .app-header-inner children, space-between spaced the cluster
            and profileLink() apart like any other two items in the row
            instead of treating them as one unit. Hidden on true mobile,
            same as before this whole restructure, where nav-mobile-
            trigger's compact bell + avatar-only icons take over instead
            (a name label doesn't fit a phone-width row next to the
            hamburger, and the hamburger itself takes over More's
            "everything else" role there). */}
        <div className="nav-end-cluster">
          <div className="nav-utility-cluster nav-utility-cluster-desktop">
            {notificationBell("desktop")}

            {/* Secondary links (Theme/Language for a logged-in user; About/
                FAQ/Contact too for a logged-out one, who never sees
                navTabs()) live behind this button rather than inline. */}
            <div className="nav-more-wrap" ref={moreRef}>
              <button
                type="button"
                className="nav-more-btn"
                aria-label={moreOpen ? t("nav.closeMenu") : t("nav.openMenu")}
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
              >
                <MoreHorizontal size={18} />
              </button>
              {moreOpen && (
                <div className="nav-more-panel">
                  {secondaryLinks(true)}
                  {user && (
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={loggingOut}
                      className="nav-link nav-link-logout"
                    >
                      {loggingOut ? t("nav.loggingOut") : t("nav.logout")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          {profileLink()}
        </div>

        {/* Mobile: logo stays on the left (above); hamburger/bell/avatar
            live here, bell placed directly next to avatar (mirroring the
            desktop bell-next-to-Profile grouping) rather than next to the
            hamburger. Assignments no longer needs its own icon here —
            it's a navTabs() tab now, visible at every breakpoint already.
            Secondary links (Theme/Language, Logout, and About/FAQ/Contact
            for a logged-out visitor) live in the full-width dropdown
            panel below. Hidden above the mobile breakpoint — see
            .nav-mobile-trigger. */}
        <div className="nav-mobile-trigger">
          <button
            type="button"
            className="hamburger-btn"
            aria-label={menuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="hamburger-line" />
            <span className="hamburger-line" />
            <span className="hamburger-line" />
          </button>
          {notificationBell("mobile")}
          {!loading && avatar()}
        </div>
      </div>

      {navTabs()}

      {menuOpen && (
        <div className="mobile-menu-panel">
          {secondaryLinks(true)}
          {user && (
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="nav-link nav-link-logout"
            >
              {loggingOut ? t("nav.loggingOut") : t("nav.logout")}
            </button>
          )}
        </div>
      )}
    </header>
  );
}
