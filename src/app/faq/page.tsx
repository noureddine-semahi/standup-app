"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";

const FAQ_KEYS: { questionKey: TranslationKey; answerKey: TranslationKey }[] = [
  { questionKey: "faq.q1.question", answerKey: "faq.q1.answer" },
  { questionKey: "faq.q2.question", answerKey: "faq.q2.answer" },
  { questionKey: "faq.q3.question", answerKey: "faq.q3.answer" },
  { questionKey: "faq.q4.question", answerKey: "faq.q4.answer" },
  { questionKey: "faq.q5.question", answerKey: "faq.q5.answer" },
  { questionKey: "faq.q6.question", answerKey: "faq.q6.answer" },
  { questionKey: "faq.q7.question", answerKey: "faq.q7.answer" },
  { questionKey: "faq.q8.question", answerKey: "faq.q8.answer" },
  { questionKey: "faq.q9.question", answerKey: "faq.q9.answer" },
  { questionKey: "faq.q10.question", answerKey: "faq.q10.answer" },
  { questionKey: "faq.q11.question", answerKey: "faq.q11.answer" },
  { questionKey: "faq.q12.question", answerKey: "faq.q12.answer" },
  { questionKey: "faq.q13.question", answerKey: "faq.q13.answer" },
  { questionKey: "faq.q14.question", answerKey: "faq.q14.answer" },
  { questionKey: "faq.q15.question", answerKey: "faq.q15.answer" },
  { questionKey: "faq.q16.question", answerKey: "faq.q16.answer" },
  { questionKey: "faq.q17.question", answerKey: "faq.q17.answer" },
  // q18 (personal info) has an embedded Privacy Policy link, so it's
  // rendered separately below rather than through this generic loop.
  { questionKey: "faq.q19.question", answerKey: "faq.q19.answer" },
  { questionKey: "faq.q20.question", answerKey: "faq.q20.answer" },
];

export default function FAQPage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">{t("faq.title")}</h1>
          <p className="text-lg text-page-secondary max-w-2xl mx-auto">
            {t("faq.subtitle")}
          </p>
        </div>

        <div className="card card-highlight">
          <div className="divide-y divide-white/10">
            {FAQ_KEYS.slice(0, 17).map((item, idx) => (
              <details key={idx} className="group py-4 first:pt-0 last:pb-0">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-semibold text-white">
                  {t(item.questionKey)}
                  <span className="text-white/40 transition-transform group-open:rotate-45 text-xl leading-none flex-shrink-0">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm text-white/70 leading-relaxed">{t(item.answerKey)}</p>
              </details>
            ))}

            <details className="group py-4">
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-semibold text-white">
                {t("faq.q18.question")}
                <span className="text-white/40 transition-transform group-open:rotate-45 text-xl leading-none flex-shrink-0">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm text-white/70 leading-relaxed">
                {t("faq.q18.answerPart1")}
                <Link href="/privacy" className="text-amber-300 hover:text-amber-200 underline">
                  {t("settings.privacyPolicy")}
                </Link>
                {t("faq.q18.answerPart2")}
              </p>
            </details>

            {FAQ_KEYS.slice(17).map((item, idx) => (
              <details key={17 + idx} className="group py-4 last:pb-0">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-semibold text-white">
                  {t(item.questionKey)}
                  <span className="text-white/40 transition-transform group-open:rotate-45 text-xl leading-none flex-shrink-0">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm text-white/70 leading-relaxed">{t(item.answerKey)}</p>
              </details>
            ))}
          </div>
        </div>

        <div className="text-center mt-10">
          <p className="text-sm text-page-tertiary">
            {t("faq.stillHaveQuestions")}{" "}
            <Link href="/contact" className="text-amber-300 hover:text-amber-200 underline">
              {t("faq.contactUs")}
            </Link>{" "}
            {t("faq.orLearnMore")}{" "}
            <Link href="/about" className="text-amber-300 hover:text-amber-200 underline">
              {t("faq.about")}
            </Link>{" "}
            {t("faq.trailingStandup")}
          </p>
        </div>
      </div>
    </div>
  );
}
