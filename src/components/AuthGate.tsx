"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    setError(null);

    (async () => {
      try {
        const { data, error: sessionErr } = await supabase.auth.getSession();
        if (!mounted) return;
        if (sessionErr) throw sessionErr;

        if (!data.session) {
          router.push("/login");
          return;
        }

        setReady(true);
      } catch (e: any) {
        // Without this, a failed/hung getSession() (network blip, stale
        // local auth token, Supabase outage) left the app stuck on the
        // spinner below forever, with zero feedback and no way to retry.
        if (!mounted) return;
        setError(e?.message ?? "Failed to load your session.");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router, attempt]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card text-center">
          <p className="text-white/80 mb-3">{error}</p>
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card">Loading…</div>
      </div>
    );
  }

  return <>{children}</>;
}

