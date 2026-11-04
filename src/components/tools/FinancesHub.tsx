"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { formatCurrency } from "@/lib/salary";
import { summarizeFinances } from "@/lib/paymentSummary";
import { summarizeBills } from "@/lib/bills";
import { findPossibleOverlaps, summarizeSubscriptions } from "@/lib/subscriptions";
import { valueLenStyle } from "@/lib/toolsLayout";
import PaymentsDashboard, { type PaymentsDashboardProps } from "./PaymentsDashboard";
import BillsTracker from "./BillsTracker";
import SubscriptionsTracker from "./SubscriptionsTracker";
import type { BillsController } from "./useBills";
import type { SubscriptionsController } from "./useSubscriptions";

export type FinancesHubProps = PaymentsDashboardProps & { bills: BillsController; subscriptions: SubscriptionsController };

type FinanceTab = "bills" | "payments" | "subscriptions";

const FIN_TABS: { key: FinanceTab; labelKey: "fin.tabBills" | "fin.tabPayments" | "fin.tabSubscriptions"; color: string; rgb: string }[] = [
  { key: "bills", labelKey: "fin.tabBills", color: "#f59e0b", rgb: "245, 158, 11" },
  { key: "payments", labelKey: "fin.tabPayments", color: "#f43f5e", rgb: "244, 63, 94" },
  { key: "subscriptions", labelKey: "fin.tabSubscriptions", color: "#a78bfa", rgb: "167, 139, 250" },
];

/**
 * Tools -> Finances. A headline overview (four separate figures -- never
 * summed into one grand total) above three internal tabs: Bills, Payments
 * (accounts) and Subscriptions.
 */
export default function FinancesHub({ bills, subscriptions, ...props }: FinancesHubProps) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<FinanceTab>("payments");
  // Real bills data only once it has actually loaded; otherwise the overview
  // stays on accounts alone rather than showing anything fabricated.
  const billsSummary = bills.state === "ready" ? summarizeBills(bills.bills, bills.occurrences, props.todayISO) : null;
  const subsSummary = subscriptions.state === "ready" ? summarizeSubscriptions(subscriptions.subscriptions, props.todayISO) : null;
  const activeBills = bills.state === "ready" ? bills.bills : [];
  const overview = summarizeFinances(props.accounts, props.todayISO, billsSummary, subsSummary);
  // Possible (not confirmed) duplicates between subscriptions and bills: surfaced, never merged.
  const overlapCount = subscriptions.state === "ready" ? findPossibleOverlaps(subscriptions.subscriptions, activeBills).length : 0;

  const panels: { key: string; label: string; value: string; kind: string; notes?: string[]; pending?: boolean }[] = [
    { key: "balances", label: t("fin.totalBalances"), value: formatCurrency(overview.totalBalances), kind: "balance" },
    {
      key: "due",
      label: t("fin.monthlyDue"),
      value: overview.monthlyDuePending ? t("bills.amountPendingShort") : formatCurrency(overview.monthlyDue),
      kind: "minimums",
      pending: overview.monthlyDuePending,
      notes: [
        // Estimates are labelled; "known only" is the caveat only when no estimate is mixed in.
        ...(overview.monthlyDueIncludesEstimates ? [t("bills.includesEstimates")] : []),
        ...(overview.monthlyDueUnknown > 0 && !overview.monthlyDuePending && !overview.monthlyDueIncludesEstimates ? [t("bills.knownOnly")] : []),
        ...(overview.monthlyDueUnknown > 0
          ? [overview.monthlyDueUnknown === 1 ? t("bills.awaitingOne") : t("bills.awaitingMany", { count: overview.monthlyDueUnknown })]
          : []),
      ],
    },
    {
      key: "subs",
      label: t("fin.subscriptions"),
      value: formatCurrency(overview.subscriptionsMonthly),
      kind: "subs",
      notes: [
        ...(overview.subscriptionsAwaitingPrice > 0
          ? [overview.subscriptionsAwaitingPrice === 1 ? t("subs.awaitingPriceOne") : t("subs.awaitingPriceMany", { count: overview.subscriptionsAwaitingPrice })]
          : []),
        ...(overview.subscriptionsOtherCurrency > 0 ? [t("subs.otherCurrencies", { count: overview.subscriptionsOtherCurrency })] : []),
        ...(overlapCount > 0 ? [overlapCount === 1 ? t("subs.mayOverlapOne") : t("subs.mayOverlapMany", { count: overlapCount })] : []),
      ],
    },
    { key: "upcoming", label: t("fin.upcoming"), value: String(overview.upcomingCount), kind: "upcoming" },
  ];

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
            <div className="pay-stat-value" style={valueLenStyle(p.value) as React.CSSProperties} data-pending={p.pending ? "true" : undefined} data-testid={`fin-${p.key}`}>
              {p.value}
            </div>
            {p.notes?.filter(Boolean).map((n) => (
              <div key={n} className="bill-stat-note">
                {n}
              </div>
            ))}
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
        {tab === "bills" && <BillsTracker controller={bills} todayISO={props.todayISO} />}
        {tab === "subscriptions" && <SubscriptionsTracker controller={subscriptions} todayISO={props.todayISO} bills={activeBills} />}
      </div>
    </div>
  );
}
