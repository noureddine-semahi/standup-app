import { supabase } from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/db";
import { isBillsUnavailableError } from "@/lib/supabase/bills";
import { DEFAULT_PARTNER_NAME } from "@/lib/household";
import { emptyProfile, type FinancialProfile } from "@/lib/financialPlanner";
import { profileToColumns, rowToProfile } from "@/lib/supabase/financialProfile";

// Data access for the household and its one optional partner. Both tables are owner-only (RLS), and every
// call also filters on the signed-in user id. This module only ever touches `households` and
// `household_members`; it never reads or writes financial_profiles, Bills, Payments or Subscriptions.
// Requires supabase/migrations/20261107000100_household_profiles.sql.

/** True when the error means the household tables don't exist yet (migration not applied). */
export const isHouseholdUnavailableError = isBillsUnavailableError;

export type PartnerRecord = { id: string; name: string; profile: FinancialProfile };

type MemberRow = Parameters<typeof rowToProfile>[0] & { id: string; display_name: string };

/**
 * The partner's profile columns. Same shape as the personal profile, minus the three "use my existing
 * records" consent flags: the records belong to the signed-in user, not to the partner.
 */
export function partnerColumns(p: FinancialProfile): Record<string, unknown> {
  const cols = { ...profileToColumns(p) };
  delete cols.use_bills;
  delete cols.use_accounts;
  delete cols.use_subscriptions;
  // Household size is a household-level answer (a later phase), so the partner row doesn't carry it.
  delete cols.adults;
  delete cols.dependents;
  return cols;
}

function rowToPartner(r: MemberRow): PartnerRecord {
  return { id: r.id, name: r.display_name, profile: rowToProfile(r) };
}

/** The signed-in user's partner, or null when none has been added. */
export async function getPartner(): Promise<PartnerRecord | null> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from("household_members").select("*").eq("owner_id", userId).eq("role", "partner").maybeSingle();
  if (error) throw error;
  return data ? rowToPartner(data as MemberRow) : null;
}

/** Adds the partner (creating the household first if needed). Fails if a partner already exists. */
export async function createPartner(name: string): Promise<PartnerRecord> {
  const userId = await getCurrentUserId();
  const { data: household, error: hErr } = await supabase
    .from("households")
    .upsert({ owner_id: userId }, { onConflict: "owner_id" })
    .select("id")
    .single();
  if (hErr) throw hErr;
  const { data, error } = await supabase
    .from("household_members")
    .insert({
      household_id: (household as { id: string }).id,
      owner_id: userId,
      role: "partner",
      display_name: name || DEFAULT_PARTNER_NAME,
      ...partnerColumns(emptyProfile()),
    })
    .select()
    .single();
  if (error) throw error;
  return rowToPartner(data as MemberRow);
}

/** Saves the partner's whole profile (every wizard step saves, so setup resumes where it stopped). */
export async function savePartnerProfile(memberId: string, profile: FinancialProfile): Promise<PartnerRecord> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from("household_members").update(partnerColumns(profile)).eq("id", memberId).eq("owner_id", userId).select().single();
  if (error) throw error;
  return rowToPartner(data as MemberRow);
}

export async function renamePartner(memberId: string, name: string): Promise<PartnerRecord> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from("household_members").update({ display_name: name }).eq("id", memberId).eq("owner_id", userId).select().single();
  if (error) throw error;
  return rowToPartner(data as MemberRow);
}

/** Deletes the partner's profile (income, expenses, debts, savings, goals, progress). Nothing else is affected. */
export async function removePartner(memberId: string): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase.from("household_members").delete().eq("id", memberId).eq("owner_id", userId);
  if (error) throw error;
}
