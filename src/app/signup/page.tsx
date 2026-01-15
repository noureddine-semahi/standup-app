// src/app/signup/page.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) throw error;

      // If email confirmation is enabled, session may be null.
      if (!data.session) {
        setMsg("Check your email to confirm your account, then sign in.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err: any) {
      setMsg(err?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen px-6 py-8">
      {/* Top right link */}
      <div className="flex justify-end">
        <Link
          href="/login"
          className="text-sm text-white/80 hover:text-white underline underline-offset-4"
        >
          Sign in
        </Link>
      </div>

      <div className="mx-auto mt-10 max-w-xl">
        <h1 className="text-5xl font-semibold tracking-tight text-white">
          Create account
        </h1>
        <p className="mt-2 text-lg text-white/70">
          Create your StandUp profile and start building your streak.
        </p>

        <form onSubmit={onSubmit} className="mt-10 space-y-5">
          <input
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-white placeholder:text-white/40 outline-none focus:border-white/25"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <input
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-white placeholder:text-white/40 outline-none focus:border-white/25"
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />

          <button
            disabled={loading}
            className="w-full rounded-2xl bg-white px-6 py-4 font-semibold text-black hover:opacity-95 disabled:opacity-60"
          >
            {loading ? "Creating..." : "Sign up"}
          </button>

          {msg && <p className="text-sm text-white/70">{msg}</p>}

          <p className="text-sm text-white/70">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-white underline underline-offset-4"
            >
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
