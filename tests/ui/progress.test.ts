import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = typeof import("../../src/ui/store");

describe("progress and saves in the store", () => {
  const memory = new Map<string, string>();
  let store: Store;
  const stored = (key: string) => JSON.parse(memory.get(`cagecoach.${key}`) ?? "null") as unknown;
  beforeEach(async () => {
    memory.clear();
    vi.stubGlobal("localStorage", {
      get length() {
        return memory.size;
      },
      key: (i: number) => [...memory.keys()][i] ?? null,
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    });
    vi.resetModules();
    store = await import("../../src/ui/store");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("moves a record from before per-device counters into this device's counts, once, and sums them back", () => {
    memory.set("cagecoach.progress", JSON.stringify({ solved: { "classic-easy": ["a"] }, best: {}, hinted: { single: 2 }, total: 3, streak: { last: "", days: 0 } }));
    const p = store.loadProgress();
    expect(p.total).toBe(3);
    expect(p.hinted).toEqual({ single: 2 });
    const device = store.deviceId();
    expect(device).toMatch(/^[0-9a-f]{16}$/);
    expect(stored("progress")).toEqual({ solved: { "classic-easy": ["a"] }, best: {}, streak: { last: "", days: 0 }, counters: { [device]: { total: 3, hinted: { single: 2 } } } });
    expect(stored("device")).toBe(device);
  });

  it("bumps only this device's counts and shows every device's together", () => {
    const device = store.deviceId();
    memory.set("cagecoach.progress", JSON.stringify({ solved: {}, best: {}, streak: { last: "", days: 0 }, counters: { other: { total: 5, hinted: { pair: 1 } } } }));
    store.recordSolve("classic", "easy", "p1", 1000);
    store.recordHint("pair");
    store.recordHint("single");
    const p = store.loadProgress();
    expect(p.counters).toEqual({ other: { total: 5, hinted: { pair: 1 } }, [device]: { total: 1, hinted: { pair: 1, single: 1 } } });
    expect(p.total).toBe(6);
    expect(p.hinted).toEqual({ pair: 2, single: 1 });
    expect(p.solved).toEqual({ "classic-easy": ["p1"] });
  });

  it("leaves the device id out of backups, so a restore counts as a new device and the totals still add up", async () => {
    store.recordSolve("classic", "easy", "p1", 1000);
    const device = store.deviceId();
    const backup = store.makeBackup();
    expect(backup.data.device).toBeUndefined();
    expect(backup.data.progress).toMatchObject({ counters: { [device]: { total: 1 } } });
    expect(store.restoreBackup(backup)).toBe(true);
    expect(memory.has("cagecoach.device")).toBe(false);
    // The next page load: a fresh id, the old device's count frozen, the sum unchanged.
    vi.resetModules();
    const fresh = await import("../../src/ui/store");
    expect(fresh.deviceId()).not.toBe(device);
    expect(fresh.loadProgress().total).toBe(1);
    fresh.recordSolve("classic", "easy", "p2", 1000);
    expect(fresh.loadProgress().counters).toEqual({ [device]: { total: 1, hinted: {} }, [fresh.deviceId()]: { total: 1, hinted: {} } });
  });

  it("stamps saves and leaves a tombstone where a game was cleared, which resumes as nothing", () => {
    store.storeSaved("killer", { difficulty: "hard", entry: "x", state: { n: 1 } }, 500);
    expect(store.loadSaved("killer")).toEqual({ difficulty: "hard", entry: "x", state: { n: 1 }, savedAt: 500 });
    store.clearSaved("killer", 900);
    expect(store.loadSaved("killer")).toBeNull();
    expect(stored("game.killer")).toEqual({ clearedAt: 900 });
    // A save from before timestamps still resumes.
    memory.set("cagecoach.game.classic", JSON.stringify({ difficulty: "easy", entry: "e", state: {} }));
    expect(store.loadSaved("classic")).toEqual({ difficulty: "easy", entry: "e", state: {} });
  });

  it("tells listeners about saves and removes, but not about quiet writes, and writes nothing after a restore", () => {
    const keys: string[] = [];
    const off = store.onChange((k) => keys.push(k));
    store.save("seen", ["a"]);
    store.saveQuiet("seen", ["a", "b"]);
    store.remove("seen");
    expect(keys).toEqual(["seen", "seen"]);
    off();
    store.save("seen", ["c"]);
    expect(keys).toEqual(["seen", "seen"]);

    store.restoreBackup({ app: "nonet", version: 2, exported: "", data: { seen: ["kept"] } });
    store.saveQuiet("seen", ["lost"]);
    store.save("seen", ["lost"]);
    expect(stored("seen")).toEqual(["kept"]);
  });
});
