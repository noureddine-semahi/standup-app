"use client";

import { useEffect } from "react";
import PrivacyPolicyContent from "@/components/PrivacyPolicyContent";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function PrivacyPage() {
  const { t } = useLanguage();

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
      <noscript>
        <style>{`.scroll-reveal { opacity: 1 !important; transform: none !important; }`}</style>
      </noscript>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="scroll-reveal text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">{t("privacy.title")}</h1>
          <p className="text-lg text-page-secondary">{t("privacy.lastUpdated")}</p>
        </div>

        <div className="scroll-reveal card card-highlight">
          <PrivacyPolicyContent />
        </div>
      </div>
    </div>
  );
}
