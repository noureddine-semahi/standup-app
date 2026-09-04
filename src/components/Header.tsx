"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile, updateThemePreference, consumePendingReferral, type Profile } from "@/lib/supabase/db";
import { onPointsUpdated } from "@/lib/pointsBus";
import { getStoredTheme, setTheme } from "@/lib/theme";

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
const INFO_ROTATION: Record<string, { label: string; href: string }> = {
  "/about": { label: "FAQ", href: "/faq" },
  "/faq": { label: "Contact", href: "/contact" },
  "/contact": { label: "About", href: "/about" },
};
const INFO_PAGES = Object.keys(INFO_ROTATION);

export default function Header() {
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

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
  }, [pathname]);

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
          {INFO_ROTATION[pathname]?.label ?? "About"}
        </Link>
      );
    }

    return (
      <>
        <Link href="/about" className={pathname === "/about" ? "nav-link font-semibold" : "nav-link"}>
          About
        </Link>
        <Link href="/faq" className={pathname === "/faq" ? "nav-link font-semibold" : "nav-link"}>
          FAQ
        </Link>
        <Link href="/contact" className={pathname === "/contact" ? "nav-link font-semibold" : "nav-link"}>
          Contact
        </Link>
      </>
    );
  }

  function navLinks(expanded = false) {
    if (loading) return <div className="text-sm text-white/50">...</div>;

    if (user) {
      return (
        <>
          <Link
            href="/standup/dashboard"
            className={pathname === "/standup/dashboard" ? "nav-link font-semibold" : "nav-link"}
          >
            Dashboard
          </Link>
          <Link
            href="/standup/today"
            className={pathname === "/standup/today" ? "nav-link font-semibold" : "nav-link"}
          >
            Review Today
          </Link>
          <Link
            href="/standup/tomorrow"
            className={pathname === "/standup/tomorrow" ? "nav-link font-semibold" : "nav-link"}
          >
            Plan Tomorrow
          </Link>
          <Link
            href="/standup/calendar"
            className={pathname === "/standup/calendar" ? "nav-link font-semibold" : "nav-link"}
          >
            Calendar
          </Link>
          {infoLinks(expanded)}
          <Link
            href="/standup/profile"
            className={pathname === "/standup/profile" ? "nav-link font-semibold" : "nav-link"}
          >
            {profile?.display_name || user.email?.split("@")[0] || "User"}
          </Link>
        </>
      );
    }

    return (
      <>
        {infoLinks(expanded)}

        {!isAuthPage && (
          <>
            <Link href="/login" className={pathname === "/login" ? "nav-link font-semibold" : "nav-link"}>
              Sign In
            </Link>
            <Link href="/signup" className={pathname === "/signup" ? "nav-link font-semibold" : "nav-link"}>
              Sign Up
            </Link>
          </>
        )}
      </>
    );
  }

  function avatar() {
    if (!user) return null;
    return (
      <Link href="/standup/profile" aria-label="Profile" className="avatar-circle">
        {profile?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm font-bold text-white">
            {(profile?.display_name || user.email || "U").charAt(0).toUpperCase()}
          </div>
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

        {/* Desktop: full horizontal row, avatar included inline. Hidden on
            mobile — see .nav-desktop in globals.css. */}
        <nav className="nav nav-desktop">
          {navLinks()}
          {!loading && avatar()}
        </nav>

        {/* Mobile: logo stays on the left (above), avatar + hamburger stay
            visible here, and the rest of the links live in the dropdown
            panel below. Hidden on desktop — see .nav-mobile-trigger. */}
        <div className="nav-mobile-trigger">
          {!loading && avatar()}
          <button
            type="button"
            className="hamburger-btn"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
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
          {navLinks(true)}
          {user && (
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="nav-link nav-link-logout"
            >
              {loggingOut ? "Logging out…" : "Logout"}
            </button>
          )}
        </div>
      )}
    </header>
  );
}
