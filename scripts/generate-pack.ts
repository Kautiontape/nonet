/**
 * v2 puzzle packs.
 *
 *   npm run gen -- [--mode all|classic|killer|queens] [--band all|easy|medium|hard|expert]
 *                  [--max 100] [--pool 1.5] [--minutes 0] [--workers 8] [--out public/packs/v2]
 *
 * For each band:
 *  1. Keep the entries of {out}/{mode}-{band}.json that still fit the band (append-only).
 *  2. Make boards for seeds 1, 2, 3… (src/engine/gen) in worker processes. The pool is the first
 *     pool × (max − kept) boards in seed order, so the same arguments make the same pack. With
 *     --minutes, a band stops early and uses the boards from the longest complete run of seeds,
 *     which then depends on timing.
 *  3. Pick the pack (src/engine/gen/select.ts): quotas per sub-target, Classic Expert's technique
 *     cap, no duplicates (content ids; Queens also up to rotation and reflection).
 *
 * Writes {out}/{mode}-{band}.json, entries in seed order. Never writes public/packs/*.json: those
 * are the v1 packs the app and cached clients still read.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BANDS, subTargetsOf, type Mode, type SubTarget } from "../src/engine/bands";
import { contentId, queensSymmetryKey } from "../src/engine/content-id";
import { GENERATOR_VERSION, makeBoard } from "../src/engine/gen";
import { selectPack, type Kept, type PoolBoard } from "../src/engine/gen/select";
import { decodeV2, encodeV2, SUB_TARGET_CODE, SUB_TARGET_OF_CODE, type EntryV2, type PackV2 } from "../src/engine/pack-v2";
import { profileQueens, profileSudoku } from "../src/engine/profile";
import type { QueensPuzzle } from "../src/engine/queens/types";
import { DIFFICULTIES, type Difficulty, type Puzzle } from "../src/engine/types";

interface Result extends PoolBoard {
  entry: EntryV2;
}

const argv = process.argv.slice(2);
const args = new Map<string, string>();
for (let i = 0; i < argv.length; i += 2) args.set(argv[i]!.replace(/^--/, ""), argv[i + 1] ?? "");

const keyOf = (mode: Mode, board: Puzzle | QueensPuzzle) =>
  mode === "queens" ? queensSymmetryKey(board as QueensPuzzle) : contentId(board);

/** Child: read seeds from stdin, answer one JSON line per seed (`null` when no board was made). */
async function child(mode: Mode, band: Difficulty): Promise<void> {
  for await (const line of createInterface({ input: process.stdin })) {
    const seed = Number(line);
    const made = makeBoard(mode, band, seed);
    if (!made) {
      process.stdout.write(JSON.stringify({ seed, result: null }) + "\n");
      continue;
    }
    const entry = encodeV2(mode, band, made, made.fits.includes(made.aim) ? made.aim : made.fits[0]!, GENERATOR_VERSION);
    const result: Result = { seed, key: keyOf(mode, made.board), fits: made.fits, hardest: made.profile.hardest, entry };
    process.stdout.write(JSON.stringify({ seed, result }) + "\n");
  }
}

/** Existing entries that still fit the band, with the sub-target they still fit. */
function loadKept(file: string, mode: Mode, band: Difficulty): (Kept & { entry: EntryV2 })[] {
  if (!existsSync(file)) return [];
  const pack = JSON.parse(readFileSync(file, "utf8")) as PackV2;
  const kept: (Kept & { entry: EntryV2 })[] = [];
  for (const entry of pack.puzzles) {
    const board = decodeV2(mode, entry);
    const fits =
      mode === "queens"
        ? subTargetsOf("queens", band, profileQueens(board as QueensPuzzle, { scan: false }))
        : subTargetsOf(mode, band, profileSudoku(board as Puzzle, { scan: mode === "classic" }));
    if (!fits.length) continue;
    const was = SUB_TARGET_OF_CODE[entry.st];
    const sub = fits.includes(was) ? was : fits[0]!;
    kept.push({ key: keyOf(mode, board), sub, hardest: entry.p.h, entry: { ...entry, st: SUB_TARGET_CODE[sub] } });
  }
  return kept;
}

async function buildBand(mode: Mode, band: Difficulty, opts: { out: string; max: number; pool: number; minutes: number; workers: number }) {
  const t0 = performance.now();
  const file = join(opts.out, `${mode}-${band}.json`);
  const kept = loadKept(file, mode, band);
  const keptSeeds = new Set(kept.map((k) => k.entry.seed));
  const target = Math.ceil(Math.max(0, opts.max - kept.length) * opts.pool);
  const results = new Map<number, Result | null>();
  const deadline = opts.minutes > 0 ? t0 + opts.minutes * 60_000 : Infinity;

  /** Boards from the longest complete run of seeds 1..K, in seed order. */
  const prefix = (): Result[] => {
    const out: Result[] = [];
    for (let seed = 1; ; seed++) {
      if (keptSeeds.has(seed)) continue;
      if (!results.has(seed)) return out;
      const r = results.get(seed);
      if (r) out.push(r);
    }
  };
  let nextSeed = 1;
  const takeSeed = () => {
    while (keptSeeds.has(nextSeed)) nextSeed++;
    return nextSeed++;
  };
  // Stop handing out seeds once the finished seeds hold enough boards; seeds already out still
  // finish, so seeds 1..K are all complete and the pool (the first `target` boards in seed order) is
  // the same however the work was spread over the workers.
  let boards = 0;
  const enough = () => boards >= target || performance.now() > deadline;

  if (target > 0) {
    const self = fileURLToPath(import.meta.url);
    await Promise.all(
      Array.from({ length: opts.workers }, () =>
        new Promise<void>((done, fail) => {
          const proc = spawn(process.execPath, ["--import", "tsx", self, "--child", "1", "--mode", mode, "--band", band], {
            stdio: ["pipe", "pipe", "inherit"],
          });
          const send = () => {
            if (enough()) proc.stdin.end();
            else proc.stdin.write(`${takeSeed()}\n`);
          };
          createInterface({ input: proc.stdout }).on("line", (line) => {
            const m = JSON.parse(line) as { seed: number; result: Result | null };
            results.set(m.seed, m.result);
            if (m.result) boards++;
            process.stdout.write(m.result ? "." : "x");
            send();
          });
          proc.on("error", fail);
          proc.on("exit", (code) => (code === 0 ? done() : fail(new Error(`worker exited ${code}`))));
          send();
        }),
      ),
    );
  }

  const pool = prefix().slice(0, target);
  const cap = (BANDS[mode][band] as { cap?: number }).cap;
  const { picked, shortfall } = selectPack(pool, opts.max, kept, cap);
  const puzzles = [
    ...kept.map((k) => k.entry),
    ...picked.map(({ board, sub }) => ({ ...board.entry, st: SUB_TARGET_CODE[sub] })),
  ].sort((a, b) => a.seed - b.seed);
  const pack: PackV2 = { version: 2, mode, difficulty: band, generator: GENERATOR_VERSION, puzzles };
  writeFileSync(file, JSON.stringify(pack) + "\n");

  const mix: Record<SubTarget, number> = { breather: 0, standard: 0, stretch: 0 };
  for (const e of puzzles) mix[SUB_TARGET_OF_CODE[e.st]]++;
  const short = Object.entries(shortfall).filter(([, n]) => n > 0);
  console.log(
    `\n${file}: ${puzzles.length}/${opts.max} boards (${kept.length} kept, pool ${pool.length} from ${results.size} seeds) in ` +
      `${((performance.now() - t0) / 1000).toFixed(1)}s; breather ${mix.breather}, standard ${mix.standard}, stretch ${mix.stretch}` +
      (short.length ? `; short of quota: ${short.map(([st, n]) => `${st} ${n}`).join(", ")}` : ""),
  );
}

if (args.has("child")) {
  await child(args.get("mode") as Mode, args.get("band") as Difficulty);
} else {
  const modeArg = args.get("mode") ?? "all";
  const modes: Mode[] = modeArg === "all" ? ["classic", "killer", "queens"] : (modeArg.split(",") as Mode[]);
  const bandArg = args.get("band") ?? "all";
  const bands: Difficulty[] = bandArg === "all" ? [...DIFFICULTIES] : (bandArg.split(",") as Difficulty[]);
  const out = args.get("out") ?? "public/packs/v2";
  if (resolve(out) === resolve("public/packs")) throw new Error("refusing to write into public/packs: those are the v1 packs");
  const opts = {
    out,
    max: Number(args.get("max") ?? 100),
    pool: Number(args.get("pool") ?? 1.5),
    minutes: Number(args.get("minutes") ?? 0),
    workers: Math.max(1, Number(args.get("workers") ?? Math.min(8, cpus().length))),
  };
  mkdirSync(out, { recursive: true });
  for (const mode of modes) for (const band of bands) await buildBand(mode, band, opts);
}
