import { describe, it, expect } from "vitest";
import { calcReducer, initialCalcState, actionForKey, formatDisplay, type CalcAction, type CalcState } from "./calculator";

function run(actions: CalcAction[], from: CalcState = initialCalcState()): CalcState {
  return actions.reduce(calcReducer, from);
}
const keys = (s: string): CalcAction[] =>
  s.split("").map((k) => actionForKey(k)).filter((a): a is CalcAction => a !== null);

describe("calculator", () => {
  it("does basic arithmetic with all four operators", () => {
    expect(run(keys("7+5=")).display).toBe("12");
    expect(run(keys("7-5=")).display).toBe("2");
    expect(run(keys("7*5=")).display).toBe("35");
    expect(run(keys("7/5=")).display).toBe("1.4");
  });

  it("chains operations left to right", () => {
    expect(run(keys("2+3*4=")).display).toBe("20");
  });

  it("handles decimals without floating-point noise", () => {
    expect(run(keys("0.1+0.2=")).display).toBe("0.3");
    expect(run(keys("1.5.5")).display).toBe("1.55");
    expect(run([{ type: "decimal" }, { type: "digit", digit: "5" }]).display).toBe("0.5");
  });

  it("percent: standalone divides by 100, after +/- takes a share of the left operand", () => {
    expect(run([...keys("50"), { type: "percent" }]).display).toBe("0.5");
    expect(run([...keys("200+10"), { type: "percent" }, { type: "equals" }]).display).toBe("220");
    expect(run([...keys("200-10"), { type: "percent" }, { type: "equals" }]).display).toBe("180");
  });

  it("division by zero shows Error and the next entry starts over", () => {
    const s = run(keys("5/0="));
    expect(s.display).toBe("Error");
    expect(run(keys("7"), s).display).toBe("7");
  });

  it("delete removes the last digit, clear resets but keeps memory and history", () => {
    expect(run([...keys("123"), { type: "delete" }]).display).toBe("12");
    expect(run([...keys("5"), { type: "delete" }]).display).toBe("0");
    const s = run([...keys("2+3="), { type: "memory", kind: "add" }, ...keys("9"), { type: "clear" }]);
    expect(s.display).toBe("0");
    expect(s.memory).toBe(5);
    expect(s.history).toHaveLength(1);
  });

  it("memory add / subtract / recall / clear", () => {
    let s = run([...keys("8"), { type: "memory", kind: "add" }, ...keys("3"), { type: "memory", kind: "subtract" }]);
    expect(s.memory).toBe(5);
    s = run([{ type: "clear" }, { type: "memory", kind: "recall" }], s);
    expect(s.display).toBe("5");
    expect(run([{ type: "memory", kind: "clear" }], s).memory).toBe(0);
  });

  it("records history (newest first) and can clear it or recall a result", () => {
    let s = run(keys("2+3=").concat(keys("4*5=")));
    expect(s.history.map((h) => h.expression)).toEqual(["4 × 5", "2 + 3"]);
    expect(s.history[0].result).toBe("20");
    s = run([{ type: "recall", value: "1,234.5" }], s);
    expect(s.display).toBe("1234.5");
    expect(run([{ type: "clearHistory" }], s).history).toEqual([]);
  });

  it("negates and changes operator before the second number", () => {
    expect(run([...keys("5"), { type: "negate" }]).display).toBe("-5");
    expect(run(keys("5+") .concat(keys("*"), keys("3="))).display).toBe("15");
  });

  it("maps keyboard keys", () => {
    expect(actionForKey("Enter")).toEqual({ type: "equals" });
    expect(actionForKey("Backspace")).toEqual({ type: "delete" });
    expect(actionForKey("Escape")).toEqual({ type: "clear" });
    expect(actionForKey("q")).toBeNull();
  });

  it("groups thousands for display only", () => {
    expect(formatDisplay("1234567.89")).toBe("1,234,567.89");
    expect(formatDisplay("-1000")).toBe("-1,000");
    expect(formatDisplay("12.")).toBe("12.");
  });
});
