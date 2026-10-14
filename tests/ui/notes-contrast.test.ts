import { readFileSync } from "node:fs";
import { blend, contrast, luminance, rgb, type Rgb } from "../../src/ui/contrast";
import { THEMES } from "../../src/ui/palette";

/**
 * Notes are the smallest text on the board, and a player once had to give up because a dim 1 is a
 * single thin stroke. These tests hold style.css to the design in
 * docs/design/2026-10-14-notes-visibility.md: every note colour keeps WCAG AA contrast (4.5:1)
 * over every background its state meets, in every theme; focus is brighter than quiet; the
 * player's notes are warm and the auto layer's cool; and notes stay big and bold enough for a phone.
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
const hex = (body: string): Rgb => rgb(prop(body, "color")!.trim());
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

const FOCUS = ":where(.cell.sel, .cell.msel, .cell.peer, .cell.cage-peer)";

type Bg = { name: string; bg: Rgb };

/** Backgrounds per state, per theme: quiet notes sit on the plain board (and killer's cage tints);
 *  focus notes on the selected square and its peers. */
function backgrounds(): { quiet: Bg[]; focus: Bg[] } {
  const quiet: Bg[] = [];
  const focus: Bg[] = [];
  const [boardRgb, boardA] = rgba(rule(".board"));
  const tints = [...css.matchAll(/^\.tint\.t\d+ \{\n([^}]*)\}/gm)].map((m) => rgba(m[1]!, "fill"));
  expect(tints.length).toBeGreaterThan(0);
  for (const t of Object.values(THEMES)) {
    const board = blend(boardRgb, boardA, rgb(t.base));
    quiet.push({ name: `${t.name} board`, bg: board });
    for (const [i, [c, a]] of tints.entries()) quiet.push({ name: `${t.name} cage tint ${i}`, bg: blend(c, a, board) });
    for (const sel of [".cell.peer", ".cell.cage-peer"]) {
      const [c, a] = rgba(rule(sel));
      focus.push({ name: `${t.name} ${sel}`, bg: blend(c, a, board) });
    }
    focus.push({ name: `${t.name} selected`, bg: blend(rgb(t.accents[0]), mix(rule(".cell.sel"), "--a1"), board) });
    focus.push({ name: `${t.name} drag-selected`, bg: blend(rgb(t.accents[0]), mix(rule(".cell.msel"), "--a1"), board) });
    focus.push({ name: `${t.name} selected (notes mode)`, bg: blend(rgb(t.accents[1]), mix(rule(".play.notes-mode .cell.sel"), "--a2"), board) });
  }
  return { quiet, focus };
}

describe("notes stay readable", () => {
  const notes = rule(".notes");
  const auto = rule(".notes i.auto");
  const killer = rule(".cell.has-sum .notes");
  const colours = {
    quietOwn: hex(notes),
    quietAuto: hex(auto),
    focusOwn: hex(rule(`${FOCUS} .notes`)),
    focusAuto: hex(rule(`${FOCUS} .notes i.auto`)),
  };

  it("keeps every note at 4.5:1 over every background its state meets, in every theme", () => {
    const { quiet, focus } = backgrounds();
    for (const { name, bg } of quiet) {
      expect(contrast(colours.quietOwn, bg), `quiet own notes on ${name}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colours.quietAuto, bg), `quiet auto notes on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const { name, bg } of focus) {
      expect(contrast(colours.focusOwn, bg), `focus own notes on ${name}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colours.focusAuto, bg), `focus auto notes on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("steps notes up around the selection: focus is brighter than quiet, for both kinds", () => {
    expect(luminance(colours.focusOwn)).toBeGreaterThan(luminance(colours.quietOwn) * 1.5);
    expect(luminance(colours.focusAuto)).toBeGreaterThan(luminance(colours.quietAuto) * 1.5);
  });

  it("tells whose by hue: the player's notes are warm, the auto layer's cool, in both states", () => {
    const warm = ([r, , b]: Rgb) => r > b;
    expect(warm(colours.quietOwn)).toBe(true);
    expect(warm(colours.focusOwn)).toBe(true);
    expect(warm(colours.quietAuto)).toBe(false);
    expect(warm(colours.focusAuto)).toBe(false);
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
    expect(prop(auto, "font-weight")).toBeUndefined(); // the layer inherits the player's weight
  });
});
