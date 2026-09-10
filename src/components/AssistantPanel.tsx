"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase/client";
import { toISODate, addDays } from "@/lib/supabase/db";

type ToolCall = { name: string; input: Record<string, any> };

type AssistantResponse = {
  message: string;
  actionTaken?: string;
  remaining?: number;
  requiresConfirmation?: boolean;
  confirmAction?: ToolCall;
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
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";

    // Browser-native speech-to-text — Chrome (desktop and Android) supports
    // it well, Safari/iOS is spotty, Firefox doesn't have it at all. Just
    // hide the mic button entirely rather than show something that'll
    // silently fail on an unsupported browser.
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognitionCtor) setVoiceSupported(true);

    return () => {
      document.body.style.overflow = "unset";
      recognitionRef.current?.abort?.();
    };
  }, []);

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop?.();
      return;
    }

    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (!transcript) return;
      // Fills the box rather than sending automatically — a misheard word
      // shouldn't be able to trigger the wrong action on a real goal
      // without a chance to glance at it first.
      setInput((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  async function postToAssistant(payload: Record<string, any>) {
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
      body: JSON.stringify({ todayISO, tomorrowISO, ...payload }),
    });

    const data: AssistantResponse = await res.json();
    if (!res.ok) throw new Error(data.message ?? "Something went wrong.");
    return data;
  }

  async function handleSend() {
    const message = input.trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);
    setLastResponse(null);

    try {
      const data = await postToAssistant({ message });
      setLastResponse(data);
      setInput("");
      if (data.actionTaken) onActionTaken();
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  // remove_goal is the only irreversible one of the 5 tools, so the server
  // never executes it straight off a model decision — it comes back here as
  // requiresConfirmation instead, and only a deliberate tap on this button
  // resends the exact same tool call with confirmedAction to actually apply it.
  async function handleConfirmDelete() {
    if (!lastResponse?.confirmAction || sending) return;

    setSending(true);
    setError(null);

    try {
      const data = await postToAssistant({ confirmedAction: lastResponse.confirmAction });
      setLastResponse(data);
      if (data.actionTaken) onActionTaken();
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  function handleCancelDelete() {
    setLastResponse(null);
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

        <div className="relative">
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
            placeholder={listening ? "Listening…" : "What would you like to do?"}
            autoFocus
            rows={2}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-12 text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50 resize-none"
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={toggleListening}
              disabled={sending}
              title={listening ? "Stop listening" : "Speak instead of typing"}
              className="absolute top-2 right-2 flex items-center justify-center disabled:opacity-50"
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "9999px",
                background: listening ? "rgba(239, 68, 68, 0.25)" : "rgba(255,255,255,0.08)",
                border: listening ? "1px solid rgba(239, 68, 68, 0.6)" : "1px solid rgba(255,255,255,0.15)",
                color: listening ? "#fca5a5" : "rgba(255,255,255,0.8)",
              }}
            >
              {listening ? "⏹️" : "🎤"}
            </button>
          )}
        </div>

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

        {lastResponse && !error && lastResponse.requiresConfirmation && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <div className="text-sm text-red-200">{lastResponse.message}</div>
            <div className="flex gap-3 mt-3">
              <button
                onClick={handleConfirmDelete}
                disabled={sending}
                className="btn flex-1"
                style={{ borderColor: "rgba(239, 68, 68, 0.6)", color: "#fca5a5" }}
              >
                {sending ? "Deleting…" : "Yes, delete it"}
              </button>
              <button onClick={handleCancelDelete} disabled={sending} className="btn btn-ghost">
                Cancel
              </button>
            </div>
          </div>
        )}

        {lastResponse && !error && !lastResponse.requiresConfirmation && (
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
