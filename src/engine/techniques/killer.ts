/**
 * Killer cage techniques:
 * - cage-last-cell: one empty cell left in a cage → it's the remainder of the sum.
 * - cage-combos (sum): digits that appear in no combination of the cage's size and sum.
 * - cage-combos (candidates): combinations that can't be arranged in the cells' candidates.
 * - cage-locked: a digit every valid combination uses, confined to one house within the cage.
 * - cage-claim: a house's only places for a digit all sit in one cage, so that cage must use it.
 */
import { comboSupport } from "../candidates";
import { ALL_DIGITS, cageCombos } from "../combos";
import { HOUSE_CELLS } from "../geometry";
import type { SolverState } from "../state";
import type { Cage, CellId, Digit, Elimination, Step } from "../types";
import type { Technique } from "./types";
import {
  ALL_HOUSE_IDS,
  bit,
  cellsWith,
  dedupeElims,
  digitsOf,
  elimDigit,
  elimMarks,
  house,
  makeStep,
  marksFor,
  placedMask,
  sharedHouses,
} from "./util";

export interface CageView {
  cage: Cage;
  empty: CellId[];
  placed: { cell: CellId; digit: Digit }[];
  placedMask: number;
  /** What the empty cells still have to add up to. */
  rem: number;
  /** Combinations of `empty.length` distinct digits summing to `rem`, avoiding placed digits. */
  combos: number[];
}

export function cageView(s: SolverState, cage: Cage): CageView {
  const empty: CellId[] = [];
  const placed: { cell: CellId; digit: Digit }[] = [];
  let mask = 0;
  let rem = cage.sum;
  for (const c of cage.cells) {
    const v = s.grid[c]!;
    if (v) {
      placed.push({ cell: c, digit: v });
      mask |= bit(v);
      rem -= v;
    } else empty.push(c);
  }
  const combos = empty.length ? cageCombos(empty.length, rem).filter((m) => !(m & mask)) : [];
  return { cage, empty, placed, placedMask: mask, rem, combos };
}

export interface ComboCheck {
  valid: number[];
  /** Ruled-out combos and, when it's that simple, the digits no empty cell can hold. */
  invalid: { combo: number; missing: Digit[] }[];
  /** Per empty cell (same order as view.empty): digits used in some valid arrangement. */
  support: number[];
}

/** Check each combination against the cells' candidates (bipartite matching). */
export function checkCombos(s: SolverState, v: CageView, require = 0): ComboCheck {
  const valid: number[] = [];
  const invalid: { combo: number; missing: Digit[] }[] = [];
  const support = new Array<number>(v.empty.length).fill(0);
  let union = 0;
  for (const c of v.empty) union |= s.cand[c]!;
  for (const combo of v.combos) {
    if ((combo & require) !== require) continue;
    const sup = comboSupport(v.empty, combo, s.cand);
    if (!sup) {
      invalid.push({ combo, missing: digitsOf(combo & ~union) });
      continue;
    }
    valid.push(combo);
    sup.forEach((m, i) => (support[i]! |= m));
  }
  return { valid, invalid, support };
}

/**
 * The last view and combination check per cage, keyed by its cells' digits and candidates. Most
 * cages don't change between steps, and the check (a matching per combination) is most of a
 * killer solve's time. Callers must not mutate what this returns.
 */
const lastCheck = new WeakMap<Cage, { key: string; view: CageView; check: ComboCheck }>();

function checkedView(s: SolverState, cage: Cage): { view: CageView; check: ComboCheck } {
  let key = "";
  for (const c of cage.cells) key += (s.grid[c] ? -s.grid[c]! : s.cand[c]!) + ",";
  const hit = lastCheck.get(cage);
  if (hit && hit.key === key) return hit;
  const view = cageView(s, cage);
  const entry = { key, view, check: checkCombos(s, view) };
  lastCheck.set(cage, entry);
  return entry;
}

const cageCells = (v: CageView) => v.cage.cells;

export const cageLastCell: Technique = {
  id: "cage-last-cell",
  tier: 1,
  rating: 1.0,
  killerOnly: true,
  find(s) {
    for (const cage of s.cages) {
      const v = cageView(s, cage);
      if (v.empty.length !== 1) continue;
      const cell = v.empty[0]!;
      const digit = v.rem;
      if (digit < 1 || digit > 9 || !(s.cand[cell]! & bit(digit))) continue;
      return makeStep({
        technique: "cage-last-cell",
        tier: 1,
        rating: 1.0,
        placements: [{ cell, digit }],
        focus: { cells: cageCells(v), cages: [cage.id], houses: [] },
        explain: { kind: "cage-last-cell", cage: cage.id, sum: cage.sum, size: cage.cells.length, cell, digit, placed: v.placed },
        sources: v.placed.map((p) => p.cell),
        marks: [{ cell, digit, role: "place" }],
      });
    }
    return null;
  },
};

function comboStep(s: SolverState, v: CageView, basis: "sum" | "candidates", valid: number[], invalid: ComboCheck["invalid"], elims: Elimination[]): Step {
  const allowed = valid.reduce((a, m) => a | m, 0);
  return makeStep({
    technique: "cage-combos",
    tier: basis === "sum" ? 1 : 2,
    rating: basis === "sum" ? 1.7 : 2.2,
    eliminations: elims,
    focus: { cells: cageCells(v), cages: [v.cage.id], houses: [] },
    explain: {
      kind: "cage-combos",
      basis,
      cage: v.cage.id,
      sum: v.cage.sum,
      size: v.cage.cells.length,
      // copies: the view and check may be shared with the next call (checkedView)
      cells: [...v.empty],
      rem: v.rem,
      placed: [...v.placed],
      combos: [...v.combos],
      valid: [...valid],
      invalid: [...invalid],
      allowed,
    },
    sources: v.placed.map((p) => p.cell),
    marks: [...marksFor(s, v.empty, allowed, "key"), ...elimMarks(elims)],
  });
}

/** Pick the most constrained candidate (fewest valid combos, then most eliminations). */
function better(a: { combos: number; elims: number } | null, b: { combos: number; elims: number }): boolean {
  return !a || b.combos < a.combos || (b.combos === a.combos && b.elims > a.elims);
}

export const cageSumCombos: Technique = {
  id: "cage-combos",
  tier: 1,
  rating: 1.7,
  killerOnly: true,
  find(s) {
    let best: { combos: number; elims: number; step: Step } | null = null;
    for (const cage of s.cages) {
      const v = cageView(s, cage);
      if (v.empty.length < 2 || !v.combos.length) continue;
      const allowed = v.combos.reduce((a, m) => a | m, 0);
      const elims: Elimination[] = [];
      for (const c of v.empty) for (const d of digitsOf(s.cand[c]! & ~allowed)) elims.push({ cell: c, digit: d });
      if (!elims.length) continue;
      const score = { combos: v.combos.length, elims: elims.length };
      if (better(best, score)) best = { ...score, step: comboStep(s, v, "sum", v.combos, [], elims) };
    }
    return best?.step ?? null;
  },
};

export const cageCandidateCombos: Technique = {
  id: "cage-combos",
  tier: 2,
  rating: 2.2,
  killerOnly: true,
  find(s) {
    let best: { combos: number; elims: number; step: Step } | null = null;
    for (const cage of s.cages) {
      const { view: v, check } = checkedView(s, cage);
      if (v.empty.length < 2 || !check.valid.length) continue;
      const elims: Elimination[] = [];
      v.empty.forEach((c, i) => {
        for (const d of digitsOf(s.cand[c]! & ~check.support[i]!)) elims.push({ cell: c, digit: d });
      });
      if (!elims.length) continue;
      const score = { combos: check.valid.length, elims: elims.length };
      if (better(best, score)) best = { ...score, step: comboStep(s, v, "candidates", check.valid, check.invalid, elims) };
    }
    return best?.step ?? null;
  },
};

export const cageLocked: Technique = {
  id: "cage-locked",
  tier: 2,
  rating: 2.6,
  killerOnly: true,
  find(s) {
    for (const cage of s.cages) {
      const { view: v, check } = checkedView(s, cage);
      if (v.empty.length < 2 || !check.valid.length) continue;
      const must = check.valid.reduce((a, m) => a & m, ALL_DIGITS);
      for (const d of digitsOf(must)) {
        const cells = v.empty.filter((c) => s.cand[c]! & bit(d));
        if (!cells.length) continue;
        for (const h of sharedHouses(cells)) {
          const elims = elimDigit(
            s,
            HOUSE_CELLS[h]!.filter((c) => !cage.cells.includes(c)),
            d,
          );
          if (!elims.length) continue;
          return makeStep({
            technique: "cage-locked",
            tier: 2,
            rating: 2.6,
            eliminations: elims,
            focus: { cells: cage.cells, cages: [cage.id], houses: [house(h)] },
            explain: {
              kind: "cage-locked",
              cage: cage.id,
              sum: cage.sum,
              size: cage.cells.length,
              digit: d,
              house: house(h),
              cells,
              valid: [...check.valid],
              inside: cells.length === v.empty.length,
            },
            marks: [...marksFor(s, cells, bit(d), "key"), ...elimMarks(elims)],
          });
        }
      }
    }
    return null;
  },
};

export const cageClaim: Technique = {
  id: "cage-claim",
  tier: 2,
  rating: 2.8,
  killerOnly: true,
  find(s) {
    for (const h of ALL_HOUSE_IDS) {
      for (const d of digitsOf(ALL_DIGITS & ~placedMask(s, h))) {
        const cells = cellsWith(s, h, d);
        if (cells.length < 2) continue;
        const k = s.cageOf[cells[0]!]!;
        if (k < 0 || !cells.every((c) => s.cageOf[c] === k)) continue;
        const cage = s.cages[k]!;
        const v = cageView(s, cage);
        // The cage must use d (inside this house), so: no d elsewhere in the cage, and only
        // combinations containing d survive.
        const elims: Elimination[] = elimDigit(
          s,
          v.empty.filter((c) => !cells.includes(c)),
          d,
        );
        const check = checkCombos(s, v, bit(d));
        if (!check.valid.length) continue;
        v.empty.forEach((c, i) => {
          for (const x of digitsOf(s.cand[c]! & ~check.support[i]!)) elims.push({ cell: c, digit: x });
        });
        const all = dedupeElims(elims);
        if (!all.length) continue;
        const dropped = v.combos.filter((m) => !(m & bit(d)));
        return makeStep({
          technique: "cage-claim",
          tier: 2,
          rating: 2.8,
          eliminations: all,
          focus: { cells: cage.cells, cages: [cage.id], houses: [house(h)] },
          explain: {
            kind: "cage-claim",
            cage: cage.id,
            sum: cage.sum,
            size: cage.cells.length,
            digit: d,
            house: house(h),
            cells,
            valid: check.valid,
            dropped,
          },
          marks: [...marksFor(s, cells, bit(d), "key"), ...elimMarks(all)],
        });
      }
    }
    return null;
  },
};

