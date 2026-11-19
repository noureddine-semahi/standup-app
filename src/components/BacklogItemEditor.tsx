"use client";

import { useRef, useState } from "react";
import type { BacklogGoal } from "@/lib/supabase/db";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export type BacklogEditDraft = { title: string; details: string | null; priority: number };

/**
 * Inline editor for ONE Backlog item: title, details and priority, with Save and Cancel. It only produces a draft: the parent saves it (updateBacklogGoal) and resolves to an
 * error message, or null on success. Nothing else about the item (its id, dates, category, target date) is part of the draft, so none of it can change here.
 * An empty title is refused, a repeated tap while saving sends one request, and Save with nothing changed simply closes without a write.
 */
export default function BacklogItemEditor({
  item,
  onSave,
  onCancel,
}: {
  item: BacklogGoal;
  onSave: (draft: BacklogEditDraft) => Promise<string | null>;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(item.title);
  const [details, setDetails] = useState(item.details ?? "");
  const [priority, setPriority] = useState(item.priority);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const titleEmpty = title.trim() === "";
  const meta = getPriorityMeta(priority);
  const unchanged = title.trim() === item.title && (details.trim() || null) === (item.details?.trim() || null) && priority === item.priority;

  async function save() {
    setAttempted(true);
    // The ref blocks a second tap in the same tick, before `saving` re-renders.
    if (titleEmpty || savingRef.current) return;
    if (unchanged) {
      onCancel();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const err = await onSave({ title: title.trim(), details: details.trim() || null, priority });
    if (err) {
      setError(err);
      savingRef.current = false;
      setSaving(false);
    }
    // On success the parent closes the editor.
  }

  return (
    <div
      className="space-y-2"
      data-testid="backlog-editor"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !savingRef.current) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("backlog.editPriorityLabel")}
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          disabled={saving}
          className="priority-select"
          style={{ "--p-bg": meta.bg, "--p-border": meta.border, "--p-color": meta.color } as React.CSSProperties}
        >
          {[1, 2, 3, 4, 5].map((v) => (
            <option key={v} value={v}>
              P{v}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label={t("backlog.editTitleLabel")}
          aria-invalid={attempted && titleEmpty}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          disabled={saving}
          className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
        />
      </div>
      <textarea
        aria-label={t("backlog.editDetailsLabel")}
        rows={2}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder={t("backlog.detailsPlaceholder")}
        disabled={saving}
        className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
      />
      {attempted && titleEmpty && (
        <p role="alert" className="text-sm text-red-300">
          {t("backlog.errTitleRequired")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || titleEmpty}
          className="btn standup-metal-btn standup-metal-btn--accent"
          style={{ padding: "0.375rem 0.9rem", fontSize: "0.8rem" }}
        >
          {saving ? t("backlog.editSaving") : t("backlog.editSave")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="btn standup-metal-btn"
          style={{ padding: "0.375rem 0.9rem", fontSize: "0.8rem" }}
        >
          {t("backlog.editCancel")}
        </button>
      </div>
    </div>
  );
}
