"use client";

import { useEffect, useRef, useState } from "react";
import { Forward, Check } from "lucide-react";
import { sharePost } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/**
 * A small "share with a connection" popover on a post — self-contained
 * (owns its own open/busy/shared-with state) the same way
 * GoalAssignmentsPanel/other feed-adjacent components are, so PostCard
 * doesn't have to thread share state through itself.
 */
export default function SharePostButton({
  postId,
  connections,
}: {
  postId: string;
  connections: { id: string; displayName: string | null }[];
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sharedWithIds, setSharedWithIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleShare(recipientId: string) {
    if (busyId) return;
    setBusyId(recipientId);
    setError(null);
    try {
      await sharePost(postId, recipientId);
      setSharedWithIds((prev) => new Set(prev).add(recipientId));
    } catch (e: any) {
      setError(e?.message ?? t("social.shareFailed"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn inline-flex items-center gap-1.5"
        style={{ padding: "0.25rem 0.5rem" }}
        title={t("social.shareButton")}
      >
        <Forward size={14} />
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            bottom: "calc(100% + 0.5rem)",
            left: 0,
            width: "220px",
            zIndex: 20,
            padding: "0.5rem",
          }}
        >
          <div className="text-[11px] uppercase tracking-wide text-white/50 font-semibold mb-1.5 px-1">
            {t("social.shareWithTitle")}
          </div>
          {error && <p className="px-1 mb-1.5 text-xs text-red-300">{error}</p>}
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {connections.map((c) => {
              const shared = sharedWithIds.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => !shared && handleShare(c.id)}
                  disabled={busyId === c.id || shared}
                  className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-left hover:bg-white/5 transition disabled:opacity-60"
                >
                  <span className="truncate text-white/85">{c.displayName ?? t("social.anonymousUser")}</span>
                  {shared ? (
                    <Check size={13} className="text-emerald-300 flex-shrink-0" />
                  ) : busyId === c.id ? (
                    <span className="text-[10px] text-white/40 flex-shrink-0">{t("social.sharing")}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
