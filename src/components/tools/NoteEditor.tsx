"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Loader2, Pin, PinOff, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { createAutosaver, type Autosaver, type SaveResult, type SaveStatus } from "@/lib/noteAutosave";
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, isBlankNote, type Note } from "@/lib/notes";
import { deleteNote, getNote, saveNoteText, setNotePinned } from "@/lib/supabase/notes";
import { ConfirmActionModal } from "./PaymentsDashboard";

// Tools > Notes > editor. A title, a plain-text body, debounced autosave (see lib/noteAutosave.ts), pin and delete.
// The parent owns the list; this reports every stored change through onChange so the library stays in step.

function errorMessage(e: unknown, fallback: string): string {
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : fallback;
}

export default function NoteEditor({
  note,
  onChange,
  onClose,
  onDeleted,
  onGone,
  onReload,
}: {
  note: Note;
  /** A stored version of the note (after a save, a pin change, or loading the latest). */
  onChange: (n: Note) => void;
  /** Leave the editor. `removedBlank` is true when the note was never used and was deleted. */
  onClose: (removedBlank: boolean) => void;
  onDeleted: (id: string) => void;
  /** The note no longer exists (deleted elsewhere). */
  onGone: (id: string) => void;
  /** The user chose to drop their unsaved text and load the stored version: the parent reopens the editor on it. */
  onReload: (latest: Note) => void;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [pinned, setPinned] = useState(note.pinned);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const [leaveBlocked, setLeaveBlocked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [busy, setBusy] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const saver = useRef<Autosaver | null>(null);
  if (saver.current === null) {
    saver.current = createAutosaver({
      initial: { title: note.title, body: note.body, revision: note.revision },
      onStatus: (s, d) => {
        setStatus(s);
        setDetail(d);
      },
      save: async (fields, revision): Promise<SaveResult> => {
        try {
          const r = await saveNoteText(note.id, revision, fields);
          if (r.status === "conflict") return { ok: false, kind: "conflict" };
          onChangeRef.current(r.note);
          return { ok: true, revision: r.note.revision };
        } catch (e) {
          return { ok: false, kind: "error", message: errorMessage(e, t("notes.saveError")) };
        }
      },
    });
  }
  const a = saver.current;

  // Save whatever is pending when the editor goes away (switching Tools tabs, for instance), then stop reporting.
  useEffect(() => {
    return () => {
      void a.flush();
      a.dispose();
    };
  }, [a]);

  // Warn before closing the browser tab while text is unsaved.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (a.isDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [a]);

  function edit(nextTitle: string, nextBody: string) {
    setTitle(nextTitle);
    setBody(nextBody);
    setLeaveBlocked(false);
    a.edit({ title: nextTitle, body: nextBody });
  }

  async function leave(force: boolean) {
    if (!force) {
      const s = await a.flush();
      if (s === "error" || s === "conflict") {
        setLeaveBlocked(true);
        return;
      }
    }
    // An untouched "New note" is not worth keeping.
    if (!force && isBlankNote({ title, body })) {
      try {
        await deleteNote(note.id);
        onClose(true);
        return;
      } catch {
        // couldn't remove it: leave it in the list rather than block the user
      }
    }
    onClose(false);
  }

  async function togglePin() {
    if (busy) return;
    setBusy(true);
    setPinError(false);
    try {
      const s = await a.flush(); // so the revision is current
      if (s === "conflict") return;
      const r = await setNotePinned(note.id, a.revision(), !pinned);
      if (r.status === "ok") {
        a.adoptRevision(r.note.revision);
        setPinned(r.note.pinned);
        onChange(r.note);
      } else {
        setPinError(true);
      }
    } catch {
      setPinError(true);
    } finally {
      setBusy(false);
    }
  }

  // Conflict: the note changed somewhere else. Either keep the text in this editor (saved over the newer version) or
  // load the newer version (this editor's unsaved text is dropped).
  async function resolve(keepMine: boolean) {
    setBusy(true);
    try {
      const latest = await getNote(note.id);
      if (!latest) {
        onGone(note.id);
        return;
      }
      if (keepMine) {
        a.adoptRevision(latest.revision);
        setPinned(latest.pinned);
        setLeaveBlocked(false);
        await a.resume();
      } else {
        a.dispose();
        onReload(latest);
      }
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = useMemo(() => {
    switch (status) {
      case "saving":
        return t("notes.saving");
      case "saved":
        return t("notes.saved");
      case "error":
        return t("notes.saveError");
      case "conflict":
        return t("notes.conflict");
      default:
        return "";
    }
  }, [status, t]);

  const displayTitle = title.trim() || t("notes.untitled");

  return (
    <div className="note-editor" data-testid="note-editor">
      <div className="note-editor-bar">
        <button type="button" className="btn standup-metal-btn note-back" onClick={() => void leave(false)} data-testid="note-back">
          <ArrowLeft size={15} aria-hidden="true" /> <span>{t("notes.back")}</span>
        </button>
        <span className="note-status" data-status={status} role="status" aria-live="polite" data-testid="note-status">
          {status === "saving" && <Loader2 size={13} className="note-spin" aria-hidden="true" />}
          {status === "saved" && <Check size={13} aria-hidden="true" />}
          {(status === "error" || status === "conflict") && <AlertTriangle size={13} aria-hidden="true" />}
          {statusLabel}
        </span>
        <div className="note-editor-actions">
          <button
            type="button"
            className="btn standup-metal-btn note-icon-btn"
            onClick={() => void togglePin()}
            disabled={busy}
            aria-pressed={pinned}
            aria-label={pinned ? t("notes.unpin") : t("notes.pin")}
            title={pinned ? t("notes.unpin") : t("notes.pin")}
            data-testid="note-pin"
          >
            {pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="btn standup-metal-btn note-icon-btn note-delete"
            onClick={() => setConfirmDelete(true)}
            aria-label={t("notes.delete")}
            title={t("notes.delete")}
            data-testid="note-delete"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {status === "error" && (
        <div role="alert" className="note-banner" data-testid="note-error">
          <span>
            {t("notes.unsavedBody")}
            {detail ? ` (${detail})` : ""}
          </span>
          <button type="button" className="btn standup-metal-btn" onClick={() => void a.retry()} data-testid="note-retry">
            {t("notes.retry")}
          </button>
        </div>
      )}
      {status === "conflict" && (
        <div role="alert" className="note-banner" data-testid="note-conflict">
          <span>{t("notes.conflictBody")}</span>
          <span className="note-banner-actions">
            <button type="button" className="btn standup-metal-btn standup-metal-btn--accent" onClick={() => void resolve(true)} disabled={busy} data-testid="note-keep-mine">
              {t("notes.keepMine")}
            </button>
            <button type="button" className="btn standup-metal-btn" onClick={() => void resolve(false)} disabled={busy} data-testid="note-load-latest">
              {t("notes.loadLatest")}
            </button>
          </span>
        </div>
      )}
      {pinError && (
        <div role="alert" className="note-banner" data-testid="note-pin-error">
          {t("notes.pinFailed")}
        </div>
      )}
      {leaveBlocked && status !== "conflict" && (
        <div role="alert" className="note-banner" data-testid="note-leave-blocked">
          <span>{t("notes.unsavedBody")}</span>
          <span className="note-banner-actions">
            <button type="button" className="btn standup-metal-btn standup-metal-btn--accent" onClick={() => void a.retry()}>
              {t("notes.retry")}
            </button>
            <button type="button" className="btn standup-metal-btn" onClick={() => void leave(true)} data-testid="note-leave-anyway">
              {t("notes.leaveAnyway")}
            </button>
          </span>
        </div>
      )}
      {leaveBlocked && status === "conflict" && (
        <div className="note-banner" data-testid="note-leave-conflict">
          <button type="button" className="btn standup-metal-btn" onClick={() => void leave(true)} data-testid="note-leave-anyway">
            {t("notes.leaveAnyway")}
          </button>
        </div>
      )}

      <input
        type="text"
        className="note-title-input"
        value={title}
        maxLength={NOTE_TITLE_MAX}
        onChange={(e) => edit(e.target.value, body)}
        placeholder={t("notes.titlePlaceholder")}
        aria-label={t("notes.titleLabel")}
        data-testid="note-title"
      />
      <textarea
        className="note-body-input"
        value={body}
        maxLength={NOTE_BODY_MAX}
        onChange={(e) => edit(title, e.target.value)}
        placeholder={t("notes.bodyPlaceholder")}
        aria-label={t("notes.bodyLabel")}
        data-testid="note-body"
      />

      {confirmDelete && (
        <ConfirmActionModal
          title={t("notes.deleteTitle")}
          body={t("notes.deleteBody", { title: displayTitle })}
          confirmLabel={t("notes.deleteConfirm")}
          busyLabel={t("notes.deleting")}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              await deleteNote(note.id);
              a.dispose();
              onDeleted(note.id);
              return null;
            } catch (e) {
              return errorMessage(e, t("notes.loadFailed"));
            }
          }}
        />
      )}
    </div>
  );
}
