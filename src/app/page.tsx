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

// Evening-first, close-the-loop order -- Review Today closes out the day
// and is what actually unlocks Plan Tomorrow, not the other way around.
// Explicit user call: this reordering matches the product's real workflow
// and what the landing page's own promo video demonstrates.
const STEPS: { n: string; color: string; titleKey: TranslationKey; bodyKey: TranslationKey }[] = [
  {
    n: "1",
    color: "var(--led-amber)",
    titleKey: "nav.reviewToday",
    bodyKey: "landing.step1Body",
  },
  {
    n: "2",
    color: "var(--led-green)",
    titleKey: "nav.planTomorrow",
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
          lit segments in ghost-cell mode until they light on load.
          Counters shrunk and tightened so the headline/tagline/CTA read
          as the main event instead of competing evenly with them. */}
      <div className="max-w-5xl mx-auto px-4 py-12 sm:py-16 text-center">
        <div className="flex items-end justify-center gap-4 sm:gap-6 mb-6 flex-wrap">
          {READOUTS.map((r) => (
            <div key={r.labelKey} className="flex flex-col items-center gap-2">
              <SevenSegmentReadout value={lit ? r.value : "0".repeat(r.value.length)} color={r.color} size={22} />
              <div
                className="led-mono text-[10px] tracking-widest uppercase"
                style={{ color: "var(--led-text-dim)" }}
              >
                {t(r.labelKey)}
              </div>
            </div>
          ))}
        </div>

        <h1 className="led-headline text-3xl sm:text-5xl font-bold mb-5 leading-tight">
          <span className="block">{t("landing.headlineLine1")}</span>
          <span className="block">{t("landing.headlineLine2")}</span>
        </h1>

        <p className="font-sans text-sm sm:text-base mb-8 max-w-2xl mx-auto" style={{ color: "var(--led-text-dim)" }}>
          {t("landing.tagline")}
        </p>

        <div className="flex flex-row flex-wrap gap-3 justify-center">
          <Link href="/signup" className="led-switch led-switch-primary">
            {t("landing.getStarted")}
          </Link>
          <Link href="/about" className="led-switch">
            {t("landing.learnMore")}
          </Link>
        </div>
      </div>

      {/* Promo video, framed as a product preview (slight 3D tilt + soft
          glow) rather than a plain embedded clip — tells a first-time
          visitor "this is a real application" the moment it's in view.
          Muted+loop so it autoplays across browsers; controls stay on so
          sound (voiceover-free, just sound design + score) is a visitor's
          choice, not forced on them. */}
      <div className="scroll-reveal max-w-2xl mx-auto px-4 pb-12">
        <div className="product-preview-frame">
          <div className="product-preview-frame-inner led-cell p-3 sm:p-4">
            <video
              className="w-full rounded-lg block"
              src="/videos/standup-promo.mp4"
              autoPlay
              muted
              loop
              playsInline
              controls
            />
          </div>
        </div>
      </div>

      {/* Features — a 2x3 grid of subtle panels instead of six identical
          text rows, which read as repetitive at a glance. */}
      <div className="scroll-reveal max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h2 className="led-headline text-3xl font-bold mb-3">{t("landing.whyStandup")}</h2>
          <p className="led-mono text-sm" style={{ color: "var(--led-text-dim)" }}>
            {t("landing.builtOnPrinciples")}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.titleKey} className="feature-panel">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="led-dot"
                  style={{ background: f.color, boxShadow: `0 0 8px ${f.color}` }}
                />
                <h3 className="led-mono text-sm font-bold uppercase tracking-wide">{t(f.titleKey)}</h3>
              </div>
              <p className="font-sans text-sm" style={{ color: "var(--led-text-dim)" }}>
                {t(f.bodyKey)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* How It Works — each step card now carries its own quiet glow/
          border in that step's color, with a larger digit (the one
          genuinely distinctive brand element here, worth using bigger)
          and a gentle hover lift. */}
      <div className="scroll-reveal max-w-6xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h2 className="led-headline text-3xl font-bold mb-3">{t("landing.howItWorks")}</h2>
          <p className="led-mono text-sm" style={{ color: "var(--led-text-dim)" }}>
            {t("landing.threeSteps")}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
          {STEPS.map((s) => (
            <div key={s.n} className="led-cell step-card p-6" style={{ "--step-color": s.color } as React.CSSProperties}>
              <div className="mb-4">
                <SevenSegmentDigit char={s.n} color={s.color} size={40} />
              </div>
              <h3 className="led-mono text-sm font-bold uppercase tracking-wide mb-2">{t(s.titleKey)}</h3>
              <p className="font-sans text-sm" style={{ color: "var(--led-text-dim)" }}>
                {t(s.bodyKey)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA — a faint background glow instead of blending flatly into
          the page, and brand-consistent copy ("Ready to Show Up?") in
          place of generic habit-app language. */}
      <div className="scroll-reveal max-w-3xl mx-auto px-4 py-12 text-center cta-glow-wrap">
        <div className="led-cell p-10" style={{ borderColor: "rgba(245, 158, 11, 0.35)" }}>
          <h2 className="led-headline text-3xl font-bold mb-3">{t("landing.readyToBuild")}</h2>
          <p className="font-sans text-sm mb-8" style={{ color: "var(--led-text-dim)" }}>
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
