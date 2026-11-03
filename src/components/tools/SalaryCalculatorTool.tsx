"use client";

import { useMemo, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import {
  convertSalary,
  DEFAULT_HOURS_PER_WEEK,
  DEFAULT_WEEKS_PER_YEAR,
  formatCurrency,
  SALARY_BASES,
  type SalaryBasis,
} from "@/lib/salary";

const BASIS_KEY: Record<SalaryBasis, TranslationKey> = {
  annual: "salary.basis.annual",
  monthly: "salary.basis.monthly",
  biweekly: "salary.basis.biweekly",
  weekly: "salary.basis.weekly",
  hourly: "salary.basis.hourly",
};

const INPUT_CLASS =
  "w-full min-w-0 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40";

function parseNumber(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, "");
  return cleaned === "" ? NaN : Number(cleaned);
}

export default function SalaryCalculatorTool() {
  const { t } = useLanguage();
  const [basis, setBasis] = useState<SalaryBasis>("annual");
  const [amount, setAmount] = useState("");
  const [hours, setHours] = useState(String(DEFAULT_HOURS_PER_WEEK));
  const [weeks, setWeeks] = useState(String(DEFAULT_WEEKS_PER_YEAR));

  const result = useMemo(
    () => convertSalary(parseNumber(amount), basis, { hoursPerWeek: parseNumber(hours), weeksPerYear: parseNumber(weeks) }),
    [amount, basis, hours, weeks]
  );
  const showInvalid = amount.trim() !== "" && !result;

  function resetDefaults() {
    setHours(String(DEFAULT_HOURS_PER_WEEK));
    setWeeks(String(DEFAULT_WEEKS_PER_YEAR));
  }

  return (
    <div className="card card-highlight">
      <div className="mb-5">
        <h2 className="text-xl font-bold mb-1">{t("salary.title")}</h2>
        <p className="text-sm text-white/70">{t("salary.subtitle")}</p>
      </div>

      <div className="salary-grid">
        <div className="salary-inputs">
          <div>
            <div className="salary-label" id="salary-basis-label">{t("salary.inputBasis")}</div>
            <div className="goal-toolbar salary-basis" role="group" aria-labelledby="salary-basis-label">
              {SALARY_BASES.map((b) => (
                <button
                  key={b}
                  type="button"
                  className="btn goal-toolbar-btn salary-basis-btn"
                  aria-pressed={basis === b}
                  onClick={() => setBasis(b)}
                >
                  {t(BASIS_KEY[b])}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="salary-label">{t("salary.amount")}</span>
            <div className="salary-amount-wrap">
              <span className="salary-currency" aria-hidden="true">$</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={`${INPUT_CLASS} salary-amount`}
                aria-invalid={showInvalid}
              />
            </div>
          </label>

          <div className="salary-config">
            <label className="block">
              <span className="salary-label">{t("salary.hoursPerWeek")}</span>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                max={168}
                step="any"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className="salary-label">{t("salary.weeksPerYear")}</span>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                max={53}
                step="any"
                value={weeks}
                onChange={(e) => setWeeks(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          </div>
          <div>
            <button type="button" className="btn goal-toolbar-btn" onClick={resetDefaults}>
              {t("salary.reset")}
            </button>
          </div>
        </div>

        <section className="salary-results" aria-live="polite" aria-label={t("salary.estimated")}>
          <h3 className="text-sm font-semibold text-white/80 mb-2">{t("salary.estimated")}</h3>
          {result ? (
            <ul className="salary-result-list">
              {SALARY_BASES.map((b) => (
                <li key={b} className="salary-result-row" data-entered={b === basis}>
                  <span className="salary-result-label">
                    {t(BASIS_KEY[b])}
                    {b === basis && <span className="salary-entered">{t("salary.entered")}</span>}
                  </span>
                  <span className="salary-result-value">{formatCurrency(result[b])}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/50">{showInvalid ? t("salary.invalid") : "—"}</p>
          )}
          <p className="text-xs text-white/50 mt-3">{t("salary.note")}</p>
        </section>
      </div>
    </div>
  );
}
