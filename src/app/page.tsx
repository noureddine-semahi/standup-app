"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { logLandingPageVisit, LANDING_VISIT_DNT_KEY } from "@/lib/supabase/db";
import { SevenSegmentDigit, SevenSegmentReadout } from "@/components/SevenSegmentDigit";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";

const VISITED_KEY = "standup-landing-visited";
// Real visitor traffic only ever reaches the production alias. Dev servers
// (localhost) and Vercel preview-deployment URLs get their own hostnames,
// so excluding everything except this list stops build/design verification
// traffic from ever being logged as a visit in the first place.
const PRODUCTION_HOSTNAMES = ["standup-app-two.vercel.app"];

const READOUTS: { labelKey: TranslationKey; value: string; color: string }[] = [
  { labelKey: "landing.readoutPoints", value: "247", color: "var(--led-amber)" },
  { labelKey: "landing.readoutStreak", value: "12", color: "var(--led-red)" },
  { labelKey: "landing.readoutComplete", value: "85", color: "var(--led-green)" },
];

const FEATURES: { color: string; titleKey: TranslationKey; bodyKey: TranslationKey }[] = [
  {
    color: "var(--led-amber)",
    titleKey: "landing.feature1Title",
    bodyKey: "landing.feature1Body",
  },
  {
    color: "var(--led-green)",
    titleKey: "landing.feature2Title",
    bodyKey: "landing.feature2Body",
  },
  {
    color: "var(--led-red)",
    titleKey: "landing.feature3Title",
    bodyKey: "landing.feature3Body",
  },
  {
    color: "var(--led-amber)",
    titleKey: "landing.feature4Title",
    bodyKey: "landing.feature4Body",
  },
  {
    color: "var(--led-green)",
    titleKey: "landing.feature5Title",
    bodyKey: "landing.feature5Body",
  },
  {
    color: "var(--led-red)",
    titleKey: "landing.feature6Title",
    bodyKey: "landing.feature6Body",
  },
];

const STEPS: { n: string; color: string; titleKey: TranslationKey; bodyKey: TranslationKey }[] = [
  {
    n: "1",
    color: "var(--led-amber)",
    titleKey: "nav.planTomorrow",
    bodyKey: "landing.step1Body",
  },
  {
    n: "2",
    color: "var(--led-green)",
    titleKey: "nav.reviewToday",
    bodyKey: "landing.step2Body",
  },
  {
    n: "3",
    color: "var(--led-red)",
    titleKey: "landing.step3Title",
    bodyKey: "landing.step3Body",
  },
];

export default function LandingPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  // Digits light in from ghost cells on mount rather than appearing lit —
  // the one authored motion moment for this surface (see craft-floor.md).
  const [lit, setLit] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setLit(true), 300);
    return () => window.clearTimeout(id);
  }, []);

  // Scroll-entrance reveal for Features/How It Works/CTA -- the digit
  // light-in above was previously the only animation on this page; the
  // skill's motion law wants 2+ distinct types, and this is a genuinely
  // different one (scroll-triggered, not mount-triggered).
  useEffect(() => {
    const els = document.querySelectorAll(".scroll-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [loading]);

  useEffect(() => {
    async function checkAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        router.push("/standup/dashboard");
      } else {
        setLoading(false);

        const isProductionHost = PRODUCTION_HOSTNAMES.includes(window.location.hostname);

        // Only for actual visitors landing here signed out — logged-in
        // users get redirected above before ever seeing this page. A local
        // flag (not a cookie, never sent anywhere) keeps a repeat visit from
        // the same browser from being logged again, so the count reflects
        // unique visitors rather than every page load/refresh. Dev/preview
        // hosts and any browser explicitly opted out never log at all.
        try {
          const optedOut = window.localStorage.getItem(LANDING_VISIT_DNT_KEY) === "1";
          if (isProductionHost && !optedOut && !window.localStorage.getItem(VISITED_KEY)) {
            window.localStorage.setItem(VISITED_KEY, "1");
            logLandingPageVisit();
          }
        } catch {
          if (isProductionHost) logLandingPageVisit();
        }
      }
    }

    checkAuth();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="led-world min-h-screen">
      {/* Without JS, the scroll-reveal IntersectionObserver (below) never
          runs, so these sections would sit at their rest state (opacity: 0)
          forever. Force them visible whenever JS hasn't executed. */}
      <noscript>
        <style>{`.scroll-reveal { opacity: 1 !important; transform: none !important; }`}</style>
      </noscript>
      {/* Hero — the day itself rendered as a bank of scoreboard digits,
          lit segments in ghost-cell mode until they light on load. */}
      <div className="max-w-5xl mx-auto px-4 py-20 sm:py-28 text-center">
        <div className="flex items-end justify-center gap-6 sm:gap-10 mb-10 flex-wrap">
          {READOUTS.map((r) => (
            <div key={r.labelKey} className="flex flex-col items-center gap-3">
              <SevenSegmentReadout value={lit ? r.value : "0".repeat(r.value.length)} color={r.color} size={36} />
              <div
                className="led-mono text-[11px] tracking-widest uppercase"
                style={{ color: "var(--led-text-dim)" }}
              >
                {t(r.labelKey)}
              </div>
            </div>
          ))}
        </div>

        <h1 className="led-headline text-3xl sm:text-5xl font-bold mb-5 leading-tight">
          {t("landing.headline")}
        </h1>

        <p className="led-mono text-sm sm:text-base mb-10 max-w-2xl mx-auto" style={{ color: "var(--led-text-dim)" }}>
          {t("landing.tagline")}
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/signup" className="led-switch led-switch-primary">
            {t("landing.getStarted")}
          </Link>
          <Link href="/about" className="led-switch">
            {t("landing.learnMore")}
          </Link>
        </div>
      </div>

      {/* Features — ledger rows, not 6 identical led-cell boxes. A single
          column keeps the divider logic simple (Tailwind's divide-y) rather
          than fighting a 2-column grid's row-pairing; the process sequence
          below and the CTA are where led-cell's box treatment is earned. */}
      <div className="scroll-reveal max-w-3xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="led-headline text-3xl font-bold mb-3">{t("landing.whyStandup")}</h2>
          <p className="led-mono text-sm" style={{ color: "var(--led-text-dim)" }}>
            {t("landing.builtOnPrinciples")}
          </p>
        </div>

        <div className="divide-y divide-white/10">
          {FEATURES.map((f) => (
            <div key={f.titleKey} className="py-5">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="led-dot"
                  style={{ background: f.color, boxShadow: `0 0 8px ${f.color}` }}
                />
                <h3 className="led-mono text-sm font-bold uppercase tracking-wide">{t(f.titleKey)}</h3>
              </div>
              <p className="text-sm" style={{ color: "var(--led-text-dim)" }}>
                {t(f.bodyKey)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* How It Works — keeps led-cell (1 of 2 card-budget slots): a
          3-step sequence genuinely reads as discrete devices. */}
      <div className="scroll-reveal max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="led-headline text-3xl font-bold mb-3">{t("landing.howItWorks")}</h2>
          <p className="led-mono text-sm" style={{ color: "var(--led-text-dim)" }}>
            {t("landing.threeSteps")}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
          {STEPS.map((s) => (
            <div key={s.n} className="led-cell p-6">
              <div className="mb-4">
                <SevenSegmentDigit char={s.n} color={s.color} size={28} />
              </div>
              <h3 className="led-mono text-sm font-bold uppercase tracking-wide mb-2">{t(s.titleKey)}</h3>
              <p className="text-sm" style={{ color: "var(--led-text-dim)" }}>
                {t(s.bodyKey)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA — keeps led-cell (2 of 2 card-budget slots): the single most
          important box on the page earns its containment. */}
      <div className="scroll-reveal max-w-3xl mx-auto px-4 py-20 text-center">
        <div className="led-cell p-10" style={{ borderColor: "rgba(245, 158, 11, 0.35)" }}>
          <h2 className="led-headline text-3xl font-bold mb-3">{t("landing.readyToBuild")}</h2>
          <p className="led-mono text-sm mb-8" style={{ color: "var(--led-text-dim)" }}>
            {t("landing.joinToday")}
          </p>
          <Link href="/signup" className="led-switch led-switch-primary">
            {t("landing.getStarted")}
          </Link>
          <p className="led-mono text-xs mt-4" style={{ color: "var(--led-text-dim)" }}>
            {t("landing.noCreditCard")}
          </p>
        </div>
      </div>
    </div>
  );
}
