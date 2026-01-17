"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/Providers";

export default function Header() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isAuthed = !!user;
  const onAuthPage = pathname === "/login" || pathname === "/signup";

  async function handleLogout() {
    await signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" className="brand">
          StandUp
        </Link>

        <nav className="nav">
          {!mounted || loading ? null : isAuthed ? (
            <>
              <Link className="nav-link" href="/dashboard">
                Dashboard
              </Link>
              <Link className="nav-link" href="/standup/today">
                Today
              </Link>
              <Link className="nav-link" href="/goals/tomorrow">
                Tomorrow
              </Link>
              <button className="btn btn-ghost" onClick={handleLogout}>
                Log out
              </button>
            </>
          ) : (
            !onAuthPage && (
              <>
                <Link className="nav-link" href="/login">
                  Sign in
                </Link>
                <Link className="btn btn-primary" href="/signup">
                  Sign up
                </Link>
              </>
            )
          )}
        </nav>
      </div>
    </header>
  );
}
