"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Status = "verifying" | "ready" | "invalid";

export default function ResetPasswordPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("verifying");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let settled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        settled = true;
        setStatus("ready");
      }
    });

    // Fallback: supabase-js parses the recovery token from the URL on load
    // and may already have a session by the time this effect runs.
    supabase.auth.getSession().then(({ data }) => {
      if (!settled && data.session) {
        settled = true;
        setStatus("ready");
      }
    });

    const timeout = window.setTimeout(() => {
      if (!settled) setStatus("invalid");
    }, 5000);

    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 6) {
      setError(t("signup.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("signup.passwordsDontMatch"));
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }

      setMessage(t("reset.updatedRedirecting"));
      setTimeout(() => router.push("/standup/dashboard"), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reset.failed"));
      setLoading(false);
    }
  }

  return (
    // No background class here on purpose -- the root layout's .app-bg
    // (real brand gradient + ambient washes) already sits behind every
    // page; this div used to paint over it with a generic gradient.
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="card">
          <div className="text-center">
            <h1 className="text-4xl font-bold">{t("reset.title")}</h1>
          </div>

          {status === "verifying" && (
            <p className="mt-8 text-center text-white/70">{t("reset.verifyingLink")}</p>
          )}

          {status === "invalid" && (
            <div className="mt-8">
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {t("reset.invalidLink")}
              </div>
              <div className="mt-6 text-center text-sm text-white/60">
                <Link href="/forgot-password" className="font-medium text-white hover:text-white/80 transition">
                  {t("reset.requestNewLink")}
                </Link>
              </div>
            </div>
          )}

          {status === "ready" && (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-white/80">
                  {t("reset.newPassword")}
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  placeholder="••••••••"
                  className="mt-1.5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                  autoComplete="new-password"
                />
                <p className="mt-1 text-xs text-white/50">{t("settings.minChars")}</p>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-white/80">
                  {t("signup.confirmPassword")}
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  placeholder="••••••••"
                  className="mt-1.5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                  autoComplete="new-password"
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
                {loading ? t("settings.updating") : t("settings.updatePassword")}
              </button>
            </form>
          )}
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
