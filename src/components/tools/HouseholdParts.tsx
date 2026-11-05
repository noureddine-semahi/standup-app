"use client";

import { useState } from "react";
import { Download, TriangleAlert } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import { formatCurrency } from "@/lib/salary";
import { EXPORT_FILE_NAME, buildExportJson, type DuplicateWarning, type Figure, type OverviewAssumption, type OverviewModel, type OverviewWarning } from "@/lib/householdOverview";

// Display pieces shared by the Household Overview and the shared-expense editor.

export const fmt = (cents: number) => formatCurrency(cents / 100);

export function Value({ f, testId }: { f: Figure; testId: string }) {
  const { t } = useLanguage();
  return (
    <span className="hh-val" data-kind={f.kind} data-testid={testId}>
      {f.kind === "atLeast" && <small className="hh-qual">{t("hh.atLeast")}</small>}
      <span className="hh-num">{f.kind === "unknown" ? t("plan.dash") : fmt(f.cents)}</span>
    </span>
  );
}

export const textOf = (f: Figure, dash: string) => (f.kind === "unknown" ? dash : fmt(f.cents));


export const ASSUME_KEY: Record<OverviewAssumption, TranslationKey> = {
  incomeIncomplete: "hh.assumeIncome",
  spendingIncomplete: "hh.assumeSpending",
  unassignedCoveredByHouseholdIncome: "hh.assumeUnassigned",
  storedDataUnreadable: "hh.assumeUnreadable",
};

export function warnText(w: OverviewWarning, t: (k: TranslationKey, p?: Record<string, string | number>) => string, partnerName: string): string {
  switch (w.code) {
    case "meIncomeUnknown": return t("hh.w.meIncomeUnknown");
    case "partnerIncomeUnknown": return t("hh.w.partnerIncomeUnknown", { name: w.name || partnerName });
    case "sharedCostsUnanswered": return t("hh.w.sharedCostsUnanswered");
    case "sharedDebtsUnanswered": return t("hh.w.sharedDebtsUnanswered");
    case "payerNotSet": return t("hh.w.payerNotSet", { count: w.count ?? 0, amount: fmt(w.cents ?? 0) });
    case "spendingIncomplete": return w.person === "me" ? t("hh.w.spendingIncompleteMe") : t("hh.w.spendingIncomplete", { name: w.name ?? "" });
    case "unassignedWithExcludedPartner": return t("hh.w.unassignedWithExcludedPartner", { amount: fmt(w.cents ?? 0), name: partnerName });
    case "contributionsInvalid": return t("hh.w.contributionsInvalid", { label: w.label ?? "" });
    case "invalidAmount": return t("hh.w.invalidAmount", { label: w.label ?? "" });
    case "compositionAdultsBelowEarners": return t("hh.w.compositionAdultsBelowEarners");
    case "partnerExcludedFundsSharedCosts": return t("hh.w.partnerExcludedFundsSharedCosts", { name: partnerName, amount: fmt(w.cents ?? 0) });
    case "storedDataUnreadable": return "";
  }
}

export function dupText(d: DuplicateWarning, t: (k: TranslationKey, p?: Record<string, string | number>) => string): string {
  switch (d.code) {
    case "possibleBillOverlap": return t("hh.d.possibleBillOverlap", { label: d.label });
    case "possibleSubscriptionOverlap": return d.relatedName ? t("hh.d.possibleSubscriptionOverlapNamed", { label: d.label, related: d.relatedName }) : t("hh.d.possibleSubscriptionOverlap", { label: d.label });
    case "possibleSharedPersonalOverlap": return d.person === "me" ? t("hh.d.possibleSharedPersonalOverlapMe", { label: d.label }) : t("hh.d.possibleSharedPersonalOverlap", { label: d.label, name: d.personName ?? "" });
    case "possibleDuplicateJointDebt": return d.person === "me" ? t("hh.d.possibleDuplicateJointDebtMe", { label: d.label }) : t("hh.d.possibleDuplicateJointDebt", { label: d.label, name: d.personName ?? "" });
  }
}


export function IntegrityAlert({ model, stored, integrity }: { model: OverviewModel; stored: Parameters<typeof buildExportJson>[0]; integrity: Parameters<typeof buildExportJson>[1] }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<"idle" | "done" | "failed">("idle");
  const count = model.integrity.unreadableCount;

  function download() {
    try {
      const json = buildExportJson(stored, integrity);
      const a = document.createElement("a");
      const canBlob = typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
      const url = canBlob ? URL.createObjectURL(new Blob([json], { type: "application/json" })) : "data:application/json;charset=utf-8," + encodeURIComponent(json);
      a.href = url;
      a.download = EXPORT_FILE_NAME;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (canBlob) setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("done");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <section className="plan-glass hh-alert" role="alert" data-testid="hh-integrity" aria-label={t("hh.intTitle")}>
      <h4 className="plan-card-title">
        <TriangleAlert size={16} aria-hidden="true" /> {t("hh.intTitle")}
      </h4>
      <p className="plan-row-note" data-testid="hh-integrity-body">
        {count > 0 ? t("hh.intBody", { count }) : t("hh.intBodyFields")}
      </p>
      <button type="button" className="plan-btn plan-gold" onClick={download} data-testid="hh-export">
        <Download size={16} aria-hidden="true" /> {t("hh.intExport")}
      </button>
      {status === "done" && (
        <p className="plan-row-note" role="status" data-testid="hh-export-done">
          {t("hh.intExported")}
        </p>
      )}
      {status === "failed" && (
        <p className="plan-warn" role="alert" data-testid="hh-export-failed">
          {t("hh.intExportFailed")}
        </p>
      )}
    </section>
  );
}

/** "2 adults, 1 child, 0 others": singular for exactly 1, plural otherwise; an unanswered part reads "? adults". */
export function sizePartsText(
  parts: { adults: number | null; children: number | null; otherMembers: number | null },
  t: (k: TranslationKey, p?: Record<string, string | number>) => string
): string {
  const one = (n: number | null, singular: TranslationKey, plural: TranslationKey) => t(n === 1 ? singular : plural, { count: n === null ? t("hh.noteUnknownCount") : n });
  return [one(parts.adults, "hh.sizeAdultOne", "hh.sizeAdultMany"), one(parts.children, "hh.sizeChildOne", "hh.sizeChildMany"), one(parts.otherMembers, "hh.sizeOtherOne", "hh.sizeOtherMany")].join(", ");
}

export function Responsibility({ model }: { model: OverviewModel }) {
  const { t } = useLanguage();
  const dash = t("plan.dash");
  const m = model;
  return (
    <section className="plan-glass" data-testid="hh-responsibility" aria-label={t("hh.respTitle")}>
      <h4 className="plan-card-title">{t("hh.respTitle")}</h4>
      <p className="plan-row-note">{t("hh.respNote")}</p>
      <dl className="plan-rows">
        {m.responsibility.rows.map((r) => (
          <div key={r.key} className="plan-row" data-testid={`hh-resp-${r.key}`} data-excluded={r.excluded}>
            <dt>
              {r.excluded ? t("hh.respExcluded", { name: r.name }) : r.name}
              <span className="plan-row-note">
                {r.excluded
                  ? r.stated
                    ? t("hh.respExcludedNote", { amount: fmt(r.towardSharedCents) })
                    : t("hh.respExcludedNothing")
                  : r.figure.kind === "unknown"
                    ? t("hh.respUnknown")
                    : `${t("hh.respOwn")}: ${textOf(r.personal, dash)} · ${t("hh.respShared")}: ${fmt(r.towardSharedCents)}`}
              </span>
            </dt>
            <dd>
              <Value f={r.figure} testId={`hh-resp-${r.key}-value`} />
            </dd>
          </div>
        ))}
        <div className="plan-row hh-unassigned" data-testid="hh-unassigned" data-tone={m.responsibility.unassigned && m.responsibility.unassigned.cents > 0 ? "gold" : "none"}>
          <dt>
            {t("hh.unassignedTitle")}
            <span className="plan-row-note">{m.responsibility.unassigned === null ? t("hh.respNoShared") : m.responsibility.unassigned.cents > 0 ? `${t("hh.unassignedNote")} (${t("hh.unassignedItems", { count: m.responsibility.unassigned.itemCount })})` : t("hh.unassignedNone")}</span>
          </dt>
          <dd data-testid="hh-unassigned-value">{m.responsibility.unassigned === null ? dash : fmt(m.responsibility.unassigned.cents)}</dd>
        </div>
      </dl>
      {m.partial.length > 0 && (
        <div className="hh-partial" data-testid="hh-partial">
          <h5 className="plan-card-title">{t("hh.partialTitle")}</h5>
          <p className="plan-row-note">{t("hh.partialNote")}</p>
          <ul className="hh-list">
            {m.partial.map((p) => (
              <li key={p.id} data-testid={`hh-partial-${p.id}`}>
                {t("hh.partialLine", { label: p.label, assigned: fmt(p.assignedCents), total: fmt(p.totalCents), remaining: fmt(p.unassignedCents) })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Completeness warnings (what is missing or needs attention). The unreadable-data warning has its own alert. */
export function WarningsCard({ model }: { model: OverviewModel }) {
  const { t } = useLanguage();
  const warnings = model.warnings.filter((w) => w.code !== "storedDataUnreadable");
  return (
    <section className="plan-glass" data-testid="hh-warnings" aria-label={t("hh.warnTitle")}>
      <h4 className="plan-card-title">
        <TriangleAlert size={16} aria-hidden="true" /> {t("hh.warnTitle")}
      </h4>
      {warnings.length === 0 ? (
        <p className="plan-row-note" data-testid="hh-warnings-none">
          {t("hh.warnNone")}
        </p>
      ) : (
        <ul className="hh-list">
          {warnings.map((w, i) => (
            <li key={w.code + i} data-severity={w.severity} data-code={w.code}>
              {warnText(w, t, model.names.partner ?? "")}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Possible duplicates: guesses only. Nothing is removed or linked. */
export function DuplicatesCard({ model }: { model: OverviewModel }) {
  const { t } = useLanguage();
  if (model.duplicates.length === 0) return null;
  return (
    <section className="plan-glass" data-testid="hh-duplicates" aria-label={t("hh.dupTitle")}>
      <h4 className="plan-card-title">{t("hh.dupTitle")}</h4>
      <p className="plan-row-note">{t("hh.dupNote")}</p>
      <ul className="hh-list">
        {model.duplicates.map((d, i) => (
          <li key={d.code + d.itemId + i} data-code={d.code}>
            {dupText(d, t)}
          </li>
        ))}
      </ul>
    </section>
  );
}
