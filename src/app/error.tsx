"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="card text-center max-w-md">
        <h1 className="text-3xl font-bold mb-2">{t("errorPage.title")}</h1>
        <p className="text-white/70 mb-6">{error.message || t("errorPage.unexpectedError")}</p>
        <button onClick={() => reset()} className="btn btn-primary">
          {t("errorPage.tryAgain")}
        </button>
      </div>
    </div>
  );
}
