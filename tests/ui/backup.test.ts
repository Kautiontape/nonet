import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = typeof import("../../src/ui/store");

describe("backup", () => {
  const memory = new Map<string, string>();
  let store: Store;
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
    // A restore stops all saving until the page loads again: each test gets a fresh module.
    vi.resetModules();
    store = await import("../../src/ui/store");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("exports every saved key and restores it over newer progress, dropping keys the backup lacks", () => {
    store.finishPuzzle({ mode: "classic", difficulty: "easy", id: "classic-easy-1", level: 1, time: 300_000, mistakes: 0, hints: 0 }, 1000);
    store.save("settings", { sfx: false });
    store.save("game.killer", { difficulty: "hard", entry: "x", state: { elapsedMs: 5 } });
    memory.set("someone-else", "kept");
    const backup = store.makeBackup(new Date("2026-10-14T12:00:00Z"));
    expect(backup).toMatchObject({ app: "nonet", version: 2, exported: "2026-10-14T12:00:00.000Z" });
    expect(Object.keys(backup.data).sort()).toEqual(["game.killer", "progress", "results", "settings"]);

    const text = JSON.stringify(backup);
    store.finishPuzzle({ mode: "queens", difficulty: "easy", id: "queens-easy-1", level: 1, time: 60_000, mistakes: 1, hints: 0 }, 2000);
    store.save("lastMode", "queens");
    store.remove("game.killer");

    const parsed = store.parseBackup(text)!;
    expect(store.backupSolved(parsed)).toBe(1);
    expect(store.restoreBackup(parsed)).toBe(true);
    expect(store.loadProgress().total).toBe(1);
    expect(store.loadResults().map((r) => r.mode)).toEqual(["classic"]);
    expect(store.load("game.killer", null)).toEqual({ difficulty: "hard", entry: "x", state: { elapsedMs: 5 } });
    expect(store.load("lastMode", null)).toBeNull();
    expect(memory.get("someone-else")).toBe("kept");
  });

  it("saves nothing more after a restore, so the old page can't write over it", () => {
    store.restoreBackup({ app: "nonet", version: 1, exported: "", data: { lastMode: "killer" } });
    store.save("lastMode", "queens");
    store.remove("lastMode");
    expect(store.load("lastMode", null)).toBe("killer");
  });

  it("leaves out a stored value that isn't valid JSON", () => {
    memory.set("cagecoach.broken", "{oops");
    store.save("seen", ["tip-classic"]);
    expect(store.makeBackup().data).toEqual({ seen: ["tip-classic"] });
  });

  it("rejects text that isn't a backup this version can read", () => {
    expect(store.parseBackup("not json")).toBeNull();
    expect(store.parseBackup("[]")).toBeNull();
    expect(store.parseBackup(JSON.stringify({ app: "other", version: 1, data: {} }))).toBeNull();
    expect(store.parseBackup(JSON.stringify({ app: "nonet", version: 3, data: {} }))).toBeNull();
    expect(store.parseBackup(JSON.stringify({ app: "nonet", version: 2, data: {} }))).toMatchObject({ version: 2 });
    expect(store.parseBackup(JSON.stringify({ app: "nonet", version: 1, data: [] }))).toBeNull();
    expect(store.parseBackup(JSON.stringify({ app: "nonet", version: 1, data: {} }))).toMatchObject({ exported: "", data: {} });
  });
});
