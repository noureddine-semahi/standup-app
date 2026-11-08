"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { getMyBillingStatus } from "@/lib/supabase/billingStatus";

// What Settings shows when Stripe sends the member back (?checkout=success or ?checkout=cancelled).
//
// The URL parameter is NEVER treated as proof of anything: anyone can type it, and a redirect says nothing about whether money moved. On
// "success" we only show "checking" and then ask the server-side billing record (the member-scoped status the verified webhook fills in)
// whether THIS SUBSCRIPTION now gives Premium. If it does, we say so; if the payment is still being completed we say that; if nothing
// arrives within about a minute we say we haven't received confirmation yet, with a "Check again" button. It never claims a payment.
// On "cancelled" it only says the member left checkout; it changes nothing and claims nothing about money.

type Phase = "none" | "cancelled" | "verifying" | "confirmed" | "incomplete" | "pending";

export const POLL_INTERVAL_MS = 4000;
export const POLL_ATTEMPTS = 15;

export default function CheckoutReturn({ onConfirmed }: { onConfirmed?: () => void }) {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<Phase>("none");
  const alive = useRef(true);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  const verify = useCallback(async () => {
    setPhase("verifying");
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      const status = await getMyBillingStatus();
      if (!alive.current) return;
      if (status?.subscriptionGrantsPremium) {
        setPhase("confirmed");
        onConfirmedRef.current?.();
        return;
      }
      setPhase(status?.status === "incomplete" ? "incomplete" : "verifying");
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!alive.current) return;
    }
    setPhase("pending");
  }, []);

  useEffect(() => {
    alive.current = true;
    let param: string | null = null;
    try {
      const url = new URL(window.location.href);
      param = url.searchParams.get("checkout");
      if (param === "success" || param === "cancelled") {
        // consume the parameter so a refresh doesn't replay it or leave a stale banner
        url.searchParams.delete("checkout");
        window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
      }
    } catch {
      param = null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (param === "cancelled") setPhase("cancelled");
    else if (param === "success") void verify();
    return () => {
      alive.current = false;
    };
  }, [verify]);

  if (phase === "none") return null;

  const text: Record<Exclude<Phase, "none">, string> = {
    cancelled: t("checkout.return.cancelled"),
    verifying: t("checkout.return.verifying"),
    confirmed: t("checkout.return.confirmed"),
    incomplete: t("checkout.return.incomplete"),
    pending: t("checkout.return.pending"),
  };

  return (
    <div className="rounded-lg border border-white/15 bg-white/5 p-3 text-sm space-y-2 mb-3" role="status" data-testid="checkout-return" data-phase={phase}>
      <p className={phase === "confirmed" ? "text-emerald-300" : "text-white/80"}>{text[phase]}</p>
      {phase === "pending" && (
        <button type="button" className="btn standup-metal-btn" onClick={() => void verify()} data-testid="checkout-check-again">
          {t("checkout.return.checkAgain")}
        </button>
      )}
    </div>
  );
}
