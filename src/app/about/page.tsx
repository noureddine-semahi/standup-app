"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SocialShareButtons from "@/components/SocialShareButtons";
import {
  Brain, RefreshCw, TrendingUp, ClipboardList, Target, Flame, CalendarClock, Ban, Calendar,
  Receipt, ListChecks, Users, Send, MessageCircle, Umbrella, type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";

type DefItem = { key: string; icon: LucideIcon; titleKey: TranslationKey; body: (t: (k: TranslationKey) => string) => React.ReactNode };

const BIGGER_PICTURE_ITEMS: DefItem[] = [
  { key: "review", icon: ClipboardList, titleKey: "about.dailyReview", body: (t) => t("about.dailyReviewBody") },
  { key: "planning", icon: Target, titleKey: "about.intentionalPlanning", body: (t) => t("about.intentionalPlanningBody") },
  { key: "points", icon: Flame, titleKey: "about.pointsStreaks", body: (t) => t("about.pointsStreaksBody") },
  { key: "reschedule", icon: CalendarClock, titleKey: "about.smartRescheduling", body: (t) => t("about.smartReschedulingBody") },
  { key: "gating", icon: Ban, titleKey: "about.reviewGating", body: (t) => t("about.reviewGatingBody") },
  { key: "calendar", icon: Calendar, titleKey: "about.fullCalendarHistory", body: (t) => t("about.fullCalendarHistoryBody") },
  {
    key: "outcomes", icon: Receipt, titleKey: "about.honestOutcomes",
    body: (t) => (
      <>
        {t("about.honestOutcomesPart1")}<b>{t("about.wordReview")}</b>{t("about.honestOutcomesPart2")}<b>{t("about.wordCompletion")}</b>{t("about.honestOutcomesPart3")}
      </>
    ),
  },
  { key: "subtasks", icon: ListChecks, titleKey: "about.subTasksFiles", body: (t) => t("about.subTasksFilesBody") },
];

const GROWING_TOGETHER_ITEMS: DefItem[] = [
  { key: "connections", icon: Users, titleKey: "about.connections", body: (t) => t("about.connectionsBody") },
  { key: "assignments", icon: Send, titleKey: "about.goalAssignments", body: (t) => t("about.goalAssignmentsBody") },
  { key: "reactions", icon: MessageCircle, titleKey: "about.reactionsComments", body: (t) => t("about.reactionsCommentsBody") },
  { key: "streakPasses", icon: Umbrella, titleKey: "about.streakPasses", body: (t) => t("about.streakPassesBody") },
];

const VISION_PHRASE_KEYS: TranslationKey[] = [
  "about.visionBullet1",
  "about.visionBullet2",
  "about.visionBullet3",
  "about.visionBullet4",
  "about.visionBullet5",
];

/** Definition-list rendering shared by Bigger Picture / Growing Together —
    hairline row dividers (matches FAQ's divide-y pattern) instead of each
    item getting its own bordered card, so 12 total facts don't read as 12
    identical boxes. */
function DefinitionList({ items, t }: { items: DefItem[]; t: (k: TranslationKey) => string }) {
  return (
    <div className="divide-y divide-white/10">
      {items.map((item) => (
        <div key={item.key} className="py-4 first:pt-0 last:pb-0">
          <h3 className="flex items-center gap-2 text-base font-semibold text-white mb-1">
            <item.icon size={18} className="text-white/80" />
            {t(item.titleKey)}
          </h3>
          <p className="text-sm text-white/60">{item.body(t)}</p>
        </div>
      ))}
    </div>
  );
}

export default function AboutPage() {
  const { t } = useLanguage();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedIn(!!session?.user);
    });
  }, []);

  // Scroll-entrance reveal (Phase 5, /looks-expensive trial) — a plain
  // IntersectionObserver rather than a library, matching this app's
  // existing "no new dependency for a small effect" convention (see
  // notificationsBus.ts's window-event pattern for the same reasoning).
  // Reduced motion is handled purely in CSS (.scroll-reveal has no
  // transform/opacity under prefers-reduced-motion), so this observer
  // still runs but has nothing visible to animate.
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
  }, []);

  return (
    <div className="min-h-screen">
      {/* Without JS, the IntersectionObserver above never runs, so
          .scroll-reveal would sit at its rest state (opacity: 0) forever —
          content the page depends on would simply never appear. This
          forces it visible whenever JS hasn't executed. */}
      <noscript>
        <style>{`.scroll-reveal { opacity: 1 !important; transform: none !important; } .about-rule-underline { transform: scaleX(1) !important; }`}</style>
      </noscript>
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Hero */}
        <div className="scroll-reveal text-center mb-20">
          <h1 className="text-5xl font-bold mb-4">{t("about.title")}</h1>
          <p className="text-xl text-page-secondary max-w-2xl mx-auto">
            {t("about.heroP1")}
          </p>
          <p className="mt-4 text-sm text-page-tertiary max-w-2xl mx-auto">
            {t("about.heroP2")}
          </p>
        </div>

        {/* Philosophy + Vision — editorial-rule containment (a top hairline,
            no card chrome) instead of two bordered boxes side by side. */}
        <div className="scroll-reveal border-t border-white/10 pt-10 grid gap-10 grid-cols-1 sm:grid-cols-2">
          <div>
            <h2 className="text-2xl text-amber-300 mb-4">{t("about.philosophyTitle")}</h2>
            <p className="text-sm text-white/70">
              {t("about.philosophyIntroPart1")}
              <b>{t("about.wordAwareness")}</b>{t("about.philosophyIntroPart2")}
              <b>{t("about.wordReview")}</b>{t("about.philosophyIntroPart3")}
              <b>{t("about.wordFollowThrough")}</b>{t("about.philosophyIntroPart4")}
            </p>

            <div className="mt-6 space-y-4 text-white/80">
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white mb-1">
                  <Brain size={20} className="text-white/80" />
                  {t("about.awarenessBeforeAction")}
                </h3>
                <p className="text-sm text-white/70">{t("about.awarenessBeforeActionBody")}</p>
              </div>
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white mb-1">
                  <RefreshCw size={20} className="text-white/80" />
                  {t("about.reflectionBeforePlanning")}
                </h3>
                <p className="text-sm text-white/70">{t("about.reflectionBeforePlanningBody")}</p>
              </div>
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white mb-1">
                  <TrendingUp size={20} className="text-white/80" />
                  {t("about.consistencyOverIntensity")}
                </h3>
                <p className="text-sm text-white/70">{t("about.consistencyOverIntensityBody")}</p>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-2xl text-amber-300 mb-4">{t("about.visionTitle")}</h2>
            <p className="text-white/80 mb-4">{t("about.visionIntro")}</p>

            {/* De-bulleted: the 5 items read as short parallel phrases
                separated by a typographic dot rather than <li> markers —
                no list semantics to fight across EN/ES, no bullet glyphs. */}
            <p className="text-sm text-white/70 leading-relaxed">
              {VISION_PHRASE_KEYS.map((key, i) => (
                <span key={key}>
                  {t(key)}
                  {i < VISION_PHRASE_KEYS.length - 1 && <span className="mx-2 text-white/30">·</span>}
                </span>
              ))}
            </p>

            <p className="text-white/80 mt-4">{t("about.visionExpansion")}</p>

            <div className="mt-6 pl-4" style={{ borderLeft: "2px solid rgba(245, 158, 11, 0.3)" }}>
              <p className="text-sm text-white/70">
                <span className="font-semibold text-white">{t("about.northStarLabel")}</span>{" "}
                {t("about.northStarText")}
              </p>
            </div>
          </div>
        </div>

        {/* The One Rule — promoted out of the Philosophy card into its own
            full-bleed beat: the one contrast/scale moment on an otherwise
            all-dark page, and the one place this page earns an animation
            tied to its actual mechanism rather than a generic fade. */}
        <div
          className="scroll-reveal about-rule-panel mt-16 px-6 py-12 sm:px-16 sm:py-16 text-center"
        >
          {/* Plain-case lead-in, not an uppercase eyebrow -- this is a full
              sentence, and forcing a whole sentence into tracked uppercase
              reads as heavier than any pill label it was meant to avoid. */}
          <p className="text-sm text-white/50 mb-4">{t("about.oneRule")}</p>
          <p className="text-2xl sm:text-4xl font-bold text-white leading-snug max-w-3xl mx-auto">
            {t("about.ruleText")}
          </p>
          <span className="about-rule-underline mt-6 max-w-xs mx-auto" />
        </div>

        {/* Bigger Picture + Growing Together — definition lists, not card
            grids: 12 facts across two related lists rather than 12 boxes. */}
        <div className="mt-16 grid gap-10 grid-cols-1 sm:grid-cols-2">
          <div className="scroll-reveal">
            <h2 className="text-2xl text-amber-300 mb-2">{t("about.biggerPictureTitle")}</h2>
            <DefinitionList items={BIGGER_PICTURE_ITEMS} t={t} />
          </div>
          <div className="scroll-reveal">
            <h2 className="text-2xl text-amber-300 mb-2">{t("about.connectTitle")}</h2>
            <DefinitionList items={GROWING_TOGETHER_ITEMS} t={t} />
          </div>
        </div>

        {/* The Story + How It Works — the two sections that keep card
            chrome (budget: at most 2 per page). */}
        <div className="mt-16 grid gap-3 grid-cols-1 sm:grid-cols-2">
          <div className="scroll-reveal card card-highlight">
            <div className="p-0 sm:p-6">
              <h2 className="text-2xl text-amber-300 mb-4">{t("about.storyTitle")}</h2>
              <p className="text-white/80 mb-4">{t("about.storyP1")}</p>
              <p className="text-sm text-white/70">{t("about.storyP2")}</p>
              <div className="mt-6 pl-4" style={{ borderLeft: "2px solid rgba(245, 158, 11, 0.3)" }}>
                <p className="text-sm text-white/70">
                  <span className="font-semibold text-white">{t("about.storyIdeaLabel")}</span> {t("about.storyIdeaText")}
                </p>
              </div>
            </div>
          </div>

          <div className="scroll-reveal card card-highlight">
            <div className="p-0 sm:p-6">
              <h2 className="text-2xl text-amber-300 mb-6">{t("about.howItWorksTitle")}</h2>
              <div className="space-y-8">
                <div>
                  <h3 className="font-semibold text-white mb-1">{t("nav.planTomorrow")}</h3>
                  <p className="text-sm text-white/70">{t("about.planTomorrowStepBody")}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">{t("nav.reviewToday")}</h3>
                  <p className="text-sm text-white/70">{t("about.reviewTodayStepBody")}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">{t("about.closeTheLoop")}</h3>
                  <p className="text-sm text-white/70">{t("about.closeTheLoopBody")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CTA — the signup push only makes sense for a signed-out visitor */}
        <div className="scroll-reveal text-center mt-16">
          {!signedIn && (
            <>
              <Link href="/signup" className="btn btn-primary text-lg px-8 py-4">
                {t("about.getStarted")}
              </Link>
              <p className="mt-4 text-sm text-page-tertiary">
                {t("about.joinToday")}
              </p>
            </>
          )}
          <p className="mt-6 text-sm text-page-tertiary">
            {t("about.haveQuestionsPart1")}
            <Link href="/faq" className="text-amber-300 hover:text-amber-200 underline">
              {t("nav.faq")}
            </Link>
            {t("about.haveQuestionsPart2")}
            <Link href="/contact" className="text-amber-300 hover:text-amber-200 underline">
              {t("about.contactUsLower")}
            </Link>
            {t("about.haveQuestionsPart3")}
            <Link href="/privacy" className="text-amber-300 hover:text-amber-200 underline">
              {t("settings.privacyPolicy")}
            </Link>
            {t("about.haveQuestionsPart4")}
          </p>

          <SocialShareButtons className="mt-8" onPage />
        </div>
      </div>
    </div>
  );
}
