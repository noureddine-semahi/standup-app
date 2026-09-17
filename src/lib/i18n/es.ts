import type { en } from "./en";

// Spanish strings. Record<keyof typeof en, string> means TypeScript fails
// the build if this ever falls out of sync with en.ts — add a key there,
// and this file won't compile until it's translated here too.
export const es: Record<keyof typeof en, string> = {
  "app.name": "StandUp",
};
