"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function Header() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
      <Link href="/" className="text-lg font-semibold">
        StandUp
      </Link>

      <nav className="flex items-center gap-6 text-sm">
        {user ? (
          <>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/standup/today">Today</Link>
            <Link href="/goals/tomorrow">Tomorrow</Link>
            <button
              onClick={logout}
              className="border px-3 py-1 rounded hover:bg-white hover:text-black transition"
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link href="/login">Sign in</Link>
            <Link
              href="/signup"
              className="border px-3 py-1 rounded hover:bg-white hover:text-black transition"
            >
              Sign up
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
