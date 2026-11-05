"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { IntegrityAlert } from "./HouseholdParts";
import SharedExpensesEditor, { type EditorShared } from "./SharedExpensesEditor";
import SharedDebtsEditor from "./SharedDebtsEditor";
import SharedGoalsEditor from "./SharedGoalsEditor";

// Tools > Planner > Household > Shared: the shared-expense (4A), joint-debt (4B) and shared-goal (4C) editors on one tab.
// They share one revision-checked data layer, so this wrapper holds what they must agree on: the unreadable-data warning
// with the original-JSON download and the one acknowledgement that unlocks saving over it, and "only one form open at a time".

type Base = Omit<EditorShared, "canEdit" | "ack" | "onSaved" | "locked" | "onFormChange">;

export default function SharedTab(props: Base) {
  const { t } = useLanguage();
  const [ack, setAck] = useState(false);
  const [open, setOpen] = useState<"expenses" | "debts" | "goals" | null>(null);
  const integrityOk = props.state.integrity.ok;
  const canEdit = integrityOk || ack;
  const common = { ...props, canEdit, ack, onSaved: () => setAck(false) };

  return (
    <div data-testid="shared-tab">
      {!integrityOk && (
        <>
          <IntegrityAlert model={props.model} stored={props.state.stored} integrity={props.state.integrity} />
          <section className="plan-source hh-include" data-checked={ack} data-testid="se-ack-box">
            <label className="plan-check">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="se-ack" />
              <span>{t("se.ackLabel")}</span>
            </label>
            {!ack && <p className="plan-row-note plan-source-note">{t("se.ackHelp")}</p>}
          </section>
        </>
      )}
      <SharedExpensesEditor {...common} locked={open !== null && open !== "expenses"} onFormChange={(o) => setOpen(o ? "expenses" : (cur) => (cur === "expenses" ? null : cur))} />
      <SharedDebtsEditor {...common} locked={open !== null && open !== "debts"} onFormChange={(o) => setOpen(o ? "debts" : (cur) => (cur === "debts" ? null : cur))} />
      <SharedGoalsEditor {...common} locked={open !== null && open !== "goals"} onFormChange={(o) => setOpen(o ? "goals" : (cur) => (cur === "goals" ? null : cur))} />
    </div>
  );
}
