// Tools > Notes: the pure parts (types, ordering, search, preview). No database access here.

export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 20000;

export type Note = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  /** Counter the database bumps when title, body or pinned changes. Saves are checked against it. */
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/** Pinned notes first, then the most recently edited. Ties fall back to the id so the order never flickers. */
export function sortNotes<T extends Pick<Note, "id" | "pinned" | "updatedAt">>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ta = Date.parse(a.updatedAt);
    const tb = Date.parse(b.updatedAt);
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Case-insensitive match on title and body. A blank query matches everything. Order is left as given. */
export function filterNotes<T extends Pick<Note, "title" | "body">>(notes: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...notes];
  return notes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
}

/** The text shown under a card's title: the body with blank lines and surrounding space removed, cut to a sensible length. */
export function notePreview(body: string, max = 220): string {
  const text = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

/** A note with no title and no text is just an unused "New note" and is removed when the editor closes. */
export function isBlankNote(n: Pick<Note, "title" | "body">): boolean {
  return n.title.trim() === "" && n.body.trim() === "";
}

/** Clamp to the database limits so a very long paste is saved (shortened) rather than rejected. */
export function clampNoteText(title: string, body: string): { title: string; body: string } {
  return { title: title.slice(0, NOTE_TITLE_MAX), body: body.slice(0, NOTE_BODY_MAX) };
}
