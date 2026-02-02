"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function StandupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
        <div className="card relative z-10">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative pointer-events-auto">
      {/* ✅ Safety background layer: never blocks clicks */}
      <div className="pointer-events-none absolute inset-0 opacity-50 -z-10" />

      {/* ✅ Force children above */}
      <div className="relative z-10 pointer-events-auto">{children}</div>
    </div>
  );
}
