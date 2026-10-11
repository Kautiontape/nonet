import { gridFromPuzzle } from "../../src/engine/candidates";
import { cellName } from "../../src/engine/geometry";
import { sudokuHint } from "../../src/engine/hints/index";
import { parseSolution } from "../../src/engine/validate";
import { ladderColors, ladderTexts, REF_COLORS, refColors, splitRefs } from "../../src/ui/cell-refs";
import { classic } from "../engine/helpers";

const [GOLD, CYAN, PINK] = REF_COLORS;

describe("square names in hint text", () => {
  it("splits text into plain runs and 0-based squares", () => {
    expect(splitRefs("Place 1 in r3c8.")).toEqual(["Place 1 in ", { name: "r3c8", row: 2, col: 7 }, "."]);
    expect(splitRefs("r1c1 and r10c11")).toEqual([{ name: "r1c1", row: 0, col: 0 }, " and ", { name: "r10c11", row: 9, col: 10 }]);
    expect(splitRefs("Row 3, column 4 and box 5")).toEqual(["Row 3, column 4 and box 5"]);
  });

  it("colours squares by first mention and keeps a square's colour when it comes up again", () => {
    const colors = refColors(["In the top-right box, r3c8 is the only cell.", "r5c7 blocks it.", "Place 1 in r3c8."]);
    expect([...colors]).toEqual([
      ["r3c8", GOLD],
      ["r5c7", CYAN],
    ]);
  });

  it("gives squares listed together one colour", () => {
    const colors = refColors(["r1c7 and r3c7 see the 1 in r5c7. r1c9, r2c9 and r3c9 see the 1 in r8c9.", "It's r1c1 or r1c7; r4c4/r4c5 = 12; r6c6 + r6c7."]);
    expect(colors.get("r1c7")).toBe(GOLD);
    expect(colors.get("r3c7")).toBe(GOLD);
    expect(colors.get("r5c7")).toBe(CYAN);
    expect(new Set(["r1c9", "r2c9", "r3c9"].map((n) => colors.get(n)))).toEqual(new Set([PINK]));
    // r1c1 is new and r1c7 already has a colour: only the new square takes the next one.
    expect(colors.get("r1c1")).not.toBe(GOLD);
    expect(colors.get("r4c4")).toBe(colors.get("r4c5"));
    expect(colors.get("r6c6")).toBe(colors.get("r6c7"));
  });

  it("separate mentions in one sentence get separate colours", () => {
    const colors = refColors(["If r1c1 is 8, then row 6's 8 has to be r6c7."]);
    expect(colors.get("r1c1")).not.toBe(colors.get("r6c7"));
  });

  it("cycles the palette when a hint names many groups", () => {
    const names = Array.from({ length: REF_COLORS.length + 1 }, (_, i) => `r${(i % 9) + 1}c${Math.floor(i / 9) + 1}`);
    const colors = refColors([names.join(" sees ")]);
    expect(colors.get(names[REF_COLORS.length]!)).toBe(GOLD);
  });

  it("a route step's ladder colours by first mention; a square keeps its colour when named again", () => {
    const ladder = {
      where: "No digit is certain yet. Look at the 7 cage at r4c3.",
      what: "This cage's sum can only be made one way.",
      why: ["Three different digits that add up to 7: 1+2+4. So r4c3, r4c4 and r4c5 can only be 1, 2 or 4."],
      do: "Note it down: r4c3, r4c4 and r4c5 can only be 1, 2 or 4.",
    };
    const colors = ladderColors(ladder, 4);
    expect(colors.get("r4c3")).toBe(GOLD);
    expect(colors.get("r4c4")).toBe(colors.get("r4c5"));
    expect(colors.get("r4c4")).not.toBe(GOLD);
    expect(ladderColors(ladder, 1).get("r4c4")).toBeUndefined(); // not named yet at rung 1
  });

  it("reads the ladder in rung order", () => {
    const ladder = { where: "w", what: "x", why: ["y1", "y2"], do: "z" };
    expect(ladderTexts(ladder, 1)).toEqual(["w"]);
    expect(ladderTexts(ladder, 3)).toEqual(["w", "x", "y1", "y2"]);
    expect(ladderTexts(ladder, 4)).toEqual(["w", "x", "y1", "y2", "z"]);
  });

  it("colours every square a real hint names", () => {
    const p = classic(
      "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
      "534678912672195348198342567859761423426853791713924856961537284287419635345286179",
    );
    const hint = sudokuHint({ puzzle: p, grid: gridFromPuzzle(p), notes: new Uint16Array(81), solution: parseSolution(p.solution!) });
    const texts = ladderTexts(hint.ladder, 4);
    const named = new Set(texts.flatMap((t) => splitRefs(t).flatMap((x) => (typeof x === "string" ? [] : [x.name]))));
    expect(named.size).toBeGreaterThan(0);
    const colors = refColors(texts);
    expect(new Set(colors.keys())).toEqual(named);
    for (const p of hint.step!.placements) expect(colors.has(cellName(p.cell))).toBe(true);
  });
});
