import { describe, it, expect } from "vitest";
import { convertSalary, formatCurrency, isValidConfig } from "./salary";

const std = { hoursPerWeek: 40, weeksPerYear: 52 };

describe("convertSalary", () => {
  it("converts from an hourly rate", () => {
    const r = convertSalary(25, "hourly", std)!;
    expect(r.annual).toBe(52000);
    expect(r.monthly).toBeCloseTo(4333.33, 2);
    expect(r.biweekly).toBe(2000);
    expect(r.weekly).toBe(1000);
    expect(r.hourly).toBe(25);
  });

  it("converts from an annual salary", () => {
    const r = convertSalary(78000, "annual", std)!;
    expect(r.monthly).toBe(6500);
    expect(r.biweekly).toBe(3000);
    expect(r.weekly).toBe(1500);
    expect(r.hourly).toBeCloseTo(37.5, 6);
  });

  it("round-trips through every basis", () => {
    const base = convertSalary(60000, "annual", std)!;
    for (const basis of ["annual", "monthly", "biweekly", "weekly", "hourly"] as const) {
      const r = convertSalary(base[basis], basis, std)!;
      expect(r.annual).toBeCloseTo(60000, 6);
    }
  });

  it("respects custom hours per week and weeks per year", () => {
    const r = convertSalary(30, "hourly", { hoursPerWeek: 32, weeksPerYear: 50 })!;
    expect(r.annual).toBe(48000);
    expect(r.weekly).toBe(960);
    expect(r.biweekly).toBe(1920);
    expect(r.hourly).toBe(30);
  });

  it("rejects invalid amounts and configs", () => {
    expect(convertSalary(NaN, "annual", std)).toBeNull();
    expect(convertSalary(-1, "annual", std)).toBeNull();
    expect(convertSalary(10, "hourly", { hoursPerWeek: 0, weeksPerYear: 52 })).toBeNull();
    expect(isValidConfig({ hoursPerWeek: 169, weeksPerYear: 52 })).toBe(false);
    expect(isValidConfig({ hoursPerWeek: 40, weeksPerYear: 54 })).toBe(false);
    expect(isValidConfig(std)).toBe(true);
  });

  it("formats currency consistently", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
    expect(formatCurrency(0)).toBe("$0.00");
    expect(formatCurrency(4333.3333)).toBe("$4,333.33");
  });
});
