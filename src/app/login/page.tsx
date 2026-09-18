"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function LoginPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (!email.trim() || !password.trim()) {
      setError(t("login.enterBoth"));
      setLoading(false);
      return;
    }

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      if (data?.user) {
        setMessage(t("login.successRedirecting"));
        router.push("/standup/today");
      }
    } catch (err: any) {
      setError(err?.message ?? t("login.failed"));
      setLoading(false);
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (!email.trim()) {
      setError(t("login.enterEmail"));
      setLoading(false);
      return;
    }

    try {
      const { error: magicError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/standup/today`,
        },
      });

      if (magicError) {
        setError(magicError.message);
        setLoading(false);
        return;
      }

      setMessage(t("login.magicLinkSent"));
      setLoading(false);
    } catch (err: any) {
      setError(err?.message ?? t("login.magicLinkFailed"));
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-black to-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="card">
          <div className="text-center">
            <h1 className="text-4xl font-bold">StandUp</h1>
            <p className="mt-2 text-white/70">{t("login.tagline")}</p>
          </div>

          <form onSubmit={handleLogin} className="mt-8 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-white/80">
                {t("login.email")}
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

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-white/80">
                {t("login.password")}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                autoComplete="current-password"
              />
              <div className="mt-1.5 text-right">
                <Link href="/forgot-password" className="text-xs text-white/50 hover:text-white/70 transition">
                  {t("login.forgotPassword")}
                </Link>
              </div>
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

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full"
            >
              {loading ? t("login.signingIn") : t("login.signIn")}
            </button>
          </form>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleMagicLink}
              disabled={loading}
              className="btn btn-ghost w-full"
            >
              {loading ? t("login.sending") : t("login.sendMagicLink")}
            </button>
          </div>

          <div className="mt-6 text-center text-sm text-white/60">
            {t("login.noAccount")}{" "}
            <Link href="/signup" className="font-medium text-white hover:text-white/80 transition">
              {t("login.signUp")}
            </Link>
          </div>

          <div className="mt-4 text-center">
            <Link
              href="/standup/today"
              className="text-xs text-white/50 hover:text-white/70 transition"
            >
              {t("login.backToApp")}
            </Link>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-white/40">
          {t("login.footer")}
          <br />
          <Link href="/privacy" className="hover:text-white/60 transition">
            {t("login.privacyPolicy")}
          </Link>
        </div>
      </div>
    </div>
  );
}