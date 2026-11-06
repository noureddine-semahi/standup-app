"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pin, Plus, Search } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { FREE_LIMITS, isAtLimit, type AccountTier } from "@/lib/entitlements";
import { filterNotes, notePreview, sortNotes, type Note } from "@/lib/notes";
import { getMyEntitlement } from "@/lib/supabase/entitlements";
import { createNote, isNoteLimitError, isNotesUnavailableError, listNotes, setNotePinned } from "@/lib/supabase/notes";
import NoteEditor from "./NoteEditor";
import { FIELD_CLASS } from "./PaymentsDashboard";

// Tools > Notes. A responsive card library (pinned first, then most recently edited, searchable by title and text) and a
// dedicated editor. Plain text only; one user's notes, scoped by owner-only row level security.

type Phase = "loading" | "ready" | "error" | "unavailable";

export default function NotesTab() {
  const { t, language } = useLanguage();
  const [phase, setPhase] = useState<Phase>("loading");
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  /** bumped to remount the editor on a freshly loaded version of the same note */
  const [editorKey, setEditorKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** The account's effective tier (resolved by the database); null until known. The database enforces the limit either way. */
  const [tier, setTier] = useState<AccountTier | null>(null);
  /** The database refused a new note because of the Free limit (covers a stale tier, or a race for the last slot). */
  const [limitHit, setLimitHit] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      setNotes(sortNotes(await listNotes()));
      setPhase("ready");
      // Only used to say so up front; a failed lookup changes nothing (the database still enforces the limit).
      getMyEntitlement().then((e) => setTier(e.tier), () => {});
    } catch (e) {
      setPhase(isNotesUnavailableError(e) ? "unavailable" : "error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const put = useCallback((n: Note) => {
    setNotes((prev) => sortNotes(prev.some((x) => x.id === n.id) ? prev.map((x) => (x.id === n.id ? n : x)) : [n, ...prev]));
  }, []);
  const drop = useCallback((id: string) => {
    setNotes((prev) => prev.filter((x) => x.id !== id));
    setLimitHit(false);
  }, []);

  const atLimit = (tier !== null && isAtLimit(tier, "notes", notes.length)) || limitHit;
  const visible = useMemo(() => filterNotes(notes, query), [notes, query]);
  const open = openId ? notes.find((n) => n.id === openId) ?? null : null;

  const dateFmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(language === "es" ? "es" : "en", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return null;
    }
  }, [language]);
  const formatEdited = (iso: string) => {
    const d = new Date(iso);
    return t("notes.edited", { date: Number.isNaN(d.getTime()) ? "" : dateFmt ? dateFmt.format(d) : d.toLocaleDateString() });
  };

  async function newNote() {
    if (creating) return;
    setCreating(true);
    setActionError(null);
    try {
      const n = await createNote();
      put(n);
      setQuery("");
      setOpenId(n.id);
    } catch (e) {
      if (isNoteLimitError(e)) setLimitHit(true);
      else if (isNotesUnavailableError(e)) setPhase("unavailable");
      else setActionError(t("notes.loadFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function pinFromCard(n: Note) {
    setActionError(null);
    try {
      const r = await setNotePinned(n.id, n.revision, !n.pinned);
      if (r.status === "ok") put(r.note);
      else {
        // changed elsewhere: refresh the list rather than guess
        await load();
      }
    } catch {
      setActionError(t("notes.pinFailed"));
    }
  }

  // ── editor ──
  if (open) {
    return (
      <div className="card card-highlight notes-root">
        <NoteEditor
          key={`${open.id}:${editorKey}`}
          note={open}
          onChange={put}
          onClose={(removedBlank) => {
            if (removedBlank) drop(open.id);
            setOpenId(null);
          }}
          onDeleted={(id) => {
            drop(id);
            setOpenId(null);
          }}
          onGone={(id) => {
            drop(id);
            setOpenId(null);
            setActionError(t("notes.gone"));
          }}
          onReload={(latest) => {
            put(latest);
            setEditorKey((k) => k + 1);
          }}
        />
      </div>
    );
  }

  // ── library ──
  return (
    <div className="card card-highlight notes-root" data-testid="notes-library">
      <div className="notes-toolbar">
        <label className="notes-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            className={`${FIELD_CLASS} notes-search-input`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("notes.searchPlaceholder")}
            aria-label={t("notes.searchLabel")}
            data-testid="notes-search"
            disabled={phase !== "ready"}
          />
        </label>
        <button type="button" className="btn standup-metal-btn standup-metal-btn--accent notes-new" onClick={() => void newNote()} disabled={creating || phase !== "ready" || atLimit} data-testid="notes-new">
          <Plus size={16} aria-hidden="true" /> {t("notes.new")}
        </button>
      </div>

      {phase === "ready" && atLimit && (
        <div role="status" className="note-banner" data-testid="notes-limit">
          {t("notes.limitReached", { limit: FREE_LIMITS.notes })}
        </div>
      )}

      {actionError && (
        <div role="alert" className="pay-error" data-testid="notes-action-error">
          {actionError}
        </div>
      )}

      {phase === "loading" && (
        <div className="text-white/60 text-center py-8" role="status" data-testid="notes-loading">
          {t("notes.loading")}
        </div>
      )}
      {phase === "error" && (
        <div role="alert" className="pay-error pay-error-page" data-testid="notes-error">
          {t("notes.loadFailed")}{" "}
          <button type="button" className="plan-link" onClick={() => void load()} data-testid="notes-retry">
            {t("notes.retry")}
          </button>
        </div>
      )}
      {phase === "unavailable" && (
        <div role="status" className="pay-error pay-error-page" data-testid="notes-unavailable">
          {t("notes.unavailable")}
        </div>
      )}

      {phase === "ready" && notes.length === 0 && (
        <div className="notes-empty" data-testid="notes-empty">
          <strong>{t("notes.empty")}</strong> {t("notes.emptyHelp")}
        </div>
      )}
      {phase === "ready" && notes.length > 0 && visible.length === 0 && (
        <div className="notes-empty" data-testid="notes-no-matches">
          {t("notes.noMatches", { query: query.trim() })}
        </div>
      )}

      {phase === "ready" && visible.length > 0 && (
        <ul className="notes-grid" data-testid="notes-grid">
          {visible.map((n) => (
            <li key={n.id} className="note-card" data-pinned={n.pinned} data-testid={`note-card-${n.id}`}>
              <button type="button" className="note-card-open" onClick={() => setOpenId(n.id)} data-testid={`note-open-${n.id}`}>
                <span className={`note-card-title${n.title.trim() ? "" : " is-untitled"}`}>{n.title.trim() || t("notes.untitled")}</span>
                <span className="note-card-preview">{notePreview(n.body) || t("notes.noText")}</span>
                <span className="note-card-date">{formatEdited(n.updatedAt)}</span>
              </button>
              <button
                type="button"
                className="note-card-pin"
                aria-pressed={n.pinned}
                aria-label={n.pinned ? t("notes.unpin") : t("notes.pin")}
                title={n.pinned ? t("notes.unpin") : t("notes.pin")}
                onClick={() => void pinFromCard(n)}
                data-testid={`note-pin-${n.id}`}
              >
                <Pin size={14} aria-hidden="true" fill={n.pinned ? "currentColor" : "none"} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
