"use client";

import { useEffect } from "react";
import Link from "next/link";
import SocialShareButtons from "@/components/SocialShareButtons";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const CONTACT_EMAIL = "deandevsolutions@gmail.com";

export default function ContactPage() {
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
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="scroll-reveal text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">{t("contact.title")}</h1>
          <p className="text-lg text-page-secondary">
            {t("contact.subtitle")}
          </p>
        </div>

        <div className="scroll-reveal card card-highlight text-center">
          <div className="p-2">
            <div className="text-sm text-white/60 mb-2">{t("contact.reachUs")}</div>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-sm sm:text-2xl font-semibold text-amber-300 hover:text-amber-200 transition"
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {CONTACT_EMAIL}
            </a>
            <p className="mt-6 text-sm text-white/60">
              {t("contact.fasterAnswerPart1")}
              <Link href="/faq" className="text-amber-300 hover:text-amber-200 underline">
                {t("nav.faq")}
              </Link>
              {t("contact.fasterAnswerPart2")}
              <Link href="/about" className="text-amber-300 hover:text-amber-200 underline">
                {t("nav.about")}
              </Link>
              {t("contact.fasterAnswerPart3")}
            </p>

            <div className="mt-6 pt-6" style={{ borderTop: "1px solid rgba(var(--tint-rgb), 0.1)" }}>
              <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
                {t("contact.spreadTheWord")}
              </div>
              <SocialShareButtons />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
