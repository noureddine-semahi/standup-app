// English strings — the source of truth. Every key here must also exist in
// es.ts (enforced by that file's type); the app falls back to this file if a
// key is somehow missing in the active language. Namespaced by
// page/component (e.g. "today.title") purely for readability while editing
// — there's no nesting at runtime, just one flat key -> string lookup.
export const en = {
  "app.name": "StandUp",
} as const;

export type TranslationKey = keyof typeof en;
