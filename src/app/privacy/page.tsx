"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function PrivacyPage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">{t("privacy.title")}</h1>
          <p className="text-lg text-page-secondary">{t("privacy.lastUpdated")}</p>
        </div>

        <div className="card card-highlight space-y-6">
          <section>
            <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.whatWeCollectTitle")}</h2>
            <p className="text-sm text-white/70">
              {t("privacy.whatWeCollectBody")}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.whyWeCollectTitle")}</h2>
            <p className="text-sm text-white/70">
              {t("privacy.whyWeCollectBody")}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.homepageVisitsTitle")}</h2>
            <p className="text-sm text-white/70">
              {t("privacy.homepageVisitsBody")}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.referralsTitle")}</h2>
            <p className="text-sm text-white/70">
              {t("privacy.referralsBody")}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.whereStoredTitle")}</h2>
            <p className="text-sm text-white/70">
              {t("privacy.whereStoredBody")}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.yourControlTitle")}</h2>
            <p className="text-sm text-white/70">
              {t("privacy.yourControlBody")}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.questionsTitle")}</h2>
            <p className="text-sm text-white/70">
              {t("privacy.questionsPart1")}
              <Link href="/contact" className="text-amber-300 hover:text-amber-200 underline">
                {t("nav.contact")}
              </Link>
              {t("privacy.questionsPart2")}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
