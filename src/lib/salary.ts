// Gross-pay conversions for the Tools salary calculator. Client-side only, no
// taxes/deductions.
//
// Model (one source of truth, annual):
//   weekly   = annual / weeksPerYear        (pay for one worked week)
//   biweekly = weekly * 2                   (26 periods at the default 52 weeks)
//   monthly  = annual / 12
//   hourly   = weekly / hoursPerWeek
// so changing weeks-per-year (e.g. 50 for unpaid time off) keeps a biweekly
// paycheck equal to two weeks of pay rather than a fixed 1/26th of the year.

export type SalaryBasis = "annual" | "monthly" | "biweekly" | "weekly" | "hourly";

export const SALARY_BASES: readonly SalaryBasis[] = ["annual", "monthly", "biweekly", "weekly", "hourly"];

export const DEFAULT_HOURS_PER_WEEK = 40;
export const DEFAULT_WEEKS_PER_YEAR = 52;
export const MAX_HOURS_PER_WEEK = 168;
export const MAX_WEEKS_PER_YEAR = 53;

export type SalaryConfig = { hoursPerWeek: number; weeksPerYear: number };
export type SalaryBreakdown = Record<SalaryBasis, number>;

export function isValidConfig({ hoursPerWeek, weeksPerYear }: SalaryConfig): boolean {
  return (
    Number.isFinite(hoursPerWeek) && hoursPerWeek > 0 && hoursPerWeek <= MAX_HOURS_PER_WEEK &&
    Number.isFinite(weeksPerYear) && weeksPerYear > 0 && weeksPerYear <= MAX_WEEKS_PER_YEAR
  );
}

/** Returns every period for `amount` entered at `basis`, or null for invalid input. */
export function convertSalary(amount: number, basis: SalaryBasis, config: SalaryConfig): SalaryBreakdown | null {
  if (!Number.isFinite(amount) || amount < 0 || !isValidConfig(config)) return null;
  const { hoursPerWeek, weeksPerYear } = config;

  let annual: number;
  switch (basis) {
    case "annual": annual = amount; break;
    case "monthly": annual = amount * 12; break;
    case "biweekly": annual = (amount / 2) * weeksPerYear; break;
    case "weekly": annual = amount * weeksPerYear; break;
    case "hourly": annual = amount * hoursPerWeek * weeksPerYear; break;
  }

  const weekly = annual / weeksPerYear;
  return {
    annual,
    monthly: annual / 12,
    biweekly: weekly * 2,
    weekly,
    hourly: weekly / hoursPerWeek,
  };
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One currency format everywhere: $1,234.56 (rounded to cents). */
export function formatCurrency(n: number): string {
  return usd.format(Math.round(n * 100) / 100);
}
