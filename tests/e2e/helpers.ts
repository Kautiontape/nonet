import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/** A v2 pack as the app reads it ("classic-easy"). */
export function packOf(key: string): { puzzles: { id: string; g: string }[] } {
  return JSON.parse(readFileSync(`public/packs/v2/${key}.json`, "utf8")) as { puzzles: { id: string; g: string }[] };
}

/** The URL that opens one board of a pack: the first, unless `board` names another. Picks are random, so tests name theirs. */
export function playUrl(key: string, board = packOf(key).puzzles[0]!.id): string {
  return `/?play=${key}-${board}`;
}

/** Open the hint sheet and climb to "Apply it" (rung 3 → apply). Returns the "do" text shown. */
export async function applyNextHint(page: Page): Promise<string> {
  await page.getByTestId("tool-hint").click();
  const sheet = page.getByTestId("hint-sheet");
  await expect(sheet).toHaveClass(/open/);
  await page.getByTestId("hint-next").click(); // → what
  await page.getByTestId("hint-next").click(); // → why
  const why = await sheet.locator(".rung-3").innerText();
  await page.getByTestId("hint-next").click(); // → do + apply
  await expect(sheet).not.toHaveClass(/open/);
  return why;
}

/** Keep applying hints until the board is solved and the results banner shows. Returns hints used. */
export async function solveWithHints(page: Page, cap = 400): Promise<number> {
  let used = 0;
  for (; used < cap; used++) {
    if (await page.locator('.play[data-solved="true"]').count()) break;
    await applyNextHint(page);
  }
  await expect(page.getByTestId("result")).toBeVisible({ timeout: 8000 });
  return used;
}

/** Wait for the level's entrance to finish (cells are live during it, but positions move). */
export async function landed(page: Page): Promise<void> {
  await expect(page.locator(".play[data-entering]")).toHaveCount(0, { timeout: 5000 });
}

export interface CellInfo {
  cell: number;
  r: number;
  c: number;
  b: number;
  value: string;
  cage?: string;
}

export async function readBoard(page: Page): Promise<CellInfo[]> {
  // Puzzles load asynchronously: wait for the full board, and for it to land, before reading it.
  await expect(page.locator(".board .cell")).toHaveCount(81);
  await landed(page);
  return page.$$eval(".board .cell", (els) =>
    els.map((el) => {
      const d = (el as HTMLElement).dataset;
      return {
        cell: Number(d.cell),
        r: Number(d.r),
        c: Number(d.c),
        b: Number(d.b),
        value: el.querySelector(".v")?.textContent ?? "",
        cage: d.cage,
      };
    }),
  );
}

export const cellLocator = (page: Page, cell: number) => page.locator(`.board .cell[data-cell="${cell}"]`);
export const digitKey = (page: Page, d: number) => page.locator(`.numpad .num[data-digit="${d}"]`);
