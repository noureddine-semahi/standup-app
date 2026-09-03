"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile, type Profile } from "@/lib/supabase/db";
import { onPointsUpdated } from "@/lib/pointsBus";
import AnimatedNumber from "@/components/AnimatedNumber";

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
        <Link href={user ? "/standup/dashboard" : "/"} className="brand">
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
              <Link
                href="/about"
                className={pathname === "/about" ? "nav-link font-semibold" : "nav-link"}
              >
                About
              </Link>
              <Link
                href="/faq"
                className={pathname === "/faq" ? "nav-link font-semibold" : "nav-link"}
              >
                FAQ
              </Link>
              <Link
                href="/contact"
                className={pathname === "/contact" ? "nav-link font-semibold" : "nav-link"}
              >
                Contact
              </Link>
              <Link
                href="/standup/profile"
                className={pathname === "/standup/profile" ? "nav-link font-semibold" : "nav-link"}
              >
                {profile?.display_name || user.email?.split("@")[0] || "User"}
                {profile && (
                  <>
                    {" · "}
                    <AnimatedNumber value={profile.points} /> pts
                  </>
                )}
              </Link>
            </>
          ) : (
            <>
              {/* Logged out: About, FAQ, Contact, Sign In, Sign Up */}
              <Link href="/about" className="nav-link">
                About
              </Link>
              <Link href="/faq" className="nav-link">
                FAQ
              </Link>
              <Link href="/contact" className="nav-link">
                Contact
              </Link>

              {!isAuthPage && (
                <>
                  <Link href="/login" className="btn btn-ghost">
                    Sign In
                  </Link>
                  <Link href="/signup" className="btn btn-primary">
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
