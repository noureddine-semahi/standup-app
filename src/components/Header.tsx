"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile, consumePendingReferral, type Profile } from "@/lib/supabase/db";
import { onPointsUpdated } from "@/lib/pointsBus";

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
          .then((p) => setProfile(p))
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

  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const isRecoveryPage = pathname === "/reset-password";

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href={user ? "/standup/dashboard" : "/"} className="brand flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="w-5 h-5 rounded-sm flex-shrink-0" />
          StandUp
        </Link>

        <nav className="nav">
          {isRecoveryPage ? null : loading ? (
            <div className="text-sm text-white/50">...</div>
          ) : user ? (
            <>
              {/* Logged in: Dashboard, Review Today, Plan Tomorrow, Calendar, About, FAQ, Contact */}
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
              {/* One rotating slot instead of three separate links — About,
                  FAQ, and Contact cycle through the same nav spot based on
                  which of the three you're currently on, so the header
                  doesn't need three fixed-width buttons just for these. */}
              <Link
                href={INFO_ROTATION[pathname]?.href ?? "/about"}
                className={INFO_PAGES.includes(pathname) ? "nav-link font-semibold" : "nav-link"}
              >
                {INFO_ROTATION[pathname]?.label ?? "About"}
              </Link>
              {/* Profile picture is its own element, separate from the
                  name button next to it — both link to the same place. */}
              <Link
                href="/standup/profile"
                className={pathname === "/standup/profile" ? "nav-link font-semibold" : "nav-link"}
              >
                {profile?.display_name || user.email?.split("@")[0] || "User"}
              </Link>
              <Link
                href="/standup/profile"
                aria-label="Profile"
                className="rounded-full overflow-hidden flex-shrink-0"
                style={{
                  width: "32px",
                  height: "32px",
                  background: "linear-gradient(135deg, var(--accent-purple), var(--accent-blue))",
                }}
              >
                {profile?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-sm font-bold text-white">
                    {(profile?.display_name || user.email || "U").charAt(0).toUpperCase()}
                  </div>
                )}
              </Link>
            </>
          ) : (
            <>
              {/* Logged out: rotating About/FAQ/Contact slot, Sign In, Sign Up */}
              <Link
                href={INFO_ROTATION[pathname]?.href ?? "/about"}
                className={INFO_PAGES.includes(pathname) ? "nav-link font-semibold" : "nav-link"}
              >
                {INFO_ROTATION[pathname]?.label ?? "About"}
              </Link>

              {!isAuthPage && (
                <>
                  <Link
                    href="/login"
                    className={pathname === "/login" ? "nav-link font-semibold" : "nav-link"}
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/signup"
                    className={pathname === "/signup" ? "nav-link font-semibold" : "nav-link"}
                  >
                    Sign Up
                  </Link>
                </>
              )}
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
