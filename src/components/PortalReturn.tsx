"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

// What Settings shows when Stripe's Customer Portal sends the member back (?portal=return). Informational ONLY: the parameter is never proof
// of anything (anyone can type it), it is removed from the address bar so a refresh doesn't replay it, and it changes nothing. Whatever the
// member did in the portal reaches their plan only through verified Stripe webhooks; the Subscription section below shows what StandUp has
// actually received.

export default function PortalReturn() {
  const { t } = useLanguage();
  const [back, setBack] = useState(false);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("portal") === "return") {
        url.searchParams.delete("portal");
        window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setBack(true);
      }
    } catch {
      // no usable address: show nothing
    }
  }, []);

  if (!back) return null;
  return (
    <div className="rounded-lg border border-white/15 bg-white/5 p-3 text-sm mb-3" role="status" data-testid="portal-return">
      <p className="text-white/80">{t("portal.return")}</p>
    </div>
  );
}
