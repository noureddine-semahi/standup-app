"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile, type Profile } from "@/lib/supabase/db";
import { onPointsUpdated } from "@/lib/pointsBus";
import AnimatedNumber from "@/components/AnimatedNumber";

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const {
          data: { user: u },
        } = await supabase.auth.getUser();
        setUser(u);

        const p = await getOrCreateProfile();
        setProfile(p);
      } finally {
        setLoading(false);
      }
    }
    load();

    const unsubscribePoints = onPointsUpdated(() => {
      getOrCreateProfile()
        .then((p) => setProfile(p))
        .catch(() => {});
    });

    return unsubscribePoints;
  }, []);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);

    try {
      await supabase.auth.signOut();
      router.push("/");
    } catch (error) {
      console.error("Logout error:", error);
      setLoggingOut(false);
    }
  }

  if (loading) {
    return <div className="card">Loading profile…</div>;
  }

  return (
    <div className="card">
      <div className="flex flex-col items-center text-center">
        <div
          className="flex items-center justify-center rounded-full text-3xl font-bold overflow-hidden"
          style={{
            width: "84px",
            height: "84px",
            background: "linear-gradient(135deg, var(--accent-purple), var(--accent-blue))",
            color: "white",
          }}
        >
          {profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="Profile photo" className="w-full h-full object-cover" />
          ) : (
            (profile?.display_name || user?.email || "U").charAt(0).toUpperCase()
          )}
        </div>
        <div className="mt-4 text-2xl font-bold text-white">
          {profile?.display_name || user?.email?.split("@")[0] || "User"}
        </div>
        <div className="mt-1 text-sm text-white/50">{user?.email}</div>
      </div>

      {profile && (
        <div
          className="mt-8 rounded-2xl p-6 text-center"
          style={{
            background: "rgba(168, 85, 247, 0.08)",
            border: "1px solid rgba(168, 85, 247, 0.2)",
          }}
        >
          <div className="text-xs uppercase tracking-wider text-white/50 font-semibold">
            Total Points
          </div>
          <div className="mt-2 text-4xl font-bold text-white">
            <AnimatedNumber value={profile.points} />
          </div>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-3 max-w-sm mx-auto" style={{ boxSizing: "border-box" }}>
        <Link
          href="/standup/settings"
          className="btn text-center"
          style={{ boxSizing: "border-box", width: "100%" }}
        >
          Profile &amp; Settings
        </Link>
        <Link
          href="/standup/history"
          className="btn text-center"
          style={{ boxSizing: "border-box", width: "100%" }}
        >
          Points &amp; Usage History
        </Link>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="btn"
          style={{ boxSizing: "border-box", width: "100%" }}
        >
          {loggingOut ? "Logging out..." : "Logout"}
        </button>
      </div>
    </div>
  );
}
