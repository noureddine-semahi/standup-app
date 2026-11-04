"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { formatCurrency } from "@/lib/salary";
import { summarizeFinances } from "@/lib/paymentSummary";
import PaymentsDashboard, { type PaymentsDashboardProps } from "./PaymentsDashboard";

type FinanceTab = "bills" | "payments" | "subscriptions";

const FIN_TABS: { key: FinanceTab; labelKey: "fin.tabBills" | "fin.tabPayments" | "fin.tabSubscriptions"; color: string; rgb: string }[] = [
  { key: "bills", labelKey: "fin.tabBills", color: "#f59e0b", rgb: "245, 158, 11" },
  { key: "payments", labelKey: "fin.tabPayments", color: "#f43f5e", rgb: "244, 63, 94" },
  { key: "subscriptions", labelKey: "fin.tabSubscriptions", color: "#a78bfa", rgb: "167, 139, 250" },
];

/**
 * Tools -> Finances. A headline overview (four separate figures -- never
 * summed into one grand total) above three internal tabs. Payments is the
 * existing accounts experience; Bills and Subscriptions arrive in later
 * phases and show an honest placeholder until then.
 */
export default function FinancesHub(props: PaymentsDashboardProps) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<FinanceTab>("payments");
  const overview = summarizeFinances(props.accounts, props.todayISO);

  const panels: { key: string; label: string; value: string; kind: string }[] = [
    { key: "balances", label: t("fin.totalBalances"), value: formatCurrency(overview.totalBalances), kind: "balance" },
    { key: "due", label: t("fin.monthlyDue"), value: formatCurrency(overview.monthlyDue), kind: "minimums" },
    { key: "subs", label: t("fin.subscriptions"), value: formatCurrency(overview.subscriptionsMonthly), kind: "subs" },
    { key: "upcoming", label: t("fin.upcoming"), value: String(overview.upcomingCount), kind: "upcoming" },
  ];
  const longValues = panels.some((p) => p.value.length > 10);

  return (
    <div className="card card-highlight pay-root">
      <div className="pay-head">
        <div>
          <h2 className="text-xl font-bold mb-1">{t("fin.title")}</h2>
          <p className="text-sm text-white/70">{t("fin.subtitle")}</p>
        </div>
      </div>

      <section className="pay-summary fin-overview" aria-label={t("fin.overview")}>
        {panels.map((p) => (
          <div key={p.key} className="pay-stat" data-kind={p.kind}>
            <div className="pay-stat-label">{p.label}</div>
            <div className="pay-stat-value" data-long={longValues} data-testid={`fin-${p.key}`}>
              {p.value}
            </div>
          </div>
        ))}
      </section>

      <div className="goal-toolbar fin-tabs" role="tablist" aria-label={t("fin.sections")}>
        {FIN_TABS.map((ft) => (
          <button
            key={ft.key}
            type="button"
            role="tab"
            aria-selected={tab === ft.key}

            className="btn goal-toolbar-btn salary-basis-btn fin-tab"
            style={{ "--tint-color-rgb": ft.rgb, "--tab-color": ft.color } as React.CSSProperties}
            onClick={() => setTab(ft.key)}
          >
            {t(ft.labelKey)}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="fin-panel">
        {tab === "payments" && <PaymentsDashboard {...props} />}
        {tab === "bills" && <p className="text-sm text-white/60 italic">{t("fin.comingBills")}</p>}
        {tab === "subscriptions" && <p className="text-sm text-white/60 italic">{t("fin.comingSubs")}</p>}
      </div>
    </div>
  );
}
