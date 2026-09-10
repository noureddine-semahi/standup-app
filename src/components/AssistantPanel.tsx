"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase/client";
import { toISODate, addDays } from "@/lib/supabase/db";

type AssistantResponse = {
  message: string;
  actionTaken?: string;
  remaining?: number;
};

type AssistantPanelProps = {
  onClose: () => void;
  onActionTaken: () => void;
};

/** Dashboard quick-access assistant — add a goal or act on an existing one via a short plain-language request. Free tier, capped monthly (see src/lib/assistant/usage.ts); single-turn per submission, not a persistent chat thread. */
export default function AssistantPanel({ onClose, onActionTaken }: AssistantPanelProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [lastResponse, setLastResponse] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  async function handleSend() {
    const message = input.trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);
    setLastResponse(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Not signed in.");

      const todayISO = toISODate(new Date());
      const tomorrowISO = toISODate(addDays(new Date(), 1));

      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ message, todayISO, tomorrowISO }),
      });

      const data: AssistantResponse = await res.json();

      if (!res.ok) {
        setError(data.message ?? "Something went wrong.");
        return;
      }

      setLastResponse(data);
      setInput("");
      if (data.actionTaken) onActionTaken();
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

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
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div
        className="card"
        style={{ maxWidth: "480px", width: "100%", position: "relative", zIndex: 10000 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2 className="text-xl font-bold">🤖 Assistant</h2>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white/80 text-2xl leading-none"
            style={{
              background: "rgba(255,255,255,0.1)",
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>
        </div>
        <p className="text-sm text-white/70 mb-4">
          Add a goal or act on an existing one — e.g. "add a goal to call the dentist tomorrow" or
          "mark my workout done."
        </p>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={sending}
          placeholder="What would you like to do?"
          autoFocus
          rows={2}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50 resize-none"
        />

        <div className="flex gap-3 mt-3">
          <button onClick={handleSend} disabled={sending || !input.trim()} className="btn btn-primary flex-1">
            {sending ? "Thinking…" : "Send"}
          </button>
          <button onClick={onClose} disabled={sending} className="btn btn-ghost">
            Close
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {lastResponse && !error && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/90">
            {lastResponse.actionTaken && <span className="text-emerald-400 mr-1">✓</span>}
            {lastResponse.message}
          </div>
        )}

        {typeof lastResponse?.remaining === "number" && (
          <div className="mt-3 text-xs text-white/40">{lastResponse.remaining} free actions left this month.</div>
        )}
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}
