/**
 * Generator bench: makes boards for seeds 1..count in each band, one process, and reports cost per
 * board, how often the seed's sub-target was met, the sub-target mix and the profile spread.
 *
 *   npx tsx scripts/gen-bench.ts [--mode classic,killer,queens] [--band easy,...] [--count 20]
 *
 * Cost per board is the band's total time divided by boards made, so failed attempts count.
 */
import { subTargetForSeed, type Mode, type SubTarget } from "../src/engine/bands";
import { makeBoard } from "../src/engine/gen";
import { DIFFICULTIES, type Difficulty } from "../src/engine/types";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const modes = arg("mode", "classic,killer,queens").split(",") as Mode[];
const bands = arg("band", DIFFICULTIES.join(",")).split(",") as Difficulty[];
const count = Number(arg("count", "20"));
const seed0 = Number(arg("seed", "1"));

const spread = (xs: number[]) => {
  if (!xs.length) return "—";
  const s = [...xs].sort((a, b) => a - b);
  const r = (x: number) => String(Math.round(x * 10) / 10);
  return `${r(s[0]!)}–${r(s.at(-1)!)} (${r(s[s.length >> 1]!)})`;
};

for (const mode of modes)
  for (const band of bands) {
    const t0 = performance.now();
    let made = 0;
    let hit = 0;
    let attempts = 0;
    const mix: Record<SubTarget, number> = { breather: 0, standard: 0, stretch: 0 };
    const per: Record<string, number[]> = {};
    const note = (k: string, v: number | null) => v !== null && (per[k] ??= []).push(v);
    for (let seed = seed0; seed < seed0 + count; seed++) {
      const aim = subTargetForSeed(mode, band, seed);
      const m = makeBoard(mode, band, seed);
      if (!m) continue;
      made++;
      attempts += m.attempts;
      if (m.fits.includes(aim)) hit++;
      mix[m.fits.includes(aim) ? aim : m.fits[0]!]++;
      const p = m.profile;
      note("steps past basics", p.beyond);
      note("walls", p.walls);
      note("tier-4+ steps", p.advanced);
      if (p.mode === "queens") {
        note("size", p.n);
        note("contradictions", p.counts["contradiction"] ?? 0);
      } else {
        note("first wall", p.firstWall);
        if (p.mode === "classic") {
          note("givens", p.givens);
          note("early options", p.scan.early);
          note("tier-3 steps", p.tiers[3]!);
        } else {
          note("45-rule steps", p.innies.single + p.innies.multi);
          note("one-cell cages", p.cages!.sizes[1]!);
          note("cages", p.cages!.count);
        }
      }
    }
    const ms = performance.now() - t0;
    console.log(
      `${mode}-${band}: ${made}/${count} boards, ${(ms / Math.max(1, made) / 1000).toFixed(2)} s a board, ` +
        `aim met ${hit}/${made}, ${(attempts / Math.max(1, made)).toFixed(1)} attempts a board; ` +
        `mix breather ${mix.breather}, standard ${mix.standard}, stretch ${mix.stretch}`,
    );
    console.log("   " + Object.entries(per).map(([k, v]) => `${k} ${spread(v)}`).join("; "));
  }
