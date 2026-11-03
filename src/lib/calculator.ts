// Pure state machine for the Tools calculator (immediate-execution style, like a
// pocket calculator: 2 + 3 × 4 = 20). Everything here is client-side and free of
// React so it can be tested directly.

export type Op = "+" | "-" | "*" | "/";

export type HistoryItem = { id: number; expression: string; result: string };

export type CalcState = {
  /** What the display shows: the number being typed, or the last result. */
  display: string;
  /** Left operand waiting for the pending operator. */
  acc: number | null;
  op: Op | null;
  /** True when the next digit should replace the display (after an op/equals/result). */
  fresh: boolean;
  error: boolean;
  memory: number;
  history: HistoryItem[];
  nextId: number;
};

export type CalcAction =
  | { type: "digit"; digit: string }
  | { type: "decimal" }
  | { type: "op"; op: Op }
  | { type: "equals" }
  | { type: "percent" }
  | { type: "negate" }
  | { type: "delete" }
  | { type: "clear" }
  | { type: "memory"; kind: "clear" | "recall" | "add" | "subtract" }
  | { type: "recall"; value: string }
  | { type: "clearHistory" };

export const MAX_DIGITS = 15;
export const MAX_HISTORY = 30;

export const OP_SYMBOL: Record<Op, string> = { "+": "+", "-": "−", "*": "×", "/": "÷" };

export function initialCalcState(): CalcState {
  return { display: "0", acc: null, op: null, fresh: true, error: false, memory: 0, history: [], nextId: 1 };
}

/** Trims binary floating-point noise (0.1 + 0.2 -> 0.3) without hiding real precision. */
export function roundResult(n: number): number {
  return parseFloat(n.toPrecision(12));
}

/** Plain (ungrouped) text for a number, e.g. 1234.5 -> "1234.5". */
export function numberToDisplay(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  const r = roundResult(n);
  // Avoid "-0".
  return String(Object.is(r, -0) ? 0 : r);
}

/** Adds thousands separators to a plain display string, keeping a trailing "." / zeros as typed. */
export function formatDisplay(raw: string): string {
  if (raw === "Error") return raw;
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  if (/e/i.test(body)) return raw;
  const [intPart, frac] = body.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${frac !== undefined ? "." + frac : ""}`;
}

function value(state: CalcState): number {
  return parseFloat(state.display);
}

function apply(a: number, op: Op, b: number): number {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? NaN : a / b;
  }
}

function errorState(state: CalcState): CalcState {
  return { ...state, display: "Error", acc: null, op: null, fresh: true, error: true };
}

function pushHistory(state: CalcState, expression: string, result: string): CalcState {
  const item: HistoryItem = { id: state.nextId, expression, result };
  return { ...state, nextId: state.nextId + 1, history: [item, ...state.history].slice(0, MAX_HISTORY) };
}

export function calcReducer(state: CalcState, action: CalcAction): CalcState {
  // After an error only Clear / memory / history actions do anything; any entry starts over.
  if (state.error && action.type !== "clear" && action.type !== "clearHistory" && action.type !== "memory") {
    if (action.type === "digit" || action.type === "decimal") {
      state = { ...state, display: "0", fresh: true, error: false, acc: null, op: null };
    } else {
      return state;
    }
  }

  switch (action.type) {
    case "digit": {
      if (state.fresh) return { ...state, display: action.digit, fresh: false };
      const digits = state.display.replace(/[^0-9]/g, "").length;
      if (digits >= MAX_DIGITS) return state;
      return { ...state, display: state.display === "0" ? action.digit : state.display + action.digit };
    }

    case "decimal": {
      if (state.fresh) return { ...state, display: "0.", fresh: false };
      if (state.display.includes(".")) return state;
      return { ...state, display: state.display + "." };
    }

    case "op": {
      // Changing your mind about the operator before typing the next number.
      if (state.op && state.fresh && state.acc !== null) return { ...state, op: action.op };
      const current = value(state);
      if (state.op && state.acc !== null) {
        const result = apply(state.acc, state.op, current);
        if (!Number.isFinite(result)) return errorState(state);
        const text = numberToDisplay(result);
        const next = pushHistory(
          state,
          `${formatDisplay(numberToDisplay(state.acc))} ${OP_SYMBOL[state.op]} ${formatDisplay(numberToDisplay(current))}`,
          formatDisplay(text)
        );
        return { ...next, display: text, acc: parseFloat(text), op: action.op, fresh: true };
      }
      return { ...state, acc: current, op: action.op, fresh: true };
    }

    case "equals": {
      if (!state.op || state.acc === null) return { ...state, fresh: true };
      const current = value(state);
      const result = apply(state.acc, state.op, current);
      if (!Number.isFinite(result)) return errorState(state);
      const text = numberToDisplay(result);
      const next = pushHistory(
        state,
        `${formatDisplay(numberToDisplay(state.acc))} ${OP_SYMBOL[state.op]} ${formatDisplay(numberToDisplay(current))}`,
        formatDisplay(text)
      );
      return { ...next, display: text, acc: null, op: null, fresh: true };
    }

    case "percent": {
      const current = value(state);
      // "200 + 10 %" means 10% OF 200 (20); on its own, "50 %" means 0.5.
      const pct = state.op && state.acc !== null && (state.op === "+" || state.op === "-")
        ? (state.acc * current) / 100
        : current / 100;
      return { ...state, display: numberToDisplay(pct), fresh: true };
    }

    case "negate": {
      if (state.display === "0" || state.display === "0.") return state;
      return {
        ...state,
        display: state.display.startsWith("-") ? state.display.slice(1) : "-" + state.display,
      };
    }

    case "delete": {
      if (state.fresh) return state;
      const next = state.display.slice(0, -1);
      return { ...state, display: next === "" || next === "-" ? "0" : next, fresh: next === "" || next === "-" ? true : false };
    }

    case "clear":
      return { ...initialCalcState(), memory: state.memory, history: state.history, nextId: state.nextId };

    case "memory": {
      if (action.kind === "clear") return { ...state, memory: 0 };
      if (action.kind === "recall") return { ...state, display: numberToDisplay(state.memory), fresh: true, error: false };
      const current = state.error ? 0 : value(state);
      const memory = roundResult(state.memory + (action.kind === "add" ? current : -current));
      return { ...state, memory, fresh: true };
    }

    case "recall":
      return { ...state, display: action.value.replace(/,/g, ""), fresh: true, error: false };

    case "clearHistory":
      return { ...state, history: [] };
  }
}

/** Maps a KeyboardEvent.key to a calculator action (null = not ours). */
export function actionForKey(key: string): CalcAction | null {
  if (/^[0-9]$/.test(key)) return { type: "digit", digit: key };
  switch (key) {
    case ".":
    case ",":
      return { type: "decimal" };
    case "+": return { type: "op", op: "+" };
    case "-": return { type: "op", op: "-" };
    case "*":
    case "x":
    case "X": return { type: "op", op: "*" };
    case "/": return { type: "op", op: "/" };
    case "Enter":
    case "=": return { type: "equals" };
    case "%": return { type: "percent" };
    case "Backspace": return { type: "delete" };
    case "Escape":
    case "Delete": return { type: "clear" };
    default: return null;
  }
}
