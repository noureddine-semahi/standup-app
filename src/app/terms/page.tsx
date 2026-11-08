"use client";

import { useEffect } from "react";
import Link from "next/link";
import TermsContent from "@/components/TermsContent";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { CURRENT_TERMS, isInEffect, termsStatusLine } from "@/lib/terms";

// Public page (outside /standup, so no sign-in is needed), laid out like /privacy.
export default function TermsPage() {
  const { t, language } = useLanguage();

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

  const formatDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(language === "es" ? "es" : "en", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
    } catch {
      return iso;
    }
  };

  return (
    <div className="min-h-screen">
      <noscript>
        <style>{`.scroll-reveal { opacity: 1 !important; transform: none !important; }`}</style>
      </noscript>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="scroll-reveal text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">{t("terms.title")}</h1>
          <p className="text-lg text-page-secondary" data-testid="terms-status">
            {termsStatusLine(CURRENT_TERMS, formatDate, t)}
          </p>
        </div>

        {!isInEffect(CURRENT_TERMS) && (
          <div role="note" className="scroll-reveal rounded-lg border border-amber-400/40 bg-amber-400/10 p-4 mb-6 text-sm text-white/80" data-testid="terms-draft-notice">
            {t("terms.draftNotice")}
          </div>
        )}

        <div className="scroll-reveal card card-highlight">
          <TermsContent />
        </div>

        <p className="scroll-reveal mt-8 text-center text-sm text-white/60">
          <Link href="/privacy" className="text-amber-300 hover:text-amber-200 underline">
            {t("settings.privacyPolicy")}
          </Link>
          {" · "}
          <Link href="/contact" className="text-amber-300 hover:text-amber-200 underline">
            {t("nav.contact")}
          </Link>
        </p>
      </div>
    </div>
  );
}
