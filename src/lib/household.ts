// Pure pieces of the household (Phase 1): who a Planner view is for, and the partner's display name.
// No I/O. Household totals, shared costs and record assignments are NOT part of Phase 1.

export type Person = "me" | "partner";
export type PlannerPerson = Person | "household";

export const DEFAULT_PARTNER_NAME = "Partner";
export const MAX_PARTNER_NAME = 60;

export type PartnerNameError = "tooLong";

/** Blank means "use the default name". Trims; limits the length to what the database allows. */
export function parsePartnerName(raw: string): { ok: true; name: string } | { ok: false; error: PartnerNameError } {
  const name = raw.trim();
  if (name.length > MAX_PARTNER_NAME) return { ok: false, error: "tooLong" };
  return { ok: true, name: name || DEFAULT_PARTNER_NAME };
}
