import { levelsBeaten, normalizeProgress, sumCounters } from "../../src/sync/progress";

describe("progress record", () => {
  it("moves a legacy record's top-level counts into this device's counters", () => {
    const legacy = { solved: { "classic-easy": ["a"] }, best: { "classic-easy": 500 }, hinted: { single: 2 }, total: 3, streak: { last: "2026-10-01", days: 1 } };
    const { progress, legacy: migrated } = normalizeProgress(legacy, "dev1");
    expect(migrated).toBe(true);
    expect(progress).toEqual({
      solved: { "classic-easy": ["a"] },
      best: { "classic-easy": 500 },
      streak: { last: "2026-10-01", days: 1 },
      counters: { dev1: { total: 3, hinted: { single: 2 } } },
      levels: {},
    });
    expect(sumCounters(progress.counters)).toEqual({ total: 3, hinted: { single: 2 } });
  });

  it("adds legacy counts to counts the device already has, and leaves other devices alone", () => {
    const mixed = { total: 1, hinted: { pair: 1 }, counters: { dev1: { total: 2, hinted: { pair: 1, single: 4 } }, dev2: { total: 9, hinted: {} } } };
    const { progress } = normalizeProgress(mixed, "dev1");
    expect(progress.counters).toEqual({ dev1: { total: 3, hinted: { pair: 2, single: 4 } }, dev2: { total: 9, hinted: {} } });
    expect(sumCounters(progress.counters)).toEqual({ total: 12, hinted: { pair: 2, single: 4 } });
  });

  it("reads a current record as is, and fills in what's missing from anything else", () => {
    const current = {
      solved: {},
      best: {},
      streak: { last: "", days: 0 },
      counters: { dev1: { total: 1, hinted: {} } },
      levels: { dev1: { "classic-easy": 1 } },
    };
    expect(normalizeProgress(current, "dev2")).toEqual({ progress: current, legacy: false });
    expect(normalizeProgress({}, "dev1")).toEqual({ progress: { solved: {}, best: {}, streak: { last: "", days: 0 }, counters: {}, levels: {} }, legacy: false });
    expect(normalizeProgress(null, "dev1").progress.counters).toEqual({});
    expect(normalizeProgress({ solved: { x: "not a list" }, best: { x: "no" }, counters: { d: "no" }, levels: { d: "no", e: { x: "no", y: 2 } } }, "d").progress).toEqual({
      solved: {},
      best: {},
      streak: { last: "", days: 0 },
      counters: {},
      levels: { e: { y: 2 } },
    });
  });
});

describe("levels beaten", () => {
  it("adds up every device's count per mode and difficulty", () => {
    const p = { solved: {}, levels: { phone: { "classic-easy": 3, "killer-hard": 1 }, laptop: { "classic-easy": 4 } } };
    expect(levelsBeaten(p)).toEqual({ "classic-easy": 7, "killer-hard": 1 });
  });

  it("counts v1 boards solved before levels were counted, once each, and nothing else in the solved lists", () => {
    // Content ids in a solved list were counted by the device that solved them.
    const p = {
      solved: { "classic-easy": ["classic-easy-1", "classic-easy-17", "c21u8fyyj3eh"], "queens-expert": ["queens-expert-60"], "killer-hard": ["custom"] },
      levels: { phone: { "classic-easy": 1 } },
    };
    expect(levelsBeaten(p)).toEqual({ "classic-easy": 3, "queens-expert": 1 });
  });
});
