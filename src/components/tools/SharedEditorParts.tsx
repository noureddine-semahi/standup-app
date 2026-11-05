"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import { toCents } from "@/lib/bills";
import type { Allocation, ContributionSuggestion, SharedItemResult } from "@/lib/householdPlan";
import { FIELD_CLASS } from "./PaymentsDashboard";
import { fmt } from "./HouseholdParts";

// Pieces shared by the shared-expense editor and the joint-debt editor (Phase 2, Step 4A/4B): the "who covers it" box
// with its shortcuts and live remainder, suggestions, the explicit-link picker, and small display helpers. Test ids are
// prefixed per editor ("se" for expenses, "jd" for joint debts). No accounting lives here: remainders come from the
// calculation module via the `live` value the editors pass in.

export type TFn = (k: TranslationKey, p?: Record<string, string | number>) => string;

export function Field({ label, error, help, children }: { label: string; error?: string | null; help?: string; children: React.ReactNode }) {
  return (
    <label className="pay-field">
      <span className="pay-label">{label}</span>
      {children}
      {help && <span className="plan-row-note">{help}</span>}
      {error && (
        <span className="pay-field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

/** One person's stated share: an amount (including an explicit $0) or "not stated". */
export function whoText(name: string, value: number | null, t: TFn): string {
  return value === null ? `${name}: ${t("se.cardNotStated")}` : t("se.cardStated", { name, amount: fmt(toCents(value)) });
}

export function StatusChip({ item, id, idp }: { item: SharedItemResult; id: string; idp: string }) {
  const { t } = useLanguage();
  const key: TranslationKey =
    item.excludedReason !== null ? "se.chipCounted" : item.allocation.status === "assigned" ? "se.chipAssigned" : item.allocation.status === "partial" ? "se.chipPartial" : item.allocation.status === "unassigned" ? "se.chipUnassigned" : "se.chipInvalid";
  const status = item.excludedReason !== null || item.allocation.status === "assigned" ? "complete" : item.allocation.status === "invalid" ? "skipped" : "partial";
  return (
    <div>
      <span className="plan-chip" data-status={status} data-testid={`${idp}-chip-${id}`}>
        {t(key)}
      </span>
    </div>
  );
}

const moneyInput = `${FIELD_CLASS} plan-amount`;

/**
 * "Who covers it": the Me / Partner boxes (empty = not stated, 0 = covers nothing), the three shortcuts, the over-assigned
 * error and the live assigned / not-yet-assigned summary.
 */
export function WhoBox({
  idp, legend, hasPartner, partnerName, partnerLabel, me, partner, onMe, onPartner, shortcutsEnabled, onShortcut, meError, partnerError, overAssigned, live, note,
}: {
  idp: string;
  legend: string;
  hasPartner: boolean;
  partnerName: string;
  partnerLabel: string;
  me: string;
  partner: string;
  onMe: (v: string) => void;
  onPartner: (v: string) => void;
  shortcutsEnabled: boolean;
  onShortcut: (who: "me" | "partner" | "clear") => void;
  meError: string | null;
  partnerError: string | null;
  overAssigned: boolean;
  live: (Allocation & { totalCents: number }) | null;
  /** An extra line under the summary (for example "the payment is unknown"). */
  note?: string | null;
}) {
  const { t } = useLanguage();
  return (
    <fieldset className="se-who-box">
      <legend className="plan-card-title">{legend}</legend>
      <p className="plan-row-note">{t("se.fWhoHelp")}</p>
      <div className="se-grid2">
        <Field label={t("se.fMe")} error={meError}>
          <input type="text" inputMode="decimal" autoComplete="off" placeholder="—" value={me} onChange={(e) => onMe(e.target.value)} className={moneyInput} data-testid={`${idp}-f-me`} aria-invalid={!!meError} />
        </Field>
        {hasPartner && (
          <Field label={partnerLabel} error={partnerError}>
            <input type="text" inputMode="decimal" autoComplete="off" placeholder="—" value={partner} onChange={(e) => onPartner(e.target.value)} className={moneyInput} data-testid={`${idp}-f-partner`} aria-invalid={!!partnerError} />
          </Field>
        )}
      </div>
      <div className="se-actions" role="group" aria-label={legend}>
        <button type="button" className="plan-btn" onClick={() => onShortcut("me")} disabled={!shortcutsEnabled} data-testid={`${idp}-btn-me-all`}>
          {t("se.meAll")}
        </button>
        {hasPartner && (
          <button type="button" className="plan-btn" onClick={() => onShortcut("partner")} disabled={!shortcutsEnabled} data-testid={`${idp}-btn-partner-all`}>
            {t("se.partnerAll", { name: partnerName })}
          </button>
        )}
        <button type="button" className="plan-btn" onClick={() => onShortcut("clear")} data-testid={`${idp}-btn-clear`}>
          {t("se.clearWho")}
        </button>
      </div>
      {!shortcutsEnabled && (
        <p className="plan-row-note" data-testid={`${idp}-shortcut-hint`}>
          {t("se.shortcutNeedsAmount")}
        </p>
      )}
      {overAssigned && (
        <p className="pay-field-error" role="alert" data-testid={`${idp}-error-over`}>
          {t("se.eOver")}
        </p>
      )}
      <div className="se-summary" data-testid={`${idp}-summary`} aria-live="polite">
        {live === null ? null : live.status === "unassigned" ? (
          <>
            <p className="plan-row-note">{t("se.sumNone")}</p>
            <p className="plan-row-note" data-testid={`${idp}-sum-remaining`}>
              {t("se.sumRemaining", { amount: fmt(live.unassignedCents) })}
            </p>
          </>
        ) : live.status === "invalid" ? null : (
          <>
            <p className="plan-row-note" data-testid={`${idp}-sum-assigned`}>
              {t("se.sumAssigned", { amount: fmt(live.meCents + live.partnerCents) })}
            </p>
            {live.unassignedCents > 0 ? (
              <p className="plan-row-note" data-testid={`${idp}-sum-remaining`}>
                {t("se.sumRemaining", { amount: fmt(live.unassignedCents) })}
              </p>
            ) : (
              <p className="plan-row-note" data-testid={`${idp}-sum-full`}>
                {t("se.sumFull")}
              </p>
            )}
          </>
        )}
        {note && (
          <p className="plan-row-note" data-testid={`${idp}-who-note`}>
            {note}
          </p>
        )}
      </div>
    </fieldset>
  );
}

/** Suggested contributions (from a linked planner entry). Applied only when the user presses Use. */
export function Suggestions({ idp, suggestions, partnerName, onUse }: { idp: string; suggestions: ContributionSuggestion[]; partnerName: string; onUse: (person: "me" | "partner", cents: number) => void }) {
  const { t } = useLanguage();
  if (suggestions.length === 0) return null;
  return (
    <div data-testid={`${idp}-suggestions`}>
      <h5 className="plan-card-title">{t("se.suggTitle")}</h5>
      <p className="plan-row-note">{t("se.suggNote")}</p>
      <ul className="hh-list">
        {suggestions.map((s) => (
          <li key={s.person} data-testid={`${idp}-sugg-${s.person}`} className="se-sugg">
            <span>{t("se.suggLine", { name: s.person === "me" ? t("plan.personMe") : partnerName, amount: fmt(s.cents) })}</span>
            <button type="button" className="plan-btn" onClick={() => onUse(s.person, s.cents)} data-testid={`${idp}-sugg-use-${s.person}`}>
              {t("se.suggUse")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type LinkChoice = { key: string; label: string; amountCents: number | null; checked: boolean; toggle: () => void };
export type LinkChoiceGroup = { group: string; title: string; items: LinkChoice[] };

/** The explicit-link picker. Listing a choice links nothing; only ticking it does. */
export function LinksBox({ idp, title, help, groups, count, error }: { idp: string; title: string; help: string; groups: LinkChoiceGroup[]; count: number; error?: string | null }) {
  const { t } = useLanguage();
  return (
    <details className="se-links" data-testid={`${idp}-links`} open={count > 0}>
      <summary>
        {title}{" "}
        <span className="plan-chip" data-status={count > 0 ? "complete" : "todo"} data-testid={`${idp}-link-count`}>
          {t("se.linkCount", { count })}
        </span>
      </summary>
      <p className="plan-row-note">{help}</p>
      {groups.length === 0 && <p className="plan-row-note">{t("se.linkNone")}</p>}
      {groups.map((g) => (
        <div key={g.group}>
          <h5 className="plan-card-title">{g.title}</h5>
          {g.items.map((c) => (
            <label key={c.key} className="plan-check se-link" data-testid={`${idp}-link-${c.key}`}>
              <input type="checkbox" checked={c.checked} onChange={c.toggle} />
              <span>
                {c.label} · {c.amountCents === null ? t("plan.dash") : fmt(c.amountCents)}
              </span>
            </label>
          ))}
        </div>
      ))}
      {error && (
        <p className="pay-field-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
