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
  type Profile,
  type Connection,
  type GoalAssignment,
} from "@/lib/supabase/db";
import { onPointsUpdated } from "@/lib/pointsBus";
import { onNotificationsUpdated } from "@/lib/notificationsBus";
import { countNotifications } from "@/lib/notificationBuckets";
import { getStoredTheme, setTheme } from "@/lib/theme";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import Avatar from "@/components/Avatar";
import { MoreHorizontal, Bell, ClipboardList, LayoutDashboard, Users, CheckCircle2, Sun, Calendar, Wrench } from "lucide-react";
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

// One nav slot cycles through these three instead of showing all of them at
// once: on each page, the button shows the NEXT one in the loop and links
// there. Off all three (Dashboard, Today, etc.), it defaults to "About".
const INFO_ROTATION: Record<string, { labelKey: TranslationKey; href: string }> = {
  "/about": { labelKey: "nav.faq", href: "/faq" },
  "/faq": { labelKey: "nav.contact", href: "/contact" },
  "/contact": { labelKey: "nav.about", href: "/about" },
};
const INFO_PAGES = Object.keys(INFO_ROTATION);

// The six primary destinations — previously squeezed into one inline row
// next to the logo (Calendar/Tools sharing a rotating slot to save width,
// see the git history for CALENDAR_ROTATION). Now a dedicated hanging tab
// row below the header (navTabs() below) with room for all six as their
// own tab, each with its own accent color, same folder-tab theme as
// Social/Tools' own tab bars but inverted (hangs down, rounded-bottom,
// merges upward into the header instead of downward into a content
// panel) — explicit user call, applies to every breakpoint (icon-only
// below 640px, same as the other two folder-tab bars).
const NAV_TABS: { href: string; labelKey: TranslationKey; icon: typeof LayoutDashboard; color: string }[] = [
  { href: "/standup/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, color: "#60a5fa" },
  { href: "/standup/social", labelKey: "nav.social", icon: Users, color: "#a78bfa" },
  { href: "/standup/today", labelKey: "nav.reviewToday", icon: CheckCircle2, color: "#34d399" },
  { href: "/standup/tomorrow", labelKey: "nav.planTomorrow", icon: Sun, color: "#f59e0b" },
  { href: "/standup/calendar", labelKey: "nav.calendar", icon: Calendar, color: "#22d3ee" },
  { href: "/standup/tools", labelKey: "nav.tools", icon: Wrench, color: "#f43f5e" },
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
  const moreRef = useRef<HTMLDivElement>(null);

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
    Promise.all([listConnections(), getMyGoalAssignments(), getMyMentions().catch(() => [])])
      .then(([conns, assignments, mentions]) =>
        setNotificationCount(countNotifications(conns, assignments, mentions))
      )
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
        <Link href="/login" className={pathname === "/login" ? "nav-link font-semibold" : "nav-link"}>
          {t("nav.signIn")}
        </Link>
        <Link href="/signup" className={pathname === "/signup" ? "nav-link font-semibold" : "nav-link"}>
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
    return (
      <nav className="folder-tabbar-hanging" aria-label={t("nav.dashboard")}>
        {NAV_TABS.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={`folder-tab-hanging${isActive ? " folder-tab-hanging-active" : ""}`}
              style={{ "--tab-color": tab.color } as React.CSSProperties}
            >
              <tab.icon size={15} />
              <span>{t(tab.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  // Everything besides the six NAV_TABS destinations, the always-visible
  // bell, and the always-visible Profile chip (About/FAQ/Contact plus the
  // Theme/Language toggles) — behind the More button/panel on desktop, or
  // the mobile hamburger's dropdown — rather than competing with them for
  // header space.
  function secondaryLinks(expanded: boolean) {
    if (loading) return null;

    if (user) {
      return (
        <>
          {infoLinks(expanded)}
          {/* Profile itself is always visible now (see profileLink below)
              — this is just the settings row that used to live tucked
              inside the Profile chip in the expanded dropdown. */}
          <div className="flex items-center gap-2 px-3 py-1.5">
            <ThemeToggle size="sm" />
            <LanguageToggle size="sm" />
          </div>
        </>
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
  // that shouldn't disappear into a menu. Links straight to the Dashboard,
  // where PendingNotifications (the same five buckets, via
  // notificationBuckets.ts) actually lives, rather than duplicating that
  // list in a header dropdown.
  function notificationBell() {
    if (!user) return null;
    return (
      <Link href="/standup/dashboard" className="nav-bell-btn" aria-label={t("nav.notificationsAriaLabel")}>
        <Bell size={18} />
        {notificationCount > 0 && (
          <span className="nav-bell-badge">{notificationCount > 9 ? "9+" : notificationCount}</span>
        )}
      </Link>
    );
  }

  // Always visible next to the bell, same reasoning: Assignments used to
  // only be reachable via the Calendar/Backlog rotation (see above) or
  // Social's Goals tab, and a user reported genuinely not being able to
  // find it. Reuses .nav-bell-btn's plain icon-button styling rather than
  // introducing a new class for one more icon of the same shape.
  function assignmentsShortcut() {
    if (!user) return null;
    return (
      <Link
        href="/standup/assignments"
        className="nav-bell-btn"
        aria-label={t("nav.assignments")}
        style={
          pathname === "/standup/assignments"
            ? { borderColor: "rgba(245, 158, 11, 0.4)", color: "rgb(252, 211, 77)" }
            : undefined
        }
      >
        <ClipboardList size={18} />
      </Link>
    );
  }

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

        {/* Assignments shortcut + Bell + More button grouped tightly
            together (their own small gap, not the header's wider one) so
            they read as one utility cluster on desktop. Hidden entirely on
            true mobile — the same icons re-appear there instead grouped
            with the hamburger/avatar in nav-mobile-trigger below, since a
            name-less icon row fits a phone-width row better than floating
            on its own mid-header. */}
        <div className="nav-utility-cluster nav-utility-cluster-desktop">
          {assignmentsShortcut()}
          {notificationBell()}

          {/* Secondary links (About/FAQ/Contact, Theme/Language) live
              behind this button rather than inline, so only five items
              ever compete with the logo for space. */}
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

        {/* Profile (avatar + name) — the rightmost item in the row, past
            the bell/Assignments/More cluster. Hidden on true mobile, same
            as before this whole restructure, where nav-mobile-trigger's
            compact avatar-only icon takes over instead (a name label
            doesn't fit a phone-width row next to the hamburger). */}
        {profileLink()}

        {/* Mobile: logo stays on the left (above); Assignments/bell/
            hamburger/avatar live here, avatar last so it's the rightmost
            item, same as profileLink() above on desktop. Secondary links
            (About/FAQ/Contact, Theme/Language, Logout) live in the
            full-width dropdown panel below — the six primary destinations
            don't, since navTabs()'s hanging row is already visible at
            every breakpoint. Hidden above the mobile breakpoint — see
            .nav-mobile-trigger. */}
        <div className="nav-mobile-trigger">
          {assignmentsShortcut()}
          {notificationBell()}
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
