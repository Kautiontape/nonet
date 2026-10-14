import type { SubTarget } from "../../src/engine/bands";
import { quotas, selectPack, type PoolBoard } from "../../src/engine/gen/select";

const board = (seed: number, fits: SubTarget[], hardest: string | null = "x", key = `k${seed}`): PoolBoard => ({ seed, key, fits, hardest });

describe("selectPack", () => {
  it("splits a pack about a quarter breathers, a sixth stretches, the rest standard", () => {
    expect(quotas(100)).toEqual({ breather: 25, standard: 58, stretch: 17 });
    expect(quotas(10)).toEqual({ breather: 3, standard: 5, stretch: 2 });
  });

  it("fills each quota in seed order and returns the picks in seed order", () => {
    const pool = [
      ...Array.from({ length: 6 }, (_, i) => board(i + 1, ["standard"])),
      board(7, ["breather"]),
      board(8, ["breather"]),
      board(9, ["breather"]),
      board(10, ["stretch"]),
      board(11, ["stretch"]),
      board(12, ["breather"]),
    ];
    const { picked, shortfall } = selectPack(pool, 10);
    expect(picked.map((p) => p.board.seed)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11]);
    expect(picked.filter((p) => p.sub === "breather")).toHaveLength(3);
    expect(shortfall).toEqual({ breather: 0, standard: 0, stretch: 0 });
  });

  it("sends a board that fits two sub-targets to the scarcer quota", () => {
    // Stretches are rare here, so the two-way board becomes a stretch.
    const pool = [board(1, ["standard", "stretch"]), ...Array.from({ length: 9 }, (_, i) => board(i + 2, ["standard"])), board(11, ["breather"])];
    const { picked } = selectPack(pool, 4);
    expect(picked.find((p) => p.board.seed === 1)!.sub).toBe("stretch");
  });

  it("drops duplicates and boards already in the pack", () => {
    const pool = [board(1, ["standard"], "x", "same"), board(2, ["standard"], "x", "same"), board(3, ["standard"], "x", "kept")];
    const { picked } = selectPack(pool, 3, [{ key: "kept", sub: "standard", hardest: "x" }]);
    expect(picked.map((p) => p.board.seed)).toEqual([1]);
  });

  it("keeps any one hardest technique within the cap while it can", () => {
    // The cap is per technique: 15 AIC boards, then ten boards each with a different hardest step.
    const pool = Array.from({ length: 25 }, (_, i) => board(i + 1, ["standard"], i < 15 ? "aic" : `t${i}`));
    const { picked } = selectPack(pool, 10, [], 0.4);
    expect(picked).toHaveLength(10);
    expect(picked.filter((p) => p.board.hardest === "aic")).toHaveLength(4);
    // with nothing else left, the cap gives way rather than leave the pack short
    const few = Array.from({ length: 12 }, (_, i) => board(i + 1, ["standard"], i < 10 ? "aic" : "w-wing"));
    expect(selectPack(few, 10, [], 0.4).picked).toHaveLength(10);
  });

  it("fills short quotas with what's left", () => {
    const pool = Array.from({ length: 12 }, (_, i) => board(i + 1, ["standard"]));
    const { picked, shortfall } = selectPack(pool, 10);
    expect(picked).toHaveLength(10);
    expect(shortfall).toEqual({ breather: 3, standard: 0, stretch: 2 });
  });
});
