"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (!email.trim()) {
      setError("Please enter your email address.");
      setLoading(false);
      return;
    }

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: `${window.location.origin}/reset-password` }
      );

      if (resetError) {
        setError(resetError.message);
        setLoading(false);
        return;
      }

      // Always show the same message, whether or not the email exists,
      // so this page can't be used to enumerate registered accounts.
      setMessage("If an account exists for that email, a reset link has been sent.");
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reset link. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-black to-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="card">
          <div className="text-center">
            <h1 className="text-4xl font-bold">Reset Password</h1>
            <p className="mt-2 text-white/70">We&apos;ll email you a link to reset it</p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-white/80">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="you@example.com"
                className="mt-1.5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                autoComplete="email"
              />
            </div>

            {error && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {message && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                {message}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-white/60">
            Remembered your password?{" "}
            <Link href="/login" className="font-medium text-white hover:text-white/80 transition">
              Sign in
            </Link>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-white/40">
          StandUp © 2026 • Intentional work, daily consistency
          <br />
          <Link href="/privacy" className="hover:text-white/60 transition">
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  );
}
