import { supabase } from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/db";
import { clampNoteText, sortNotes, type Note } from "@/lib/notes";

// Data access for Tools > Notes. Requires supabase/migrations/20261109000100_notes.sql.
//
// Ownership is enforced twice: row level security (auth.uid() = user_id) in the database, and here every statement is also
// scoped to the signed-in user's id (read from the session, never taken from a caller), so a bug in a caller can't ask for
// someone else's note. Text saves are revision-checked: the update only applies if the stored revision is still the one the
// editor loaded, and "no row updated" is reported as a conflict instead of overwriting newer text.

const COLUMNS = "id, title, body, pinned, revision, created_at, updated_at";

type NoteRow = { id: string; title: string; body: string; pinned: boolean; revision: number; created_at: string; updated_at: string };

/** True when the error means the notes table doesn't exist yet (migration not applied). */
export function isNotesUnavailableError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  const msg = String(err.message ?? "").toLowerCase();
  return (
    err.code === "42P01" || // undefined_table
    err.code === "PGRST205" || // table not in schema cache
    msg.includes("could not find the table") ||
    (msg.includes("relation") && msg.includes("does not exist"))
  );
}

function rowToNote(r: NoteRow): Note {
  return { id: r.id, title: r.title, body: r.body, pinned: r.pinned, revision: r.revision, createdAt: r.created_at, updatedAt: r.updated_at };
}

export type NoteWrite = { status: "ok"; note: Note } | { status: "conflict" };

/** All of the signed-in user's notes, pinned first then most recently edited. */
export async function listNotes(): Promise<Note[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("notes")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return sortNotes(((data ?? []) as NoteRow[]).map(rowToNote));
}

/** One of the signed-in user's notes, or null if it no longer exists (deleted elsewhere). */
export async function getNote(id: string): Promise<Note | null> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from("notes").select(COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? rowToNote(data as NoteRow) : null;
}

/** A new empty note owned by the signed-in user. */
export async function createNote(): Promise<Note> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from("notes").insert({ user_id: userId, title: "", body: "" }).select(COLUMNS).single();
  if (error) throw error;
  return rowToNote(data as NoteRow);
}

/** Save title and body if the stored revision is still `revision`; otherwise report a conflict and change nothing. */
export async function saveNoteText(id: string, revision: number, text: { title: string; body: string }): Promise<NoteWrite> {
  const userId = await getCurrentUserId();
  const { title, body } = clampNoteText(text.title, text.body);
  const { data, error } = await supabase
    .from("notes")
    .update({ title, body })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("revision", revision)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? { status: "ok", note: rowToNote(data as NoteRow) } : { status: "conflict" };
}

/** Pin or unpin, with the same revision check (pinning changes the revision but not the "last edited" time). */
export async function setNotePinned(id: string, revision: number, pinned: boolean): Promise<NoteWrite> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("notes")
    .update({ pinned })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("revision", revision)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? { status: "ok", note: rowToNote(data as NoteRow) } : { status: "conflict" };
}

/** Delete one of the signed-in user's notes. */
export async function deleteNote(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase.from("notes").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}
