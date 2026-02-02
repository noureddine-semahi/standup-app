"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile, type Profile } from "@/lib/supabase/db";

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

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

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);

    try {
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      router.push("/");
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setLoggingOut(false);
      setShowUserMenu(false);
    }
  }

  const isAuthPage = pathname === "/login" || pathname === "/signup";

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href={user ? "/standup/dashboard" : "/"} className="brand">
          StandUp
        </Link>

        <nav className="nav">
          {loading ? (
            <div className="text-sm text-white/50">...</div>
          ) : user ? (
            <>
              {/* Logged in: Dashboard, Review Today, Plan Tomorrow, Calendar, About */}
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

              {/* User menu */}
              <div className="relative ml-3">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 hover:bg-white/10 transition"
                >
                  <div className="text-sm text-white/90">
                    {profile?.display_name || user.email?.split("@")[0] || "User"}
                  </div>
                  {profile && (
                    <div className="text-xs text-white/60 font-semibold">
                      {profile.points} pts
                    </div>
                  )}
                  <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showUserMenu && (
                  <>
                    {/* Click-away overlay */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowUserMenu(false)}
                    />
                    
                    {/* Dropdown menu */}
                    <div className="absolute right-0 mt-2 w-56 z-50 rounded-2xl border border-white/10 bg-black/95 backdrop-blur-xl shadow-xl">
                      <div className="p-4 border-b border-white/10">
                        <div className="text-sm font-medium text-white">
                          {profile?.display_name || "User"}
                        </div>
                        <div className="text-xs text-white/60 mt-1">
                          {user.email}
                        </div>
                        {profile && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="text-xs text-white/50">Points:</div>
                            <div className="text-sm font-semibold text-white">
                              {profile.points}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="p-2">
                        <button
                          onClick={handleLogout}
                          disabled={loggingOut}
                          className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/10 rounded-lg transition"
                        >
                          {loggingOut ? "Logging out..." : "Logout"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Logged out: About, Sign In, Sign Up */}
              <Link href="/about" className="nav-link">
                About
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