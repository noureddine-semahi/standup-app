"use client";

import { useLayoutEffect, useState } from "react";
import { Wallet, Receipt, CreditCard, RefreshCw, PiggyBank, Calculator as CalculatorIcon } from "lucide-react";
import CalculatorTool from "@/components/tools/CalculatorTool";
import SalaryCalculatorTool from "@/components/tools/SalaryCalculatorTool";
import FinancesHub, { type FinancesSection } from "@/components/tools/FinancesHub";
import PlannerHome from "@/components/tools/PlannerHome";
import { useFinancialProfile } from "@/components/tools/useFinancialProfile";
import { useHousehold } from "@/components/tools/useHousehold";
import { useBills } from "@/components/tools/useBills";
import { useSubscriptions } from "@/components/tools/useSubscriptions";
import { usePaymentAccounts } from "@/components/tools/usePaymentAccounts";
import { readFinancesTab, writeFinancesTab } from "@/lib/toolsTabStorage";
import { useFixedSubNav } from "@/lib/useFixedSubNav";
import { toISODate } from "@/lib/supabase/db";
import { hexToRgbTriple } from "@/lib/color";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";

type FinancesTab = FinancesSection | "planner" | "calculators";
type Calc = "standard" | "salary";

// Same hanging folder-tab bar as Tools and Social. Colors carry over from where each piece lived before:
// the Finances hub's own tab colors, and the Planner / Calculator / Salary tab colors from Tools.
// shortLabelKey: shown instead of the full label on narrow phones, where the active tab's label would be cut off.
const TABS: { key: FinancesTab; labelKey: TranslationKey; shortLabelKey?: TranslationKey; icon: typeof Wallet; color: string }[] = [
  { key: "overview", labelKey: "fin.tabOverview", icon: Wallet, color: "#60a5fa" },
  { key: "bills", labelKey: "fin.tabBills", icon: Receipt, color: "#f59e0b" },
  { key: "payments", labelKey: "fin.tabPayments", icon: CreditCard, color: "#f43f5e" },
  { key: "subscriptions", labelKey: "fin.tabSubscriptions", icon: RefreshCw, color: "#a78bfa" },
  { key: "planner", labelKey: "backlog.tabPlanner", shortLabelKey: "fin.tabPlannerShort", icon: PiggyBank, color: "#2dd4bf" },
  { key: "calculators", labelKey: "fin.tabCalculators", icon: CalculatorIcon, color: "#fb923c" },
];
const TAB_KEYS = TABS.map((x) => x.key);

export default function FinancesPage() {
  const { t } = useLanguage();
  const [activeTab, setActiveTabState] = useState<FinancesTab>("overview");
  const [calc, setCalc] = useState<Calc>("standard");

  // A ?tab= link wins, then the tab that was open last time. Runs before the first paint, and only a click writes
  // the choice back, so the default can never overwrite the remembered tab.
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("tab");
    const tab = (TAB_KEYS as string[]).includes(linked ?? "") ? (linked as FinancesTab) : readFinancesTab(TAB_KEYS);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab) setActiveTabState(tab);
    if (params.get("calc") === "salary") setCalc("salary");
  }, []);
  const setActiveTab = (next: FinancesTab) => {
    setActiveTabState(next);
    writeFinancesTab(next);
    try {
      window.history.replaceState(null, "", `/standup/finances?tab=${next}`);
    } catch {
      // the address bar simply keeps the old query
    }
  };

  const { sentinelRef, barRef, wrapperRef, contentRef, barStyle, wrapperStyle } = useFixedSubNav(activeTab);
  const todayISO = toISODate(new Date());
  // Financial data: the same hooks the Tools page used, now owned here.
  const bills = useBills(todayISO, t("bills.failed"));
  const subscriptions = useSubscriptions(t("subs.failed"));
  const financialProfile = useFinancialProfile(t("plan.failed"));
  const household = useHousehold(t("plan.failed"));
  const payments = usePaymentAccounts();

  const activeIndex = TABS.findIndex((x) => x.key === activeTab);
  const activeColor = TABS[activeIndex]?.color;

  return (
    <div className="space-y-6">
      <div ref={wrapperRef} style={wrapperStyle}>
        <div ref={sentinelRef} style={{ height: 0 }} />
        <div ref={barRef} className="folder-tabbar folder-tabbar-tools" style={barStyle} role="tablist" aria-label={t("nav.finances")}>
          {TABS.map((tab, idx) => {
            const isActive = idx === activeIndex;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`fin-nav-${tab.key}`}
                onClick={() => setActiveTab(tab.key)}
                className={`folder-tab folder-tab-tools${isActive ? " folder-tab-active" : ""}${idx === activeIndex - 1 ? " folder-tab-tools-left-of-active" : ""}${
                  idx === activeIndex + 1 ? " folder-tab-tools-right-of-active" : ""
                }`}
                style={{ "--tab-color": tab.color, "--tab-color-rgb": hexToRgbTriple(tab.color), "--active-glow-color": activeColor } as React.CSSProperties}
              >
                <tab.icon size={15} />
                {tab.shortLabelKey ? (
                  <>
                    <span className="tab-label-full">{t(tab.labelKey)}</span>
                    <span className="tab-label-short">{t(tab.shortLabelKey)}</span>
                  </>
                ) : (
                  <span>{t(tab.labelKey)}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Each panel carries its own heading, so there is no separate intro card here; the zero-height element
            is the landmark the sticky tab bar scrolls to on a tab switch. */}
        <div ref={contentRef} aria-hidden="true" style={{ height: 0, overflow: "hidden" }} />

        {(activeTab === "overview" || activeTab === "bills" || activeTab === "payments" || activeTab === "subscriptions") && (
          <div>
            <FinancesHub section={activeTab} bills={bills} subscriptions={subscriptions} todayISO={todayISO} {...payments} />
          </div>
        )}

        {activeTab === "planner" && (
          <div>
            <PlannerHome
              me={financialProfile}
              household={household}
              bills={bills.bills}
              accounts={payments.accounts}
              subscriptions={subscriptions.subscriptions}
              todayISO={todayISO}
            />
          </div>
        )}

        {activeTab === "calculators" && (
          <div className="space-y-4">
            <div className="goal-toolbar fin-tabs" role="tablist" aria-label={t("fin.tabCalculators")}>
              {(["standard", "salary"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={calc === c}
                  data-testid={`fin-calc-${c}`}
                  className="btn goal-toolbar-btn salary-basis-btn fin-tab"
                  style={{ "--tint-color-rgb": c === "standard" ? "251, 146, 60" : "250, 204, 21", "--tab-color": c === "standard" ? "#fb923c" : "#facc15" } as React.CSSProperties}
                  onClick={() => setCalc(c)}
                >
                  {t(c === "standard" ? "backlog.tabCalculator" : "backlog.tabSalary")}
                </button>
              ))}
            </div>
            <p className="text-white/70 text-sm">{t(calc === "standard" ? "tools.descCalculator" : "tools.descSalary")}</p>
            {calc === "standard" ? <CalculatorTool /> : <SalaryCalculatorTool />}
          </div>
        )}
      </div>
    </div>
  );
}
