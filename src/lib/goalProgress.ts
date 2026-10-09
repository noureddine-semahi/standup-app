// Goal Engine Phase 2D-3: pure Target Goal progress calculation +
// formatting, shared by Goal Detail, Dashboard, and Review Today. No
// Supabase I/O, no presentation/JSX -- that stays in db.ts and each
// page respectively. Deliberately reads only plain numbers/strings, not
// an OutcomeGoal, so it has no dependency on db.ts at all.

export type TargetProgress =
  | { configured: false }
  | {
      configured: true;
      // Display value -- null current_value becomes 0 here, but the
      // stored value itself is never touched/mutated by this function.
      currentValue: number;
      targetValue: number;
      // Unclamped -- can exceed 100 (current > target) or be negative
      // (a negative current_value). Never used for the visual bar.
      rawPct: number;
      roundedPct: number;
      // Clamped 0..100 -- for the visual bar's width ONLY. This is the
      // one place "protect visual width from negative current values"
      // and "clamp width to 0..100" both apply.
      barPct: number;
    };

/**
 * target_value === null or <= 0 -> not configured, no percentage at
 * all (not even 0%) -- callers must show a "not configured" state
 * instead of a fake/empty progress bar.
 */
export function getTargetProgress(params: {
  currentValue: number | null;
  targetValue: number | null;
}): TargetProgress {
  const { targetValue } = params;
  if (targetValue == null || targetValue <= 0) {
    return { configured: false };
  }
  const currentValue = params.currentValue == null ? 0 : params.currentValue;
  const rawPct = (currentValue / targetValue) * 100;
  const roundedPct = Math.round(rawPct);
  const barPct = Math.max(0, Math.min(100, rawPct));
  return { configured: true, currentValue, targetValue, rawPct, roundedPct, barPct };
}

// $/€/£/¥ prefix the number with no space ("$1,750"); "%" suffixes with
// no space ("35%"); any other unit suffixes with one space ("18 jobs").
const PREFIX_SYMBOLS = new Set(["$", "€", "£", "¥"]);

// Plain decimal formatting, NOT Intl's currency style -- this project
// has no currency-conversion/locale engine and isn't building one here;
// "en-US" is pinned explicitly so grouping/decimal punctuation is
// consistent regardless of the viewer's own browser locale. Up to 2
// decimal places, and Intl.NumberFormat already never pads trailing
// zeros (1750.50 as a JS number is just 1750.5).
function formatTargetNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function applyUnit(numberText: string, unit: string | null): string {
  const trimmedUnit = unit?.trim() || null;
  if (!trimmedUnit) return numberText;
  if (PREFIX_SYMBOLS.has(trimmedUnit)) return `${trimmedUnit}${numberText}`;
  if (trimmedUnit === "%") return `${numberText}%`;
  return `${numberText} ${trimmedUnit}`;
}

/**
 * "current / target [unit]" -- the one shared Target-progress string,
 * e.g. formatTargetProgress(1750, 5000, "$") -> "$1,750 / $5,000".
 * Unit rules: $/€/£/¥ prefix each number (no space), "%" suffixes the
 * LAST number only (no space, e.g. "35 / 100%"), any other unit
 * suffixes the last number with one leading space, blank/null unit
 * omits it entirely.
 */
export function formatTargetProgress(current: number, target: number, unit: string | null): string {
  const trimmedUnit = unit?.trim() || null;
  const currentText = formatTargetNumber(current);
  const targetText = formatTargetNumber(target);

  if (trimmedUnit && PREFIX_SYMBOLS.has(trimmedUnit)) {
    return `${trimmedUnit}${currentText} / ${trimmedUnit}${targetText}`;
  }
  return `${currentText} / ${applyUnit(targetText, trimmedUnit)}`;
}
