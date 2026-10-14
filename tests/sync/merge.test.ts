import fc from "fast-check";
import { canonical, deepEqual } from "../../src/sync/equal";
import { merge, RESULTS_MAX, type Data } from "../../src/sync/merge";

// Small alphabets so collisions and overlaps happen often.
const modeKey = fc.constantFrom("classic-easy", "killer-hard");
const id = fc.constantFrom("p1", "p2", "p3", "p4");
const device = fc.constantFrom("d1", "d2", "d3");
const tech = fc.constantFrom("single", "pair");
const progress = fc.record({
  solved: fc.dictionary(modeKey, fc.uniqueArray(id)),
  best: fc.dictionary(modeKey, fc.integer({ min: 1000, max: 9999 })),
  streak: fc.record({ last: fc.constantFrom("", "2026-10-01", "2026-10-02"), days: fc.nat(5) }),
  counters: fc.dictionary(device, fc.record({ total: fc.nat(9), hinted: fc.dictionary(tech, fc.nat(5)) })),
});
// A fixed pool, so two copies of the same result (same id and time) never disagree on the rest.
const POOL = Array.from({ length: 12 }, (_, i) => ({ id: `p${i % 4}`, at: Math.floor(i / 4) * 10 + (i % 3), mode: "classic", time: 1000 + i * 7 }));
const results = fc.subarray(POOL);
const seen = fc.uniqueArray(fc.constantFrom("a", "b", "c"));
const settings = fc.record({ showTimer: fc.boolean(), autoNotes: fc.boolean() });
const game = fc.oneof(
  fc.record({ savedAt: fc.nat(20), difficulty: fc.constant("easy"), entry: fc.constant("e"), state: fc.record({ n: fc.nat(3) }) }),
  fc.record({ clearedAt: fc.nat(20) }),
);
const data: fc.Arbitrary<Data> = fc.record(
  { progress, results, seen, settings, settingsAt: fc.nat(10), "game.classic": game, "game.killer": game, extra: fc.nat(3) },
  { requiredKeys: [] },
);

/** Order inside sets is not part of the answer; results are compared in the merge's own order (newest first). */
function canon(d: Data): Data {
  const out = structuredClone(d) as Data;
  const p = out.progress as { solved?: Record<string, string[]> } | undefined;
  if (p?.solved) for (const k of Object.keys(p.solved)) p.solved[k] = [...p.solved[k]!].sort();
  if (Array.isArray(out.seen)) out.seen = [...(out.seen as string[])].sort();
  if (Array.isArray(out.results))
    out.results = [...(out.results as { id: string; at: number }[])].sort((x, y) => y.at - x.at || `${x.id}@${x.at}`.localeCompare(`${y.id}@${y.at}`));
  return out;
}
const same = (x: Data, y: Data) => deepEqual(canon(x), canon(y));

describe("merge is a join", () => {
  it("merging a copy with itself changes nothing", () => {
    fc.assert(fc.property(data, (a) => same(merge(a, a), a)));
  });

  it("gives the same answer in either order", () => {
    fc.assert(fc.property(data, data, (a, b) => same(merge(a, b), merge(b, a))));
  });

  it("gives the same answer however three copies are grouped", () => {
    fc.assert(fc.property(data, data, data, (a, b, c) => same(merge(merge(a, b), c), merge(a, merge(b, c)))));
  });

  it("never invents undefined values (what it returns survives JSON)", () => {
    fc.assert(fc.property(data, data, (a, b) => deepEqual(merge(a, b), JSON.parse(JSON.stringify(merge(a, b))))));
  });
});

describe("merge rules", () => {
  it("progress: solved lists union, best times take the minimum, counters take each device's maximum", () => {
    const a: Data = {
      progress: {
        solved: { "classic-easy": ["p1", "p2"] },
        best: { "classic-easy": 5000, "killer-hard": 9000 },
        streak: { last: "2026-10-01", days: 2 },
        counters: { phone: { total: 3, hinted: { single: 2 } } },
      },
    };
    const b: Data = {
      progress: {
        solved: { "classic-easy": ["p2", "p3"], "killer-hard": ["k1"] },
        best: { "classic-easy": 4000 },
        streak: { last: "2026-10-02", days: 1 },
        counters: { phone: { total: 2, hinted: { single: 1, pair: 1 } }, laptop: { total: 4, hinted: {} } },
      },
    };
    expect(merge(a, b).progress).toEqual({
      solved: { "classic-easy": ["p1", "p2", "p3"], "killer-hard": ["k1"] },
      best: { "classic-easy": 4000, "killer-hard": 9000 },
      streak: { last: "2026-10-02", days: 1 },
      counters: { phone: { total: 3, hinted: { single: 2, pair: 1 } }, laptop: { total: 4, hinted: {} } },
    });
  });

  it("progress: the same day's streak keeps the longer run; a field it doesn't know passes through", () => {
    const a: Data = { progress: { streak: { last: "2026-10-02", days: 3 }, total: 7 } };
    const b: Data = { progress: { streak: { last: "2026-10-02", days: 5 } } };
    expect(merge(a, b).progress).toEqual({ streak: { last: "2026-10-02", days: 5 }, total: 7 });
    expect(merge(b, a).progress).toEqual({ streak: { last: "2026-10-02", days: 5 }, total: 7 });
  });

  it("results: union by id and time, newest first, capped", () => {
    const r = (id: string, at: number) => ({ id, at, mode: "classic", time: 100 });
    const a: Data = { results: [r("x", 30), r("y", 20)] };
    const b: Data = { results: [r("y", 20), r("z", 40), r("x", 10)] };
    expect(merge(a, b).results).toEqual([r("z", 40), r("x", 30), r("y", 20), r("x", 10)]);
    const many = (from: number) => Array.from({ length: 200 }, (_, i) => r(`m${from + i}`, from + i));
    const capped = merge({ results: many(0) }, { results: many(200) }).results as { at: number }[];
    expect(capped).toHaveLength(RESULTS_MAX);
    expect(capped[0]!.at).toBe(399);
    expect(capped[RESULTS_MAX - 1]!.at).toBe(400 - RESULTS_MAX);
  });

  it("seen: union", () => {
    expect(merge({ seen: ["a", "b"] }, { seen: ["b", "c"] }).seen).toEqual(["a", "b", "c"]);
  });

  it("settings: the later change wins as a whole; a tie picks the same side on every device", () => {
    const a: Data = { settings: { showTimer: true, autoNotes: false }, settingsAt: 5 };
    const b: Data = { settings: { showTimer: false, autoNotes: true }, settingsAt: 9 };
    expect(merge(a, b)).toEqual(b);
    expect(merge(b, a)).toEqual(b);
    const tie: Data = { settings: { showTimer: false, autoNotes: false }, settingsAt: 5 };
    expect(merge(a, tie)).toEqual(merge(tie, a));
    expect(canonical(merge(a, tie).settings)).toBe(canonical(tie.settings));
    // A side without a timestamp counts as the oldest.
    expect(merge({ settings: { showTimer: false } }, a)).toEqual(a);
  });

  it("games: the slot touched last wins, whether that was a save or a clear", () => {
    const save = { savedAt: 10, difficulty: "easy", entry: "e", state: { n: 1 } };
    const older = { savedAt: 5, difficulty: "easy", entry: "e", state: { n: 0 } };
    expect(merge({ "game.classic": save }, { "game.classic": { clearedAt: 12 } })["game.classic"]).toEqual({ clearedAt: 12 });
    expect(merge({ "game.classic": save }, { "game.classic": { clearedAt: 8 } })["game.classic"]).toEqual(save);
    expect(merge({ "game.classic": older }, { "game.classic": save })["game.classic"]).toEqual(save);
    expect(merge({}, { "game.killer": save })["game.killer"]).toEqual(save);
    // Saves from before timestamps count as the oldest.
    expect(merge({ "game.classic": { difficulty: "easy", entry: "e", state: {} } }, { "game.classic": older })["game.classic"]).toEqual(older);
  });

  it("keys it doesn't know pass through, and both sides present picks the same side on every device", () => {
    expect(merge({ lastMode: "killer" }, {})).toEqual({ lastMode: "killer" });
    expect(merge({ lastMode: "killer" }, { lastMode: "queens" })).toEqual(merge({ lastMode: "queens" }, { lastMode: "killer" }));
  });
});
