import { describe, it, expect } from "vitest";
import { getTaskExecutionDestination } from "./taskNavigation";

const todayISO = "2026-10-08";
const tomorrowISO = "2026-10-09";

describe("getTaskExecutionDestination", () => {
  it("routes to Today when planDate matches todayISO", () => {
    const dest = getTaskExecutionDestination({
      planDate: todayISO,
      todayISO,
      tomorrowISO,
      terminalId: "D",
      rootId: "A",
    });
    expect(dest).toBe("/standup/today?goal=D&root=A");
  });

  it("routes to Tomorrow when planDate matches tomorrowISO", () => {
    const dest = getTaskExecutionDestination({
      planDate: tomorrowISO,
      todayISO,
      tomorrowISO,
      terminalId: "D",
      rootId: "A",
    });
    expect(dest).toBe("/standup/tomorrow?goal=D&root=A");
  });

  it("routes to the calendar date page for an arbitrary past date", () => {
    const dest = getTaskExecutionDestination({
      planDate: "2026-09-15",
      todayISO,
      tomorrowISO,
      terminalId: "D",
      rootId: "A",
    });
    expect(dest).toBe("/standup/date/2026-09-15?goal=D&root=A");
  });

  it("routes to the calendar date page for an arbitrary future date", () => {
    const dest = getTaskExecutionDestination({
      planDate: "2026-12-25",
      todayISO,
      tomorrowISO,
      terminalId: "D",
      rootId: "A",
    });
    expect(dest).toBe("/standup/date/2026-12-25?goal=D&root=A");
  });

  it("returns null for a null planDate instead of inventing a destination", () => {
    const dest = getTaskExecutionDestination({
      planDate: null,
      todayISO,
      tomorrowISO,
      terminalId: "D",
      rootId: "A",
    });
    expect(dest).toBeNull();
  });

  it("URL-encodes ids that contain characters needing encoding", () => {
    const dest = getTaskExecutionDestination({
      planDate: todayISO,
      todayISO,
      tomorrowISO,
      terminalId: "id with space",
      rootId: "id&with=special",
    });
    expect(dest).toBe("/standup/today?goal=id+with+space&root=id%26with%3Dspecial");
  });

  it("a never-rescheduled Task (root === terminal) still produces a valid destination", () => {
    const dest = getTaskExecutionDestination({
      planDate: todayISO,
      todayISO,
      tomorrowISO,
      terminalId: "A",
      rootId: "A",
    });
    expect(dest).toBe("/standup/today?goal=A&root=A");
  });
});
