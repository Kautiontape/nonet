import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latestRelease } from "../../src/ui/changelog";

type WhatsNew = typeof import("../../src/ui/whats-new");

describe("what's new after an update", () => {
  const memory = new Map<string, string>();
  let news: WhatsNew;
  const seen = () => JSON.parse(memory.get("cagecoach.seenRelease") ?? "null") as unknown;
  const played = () => memory.set("cagecoach.game.killer", JSON.stringify({ clearedAt: 1 }));
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
    news = await import("../../src/ui/whats-new");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("compares releases by number, not as text", () => {
    expect(news.compareReleases("1.0.0", "0.4.1")).toBeGreaterThan(0);
    expect(news.compareReleases("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(news.compareReleases("0.4.1", "0.4.1")).toBe(0);
    expect(news.compareReleases("0.4.1", "0.4.2")).toBeLessThan(0);
  });

  it("the newest release is the first changelog heading with a version: Unreleased doesn't count", () => {
    expect(latestRelease("## Unreleased\n\n- Soon.\n\n## 1.0.0 — 2026-10-20\n\n- New.\n\n## 0.4.1 — 2026-10-18\n\n- Old.\n")).toBe("1.0.0");
    expect(latestRelease("## Unreleased\n\n- Soon.\n")).toBeNull();
  });

  it("a first visit has nothing new: the release is noted quietly", () => {
    news.initWhatsNew(false, "1.0.0");
    expect(news.hasNews()).toBe(false);
    expect(seen()).toBe("1.0.0");
  });

  it("someone who played before this was tracked sees the newest release as new", () => {
    played();
    news.initWhatsNew(false, "1.0.0");
    expect(news.hasNews()).toBe(true);
    expect(news.newSections(["1.0.0", "0.4.1"])).toEqual([true, false]);
    expect(seen()).toBeNull(); // not until they open the changelog
  });

  it("counts finished puzzles and results as playing, not just a game in progress", () => {
    memory.set("cagecoach.results", JSON.stringify([{ id: "x" }]));
    news.initWhatsNew(false, "1.0.0");
    expect(news.hasNews()).toBe(true);
  });

  it("after an update, every release since the last one seen is new", () => {
    memory.set("cagecoach.seenRelease", JSON.stringify("0.4.0"));
    news.initWhatsNew(false, "1.0.0");
    expect(news.hasNews()).toBe(true);
    expect(news.newSections(["1.0.0", "0.4.1", "0.4.0"])).toEqual([true, true, false]);
    // A beta build lists Unreleased first: newer than any release, so new too.
    expect(news.newSections([null, "1.0.0", "0.4.0"])).toEqual([true, true, false]);
  });

  it("nothing is new once this release's notes were seen, or on an older build than the one seen", () => {
    memory.set("cagecoach.seenRelease", JSON.stringify("1.0.0"));
    news.initWhatsNew(false, "1.0.0");
    expect(news.hasNews()).toBe(false);
    news.initWhatsNew(false, "0.4.1");
    expect(news.hasNews()).toBe(false);
  });

  it("opening the changelog clears it, tells whoever's listening, and remembers", () => {
    played();
    news.initWhatsNew(false, "1.0.0");
    const heard = vi.fn();
    const off = news.onWhatsNew(heard);
    news.markSeen();
    expect(news.hasNews()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(seen()).toBe("1.0.0");
    off();
  });

  it("the mark never moves back: an older build (the beta, a stale cache) can't make a newer one glow again", () => {
    memory.set("cagecoach.seenRelease", JSON.stringify("1.0.0"));
    news.initWhatsNew(true, "0.4.1");
    news.markSeen();
    expect(seen()).toBe("1.0.0");
  });

  it("?whatsnew forces it for this visit, even on a first one, and writes nothing until the changelog is opened", () => {
    news.initWhatsNew(true, "1.0.0");
    expect(news.hasNews()).toBe(true);
    expect(news.newSections(["1.0.0", "0.4.1"])).toEqual([true, false]);
    expect(seen()).toBeNull();
    // Already seen: forcing still tags the newest section, which on the beta is Unreleased.
    memory.set("cagecoach.seenRelease", JSON.stringify("1.0.0"));
    news.initWhatsNew(true, "1.0.0");
    expect(news.newSections([null, "1.0.0"])).toEqual([true, false]);
  });
});
