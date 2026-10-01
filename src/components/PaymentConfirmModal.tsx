"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type PaymentConfirmModalProps = {
  accountName: string;
  suggestedAmount: number;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (amount: number) => void;
};

/** Required confirmation before a payment-reminder goal is marked complete — prefilled with the account's current minimum payment, editable in case more or less was actually paid. Mirrors BlockedReasonModal's shape (one required input gating one action). */
export default function PaymentConfirmModal({ accountName, suggestedAmount, saving, error, onCancel, onConfirm }: PaymentConfirmModalProps) {
  const { t } = useLanguage();
  const [amountText, setAmountText] = useState(suggestedAmount.toFixed(2));
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  const parsedAmount = Number(amountText);
  const isValid = amountText.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount >= 0;

  const modalContent = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div
        className="card"
        style={{ maxWidth: "440px", width: "100%", position: "relative", zIndex: 10000 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-1">{t("paymentConfirm.title")}</h2>
        <p className="mt-1 text-sm text-white/70">{t("paymentConfirm.body", { name: accountName })}</p>

        <label className="mt-4 block text-xs uppercase tracking-wide text-white/40 font-semibold mb-1">
          {t("paymentConfirm.amountLabel")}
        </label>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          disabled={saving}
          autoFocus
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
        />

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={() => onConfirm(parsedAmount)}
            disabled={saving || !isValid}
            className="btn btn-primary flex-1"
          >
            {saving ? t("paymentConfirm.saving") : t("paymentConfirm.confirmButton")}
          </button>
          <button onClick={onCancel} disabled={saving} className="btn btn-ghost">
            {t("paymentConfirm.cancel")}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}
