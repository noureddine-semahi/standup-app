import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAutosaver, type NoteFields, type SaveResult, type SaveStatus } from "./noteAutosave";

const flushPromises = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(results: (SaveResult | (() => Promise<SaveResult>))[], initial = { title: "", body: "", revision: 3 }) {
  const calls: { fields: NoteFields; revision: number }[] = [];
  const statuses: SaveStatus[] = [];
  const queue = [...results];
  const a = createAutosaver({
    initial,
    delay: 800,
    save: async (fields, revision) => {
      calls.push({ fields, revision });
      const r = queue.shift();
      if (!r) return { ok: true, revision: revision + 1 };
      return typeof r === "function" ? r() : r;
    },
    onStatus: (s) => statuses.push(s),
  });
  return { a, calls, statuses };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("debounce", () => {
  it("saves once after a quiet period, with the latest text and the loaded revision", async () => {
    const { a, calls, statuses } = setup([{ ok: true, revision: 4 }]);
    a.edit({ title: "T", body: "a" });
    a.edit({ title: "T", body: "ab" });
    a.edit({ title: "T", body: "abc" });
    expect(statuses).toEqual(["saving"]);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(799);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    await flushPromises();
    expect(calls).toEqual([{ fields: { title: "T", body: "abc" }, revision: 3 }]);
    expect(statuses.at(-1)).toBe("saved");
    expect(a.revision()).toBe(4);
    expect(a.isDirty()).toBe(false);
  });
  it("does not save when the text is unchanged", async () => {
    const { a, calls } = setup([]);
    a.edit({ title: "", body: "" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(0);
  });
  it("flush() saves immediately without waiting for the debounce", async () => {
    const { a, calls } = setup([{ ok: true, revision: 4 }]);
    a.edit({ title: "x", body: "" });
    await expect(a.flush()).resolves.toBe("saved");
    expect(calls).toHaveLength(1);
  });
});

describe("races", () => {
  it("never has two saves in flight: edits made during a save are saved next, with the revision it returned", async () => {
    let release!: (r: SaveResult) => void;
    const first = () => new Promise<SaveResult>((res) => (release = res));
    const { a, calls } = setup([first, { ok: true, revision: 6 }]);
    a.edit({ title: "", body: "one" });
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toHaveLength(1);
    // typing continues while the first request is still in flight
    a.edit({ title: "", body: "one two" });
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toHaveLength(1); // still just the one request
    release({ ok: true, revision: 5 });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ fields: { title: "", body: "one two" }, revision: 5 });
    expect(a.revision()).toBe(6);
    expect(a.status()).toBe("saved");
    expect(a.isDirty()).toBe(false);
  });
  it("a slow earlier response cannot make the status say Saved while newer text is still unsaved", async () => {
    let release!: (r: SaveResult) => void;
    const calls: number[] = [];
    const savedAt: number[] = [];
    let n = 0;
    const a = createAutosaver({
      initial: { title: "", body: "", revision: 3 },
      delay: 800,
      save: async (_f, rev) => {
        n++;
        calls.push(rev);
        return n === 1 ? new Promise<SaveResult>((res) => (release = res)) : { ok: true, revision: rev + 1 };
      },
      onStatus: (s) => {
        if (s === "saved") savedAt.push(n);
      },
    });
    a.edit({ title: "", body: "a" });
    await vi.advanceTimersByTimeAsync(800);
    a.edit({ title: "", body: "ab" });
    release({ ok: true, revision: 5 });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    // "Saved" appeared only once the SECOND save (the one carrying the newer text) had been sent and finished
    expect(savedAt).toEqual([2]);
    expect(calls).toEqual([3, 5]);
    expect(a.status()).toBe("saved");
  });
});

describe("failure", () => {
  it("keeps the unsaved text and shows an error, then retries on the next edit and succeeds", async () => {
    const { a, calls, statuses } = setup([{ ok: false, kind: "error", message: "offline" }, { ok: true, revision: 4 }]);
    a.edit({ title: "", body: "hello" });
    await vi.advanceTimersByTimeAsync(800);
    await flushPromises();
    expect(a.status()).toBe("error");
    expect(a.isDirty()).toBe(true);
    a.edit({ title: "", body: "hello!" });
    await vi.advanceTimersByTimeAsync(800);
    await flushPromises();
    expect(calls).toHaveLength(2);
    expect(calls[1].fields.body).toBe("hello!");
    expect(calls[1].revision).toBe(3); // the failed save did not move the revision
    expect(statuses.at(-1)).toBe("saved");
  });
  it("retry() saves the kept text", async () => {
    const { a, calls } = setup([{ ok: false, kind: "error" }, { ok: true, revision: 4 }]);
    a.edit({ title: "", body: "keep me" });
    await a.flush();
    expect(a.status()).toBe("error");
    await expect(a.retry()).resolves.toBe("saved");
    expect(calls[1].fields.body).toBe("keep me");
  });
  it("editing back to exactly the stored text clears a pending error", async () => {
    const { a } = setup([{ ok: false, kind: "error" }]);
    a.edit({ title: "", body: "x" });
    await a.flush();
    expect(a.status()).toBe("error");
    a.edit({ title: "", body: "" });
    expect(a.status()).toBe("saved");
    expect(a.isDirty()).toBe(false);
  });
});

describe("stale saves", () => {
  it("a revision conflict stops autosaving and keeps the local text; nothing is overwritten", async () => {
    const { a, calls } = setup([{ ok: false, kind: "conflict" }]);
    a.edit({ title: "", body: "mine" });
    await vi.advanceTimersByTimeAsync(800);
    await flushPromises();
    expect(a.status()).toBe("conflict");
    expect(a.isDirty()).toBe(true);
    a.edit({ title: "", body: "mine, more" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1); // no further attempts after a conflict
    await expect(a.flush()).resolves.toBe("conflict");
    expect(calls).toHaveLength(1);
  });
});

describe("dispose", () => {
  it("cancels a pending save and stops reporting", async () => {
    const { a, calls, statuses } = setup([]);
    a.edit({ title: "", body: "x" });
    a.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(0);
    expect(statuses).toEqual(["saving"]);
  });
});
