import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import CalculatorTool from "./CalculatorTool";
import SalaryCalculatorTool from "./SalaryCalculatorTool";

afterEach(cleanup);

const wrap = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const readout = () => document.querySelector(".calc-readout")!.textContent;

describe("CalculatorTool", () => {
  it("calculates with the on-screen keys and records history", () => {
    wrap(<CalculatorTool />);
    press("2"); press("+"); press("3"); press("=");
    expect(readout()).toBe("5");
    expect(document.querySelector(".calc-history-expr")!.textContent).toBe("2 + 3");
    // history item recalls its result; Clear history empties the list
    press("Use result 5");
    expect(readout()).toBe("5");
    press("Clear history");
    expect(screen.getByText("No calculations yet.")).toBeTruthy();
  });

  it("supports memory, percent and delete", () => {
    wrap(<CalculatorTool />);
    press("8"); press("Add to memory"); press("Clear");
    press("Memory recall");
    expect(readout()).toBe("8");
    press("5"); press("0"); press("Percent");
    expect(readout()).toBe("0.5");
    press("Delete");
    expect(readout()).toBe("0.5");
  });

  it("responds to the desktop keyboard but not while typing in a field", () => {
    wrap(<><CalculatorTool /><input aria-label="other" /></>);
    fireEvent.keyDown(window, { key: "9" });
    fireEvent.keyDown(window, { key: "*" });
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(readout()).toBe("27");
    fireEvent.keyDown(screen.getByLabelText("other"), { key: "5" });
    expect(readout()).toBe("27");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(readout()).toBe("0");
  });
});

describe("SalaryCalculatorTool", () => {
  it("converts an hourly rate to every period", () => {
    wrap(<SalaryCalculatorTool />);
    press("Hourly");
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "25" } });
    const rows = Array.from(document.querySelectorAll(".salary-result-row")).map((r) => r.textContent);
    expect(rows[0]).toContain("$52,000.00");
    expect(rows[1]).toContain("$4,333.33");
    expect(rows[2]).toContain("$2,000.00");
    expect(rows[3]).toContain("$1,000.00");
    expect(rows[4]).toContain("$25.00");
  });

  it("honors custom hours/weeks and shows a message for invalid input", () => {
    wrap(<SalaryCalculatorTool />);
    press("Hourly");
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Hours per week"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Weeks per year"), { target: { value: "50" } });
    expect(document.querySelector(".salary-result-row")!.textContent).toContain("$48,000.00");
    fireEvent.change(screen.getByLabelText("Hours per week"), { target: { value: "0" } });
    expect(screen.getByText(/Enter an amount, hours per week/)).toBeTruthy();
    press("Reset defaults");
    expect(document.querySelector(".salary-result-row")!.textContent).toContain("$62,400.00");
  });
});
