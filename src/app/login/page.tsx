"use client";

import { useState } from "react";
import Link from "next/link";

// If you haven't created the Supabase client yet, do this next:
// src/lib/supabase/client.ts
// export const supabase = createClient(url, anonKey);
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      if (!email || !password) throw new Error("Email and password are required.");

      const { error } =
        mode === "signup"
          ? await supabase.auth.signUp({ email, password })
          : await supabase.auth.signInWithPassword({ email, password });

      if (error) throw error;

      router.push("/dashboard");
    } catch (err: any) {
      setMsg(err?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-md px-6 py-20">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>
          <Link className="text-sm text-zinc-400 hover:text-zinc-200" href="/">
            Home
          </Link>
        </div>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <input
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            disabled={loading}
            className="w-full rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading ? "Working..." : mode === "signin" ? "Sign in" : "Sign up"}
          </button>

          {msg && <p className="text-sm text-zinc-300">{msg}</p>}
        </form>

        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-6 text-sm text-zinc-400 hover:text-zinc-200"
        >
          {mode === "signin"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
