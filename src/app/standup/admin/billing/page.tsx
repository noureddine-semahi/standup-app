"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { supabase } from "@/lib/supabase/client";
import { isCurrentUserSysAdmin } from "@/lib/supabase/db";
import { getBillingOverview } from "@/lib/admin/getBillingOverview";
import type { BillingOverviewResponse } from "@/lib/admin/billingOverview";
import { loginUrlWithReturn } from "@/lib/safeReturn";
import AdminBillingDashboard from "@/components/AdminBillingDashboard";
import AdminSubscriptionPreview from "@/components/AdminSubscriptionPreview";

// System Admin > Premium & Billing. System Admins only. The check below only decides what this page SHOWS: the numbers come from
// POST /api/admin/billing-overview, which verifies the System Admin on the server and refuses everyone else (so a member who reaches this URL, or
// calls the endpoint directly, gets nothing). Read-only: no action on this page changes a plan, a flag, a subscription or an account.

type Phase = "checking" | "denied" | "loading" | "ready" | "error";

export default function AdminBillingPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const routerRef = useRef(router); // the load below must not re-run just because the router object was recreated
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const [phase, setPhase] = useState<Phase>("checking");
  const [data, setData] = useState<BillingOverviewResponse | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    const result = await getBillingOverview({ getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null });
    if (result.kind === "ok") {
      setData(result.data);
      setPhase("ready");
    } else if (result.kind === "login") {
      routerRef.current.push(loginUrlWithReturn("/standup/admin/billing"));
    } else if (result.kind === "forbidden") {
      setPhase("denied");
    } else {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      let sys = false;
      try {
        sys = await isCurrentUserSysAdmin();
      } catch {
        sys = false;
      }
      if (!alive) return;
      if (!sys) {
        setPhase("denied");
        return;
      }
      await load();
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="card card-highlight">
        <Link href="/standup/admin" className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white/80 mb-3 py-1">
          <ArrowLeft size={15} aria-hidden="true" /> {t("adminBill.back")}
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold">{t("adminBill.title")}</h1>
        <p className="mt-2 text-white/70">{t("adminBill.subtitle")}</p>
      </div>

      {phase === "checking" || phase === "loading" ? (
        <p className="text-sm text-white/50" role="status" data-testid="adminbill-loading">
          {t("adminBill.loading")}
        </p>
      ) : null}

      {phase === "denied" && (
        <div className="card" role="alert" data-testid="adminbill-denied">
          <h2 className="text-lg font-semibold mb-1">{t("adminBill.deniedTitle")}</h2>
          <p className="text-sm text-white/70">{t("adminBill.denied")}</p>
        </div>
      )}

      {phase === "error" && (
        <div className="card" role="alert" data-testid="adminbill-error">
          <p className="text-sm text-red-300">
            {t("adminBill.error")}{" "}
            <button type="button" className="underline" onClick={() => void load()} data-testid="adminbill-retry">
              {t("premium.retry")}
            </button>
          </p>
        </div>
      )}

      {phase === "ready" && data && (
        <>
          <AdminBillingDashboard data={data} />
          <AdminSubscriptionPreview />
        </>
      )}
    </div>
  );
}
