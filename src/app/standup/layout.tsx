"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!data.session) {
        router.push("/login");
        return;
      }

      setReady(true);
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      {/* ✅ Background layer must not block clicks */}
      <div className="pointer-events-none absolute inset-0 opacity-50" />

      {/* ✅ Foreground content must be above */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
