"use client";

import { useRef, useState } from "react";
import {
  deleteGoalAttachment,
  getAttachmentUrl,
  uploadGoalAttachment,
  type GoalAttachment,
} from "@/lib/supabase/db";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📄";
  return "📎";
}

/** A goal's optional file attachments (receipts, documents). Shared by Today, Tomorrow, and the date detail page. */
export default function GoalAttachments({
  goalId,
  items,
  onItemsChange,
  readOnly = false,
}: {
  goalId: string;
  items: GoalAttachment[];
  onItemsChange: (items: GoalAttachment[]) => void;
  readOnly?: boolean;
}) {
  const [expanded, setExpanded] = useState(items.length > 0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [openingId, setOpeningId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Read-only views (past days) with nothing to show shouldn't render an
  // empty, dead toggle — but an editable view always shows it, so there's
  // somewhere to upload the first file.
  if (readOnly && items.length === 0) return null;

  function setBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file again later
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const created = await uploadGoalAttachment(goalId, file);
      onItemsChange([...items, created]);
      setExpanded(true);
    } catch (err: any) {
      setError(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleView(item: GoalAttachment) {
    setOpeningId(item.id);
    setError(null);
    try {
      const url = await getAttachmentUrl(item.storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setError("Couldn't open file — try again.");
    } finally {
      setOpeningId(null);
    }
  }

  async function handleDelete(item: GoalAttachment) {
    if (busyIds.has(item.id)) return;
    setBusy(item.id, true);
    const prevItems = items;
    onItemsChange(items.filter((i) => i.id !== item.id));
    try {
      await deleteGoalAttachment(item.id, item.storage_path);
    } catch {
      onItemsChange(prevItems);
    } finally {
      setBusy(item.id, false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-xs text-white/50 hover:text-white/80 transition"
      >
        {expanded ? "▾" : "▸"} Files{items.length > 0 ? ` (${items.length})` : ""}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <span className="flex-shrink-0">{fileIcon(item.mime_type)}</span>
              <button
                type="button"
                onClick={() => handleView(item)}
                disabled={openingId === item.id}
                className="flex-1 min-w-0 text-left text-sm text-white/85 hover:text-white truncate underline decoration-white/20 underline-offset-2"
                title={item.file_name}
              >
                {openingId === item.id ? "Opening…" : item.file_name}
              </button>
              <span className="flex-shrink-0 text-[10px] text-white/40">{formatBytes(item.size_bytes)}</span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  disabled={busyIds.has(item.id)}
                  className="flex-shrink-0 text-white/30 hover:text-white/70 text-xs"
                  title="Remove file"
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          {items.length === 0 && <div className="text-xs text-white/40 italic">No files yet.</div>}

          {!readOnly && (
            <div className="mt-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
                onChange={handleFileSelected}
                disabled={uploading}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="btn"
                style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
              >
                {uploading ? "Uploading…" : "+ Add file"}
              </button>
              <div className="mt-1 text-[10px] text-white/35">Images or PDF, up to 5MB.</div>
              {error && <div className="mt-1 text-[10px] text-red-400">{error}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
