"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { storePendingReferral } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import PrivacyConsentModal from "@/components/PrivacyConsentModal";

export default function SignupPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showConsent, setShowConsent] = useState(false);

  // Stashed for later rather than acted on now — if email confirmation is
  // required, the session that actually gets created lands on a fresh page
  // load with no signup-flow state, so this is picked up in Header.tsx once
  // that session shows up (see consumePendingReferral in db.ts).
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) storePendingReferral(ref);
  }, []);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    // Validation
    if (!email.trim() || !password.trim()) {
      setError(t("login.enterBoth"));
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError(t("signup.passwordTooShort"));
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError(t("signup.passwordsDontMatch"));
      setLoading(false);
      return;
    }

    setLoading(false);
    setShowConsent(true);
  }

  async function completeSignup() {
    setLoading(true);
    setError(null);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          data: {
            display_name: displayName.trim() || null,
            privacy_accepted_at: new Date().toISOString(),
          },
          emailRedirectTo: `${window.location.origin}/standup/today`,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      if (data?.user) {
        // Check if email confirmation is required
        if (data.user.identities && data.user.identities.length === 0) {
          setError(t("signup.alreadyRegistered"));
          setLoading(false);
          return;
        }

        setShowConsent(false);

        // If email confirmation is disabled, redirect immediately
        if (data.session) {
          setMessage(t("signup.accountCreatedRedirecting"));
          setTimeout(() => {
            router.push("/standup/today");
          }, 1000);
        } else {
          // Email confirmation required
          setMessage(t("signup.accountCreatedConfirmEmail"));
          setLoading(false);
        }
      }
    } catch (err: any) {
      setError(err?.message ?? t("signup.failed"));
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-black to-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="card">
          <div className="text-center">
            <h1 className="text-4xl font-bold">{t("signup.title")}</h1>
            <p className="mt-2 text-white/70">{t("signup.tagline")}</p>
          </div>

          <form onSubmit={handleSignup} className="mt-8 space-y-4">
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-white/80">
                {t("signup.displayNameOptional")} <span className="text-white/50">{t("signup.optional")}</span>
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={loading}
                placeholder={t("settings.yourName")}
                className="mt-1.5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                autoComplete="name"
              />
            </div>

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
                required
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
                autoComplete="new-password"
                required
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
                required
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

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full"
            >
              {loading ? t("signup.creatingAccount") : t("signup.createAccount")}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-white/60">
            {t("signup.alreadyHaveAccount")}{" "}
            <Link href="/login" className="font-medium text-white hover:text-white/80 transition">
              {t("signup.signIn")}
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

      {showConsent && (
        <PrivacyConsentModal
          saving={loading}
          error={error}
          onCancel={() => {
            if (loading) return;
            setShowConsent(false);
            setError(null);
          }}
          onConfirm={completeSignup}
        />
      )}
    </div>
  );
}