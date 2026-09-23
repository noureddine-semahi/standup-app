"use client";

import PrivacyPolicyContent from "@/components/PrivacyPolicyContent";
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

        <div className="card card-highlight">
          <PrivacyPolicyContent />
        </div>
      </div>
    </div>
  );
}
