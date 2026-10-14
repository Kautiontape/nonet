import { readFileSync } from "node:fs";
import { blend, contrast, rgb, type Rgb } from "../../src/ui/contrast";
import { DIGIT_COLORS, THEMES } from "../../src/ui/palette";

/**
 * Notes are the smallest text on the board, and a player once had to give up because a dim 1 is a
 * single thin stroke. These tests hold style.css to a floor: every note colour keeps WCAG AA
 * contrast (4.5:1) over every background a note can sit on, in every theme, and the notes stay
 * big and bold enough to resolve on a phone.
 */
const css = readFileSync(new URL("../../src/ui/style.css", import.meta.url), "utf8");

/** Body of the first top-level rule written exactly as `selector {`. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`^${esc} \\{\\n([^}]*)\\}`, "m"));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1]!;
}

const prop = (body: string, name: string): string | undefined => body.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))?.[1];
/** The rule's colour, or `fallback`'s when it leaves colour to inherit. */
const hex = (body: string, fallback = body): Rgb => rgb((prop(body, "color") ?? prop(fallback, "color"))!.trim());
const cellFactor = (body: string): number => Number(prop(body, "font-size")!.match(/var\(--cell\) \* ([\d.]+)/)![1]);
const weight = (body: string): number => Number(prop(body, "font-weight"));
/** `rgba(r, g, b, a)` as colour and alpha. */
function rgba(body: string, name = "background"): [Rgb, number] {
  const m = prop(body, name)!.match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/)!;
  return [[Number(m[1]), Number(m[2]), Number(m[3])], Number(m[4])];
}
/** The rule's `var(--x) N%` mix; for a gradient, the mean of its stops (notes sit across the square). */
function mix(body: string, v: string): number {
  const pcts = [...prop(body, "background")!.matchAll(new RegExp(`var\\(${v}\\) (\\d+)%`, "g"))].map((m) => Number(m[1]));
  return pcts.reduce((a, b) => a + b, 0) / pcts.length / 100;
}

/** Every background a note can land on, per theme. */
function backgrounds(): { name: string; bg: Rgb }[] {
  const out: { name: string; bg: Rgb }[] = [];
  const [boardRgb, boardA] = rgba(rule(".board"));
  for (const t of Object.values(THEMES)) {
    const board = blend(boardRgb, boardA, rgb(t.base));
    out.push({ name: `${t.name} board`, bg: board });
    for (const sel of [".cell.peer", ".cell.cage-peer"]) {
      const [c, a] = rgba(rule(sel));
      out.push({ name: `${t.name} ${sel}`, bg: blend(c, a, board) });
    }
    for (const [d, dc] of DIGIT_COLORS.entries()) if (d) out.push({ name: `${t.name} same digit ${d}`, bg: blend(rgb(dc), mix(rule(".cell.same"), "--dc"), board) });
    out.push({ name: `${t.name} selected`, bg: blend(rgb(t.accents[0]), mix(rule(".cell.sel"), "--a1"), board) });
    out.push({ name: `${t.name} selected (notes mode)`, bg: blend(rgb(t.accents[1]), mix(rule(".play.notes-mode .cell.sel"), "--a2"), board) });
  }
  return out;
}

describe("notes stay readable", () => {
  const notes = rule(".notes");
  const auto = rule(".notes i.auto");
  const killer = rule(".cell.has-sum .notes");

  it("keeps every note at 4.5:1 over every board background, in every theme", () => {
    const own = hex(notes);
    const dim = hex(auto, notes);
    for (const { name, bg } of backgrounds()) {
      expect(contrast(own, bg), `own notes on ${name}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dim, bg), `auto notes on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("shows auto notes at full opacity (.notes i starts hidden, so this rule is also the switch)", () => {
    expect(Number(prop(auto, "opacity"))).toBe(1);
    expect(prop(rule(".notes i"), "opacity")).toBe("0");
    expect(prop(rule(".notes i.on"), "opacity")).toBe("1");
  });

  it("keeps notes big and bold enough for a phone", () => {
    expect(cellFactor(notes)).toBeGreaterThanOrEqual(0.28); // 12px in a 43px square (412px-wide phone)
    expect(cellFactor(killer)).toBeGreaterThanOrEqual(0.24); // under a cage sum
    expect(weight(notes)).toBeGreaterThanOrEqual(600);
    expect(prop(auto, "font-weight") ?? "600").not.toMatch(/^[0-5]\d\d$/); // never lighter than 600
  });
});
