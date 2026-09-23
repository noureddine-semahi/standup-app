"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** The Privacy Policy's body sections — shared by the standalone /privacy page and the signup consent modal so both render from one source. */
export default function PrivacyPolicyContent() {
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.whatWeCollectTitle")}</h2>
        <p className="text-sm text-white/70">{t("privacy.whatWeCollectBody")}</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.whyWeCollectTitle")}</h2>
        <p className="text-sm text-white/70">{t("privacy.whyWeCollectBody")}</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.homepageVisitsTitle")}</h2>
        <p className="text-sm text-white/70">{t("privacy.homepageVisitsBody")}</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.referralsTitle")}</h2>
        <p className="text-sm text-white/70">{t("privacy.referralsBody")}</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.whereStoredTitle")}</h2>
        <p className="text-sm text-white/70">{t("privacy.whereStoredBody")}</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-2">{t("privacy.yourControlTitle")}</h2>
        <p className="text-sm text-white/70">{t("privacy.yourControlBody")}</p>
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
  );
}
