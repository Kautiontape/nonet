import { mulberry32 } from "../../src/engine/rng";
import { createStyleBag, spiralOrder } from "../../src/ui/fx/level-order";
import { finishPuzzle, loadProgress, loadResults } from "../../src/ui/store";

describe("level entrance order", () => {
  it("plays every style once per round and never the same one twice in a row", () => {
    const bag = createStyleBag(8, mulberry32(7));
    const seen: number[] = [];
    for (let i = 0; i < 8 * 40; i++) seen.push(bag.next());
    for (let r = 0; r < 40; r++) expect(new Set(seen.slice(r * 8, r * 8 + 8)).size).toBe(8);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it("orders a spiral from the outer edge in, visiting every cell once", () => {
    const k = spiralOrder(3);
    // Rank of each cell, row-major: clockwise round the edge from the top-left, then the centre.
    expect(k).toEqual([0, 1, 2, 7, 8, 3, 6, 5, 4]);
    const nine = spiralOrder(9);
    expect([...nine].sort((a, b) => a - b)).toEqual([...Array(81).keys()]);
    expect(nine[40]).toBe(80); // the centre comes last
  });
});

describe("results history", () => {
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const solve = (time: number, extra: Partial<{ id: string; mistakes: number; hints: number }> = {}) =>
    finishPuzzle({ mode: "classic", difficulty: "easy", id: extra.id ?? "classic-easy-1", level: 1, time, mistakes: extra.mistakes ?? 0, hints: extra.hints ?? 0 }, 1000);

  it("flags a first clear, then a record only when the best time is beaten", () => {
    const a = solve(300_000);
    expect(a).toMatchObject({ first: true, record: false, perfect: true });
    const b = solve(320_000, { id: "classic-easy-2", hints: 1 });
    expect(b).toMatchObject({ first: false, record: false, perfect: false, prevBest: 300_000 });
    const c = solve(250_000, { id: "classic-easy-3" });
    expect(c).toMatchObject({ record: true, prevBest: 300_000 });
    expect(loadProgress().best["classic-easy"]).toBe(250_000);
    expect(loadProgress().solved["classic-easy"]).toEqual(["classic-easy-1", "classic-easy-2", "classic-easy-3"]);
  });

  it("keeps results newest first, capped", () => {
    for (let i = 1; i <= 305; i++) solve(100_000 + i, { id: `classic-easy-${i}` });
    const all = loadResults();
    expect(all).toHaveLength(300);
    expect(all[0]!.id).toBe("classic-easy-305");
  });
});
