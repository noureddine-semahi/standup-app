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
import { MoreHorizontal, Bell } from "lucide-react";
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

// Same space-saving trick as the About/FAQ/Contact rotation above, applied
// to Calendar/Backlog — a two-page loop, so each just links straight to
// the other.
const CALENDAR_ROTATION: Record<string, { labelKey: TranslationKey; href: string }> = {
  "/standup/calendar": { labelKey: "nav.backlog", href: "/standup/backlog" },
  "/standup/backlog": { labelKey: "nav.calendar", href: "/standup/calendar" },
};
const CALENDAR_PAGES = Object.keys(CALENDAR_ROTATION);

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
    Promise.all([listConnections(), getMyGoalAssignments()])
      .then(([conns, assignments]: [Connection[], GoalAssignment[]]) =>
        setNotificationCount(countNotifications(conns, assignments))
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

  function calendarLinks(expanded: boolean) {
    if (!expanded) {
      return (
        <Link
          href={CALENDAR_ROTATION[pathname]?.href ?? "/standup/calendar"}
          className={CALENDAR_PAGES.includes(pathname) ? "nav-link font-semibold" : "nav-link"}
        >
          {t(CALENDAR_ROTATION[pathname]?.labelKey ?? "nav.calendar")}
        </Link>
      );
    }

    return (
      <>
        <Link
          href="/standup/calendar"
          className={pathname === "/standup/calendar" ? "nav-link font-semibold" : "nav-link"}
        >
          {t("nav.calendar")}
        </Link>
        <Link
          href="/standup/backlog"
          className={pathname === "/standup/backlog" ? "nav-link font-semibold" : "nav-link"}
        >
          {t("nav.backlog")}
        </Link>
      </>
    );
  }

  // The five primary, daily-use destinations — always visible inline
  // whenever there's room for the logo plus these (see .nav-primary),
  // never tucked behind the More button. Calendar/Backlog share one
  // rotating slot (calendarLinks) rather than two separate links, to
  // keep this row's width in check. Everything else (About/FAQ/Contact,
  // Profile) lives in secondaryLinks below.
  function primaryLinks(expanded = false) {
    if (loading) return <div className="text-sm text-white/50">...</div>;

    if (user) {
      return (
        <>
          <Link
            href="/standup/dashboard"
            className={pathname === "/standup/dashboard" ? "nav-link font-semibold" : "nav-link"}
          >
            {t("nav.dashboard")}
          </Link>
          <Link
            href="/standup/social"
            className={pathname === "/standup/social" ? "nav-link font-semibold" : "nav-link"}
          >
            {t("nav.social")}
          </Link>
          <Link
            href="/standup/today"
            className={pathname === "/standup/today" ? "nav-link font-semibold" : "nav-link"}
          >
            {t("nav.reviewToday")}
          </Link>
          <Link
            href="/standup/tomorrow"
            className={pathname === "/standup/tomorrow" ? "nav-link font-semibold" : "nav-link"}
          >
            {t("nav.planTomorrow")}
          </Link>
          {calendarLinks(expanded)}
        </>
      );
    }

    if (isAuthPage) return null;

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

  // Everything besides the five primary links, the always-visible bell,
  // and the always-visible Profile chip (About/FAQ/Contact plus the
  // Theme/Language toggles) — behind the More button/panel (or, on true
  // mobile, folded into the one full dropdown alongside primaryLinks)
  // rather than competing with them for header space.
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

        {/* Primary row: the five daily-use links, always visible whenever
            there's room for the logo plus these — see .nav-primary. */}
        <nav className="nav nav-primary">{primaryLinks()}</nav>

        {/* Profile (avatar + name) sits before the bell/More cluster
            whenever nav-primary has room — hidden on true mobile, same as
            before this whole restructure, where nav-mobile-trigger's
            compact avatar-only icon takes over instead (a name label
            doesn't fit a phone-width row next to the hamburger). */}
        {profileLink()}

        {/* Bell + More button grouped tightly together (their own small
            gap, not the header's wider one) so they read as one utility
            cluster — bell is always visible regardless of breakpoint,
            alongside whichever of nav-primary/nav-mobile-trigger is
            currently shown; the More button is hidden on true mobile
            alongside nav-primary (see .nav-more-wrap). */}
        <div className="nav-utility-cluster">
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

        {/* Mobile: logo stays on the left (above), avatar + hamburger stay
            visible here, and every link (primary and secondary) lives in
            the full-width dropdown panel below. Hidden above the mobile
            breakpoint — see .nav-mobile-trigger. */}
        <div className="nav-mobile-trigger">
          {!loading && avatar()}
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
        </div>
      </div>

      {menuOpen && (
        <div className="mobile-menu-panel">
          {primaryLinks(true)}
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
