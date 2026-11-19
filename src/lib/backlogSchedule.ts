/**
 * Whether a Backlog item may be scheduled for `value`: a real calendar day (YYYY-MM-DD) that is today or later. The date picker already sets `min`, but a typed or pasted
 * value can bypass that, so Schedule checks it too. An empty, malformed, impossible (2026-02-30) or past date is not schedulable.
 */
export function isSchedulableDate(value: string | null | undefined, todayISO: string): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(y, m - 1, d, 12, 0, 0);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return false;
  return value >= todayISO;
}
