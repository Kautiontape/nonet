/**
 * Squares named in coaching text ("r9c8"). The hint sheet colours each name and the board rings
 * the same square in the same colour, so reading a name and finding its square are one glance
 * apart. The colour assignment lives here so the text and the board always agree.
 */
import type { LadderText } from "../engine/hint-types";
import { h } from "./dom";

/**
 * Accent colours for named squares, handed out in order of first mention. No pure red or green:
 * on the board those already mean "eliminate" and "place".
 */
export const REF_COLORS: readonly string[] = ["#ffd84a", "#3fdcff", "#ff6fd8", "#ff9b45", "#a98cff", "#c6f25a", "#5f8dff"];

/** A square named in text; row and col are 0-based. */
export interface CellRef {
  name: string;
  row: number;
  col: number;
}

export type RefPart = string | CellRef;

const REF = /\br(\d{1,2})c(\d{1,2})\b/g;
/** What may sit between two names for them to read as one list: ", ", " and ", ", or ", "/", "+". */
const JOIN = /^(?:,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+|\s*[/+]\s*)$/;

/** Split text into plain runs and square names. */
export function splitRefs(text: string): RefPart[] {
  const out: RefPart[] = [];
  let last = 0;
  for (const m of text.matchAll(REF)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ name: m[0], row: Number(m[1]) - 1, col: Number(m[2]) - 1 });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * A colour for every square named in `texts`, by first mention. Squares listed together
 * ("r1c9, r2c9 and r3c9") share one colour; a square keeps its colour wherever it comes up again.
 */
export function refColors(texts: readonly string[], palette: readonly string[] = REF_COLORS): Map<string, string> {
  const colors = new Map<string, string>();
  let next = 0;
  let group: string[] = [];
  const flush = () => {
    const fresh = group.filter((n) => !colors.has(n));
    if (fresh.length) {
      const color = palette[next++ % palette.length]!;
      for (const n of fresh) colors.set(n, color);
    }
    group = [];
  };
  for (const text of texts) {
    const parts = splitRefs(text);
    parts.forEach((p, i) => {
      if (typeof p !== "string") group.push(p.name);
      else if (!(JOIN.test(p) && typeof parts[i + 1] === "object")) flush();
    });
    flush();
  }
  return colors;
}

/** Colours for a hint's visible text. */
export function ladderColors(ladder: LadderText, rung: number, palette: readonly string[] = REF_COLORS): Map<string, string> {
  return refColors(ladderTexts(ladder, rung), palette);
}

/** The ladder text on screen once rungs 1..rung are revealed, in reading order. */
export function ladderTexts(ladder: LadderText, rung: number): string[] {
  const out: string[] = [];
  if (rung >= 1) out.push(ladder.where);
  if (rung >= 2) out.push(ladder.what);
  if (rung >= 3) out.push(...ladder.why);
  if (rung >= 4) out.push(ladder.do);
  return out;
}

/** Text with each coloured square name wrapped in a tinted chip; tapping a chip calls `onRef`. */
export function refNodes(text: string, colors: ReadonlyMap<string, string>, onRef?: (name: string) => void): (string | HTMLElement)[] {
  return splitRefs(text).map((p) => {
    if (typeof p === "string") return p;
    const color = colors.get(p.name);
    if (!color) return p.name;
    return h("span", { class: "ref", "data-ref": p.name, style: { "--ref": color }, onclick: onRef && (() => onRef(p.name)) }, p.name);
  });
}
