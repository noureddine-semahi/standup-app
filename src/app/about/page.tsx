"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SocialShareButtons from "@/components/SocialShareButtons";
import { supabase } from "@/lib/supabase/client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function AboutPage() {
  const { t } = useLanguage();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedIn(!!session?.user);
    });
  }, []);

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4">{t("about.title")}</h1>
          <p className="text-xl text-page-secondary max-w-2xl mx-auto">
            {t("about.heroP1")}
          </p>
          <p className="mt-4 text-sm text-page-tertiary max-w-2xl mx-auto">
            {t("about.heroP2")}
          </p>
        </div>

        {/* Two cards per row max — these are text-heavy sections, not
            compact stat tiles, so they need real width to read comfortably. */}
        <div className="mt-6 grid gap-3 grid-cols-1 sm:grid-cols-2">
          {/* Philosophy — paired side-by-side with Vision */}
          <div
            className="card card-highlight"
          >
          <div className="p-0 sm:p-6">
            <h2 className={`text-2xl text-amber-300 mb-4`}>{t("about.philosophyTitle")}</h2>

            <div className="mb-6 pl-4" style={{ borderLeft: "2px solid rgba(245, 158, 11, 0.3)" }}>
              <p className="text-sm text-white/70">
                {t("about.philosophyIntroPart1")}
                <b>{t("about.wordAwareness")}</b>{t("about.philosophyIntroPart2")}
                <b>{t("about.wordReview")}</b>{t("about.philosophyIntroPart3")}
                <b>{t("about.wordFollowThrough")}</b>{t("about.philosophyIntroPart4")}
              </p>
              <p className="mt-3 text-sm text-white/70">
                {t("about.oneRule")}
              </p>
              <p className="mt-2 text-sm font-semibold text-white">
                {t("about.ruleText")}
              </p>
            </div>

            <div className="space-y-4 text-white/80">
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white mb-1">
                  <span className="text-xl">🧠</span>
                  {t("about.awarenessBeforeAction")}
                </h3>
                <p className="text-sm text-white/70">
                  {t("about.awarenessBeforeActionBody")}
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white mb-1">
                  <span className="text-xl">🔄</span>
                  {t("about.reflectionBeforePlanning")}
                </h3>
                <p className="text-sm text-white/70">
                  {t("about.reflectionBeforePlanningBody")}
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white mb-1">
                  <span className="text-xl">📈</span>
                  {t("about.consistencyOverIntensity")}
                </h3>
                <p className="text-sm text-white/70">
                  {t("about.consistencyOverIntensityBody")}
                </p>
              </div>
            </div>
          </div>
          </div>

          {/* Vision — paired side-by-side with Philosophy */}
          <div
            className="card card-highlight"
          >
          <div className="p-0 sm:p-6">
            <h2 className={`text-2xl text-amber-300 mb-4`}>{t("about.visionTitle")}</h2>
            <p className="text-white/80 mb-4">
              {t("about.visionIntro")}
            </p>
            <ul className="space-y-2 text-white/70 text-sm list-disc list-inside">
              <li>{t("about.visionBullet1")}</li>
              <li>{t("about.visionBullet2")}</li>
              <li>{t("about.visionBullet3")}</li>
              <li>{t("about.visionBullet4")}</li>
              <li>{t("about.visionBullet5")}</li>
            </ul>

            <p className="text-white/80 mt-4">
              {t("about.visionExpansion")}
            </p>

            <div className="mt-6 pl-4" style={{ borderLeft: "2px solid rgba(245, 158, 11, 0.3)" }}>
              <p className="text-sm text-white/70">
                <span className="font-semibold text-white">{t("about.northStarLabel")}</span>{" "}
                {t("about.northStarText")}
              </p>
            </div>
          </div>
          </div>

          {/* The Bigger Picture — full-width band below the pair */}
          <div
            className="card card-highlight"
          >
          <div className="p-0 sm:p-6">
            <h2 className={`text-2xl text-amber-300 mb-6`}>{t("about.biggerPictureTitle")}</h2>
            <div className="space-y-5">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">📋</span>
                  {t("about.dailyReview")}
                </h3>
                <p className="text-sm text-white/60">
                  {t("about.dailyReviewBody")}
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">🎯</span>
                  {t("about.intentionalPlanning")}
                </h3>
                <p className="text-sm text-white/60">
                  {t("about.intentionalPlanningBody")}
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">🔥</span>
                  {t("about.pointsStreaks")}
                </h3>
                <p className="text-sm text-white/60">
                  {t("about.pointsStreaksBody")}
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">📅</span>
                  {t("about.smartRescheduling")}
                </h3>
                <p className="text-sm text-white/60">
                  {t("about.smartReschedulingBody")}
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">🚫</span>
                  {t("about.reviewGating")}
                </h3>
                <p className="text-sm text-white/60">
                  {t("about.reviewGatingBody")}
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">🗓️</span>
                  {t("about.fullCalendarHistory")}
                </h3>
                <p className="text-sm text-white/60">
                  {t("about.fullCalendarHistoryBody")}
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">🧾</span>
                  {t("about.honestOutcomes")}
                </h3>
                <p className="text-sm text-white/60">
                  {t("about.honestOutcomesPart1")}<b>{t("about.wordReview")}</b>{t("about.honestOutcomesPart2")}<b>{t("about.wordCompletion")}</b>{t("about.honestOutcomesPart3")}
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-1">
                  <span className="text-lg">🛒</span>
                  {t("about.subTasksFiles")}
                </h3>
                <p className="text-sm text-white/60">
                  {t("about.subTasksFilesBody")}
                </p>
              </div>
            </div>
          </div>
          </div>

          {/* The Story — paired side-by-side with How It Works */}
          <div
            className="card card-highlight"
          >
          <div className="p-0 sm:p-6">
            <h2 className={`text-2xl text-amber-300 mb-4`}>{t("about.storyTitle")}</h2>
            <p className="text-white/80 mb-4">
              {t("about.storyP1")}
            </p>
            <p className="text-sm text-white/70">
              {t("about.storyP2")}
            </p>

            <div className="mt-6 pl-4" style={{ borderLeft: "2px solid rgba(245, 158, 11, 0.3)" }}>
              <p className="text-sm text-white/70">
                <span className="font-semibold text-white">{t("about.storyIdeaLabel")}</span> {t("about.storyIdeaText")}
              </p>
            </div>
          </div>
          </div>

          {/* How It Works — paired side-by-side with The Story */}
          <div
            className="card card-highlight"
          >
          <div className="p-0 sm:p-6">
            <h2 className={`text-2xl text-amber-300 mb-6`}>{t("about.howItWorksTitle")}</h2>
            <div className="space-y-8">
              <div>
                <h3 className="font-semibold text-white mb-1">{t("nav.planTomorrow")}</h3>
                <p className="text-sm text-white/70">
                  {t("about.planTomorrowStepBody")}
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-white mb-1">{t("nav.reviewToday")}</h3>
                <p className="text-sm text-white/70">
                  {t("about.reviewTodayStepBody")}
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-white mb-1">{t("about.closeTheLoop")}</h3>
                <p className="text-sm text-white/70">
                  {t("about.closeTheLoopBody")}
                </p>
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* CTA — the signup push only makes sense for a signed-out visitor */}
        <div className="text-center">
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
