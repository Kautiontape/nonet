/**
 * Pack report: profiles every board in the shipped packs (src/engine/profile.ts) and prints one
 * markdown table per mode, a column per band, v1 (public/packs/) next to v2 (public/packs/v2/)
 * when v2 exists.
 *
 *   npx tsx scripts/pack-stats.ts [--set v1|v2|both] [--mode classic,killer,queens] [--json file]
 *
 * --json writes every board's profile, for further analysis.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { contentId } from "../src/engine/content-id";
import { decodeSudoku, type SudokuPack } from "../src/engine/pack";
import { profileQueens, profileSudoku, type QueensProfile, type SudokuProfile } from "../src/engine/profile";
import { decodeQueens, type QueensPack } from "../src/engine/queens/pack";
import { DIFFICULTIES, type Difficulty } from "../src/engine/types";

type Mode = "classic" | "killer" | "queens";
type SetName = "v1" | "v2";
type Profile = (SudokuProfile | QueensProfile) & { st?: string };

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const DIR: Record<SetName, string> = { v1: "public/packs", v2: "public/packs/v2" };

/** Profiles for one pack, or null when the file doesn't exist. */
function profilePack(set: SetName, mode: Mode, band: Difficulty): { id: string; profile: Profile }[] | null {
  const file = `${DIR[set]}/${mode}-${band}.json`;
  if (!existsSync(file)) return null;
  const pack = JSON.parse(readFileSync(file, "utf8")) as SudokuPack | QueensPack;
  // v2 entries also carry their sub-target (st: b / s / x).
  const st = (e: object) => ("st" in e ? (e as { st: string }).st : undefined);
  if (pack.mode === "queens")
    return pack.puzzles.map((e) => {
      const p = decodeQueens(e);
      return { id: contentId(p), profile: { ...profileQueens(p), st: st(e) } };
    });
  return pack.puzzles.map((e) => {
    const p = decodeSudoku(e);
    return { id: contentId(p), profile: { ...profileSudoku(p), st: st(e) } };
  });
}

// --- formatting -------------------------------------------------------------------------------

const sortNum = (a: number, b: number) => a - b;
function range(xs: readonly number[]): string {
  if (!xs.length) return "—";
  const s = [...xs].sort(sortNum);
  const lo = s[0]!;
  const hi = s.at(-1)!;
  const med = s[s.length >> 1]!;
  const r = (x: number) => String(Math.round(x * 10) / 10);
  return lo === hi ? r(lo) : `${r(lo)}–${r(hi)} · ${r(med)}`;
}
function hist(xs: readonly number[]): string {
  const h = new Map<number, number>();
  for (const x of xs) h.set(x, (h.get(x) ?? 0) + 1);
  return [...h.entries()]
    .sort(([a], [b]) => a - b)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
}
const share = (k: number, n: number) => (n ? `${k} (${Math.round((100 * k) / n)}%)` : "—");

interface Row<P> {
  label: string;
  cell: (ps: P[]) => string;
}

const uses = (p: Profile, ids: readonly string[]) => ids.some((t) => (p.counts[t] ?? 0) > 0);
const PAIRS = ["naked-pair", "hidden-pair"];

/** The hardest step's technique, by number of boards (top 6). */
function mix(ps: Profile[]): string {
  const boards = new Map<string, number>();
  for (const p of ps) if (p.hardest) boards.set(p.hardest, (boards.get(p.hardest) ?? 0) + 1);
  return [...boards.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t, k]) => `${t} ${k}`)
    .join(", ");
}

const COMMON: Row<Profile>[] = [
  { label: "boards", cell: (ps) => String(ps.length) },
  {
    label: "breather / standard / stretch",
    cell: (ps) => (ps.some((p) => p.st) ? ["b", "s", "x"].map((c) => ps.filter((p) => p.st === c).length).join(" / ") : "—"),
  },
  { label: "solved by the hint engine", cell: (ps) => share(ps.filter((p) => p.solved).length, ps.length) },
  { label: "hardest tier", cell: (ps) => hist(ps.map((p) => p.tier)) },
  { label: "steps beyond the floor", cell: (ps) => range(ps.map((p) => p.beyond)) },
  { label: "walls", cell: (ps) => hist(ps.map((p) => p.walls)) },
  { label: "first wall (open)", cell: (ps) => range(ps.flatMap((p) => (p.firstWall === null ? [] : [p.firstWall]))) },
  { label: "tier-3 steps", cell: (ps) => range(ps.map((p) => p.tiers[3]!)) },
  { label: "tier-4+ steps", cell: (ps) => range(ps.map((p) => p.advanced)) },
  { label: "… boards with ≥ 3", cell: (ps) => share(ps.filter((p) => p.advanced >= 3).length, ps.length) },
  { label: "scan: early options (mean, first 25)", cell: (ps) => range(ps.map((p) => p.scan.early)) },
  { label: "scan: median options", cell: (ps) => range(ps.map((p) => p.scan.median)) },
  { label: "scan: states with one option", cell: (ps) => range(ps.map((p) => p.scan.ones)) },
  { label: "hardest step (boards)", cell: (ps) => mix(ps) },
];

const CLASSIC: Row<SudokuProfile>[] = [
  { label: "givens", cell: (ps) => range(ps.map((p) => p.givens)) },
  { label: "needs a naked single", cell: (ps) => share(ps.filter((p) => (p.counts["naked-single"] ?? 0) > 0).length, ps.length) },
  { label: "fewest squares to fill at any point", cell: (ps) => range(ps.map((p) => p.scan.min)) },
  { label: "… ≤ 3 beyond singles", cell: (ps) => share(ps.filter((p) => p.beyond <= 3).length, ps.length) },
  { label: "uses pairs", cell: (ps) => share(ps.filter((p) => uses(p, PAIRS)).length, ps.length) },
  { label: "exactly one tier-3+ step", cell: (ps) => share(ps.filter((p) => p.tiers[3]! + p.advanced === 1).length, ps.length) },
  { label: "uses UR / BUG+1", cell: (ps) => share(ps.filter((p) => p.uniqueness > 0).length, ps.length) },
];

const KILLER: Row<SudokuProfile>[] = [
  { label: "45-rule steps", cell: (ps) => range(ps.map((p) => p.innies.single + p.innies.multi)) },
  {
    label: "first 45 before 11 squares filled",
    cell: (ps) => share(ps.filter((p) => p.firstWall !== null && 81 - p.givens - p.firstWall <= 10).length, ps.length),
  },
  { label: "… boards with ≤ 2", cell: (ps) => share(ps.filter((p) => p.innies.single + p.innies.multi <= 2).length, ps.length) },
  { label: "… multi-house", cell: (ps) => share(ps.filter((p) => p.innies.multi > 0).length, ps.length) },
  { label: "cages", cell: (ps) => range(ps.map((p) => p.cages!.count)) },
  {
    label: "cage sizes (all boards)",
    cell: (ps) =>
      ps
        .reduce((acc, p) => acc.map((k, s) => k + p.cages!.sizes[s]!), new Array<number>(10).fill(0))
        .map((k, s) => (k ? `${s}:${k}` : ""))
        .filter(Boolean)
        .join(" "),
  },
  { label: "mean cage size", cell: (ps) => range([ps.reduce((a, p) => a + 81 / p.cages!.count, 0) / ps.length]) },
  { label: "6+-cell cages", cell: (ps) => range(ps.map((p) => p.cages!.sizes.slice(6).reduce((a, b) => a + b, 0))) },
  { label: "one-cell cages", cell: (ps) => range(ps.map((p) => p.cages!.sizes[1]!)) },
  { label: "one-combination cages", cell: (ps) => range(ps.map((p) => p.cages!.unique)) },
];

const QUEENS: Row<QueensProfile>[] = [
  { label: "size", cell: (ps) => hist(ps.map((p) => p.n)) },
  { label: "… ≤ 2 tier-3 steps", cell: (ps) => share(ps.filter((p) => p.tiers[3]! <= 2).length, ps.length) },
  { label: "tier-5 steps", cell: (ps) => range(ps.map((p) => p.tiers[5]!)) },
  { label: "tier-4 steps", cell: (ps) => range(ps.map((p) => p.tiers[4]!)) },
  { label: "regions of ≤ 3 cells", cell: (ps) => range(ps.map((p) => p.regions.tiny)) },
  { label: "steps", cell: (ps) => range(ps.map((p) => p.steps)) },
];

// --- main ---------------------------------------------------------------------------------------

{
  const sets: SetName[] = arg("set", "both") === "both" ? ["v1", "v2"] : [arg("set", "v1") as SetName];
  const modes = arg("mode", "classic,killer,queens").split(",") as Mode[];
  const json: Record<string, { id: string; profile: Profile }[]> = {};

  for (const mode of modes) {
    const columns: { title: string; ps: Profile[] }[] = [];
    for (const band of DIFFICULTIES)
      for (const set of sets) {
        const rows = profilePack(set, mode, band);
        if (!rows) continue;
        json[`${set}/${mode}-${band}`] = rows;
        columns.push({ title: `${band} ${set}`, ps: rows.map((r) => r.profile) });
      }
    if (!columns.length) continue;
    const specific = (mode === "queens" ? QUEENS : mode === "killer" ? KILLER : CLASSIC) as Row<Profile>[];
    console.log(`\n### ${mode}\n`);
    console.log(`| | ${columns.map((c) => c.title).join(" | ")} |`);
    console.log(`|---|${columns.map(() => "---").join("|")}|`);
    for (const row of [...COMMON, ...specific]) console.log(`| ${row.label} | ${columns.map((c) => row.cell(c.ps)).join(" | ")} |`);
  }
  const out = arg("json", "");
  if (out) writeFileSync(out, JSON.stringify(json));
}
