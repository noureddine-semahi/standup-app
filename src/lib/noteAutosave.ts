// Debounced, race-safe autosave for one note. Framework-free so it can be tested with fake timers.
//
// Rules it guarantees:
//  - edits are saved after `delay` ms of quiet (or at once on flush());
//  - at most ONE save is in flight; edits made meanwhile are saved next, with the revision the last save returned, so
//    two saves never race and an older response can never overwrite newer text;
//  - a failed save keeps the unsaved text (status "error") and is retried on the next edit or on retry(); nothing is lost;
//  - a revision conflict (someone else saved first) stops autosaving and keeps the local text (status "conflict") until
//    the user chooses to reload; nothing is silently overwritten.

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";

export type NoteFields = { title: string; body: string };

export type SaveResult =
  | { ok: true; revision: number }
  | { ok: false; kind: "conflict" }
  | { ok: false; kind: "error"; message?: string };

export type AutosaverOptions = {
  /** Save these fields if the stored revision is still `revision`. Must not throw; return a result. */
  save: (fields: NoteFields, revision: number) => Promise<SaveResult>;
  /** The note as it is stored right now (the starting point). */
  initial: NoteFields & { revision: number };
  delay?: number;
  onStatus: (status: SaveStatus, detail?: string) => void;
  /** Called after each successful save with the revision now stored. */
  onSaved?: (revision: number) => void;
};

export type Autosaver = {
  /** Record the latest text. Schedules a save. */
  edit: (fields: NoteFields) => void;
  /** Save now (resolves when nothing is pending or in flight, or when the save failed / conflicted). */
  flush: () => Promise<SaveStatus>;
  /** Try again after an error. */
  retry: () => Promise<SaveStatus>;
  /** True while there is text that is not yet stored. */
  isDirty: () => boolean;
  status: () => SaveStatus;
  revision: () => number;
  /** Use this revision for the next save (after a pin change, or after the user chose to keep their text over a newer version). */
  adoptRevision: (revision: number) => void;
  /** After a conflict the user chose "keep mine": allow saving again (with the adopted revision). */
  resume: () => Promise<SaveStatus>;
  /** Cancel timers (call on unmount). Does not save. */
  dispose: () => void;
};

const same = (a: NoteFields, b: NoteFields) => a.title === b.title && a.body === b.body;

export function createAutosaver(opts: AutosaverOptions): Autosaver {
  const delay = opts.delay ?? 800;
  let revision = opts.initial.revision;
  let saved: NoteFields = { title: opts.initial.title, body: opts.initial.body };
  let latest: NoteFields = { ...saved };
  let status: SaveStatus = "idle";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;
  let disposed = false;

  const set = (s: SaveStatus, detail?: string) => {
    status = s;
    if (!disposed) opts.onStatus(s, detail);
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  async function run(): Promise<void> {
    // Loops so edits made during a save are picked up right after it, with the newest revision.
    while (!same(latest, saved) && status !== "conflict") {
      const sending = { ...latest };
      set("saving");
      const result = await opts.save(sending, revision);
      if (result.ok) {
        revision = result.revision;
        saved = sending;
        opts.onSaved?.(revision);
        if (same(latest, saved)) set("saved");
      } else if (result.kind === "conflict") {
        set("conflict");
        return;
      } else {
        set("error", result.message);
        return;
      }
    }
  }

  function start(): Promise<void> {
    if (inflight) return inflight;
    inflight = run().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return {
    edit(fields) {
      latest = { ...fields };
      if (status === "conflict") return; // keep the local text; the user decides what to do
      clear();
      if (same(latest, saved)) {
        if (status === "saving" || status === "error") {
          // back to exactly the stored text: nothing left to save
          if (!inflight) set("saved");
        }
        return;
      }
      if (status !== "saving") set("saving");
      timer = setTimeout(() => {
        timer = null;
        void start();
      }, delay);
    },
    async flush() {
      clear();
      if (status !== "conflict") await start();
      return status;
    },
    async retry() {
      clear();
      if (status === "conflict") return status;
      await start();
      return status;
    },
    adoptRevision(r) {
      revision = r;
    },
    async resume() {
      if (status === "conflict") status = "idle";
      clear();
      await start();
      return status;
    },
    isDirty: () => !same(latest, saved),
    status: () => status,
    revision: () => revision,
    dispose() {
      disposed = true;
      clear();
    },
  };
}
