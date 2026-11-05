import { supabase } from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/db";
import { isHouseholdUnavailableError } from "@/lib/supabase/household";
import { fingerprintOf, rowToShared, sharedToColumns, validateShared, type IntegrityIssue, type SharedIntegrity, type SharedRow, type SharedValidationError } from "@/lib/householdShared";
import { emptyComposition, emptyShared, type Composition, type SharedHousehold } from "@/lib/householdPlan";

// Data access for the household's SHARED data (Phase 2): shared expenses, joint debts, shared goals and household
// composition, plus the partner's include_in_household switch. Everything is owner-only (RLS) and every call also
// filters on the signed-in user id. This module touches ONLY `households` (the new columns) and, for the switch,
// `household_members.include_in_household`. It never reads or writes financial_profiles, Bills, Payments or
// Subscriptions, so household operations cannot change personal financial records.
// Requires supabase/migrations/20261108000100_household_shared.sql. Until that is applied the shared data reads as
// "unavailable" and the Me and Partner planners (which use other columns/tables) are unaffected.

/**
 * True when the shared-household columns (or the table) don't exist yet. Broader than the table-only check because the
 * Phase 2 migration adds COLUMNS to an existing table: a missing column is reported by Postgres as 42703 and by
 * PostgREST as PGRST204 / "Could not find the '<col>' column".
 */
export function isHouseholdSharedUnavailableError(e: unknown): boolean {
  if (isHouseholdUnavailableError(e)) return true;
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  const msg = String(err.message ?? "").toLowerCase();
  return err.code === "42703" || err.code === "PGRST204" || (msg.includes("column") && (msg.includes("does not exist") || msg.includes("could not find")));
}

export const SHARED_SELECT = "id,revision,shared_expenses,no_shared_expenses,shared_debts,no_shared_debts,shared_goals,adults,children,other_members";

type HouseholdRow = SharedRow & { id: string };

export type HouseholdSharedState =
  | { status: "unavailable" }
  | {
      status: "ready";
      /** null until the household row exists (it is created the first time anything is saved). */
      householdId: string | null;
      /** Pass this back when saving. The save is refused if someone else changed the data in between. */
      revision: number;
      shared: SharedHousehold;
      composition: Composition;
      /** Stored items that could not be shown and were left out of this display copy (see rowToShared). */
      droppedItems: number;
      /**
       * Whether this display copy equals what is stored. When it does not (`ok: false`) the copy is for viewing only:
       * saving it is refused until the user acknowledges the problem with `acknowledgeIntegrity: fingerprint`.
       */
      integrity: SharedIntegrity;
      /** The stored columns exactly as read (the shared-data columns and the revision; no ids or credentials). For export. */
      stored: SharedRow;
    };
export type ReadyState = Extract<HouseholdSharedState, { status: "ready" }>;

export class HouseholdValidationError extends Error {
  constructor(readonly errors: SharedValidationError[]) {
    super("Household data failed validation: " + errors.map((e) => e.code).join(", "));
    this.name = "HouseholdValidationError";
  }
}

/**
 * The STORED data is malformed or has repeated ids, so the sanitized copy the app shows would permanently change or
 * delete part of it if saved. Nothing was written. Recoverable: `stored` is the exact stored content (to copy or
 * export), `latest` is the display copy, and the caller can retry with `acknowledgeIntegrity: fingerprint` once the
 * user has seen the issues and accepted that the listed entries will not be kept.
 */
export class HouseholdIntegrityError extends Error {
  constructor(
    readonly issues: IntegrityIssue[],
    readonly fingerprint: string,
    readonly stored: SharedRow,
    readonly latest: ReadyState
  ) {
    super("Stored household data has problems that saving would overwrite: " + issues.map((i) => i.code).join(", "));
    this.name = "HouseholdIntegrityError";
  }
}

/** Someone else saved first. `latest` is what is stored now, so the caller can show it and let the user re-apply. */
export class HouseholdConflictError extends Error {
  constructor(readonly latest: HouseholdSharedState) {
    super("The household was changed elsewhere; reload before saving.");
    this.name = "HouseholdConflictError";
  }
}

function toState(row: HouseholdRow | null): ReadyState {
  if (!row) return { status: "ready", householdId: null, revision: 0, shared: emptyShared(), composition: emptyComposition(), droppedItems: 0, integrity: { ok: true, issues: [], fingerprint: fingerprintOf(null) }, stored: {} };
  const read = rowToShared(row);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, ...storedColumns } = row;
  return { status: "ready", householdId: row.id, revision: Number.isInteger(row.revision) ? (row.revision as number) : 0, shared: read.shared, composition: read.composition, droppedItems: read.droppedItems, integrity: read.integrity, stored: storedColumns };
}

async function readRow(userId: string): Promise<HouseholdRow | null> {
  const { data, error } = await supabase.from("households").select(SHARED_SELECT).eq("owner_id", userId).maybeSingle();
  if (error) throw error;
  return (data as HouseholdRow | null) ?? null;
}

/** Loads the household's shared data. A missing migration is "unavailable", not an error. */
export async function getHouseholdShared(): Promise<HouseholdSharedState> {
  try {
    return toState(await readRow(await getCurrentUserId()));
  } catch (e) {
    if (isHouseholdSharedUnavailableError(e)) return { status: "unavailable" };
    throw e;
  }
}

/**
 * Validates, then saves shared data only if it is still the version the caller read (`expectedRevision`). The database
 * moves the revision, so a stale save matches no row and raises HouseholdConflictError instead of overwriting.
 * Throws HouseholdValidationError (nothing is sent) for invalid data, and the raw error if the migration is missing.
 */
export async function saveHouseholdShared(input: {
  expectedRevision: number;
  shared: SharedHousehold;
  composition: Composition;
  /** The `integrity.fingerprint` the user was shown. Needed only to save over stored data that has integrity problems. */
  acknowledgeIntegrity?: string;
}): Promise<ReadyState> {
  const errors = validateShared(input.shared, input.composition);
  if (errors.length > 0) throw new HouseholdValidationError(errors);
  const userId = await getCurrentUserId();
  // Make sure the household exists without changing an existing one (ignoreDuplicates => no update, no revision bump).
  const { error: upErr } = await supabase.from("households").upsert({ owner_id: userId }, { onConflict: "owner_id", ignoreDuplicates: true });
  if (upErr) throw upErr;
  const existing = await readRow(userId);
  if (!existing) throw new Error("Household could not be created.");
  // Cheap early refusal: the stored version is already newer than the one the caller edited. Nothing is written.
  if ((Number.isInteger(existing.revision) ? (existing.revision as number) : 0) !== input.expectedRevision) throw new HouseholdConflictError(toState(existing));
  // Never save a sanitized copy over malformed / duplicate-id stored data unless the user explicitly accepted it.
  const stored = toState(existing);
  if (!stored.integrity.ok && input.acknowledgeIntegrity !== stored.integrity.fingerprint) {
    const { id: _id, revision: _rev, ...columns } = existing; // eslint-disable-line @typescript-eslint/no-unused-vars
    throw new HouseholdIntegrityError(stored.integrity.issues, stored.integrity.fingerprint, columns, stored);
  }
  const { data, error } = await supabase
    .from("households")
    .update(sharedToColumns(input.shared, input.composition))
    .eq("id", existing.id)
    .eq("owner_id", userId)
    .eq("revision", input.expectedRevision)
    .select(SHARED_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HouseholdConflictError(toState(await readRow(userId)));
  return toState(data as HouseholdRow);
}

/** The partner's include_in_household setting, or null when there is no partner (callers treat that as "included"). */
export async function getPartnerIncluded(): Promise<boolean | null> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from("household_members").select("id,include_in_household").eq("owner_id", userId).eq("role", "partner").maybeSingle();
  if (error) throw error;
  return data ? (data as { include_in_household: boolean }).include_in_household !== false : null;
}

/**
 * Includes or excludes the partner from household totals. Changes this one flag on this one member row; the partner's
 * profile, the shared data and every personal record are left alone.
 */
export async function setPartnerIncluded(memberId: string, included: boolean): Promise<boolean> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from("household_members").update({ include_in_household: included }).eq("id", memberId).eq("owner_id", userId).select("id,include_in_household").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Partner not found.");
  return (data as { include_in_household: boolean }).include_in_household !== false;
}
