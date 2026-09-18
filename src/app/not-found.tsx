"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function NotFound() {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="card text-center">
        <h1 className="text-3xl font-bold mb-2">{t("notFound.title")}</h1>
        <p className="text-white/70 mb-6">
          {t("notFound.body")}
        </p>
        <Link href="/" className="btn btn-primary">
          {t("notFound.backHome")}
        </Link>
      </div>
    </div>
  );
}
