/**
 * Picking a pack from a pool of generated boards (scripts/generate-pack.ts).
 *
 * Quotas come from SUB_TARGET_SHARE (about a quarter breathers, a sixth stretches, the rest
 * standard). Candidates are taken in seed order; a board that fits several sub-targets goes to the
 * one whose quota is scarcest (most still needed per candidate left that could fill it). A band with
 * a cap (Classic Expert) skips boards whose hardest-step technique already has its share. If quotas
 * can't all be met, the remaining slots take whatever boards are left, in seed order.
 */
import { SUB_TARGET_SHARE, type SubTarget } from "../bands";

export interface PoolBoard {
  seed: number;
  /** Duplicate key: the content id, or a symmetry-free key for Queens. */
  key: string;
  fits: readonly SubTarget[];
  hardest: string | null;
}

export interface Kept {
  key: string;
  sub: SubTarget;
  hardest: string | null;
}

export interface Picked<B extends PoolBoard> {
  board: B;
  sub: SubTarget;
}

export function quotas(max: number): Record<SubTarget, number> {
  const breather = Math.round(max * SUB_TARGET_SHARE.breather);
  const stretch = Math.round(max * SUB_TARGET_SHARE.stretch);
  return { breather, standard: max - breather - stretch, stretch };
}

/**
 * Up to `max - kept.length` boards from `pool` (which must be sorted by seed). `cap` is the most of
 * the pack (0..1) any one hardest-step technique may take. Returns the picks in seed order and how
 * far each quota fell short.
 */
export function selectPack<B extends PoolBoard>(
  pool: readonly B[],
  max: number,
  kept: readonly Kept[] = [],
  cap?: number,
): { picked: Picked<B>[]; shortfall: Record<SubTarget, number> } {
  const need = quotas(max);
  for (const k of kept) need[k.sub] = Math.max(0, need[k.sub] - 1);
  const capCount = cap === undefined ? Infinity : Math.floor(cap * max);
  const used = new Map<string, number>();
  for (const k of kept) if (k.hardest) used.set(k.hardest, (used.get(k.hardest) ?? 0) + 1);
  const seen = new Set(kept.map((k) => k.key));
  const unique = pool.filter((b) => !seen.has(b.key) && (seen.add(b.key), true));
  const slots = Math.max(0, max - kept.length);
  const picked: Picked<B>[] = [];
  const taken = new Set<B>();
  const capped = (b: B) => b.hardest !== null && (used.get(b.hardest) ?? 0) >= capCount;
  const take = (b: B, sub: SubTarget) => {
    picked.push({ board: b, sub });
    taken.add(b);
    if (b.hardest) used.set(b.hardest, (used.get(b.hardest) ?? 0) + 1);
  };

  // How many boards still to come could fill each quota.
  const supply: Record<SubTarget, number> = { breather: 0, standard: 0, stretch: 0 };
  for (const b of unique) for (const st of b.fits) supply[st]++;
  for (const b of unique) {
    if (picked.length >= slots) break;
    const open = b.fits.filter((st) => need[st] > 0);
    if (open.length && !capped(b)) {
      const sub = open.reduce((x, y) => (need[y] / supply[y] > need[x] / supply[x] ? y : x));
      need[sub]--;
      take(b, sub);
    }
    for (const st of b.fits) supply[st]--;
  }
  const shortfall = { ...need };
  // Quotas that couldn't be met: fill the remaining slots in seed order, within the cap if possible.
  for (const strict of [true, false])
    for (const b of unique) {
      if (picked.length >= slots) break;
      if (taken.has(b) || (strict && capped(b))) continue;
      take(b, b.fits[0]!);
    }
  picked.sort((a, b) => a.board.seed - b.board.seed);
  return { picked, shortfall };
}

