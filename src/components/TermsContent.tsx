"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { TERMS_SECTIONS, TERMS_VARS } from "@/lib/terms";

// The Terms of Service body: a contents list (anchor links, so it works the same on a phone) and the numbered sections. Text comes from the terms.*
// translation keys; {privacyLink}, {contactLink} and {settingsLink} inside a paragraph become real links to the Privacy Policy, the Contact page and Settings.

export default function TermsContent() {
  const { t } = useLanguage();

  const linkify = (text: string): ReactNode =>
    text.split(/(\{privacyLink\}|\{contactLink\}|\{settingsLink\})/).map((part, i) => {
      if (part === "{privacyLink}")
        return (
          <Link key={i} href="/privacy" className="text-amber-300 hover:text-amber-200 underline">
            {t("settings.privacyPolicy")}
          </Link>
        );
      if (part === "{contactLink}")
        return (
          <Link key={i} href="/contact" className="text-amber-300 hover:text-amber-200 underline">
            {t("nav.contact")}
          </Link>
        );
      if (part === "{settingsLink}")
        return (
          <Link key={i} href="/standup/settings" className="text-amber-300 hover:text-amber-200 underline">
            {t("terms.settingsLinkText")}
          </Link>
        );
      return <Fragment key={i}>{part}</Fragment>;
    });

  return (
    <div className="break-words" data-testid="terms-content">
      <nav aria-labelledby="terms-contents-title" className="pb-6 mb-6 border-b border-white/10" data-testid="terms-toc">
        <h2 id="terms-contents-title" className="text-lg font-semibold text-white mb-3">
          {t("terms.tocTitle")}
        </h2>
        <ol className="list-decimal pl-5 space-y-1.5 text-sm">
          {TERMS_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-amber-300 hover:text-amber-200 underline underline-offset-2 inline-block py-0.5">
                {t(s.title)}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="divide-y divide-white/10">
        {TERMS_SECTIONS.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className={`scroll-mt-24 ${i === 0 ? "pb-6" : i === TERMS_SECTIONS.length - 1 ? "pt-6" : "py-6"}`} data-testid={`terms-section-${s.id}`}>
            <h2 id={`${s.id}-title`} className="text-lg font-semibold text-white mb-2">
              {i + 1}. {t(s.title)}
            </h2>
            <div className="space-y-3">
              {s.paragraphs.map((key) => (
                <p key={key} className="text-sm text-white/70 leading-relaxed">
                  {linkify(t(key, TERMS_VARS))}
                </p>
              ))}
            </div>
            <p className="mt-3 text-xs">
              <a href="#terms-contents-title" className="text-white/50 hover:text-white/70 underline underline-offset-2 inline-block py-1">
                {t("terms.backToContents")}
              </a>
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
