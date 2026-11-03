"use client";

import { useEffect, useReducer, useRef } from "react";
import { Delete } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import {
  actionForKey,
  calcReducer,
  formatDisplay,
  initialCalcState,
  numberToDisplay,
  OP_SYMBOL,
  type CalcAction,
} from "@/lib/calculator";

type Key = {
  label: React.ReactNode;
  aria: string;
  action: CalcAction;
  tone?: "op" | "equals" | "memory";
  testId?: string;
};

export default function CalculatorTool() {
  const { t } = useLanguage();
  const [state, dispatch] = useReducer(calcReducer, undefined, initialCalcState);
  const rootRef = useRef<HTMLDivElement>(null);

  // Desktop keyboard support. Ignored while typing in a field, with modifier
  // keys held, and for Enter on a focused button (the button's own click
  // already handles it -- reacting here too would press it twice).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target.closest("input, textarea, select, [contenteditable='true']") || target.isContentEditable)) return;
      if (target?.closest("button") && (e.key === "Enter" || e.key === " ")) return;
      const action = actionForKey(e.key);
      if (!action) return;
      e.preventDefault();
      dispatch(action);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const memoryKeys: Key[] = [
    { label: "MC", aria: t("calc.memClear"), action: { type: "memory", kind: "clear" }, tone: "memory" },
    { label: "MR", aria: t("calc.memRecall"), action: { type: "memory", kind: "recall" }, tone: "memory" },
    { label: "M+", aria: t("calc.memAdd"), action: { type: "memory", kind: "add" }, tone: "memory" },
    { label: "M−", aria: t("calc.memSubtract"), action: { type: "memory", kind: "subtract" }, tone: "memory" },
  ];
  const d = (n: string): Key => ({ label: n, aria: n, action: { type: "digit", digit: n } });
  const rows: Key[][] = [
    [
      { label: "C", aria: t("calc.clear"), action: { type: "clear" } },
      { label: <Delete size={18} aria-hidden="true" />, aria: t("calc.delete"), action: { type: "delete" } },
      { label: "%", aria: t("calc.percent"), action: { type: "percent" } },
      { label: "÷", aria: "÷", action: { type: "op", op: "/" }, tone: "op" },
    ],
    [d("7"), d("8"), d("9"), { label: "×", aria: "×", action: { type: "op", op: "*" }, tone: "op" }],
    [d("4"), d("5"), d("6"), { label: "−", aria: "−", action: { type: "op", op: "-" }, tone: "op" }],
    [d("1"), d("2"), d("3"), { label: "+", aria: "+", action: { type: "op", op: "+" }, tone: "op" }],
    [
      { label: "±", aria: t("calc.negate"), action: { type: "negate" } },
      d("0"),
      { label: ".", aria: ".", action: { type: "decimal" } },
      { label: "=", aria: "=", action: { type: "equals" }, tone: "equals" },
    ],
  ];

  const keyClass = (tone?: Key["tone"]) =>
    `btn ${tone === "op" ? "btn-tint btn-amber-tint" : tone === "equals" ? "btn-tint btn-teal" : tone === "memory" ? "btn-tint btn-purple" : ""} goal-toolbar-btn calc-key${tone === "memory" ? " calc-key-memory" : ""}`;

  const pending =
    state.op && state.acc !== null ? `${formatDisplay(numberToDisplay(state.acc))} ${OP_SYMBOL[state.op]}` : " ";
  const mainText = formatDisplay(state.display);

  return (
    <div ref={rootRef} className="card card-highlight">
      <div className="mb-4">
        <h2 className="text-xl font-bold mb-1">{t("calc.title")}</h2>
      </div>

      <div className="calc-layout">
        <div className="calc-main">
          <div className="calc-display" role="status" aria-live="polite" aria-atomic="true">
            <div className="calc-display-top">
              <span className="calc-memory-flag" data-on={state.memory !== 0} title={t("calc.memoryHas", { value: formatDisplay(numberToDisplay(state.memory)) })}>
                {state.memory !== 0 ? "M" : " "}
              </span>
              <span className="calc-pending">{pending}</span>
            </div>
            <div className="calc-readout" data-long={mainText.length > 12} data-error={state.error}>
              {mainText}
            </div>
          </div>

          <div className="calc-keys" role="group" aria-label={t("calc.keys")}>
            <div className="calc-keys-row">
              {memoryKeys.map((k) => (
                <button key={k.aria} type="button" className={keyClass(k.tone)} aria-label={k.aria} onClick={() => dispatch(k.action)}>
                  {k.label}
                </button>
              ))}
            </div>
            {rows.map((row, i) => (
              <div key={i} className="calc-keys-row">
                {row.map((k) => (
                  <button
                    key={k.aria}
                    type="button"
                    className={keyClass(k.tone)}
                    aria-label={k.aria}
                    onClick={() => dispatch(k.action)}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <p className="calc-hint">{t("calc.keyboardHint")}</p>
        </div>

        <section className="calc-history" aria-label={t("calc.history")}>
          <div className="calc-history-head">
            <h3 className="text-sm font-semibold text-white/80">{t("calc.history")}</h3>
            <button
              type="button"
              className="btn goal-toolbar-btn calc-history-clear"
              disabled={state.history.length === 0}
              onClick={() => dispatch({ type: "clearHistory" })}
            >
              {t("calc.clearHistory")}
            </button>
          </div>
          {state.history.length === 0 ? (
            <p className="text-sm text-white/50">{t("calc.historyEmpty")}</p>
          ) : (
            <ul className="calc-history-list">
              {state.history.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className="calc-history-item"
                    aria-label={t("calc.useResult", { result: h.result })}
                    onClick={() => dispatch({ type: "recall", value: h.result })}
                  >
                    <span className="calc-history-expr">{h.expression}</span>
                    <span className="calc-history-result">= {h.result}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
