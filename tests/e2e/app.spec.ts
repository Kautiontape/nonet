import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { applyNextHint, cellLocator, digitKey, landed, packOf, playUrl, readBoard, solveWithHints } from "./helpers";

const STYLES = ["warp", "rain", "ripple", "deal", "vortex", "shards", "hologram", "nova"];

test("home shows the three modes and starts a game", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Nonet" })).toBeVisible();
  for (const m of ["classic", "killer", "queens"]) await expect(page.getByTestId(`mode-${m}`)).toBeVisible();
  await page.getByTestId("mode-classic").locator(".mode-head").click();
  await page.getByTestId("play-classic-easy").click();
  await expect(page.getByRole("gridcell")).toHaveCount(81);
  await page.screenshot({ path: "test-results/screens/classic.png" });
});

test("classic: placing, a teaching mistake, and undo", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  await expect(page.getByRole("gridcell")).toHaveCount(81);
  const board = await readBoard(page);
  // Find an empty cell and a digit already given in its row: placing it must be explained.
  const target = board.find((x) => !x.value && board.some((y) => y.r === x.r && y.value));
  expect(target).toBeDefined();
  const clash = board.find((y) => y.r === target!.r && y.value)!;
  await cellLocator(page, target!.cell).click();
  await digitKey(page, Number(clash.value)).click();
  const article = clash.value === "8" ? "an" : "a";
  await expect(page.getByTestId("toast")).toContainText(`Row ${target!.r + 1} already has ${article} ${clash.value}.`);
  await expect(cellLocator(page, target!.cell)).toHaveClass(/wrong/);
  await expect(page.locator(".stats")).toContainText("Mistakes 1");
  await page.getByTestId("tool-undo").click();
  await expect(cellLocator(page, target!.cell).locator(".v")).toHaveText("");
});

test("classic: notes mode pencils candidates; holding a digit lights it up and places nothing", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  const board = await readBoard(page);
  const empty = board.find((x) => !x.value)!;
  await cellLocator(page, empty.cell).click();
  await page.getByTestId("tool-notes").click();
  await expect(page.locator(".play.notes-mode")).toHaveCount(1);
  await expect(page.getByTestId("tool-notes")).toContainText("Notes on");
  await digitKey(page, 3).click();
  await expect(cellLocator(page, empty.cell).locator(".notes i.on")).toHaveCount(1);
  await page.screenshot({ path: "test-results/screens/notes-mode.png" });
  await page.getByTestId("tool-notes").click();
  await digitKey(page, 5).click({ delay: 600 }); // hold
  await expect(page.locator(".cell.same")).toHaveCount(board.filter((x) => x.value === "5").length);
  await expect(cellLocator(page, empty.cell).locator(".v")).toHaveText("");
  await expect(cellLocator(page, empty.cell).locator(".notes i.on")).toHaveCount(1);
});

test("classic: a held digit is the active digit, so a tap on the selected square enters it, not the digit before", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  const board = await readBoard(page);
  const [a, b, c] = board.filter((x) => !x.value);
  await cellLocator(page, a!.cell).click();
  await digitKey(page, 7).click(); // 7 is the last digit entered
  await cellLocator(page, b!.cell).click();
  await digitKey(page, 9).click({ delay: 600 }); // hold: 9 lights up, nothing is placed
  await expect(cellLocator(page, b!.cell).locator(".v")).toHaveText("");
  await expect(digitKey(page, 9)).toHaveClass(/active/);
  await cellLocator(page, b!.cell).click(); // a tap on the selected square repeats the active digit
  await expect(cellLocator(page, b!.cell).locator(".v")).toHaveText("9");
  // The same in pencil mode: the held digit is what the next tap pencils.
  await page.getByTestId("tool-notes").click();
  await cellLocator(page, c!.cell).click();
  await digitKey(page, 3).click();
  await digitKey(page, 5).click({ delay: 600 });
  await cellLocator(page, c!.cell).click();
  await expect(cellLocator(page, c!.cell).locator(".notes i.on")).toHaveText(["3", "5"]);
});

test("hold the Notes tool to hide every note; hold again, or go to pencil mode, to show them", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  const board = await readBoard(page);
  const empty = board.find((x) => !x.value)!;
  await cellLocator(page, empty.cell).click();
  await page.getByTestId("tool-notes").click();
  await digitKey(page, 3).click();
  const note = cellLocator(page, empty.cell).locator(".notes i.on");
  await expect(note).toBeVisible();
  await page.getByTestId("tool-notes").click({ delay: 600 }); // hold: hidden, and pencil mode ends
  await expect(page.locator(".play.notes-hidden")).toHaveCount(1);
  await expect(page.locator(".play.notes-mode")).toHaveCount(0);
  await expect(note).toBeHidden();
  await expect(page.getByTestId("tool-notes")).toContainText("Hidden");
  await expect(page.locator(".stats")).toContainText("Notes hidden");
  await page.screenshot({ path: "test-results/screens/notes-hidden.png" });
  await page.getByTestId("tool-notes").click({ delay: 600 }); // hold again: back
  await expect(page.locator(".play.notes-hidden")).toHaveCount(0);
  await expect(note).toBeVisible();
  await page.keyboard.press("v"); // the keyboard way
  await expect(note).toBeHidden();
  await page.getByTestId("tool-notes").click(); // a tap goes to pencil mode, which shows notes
  await expect(page.locator(".play.notes-mode")).toHaveCount(1);
  await expect(note).toBeVisible();
});

test("classic: holding Shift turns notes mode on until it's let go", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  const empty = (await readBoard(page)).find((x) => !x.value)!;
  const cell = cellLocator(page, empty.cell);
  await cell.click();
  await page.keyboard.down("Shift");
  await expect(page.locator(".play.notes-mode")).toHaveCount(1);
  await expect(page.locator(".numpad.notes-mode")).toHaveCount(1);
  await expect(page.getByTestId("tool-notes")).toHaveAttribute("aria-pressed", "false");
  await digitKey(page, 3).click(); // the pad, with Shift held: a note, as it looks
  await expect(cell.locator(".notes i.on")).toHaveText("3");
  await expect(cell.locator(".v")).toHaveText("");
  await page.keyboard.up("Shift");
  await expect(page.locator(".play.notes-mode")).toHaveCount(0);
  await expect(page.locator(".numpad.notes-mode")).toHaveCount(0);
  // With the toggle on, letting go of Shift leaves notes mode on.
  await page.getByTestId("tool-notes").click();
  await page.keyboard.down("Shift");
  await page.keyboard.up("Shift");
  await expect(page.locator(".play.notes-mode")).toHaveCount(1);
});

test("classic: dragging across empty cells pencils a digit into all of them", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  const board = await readBoard(page);
  const row = board.filter((x) => x.r === 4);
  const run = row.filter((x) => !x.value).slice(0, 3);
  test.skip(run.length < 2, "row 5 has fewer than two empty cells");
  const box = async (c: number) => (await cellLocator(page, c).boundingBox())!;
  const a = await box(run[0]!.cell);
  const b = await box(run[run.length - 1]!.cell);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".cell.msel")).not.toHaveCount(0);
  await digitKey(page, 7).click();
  const selected: number[] = [];
  for (const x of run) {
    if (!(await cellLocator(page, x.cell).evaluate((el) => el.classList.contains("msel")))) continue;
    selected.push(x.cell);
    await expect(cellLocator(page, x.cell).locator(".notes i.on")).toHaveText("7");
  }
  // Erase wipes the whole selection.
  await page.getByTestId("tool-erase").click();
  for (const c of selected) await expect(cellLocator(page, c).locator(".notes i.on")).toHaveCount(0);
});

test("classic: a drag that starts on the selected cell only selects; a tap there repeats the digit", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  const run = (await readBoard(page)).filter((x) => x.r === 4 && !x.value).slice(0, 3);
  test.skip(run.length < 2, "row 5 has fewer than two empty cells");
  const first = cellLocator(page, run[0]!.cell);
  await first.click();
  await page.getByTestId("tool-notes").click();
  await digitKey(page, 7).click(); // pencils 7; 7 is now the digit a tap would repeat
  await expect(first.locator(".notes i.on")).toHaveText("7");
  const box = async (c: number) => (await cellLocator(page, c).boundingBox())!;
  const a = await box(run[0]!.cell);
  const b = await box(run[run.length - 1]!.cell);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".cell.msel")).not.toHaveCount(0);
  await expect(first.locator(".notes i.on")).toHaveText("7"); // the press didn't toggle it
  await first.click(); // select just this cell…
  await first.click(); // …and a tap on it repeats 7 (in notes mode: toggles it off)
  await expect(first.locator(".notes i.on")).toHaveCount(0);
});

test("classic: holding an empty square opens the number wheel; a flick enters the digit", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  const board = await readBoard(page);
  const wheel = page.getByTestId("radial");
  // A flick straight up lands on 1 (1 sits at 12 o'clock).
  const flickUp = async (cell: number, expectDigit: string, shot = false) => {
    const bx = (await cellLocator(page, cell).boundingBox())!;
    const cx = bx.x + bx.width / 2;
    const cy = bx.y + bx.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await expect(wheel).toHaveClass(/open/, { timeout: 4000 }); // the hold threshold, then the wheel
    await page.mouse.move(cx, cy - bx.height * 1.6);
    await expect(page.locator(".radial-dot.on")).toHaveText(expectDigit);
    if (shot) await page.screenshot({ path: "test-results/screens/radial.png" });
    await page.mouse.up();
    await expect(wheel).not.toHaveClass(/open/);
  };
  // Answer mode: the digit lands in the square.
  const a = board.find((x) => !x.value && x.r >= 3 && x.r <= 5)!;
  await flickUp(a.cell, "1", true);
  await expect(cellLocator(page, a.cell).locator(".v")).toHaveText("1");
  // Notes mode: the same flick pencils the digit instead.
  await page.getByTestId("tool-notes").click();
  const b = board.find((x) => !x.value && x.cell !== a.cell && x.r >= 3 && x.r <= 5)!;
  await flickUp(b.cell, "1");
  await expect(cellLocator(page, b.cell).locator(".notes i.on")).toHaveText("1");
  await expect(cellLocator(page, b.cell).locator(".v")).toHaveText("");
});

test("classic: a second Shift-drag adds a cluster without unselecting the first", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  const board = await readBoard(page);
  // Two side-by-side empty cells in two separated rows: each drag covers exactly its own pair.
  const adjPair = (rows: number[]): readonly [number, number] | null => {
    for (const r of rows)
      for (let c = 0; c < 8; c++) {
        const left = board.find((x) => x.r === r && x.c === c && !x.value);
        const right = board.find((x) => x.r === r && x.c === c + 1 && !x.value);
        if (left && right) return [left.cell, right.cell];
      }
    return null;
  };
  const pairA = adjPair([2, 1, 3]);
  const pairB = adjPair([6, 7, 5]);
  test.skip(!pairA || !pairB, "need an adjacent empty pair in an upper and a lower row");
  const box = async (c: number) => (await cellLocator(page, c).boundingBox())!;
  const drag = async ([from, to]: readonly [number, number]) => {
    const a = await box(from);
    const b = await box(to);
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  await page.keyboard.down("Shift"); // so the pointer events carry shiftKey
  await drag(pairA!);
  await drag(pairB!);
  await page.keyboard.up("Shift");
  const all = [...pairA!, ...pairB!];
  for (const c of all) await expect(cellLocator(page, c)).toHaveClass(/msel/); // first cluster kept
  await expect(page.locator(".cell.msel")).toHaveCount(4);
  // A digit pencils into all four.
  await digitKey(page, 6).click();
  for (const c of all) await expect(cellLocator(page, c).locator(".notes i.on")).toHaveText("6");
});

test("classic: Shift- or Ctrl-click adds cells to the selection", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  const empties = (await readBoard(page)).filter((x) => !x.value).slice(0, 3);
  await cellLocator(page, empties[0]!.cell).click();
  await cellLocator(page, empties[1]!.cell).click({ modifiers: ["Shift"] });
  await cellLocator(page, empties[2]!.cell).click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".cell.msel")).toHaveCount(3);
  await cellLocator(page, empties[2]!.cell).click({ modifiers: ["Shift"] }); // again: out
  await expect(page.locator(".cell.msel")).toHaveCount(2);
  // As a real keyboard sends it: Shift held, then the 4 key (key "$", code "Digit4").
  await page.keyboard.down("Shift");
  await page.keyboard.press("Digit4");
  await page.keyboard.up("Shift");
  for (const x of empties.slice(0, 2)) await expect(cellLocator(page, x.cell).locator(".notes i.on")).toHaveText("4");
});

test("Backspace erases in the game and never navigates the browser back", async ({ page }) => {
  const backspaceCancelled = () =>
    page.evaluate(() => !document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })));
  await page.goto("/");
  expect(await backspaceCancelled()).toBe(true);
  await page.goto(playUrl("classic-easy"));
  const empty = (await readBoard(page)).find((x) => !x.value)!;
  await cellLocator(page, empty.cell).click();
  await page.keyboard.press("5");
  await expect(cellLocator(page, empty.cell).locator(".v")).toHaveText("5");
  await page.keyboard.press("Backspace");
  await expect(cellLocator(page, empty.cell).locator(".v")).toHaveText("");
  expect(await backspaceCancelled()).toBe(true);
  expect(page.url()).toContain("play=classic-easy");
});

test("desktop keys: Enter climbs the hint, Esc steps back, browser combos and held keys are left alone", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  const board = await readBoard(page);
  const key = (init: Record<string, string | boolean>) =>
    page.evaluate((i) => void dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...(i as KeyboardEventInit) })), init);
  const sheet = page.getByTestId("hint-sheet");
  await page.keyboard.press("h");
  await expect(sheet).toHaveClass(/open/);
  await page.keyboard.press("Enter"); // the sheet's main button: → what
  await expect(sheet.locator(".rung-2")).toBeVisible();
  await key({ key: "h", repeat: true }); // a held H doesn't race to the answer
  await expect(sheet.locator(".rung-3")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).not.toHaveClass(/open/);
  await key({ key: "h", ctrlKey: true }); // Ctrl+H is the browser's (history)
  await expect(sheet).not.toHaveClass(/open/);
  // Shift+arrow grows the selection; Esc lets go of the cells, then of the cell.
  const empty = board.find((x) => !x.value)!;
  await cellLocator(page, empty.cell).click();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator(".cell.msel")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(page.locator(".cell.msel")).toHaveCount(0);
  await expect(page.locator(".cell.sel")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".cell.sel")).toHaveCount(0);
  // A keypad with NumLock off sends arrows (code Numpad6): they move, they don't type a 6.
  await cellLocator(page, empty.cell).click();
  await key({ key: "ArrowRight", code: "Numpad6" });
  await expect(cellLocator(page, empty.cell).locator(".v")).toHaveText("");
  await page.keyboard.press("Space"); // notes on
  await expect(page.locator(".play.notes-mode")).toHaveCount(1);
  // Queens: Ctrl+S is the browser's (save page), a bare S is Scratch.
  await page.goto(playUrl("queens-easy"));
  await expect(page.locator(".qcell").first()).toBeVisible();
  await key({ key: "s", ctrlKey: true });
  await expect(page.locator(".play.scratch-mode")).toHaveCount(0);
  await page.keyboard.press("s");
  await expect(page.locator(".play.scratch-mode")).toHaveCount(1);
});

test("hint ladder climbs where → what → why and applies a step", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  await page.getByTestId("tool-hint").click();
  const sheet = page.getByTestId("hint-sheet");
  await expect(sheet.locator(".rung-1")).toContainText("Look at");
  await expect(sheet.locator(".hs-title")).toHaveText("Hint"); // technique hidden on rung 1
  await page.getByTestId("hint-next").click();
  await expect(sheet.locator(".hs-title")).not.toHaveText("Hint");
  await page.getByTestId("hint-next").click();
  await expect(page.locator(".board.hinting")).toHaveCount(1);
  await page.screenshot({ path: "test-results/screens/hint-why.png" });
  await page.getByTestId("hint-next").click();
  await expect(page.locator(".stats")).toContainText("Hints 1");
});

test("hint text colours each square it names and rings that square in the same colour", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  await page.getByTestId("tool-hint").click();
  await page.getByTestId("hint-next").click();
  await page.getByTestId("hint-next").click(); // → why: the reasoning names squares
  const chips = page.getByTestId("hint-sheet").locator(".ref");
  await expect(chips.first()).toBeVisible();
  const named = await chips.evaluateAll((els) => els.map((el) => ({ name: (el as HTMLElement).dataset.ref!, color: (el as HTMLElement).style.getPropertyValue("--ref") })));
  const squares = new Map(named.map((x) => [x.name, x.color]));
  await expect(page.locator(".ref-ring.on")).toHaveCount(squares.size);
  for (const [name, color] of squares) {
    const cell = (Number(name[1]) - 1) * 9 + Number(name[3]) - 1;
    await expect(cellLocator(page, cell)).toHaveClass(/h-ref/);
    const ring = page.locator(`.ref-ring.on[data-cell="${cell}"]`);
    expect(await ring.evaluate((el) => (el as SVGElement).style.getPropertyValue("--ref"))).toBe(color);
  }
  // The whole board stays above the sheet, so no ringed square hides behind it.
  const overlap = async () => {
    const b = (await page.getByTestId("board").boundingBox())!;
    const s = (await page.getByTestId("hint-sheet").boundingBox())!;
    return b.y + b.height - s.y;
  };
  await expect.poll(overlap).toBeLessThanOrEqual(0);
  // Row and column numbers show while hinting; each named square's row and column light up.
  await expect(page.locator(".board-wrap .coord")).toHaveCount(18);
  await expect(page.locator(".board-wrap .coords")).toHaveCSS("opacity", "1");
  const [nr, nc] = [Number([...squares.keys()][0]![1]), Number([...squares.keys()][0]![3])];
  await expect(page.locator(".coord.row.lit", { hasText: String(nr) })).toHaveCount(1);
  await expect(page.locator(".coord.col.lit", { hasText: String(nc) })).toHaveCount(1);
  await page.screenshot({ path: "test-results/screens/hint-refs.png" });
  // Tapping a name pulses its square.
  await chips.first().click();
  await expect(page.locator(".ref-ring.flash")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".ref-ring.on")).toHaveCount(0);
});

test("a tap on the board while a hint is open only closes it: nothing is selected or placed", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  const board = await readBoard(page);
  const sheet = page.getByTestId("hint-sheet");
  await digitKey(page, 5).click(); // with nothing selected, 5 becomes the digit a tap on the selected square repeats
  await page.getByTestId("tool-hint").click();
  await page.getByTestId("hint-next").click(); // → what: the hint selects its square
  const target = Number(await page.locator(".board .cell.sel").getAttribute("data-cell"));
  const filled = await page.locator(".board .cell.filled").count();
  await cellLocator(page, target).click();
  await expect(sheet).not.toHaveClass(/open/);
  await expect(page.locator(".board .cell.filled")).toHaveCount(filled);
  await expect(cellLocator(page, target)).toHaveClass(/\bsel\b/);
  // Any other square too: the hint closes and the selection stays put.
  const other = board.find((x) => !x.value && x.cell !== target)!;
  await page.getByTestId("tool-hint").click();
  await cellLocator(page, other.cell).click();
  await expect(sheet).not.toHaveClass(/open/);
  await expect(cellLocator(page, other.cell)).not.toHaveClass(/\bsel\b/);
  await cellLocator(page, other.cell).click(); // closed: taps select as usual
  await expect(cellLocator(page, other.cell)).toHaveClass(/\bsel\b/);
});

test("classic easy can be solved by hints; the next level follows on its own and Scores keeps the result", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(playUrl("classic-easy"));
  await expect(page.locator(".play .title")).toContainText("Lv 1");
  await solveWithHints(page);
  const result = page.getByTestId("result");
  await expect(result).toContainText(/Solved|Perfect/);
  await expect(result).toContainText("Level 1");
  await expect(result).toContainText("first clear");
  // The banner covers the top of the screen: the top bar, progress and stats step aside under it…
  const top = [".play .topbar", ".play .progress", ".play .stats"];
  for (const sel of top) await expect(page.locator(sel)).toBeHidden();
  await page.screenshot({ path: "test-results/screens/result-banner.png" });
  await result.click(); // …until it goes: a tap, or on its own
  await expect(result).toHaveCount(0);
  for (const sel of top) await expect(page.locator(sel)).toBeVisible();
  // No card to dismiss: the next level drops in by itself.
  await expect(page.locator(".play .title")).toContainText("Lv 2", { timeout: 8000 });
  await expect(page.getByRole("gridcell")).toHaveCount(81);
  await landed(page);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Scores" }).click();
  const scores = page.getByTestId("scores");
  await expect(scores.getByTestId("score-row")).toHaveCount(1);
  await expect(scores.getByTestId("score-row")).toContainText("Classic · Easy");
  await expect(scores.locator(".record:not(.none)")).toHaveCount(1);
  await page.screenshot({ path: "test-results/screens/scores.png" });
});

test("every level entrance runs and leaves the board live", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [i, style] of STYLES.entries()) {
    const mode = i % 2 ? "queens-easy" : "killer-easy";
    await page.goto(`${playUrl(mode)}&entrance=${style}`);
    const play = page.locator(".play");
    await expect(play).toHaveAttribute("data-entering", style);
    await page.waitForTimeout(260);
    await page.screenshot({ path: `test-results/screens/entrance-${style}.png` });
    await expect(page.locator(".callout")).toContainText("LEVEL 1");
    await landed(page);
  }
  // Mid-entrance input works: a sudoku digit lands while the board is still arriving.
  await page.goto(`${playUrl("classic-easy")}&entrance=vortex`);
  await expect(page.locator(".play")).toHaveAttribute("data-entering", "vortex");
  const empty = page.locator(".board .cell:not(.given)").first();
  await empty.click();
  await page.keyboard.press("5");
  await expect(empty.locator(".v")).toHaveText("5");
  expect(errors).toEqual([]);
});

test("killer: cages render and a cage repeat is explained", async ({ page }) => {
  await page.goto(playUrl("killer-easy"));
  await expect(page.locator(".sum").first()).toBeVisible();
  const board = await readBoard(page);
  // Two cells in one cage that share no row, column or box.
  let pair: [number, number] | null = null;
  for (const a of board)
    for (const b of board)
      if (a.cell < b.cell && a.cage && a.cage === b.cage && a.r !== b.r && a.c !== b.c && a.b !== b.b) pair ??= [a.cell, b.cell];
  test.skip(!pair, "no diagonal cage pair in this puzzle");
  await cellLocator(page, pair![0]).click();
  await digitKey(page, 5).click();
  await cellLocator(page, pair![1]).click();
  await digitKey(page, 5).click();
  await expect(page.getByTestId("toast")).toContainText("cage already has a 5");
  await page.screenshot({ path: "test-results/screens/killer.png" });
});

test("killer: the 45 lens works out a house's innies or outies", async ({ page }) => {
  await page.goto(playUrl("killer-medium"));
  await page.locator(".board .cell").nth(40).click();
  await page.getByTestId("lens").click();
  await expect(page.getByTestId("lens-eq")).toContainText(/45|cage fits|poke out/);
  await expect(page.locator(".cell.lens-region")).toHaveCount(9);
  await page.getByRole("button", { name: "Box 5" }).click();
  await expect(page.locator(".cell.lens-region")).toHaveCount(9);
  const text = await page.getByTestId("lens-eq").innerText();
  // A readable equation names its cells and rings them on the board.
  if (/so r\dc\d/.test(text)) expect(await page.locator(".cell.lens-in, .cell.lens-out").count()).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/screens/killer-lens.png" });
  await page.getByTestId("lens").click(); // close
  await expect(page.locator(".cell.lens-region")).toHaveCount(0);
});

test("killer: cells picked across cages show those cages' total, each cage once, and light them up", async ({ page }) => {
  await page.goto(playUrl("killer-medium"));
  const board = await readBoard(page);
  const sums = new Map(await page.$$eval(".sum[data-cage]", (els) => els.map((el) => [Number((el as HTMLElement).dataset.cage), Number(el.textContent)] as const)));
  const firstCell = new Map<number, number>();
  for (const x of board) if (!firstCell.has(Number(x.cage))) firstCell.set(Number(x.cage), x.cell);
  // As in the request: four cages, two of them different cages with the same clue.
  const ids = [...firstCell.keys()];
  const twin = ids.find((a) => ids.some((b) => b !== a && sums.get(b) === sums.get(a)))!;
  const other = ids.find((b) => b !== twin && sums.get(b) === sums.get(twin))!;
  const rest = ids.filter((k) => k !== twin && k !== other).slice(0, 2);
  const picked = [twin, rest[0]!, other, rest[1]!];
  const y = (await page.getByTestId("board").boundingBox())!.y;
  await cellLocator(page, firstCell.get(picked[0]!)!).click();
  for (const k of picked.slice(1)) await cellLocator(page, firstCell.get(k)!).click({ modifiers: ["Shift"] });
  const text = `${picked.reduce((a, k) => a + sums.get(k)!, 0)} = ${picked.map((k) => sums.get(k)).join(" + ")}`;
  await expect(page.getByTestId("cage-total")).toHaveText(text);
  await expect(page.locator(".cage.tallied")).toHaveCount(4);
  expect((await page.getByTestId("board").boundingBox())!.y).toBe(y); // one line: nothing moves under a drag
  await page.screenshot({ path: "test-results/screens/cage-total.png" });
  // Another cell of a counted cage adds nothing.
  const extra = board.find((x) => picked.includes(Number(x.cage)) && x.cell !== firstCell.get(Number(x.cage)))!;
  await cellLocator(page, extra.cell).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("cage-total")).toHaveText(text);
  // The Σ45 lens takes the bar over; Esc steps back to the total, then to a single cell.
  await page.keyboard.press("l");
  await expect(page.getByTestId("cage-total")).toHaveCount(0);
  await expect(page.locator(".cage.tallied")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cage-total")).toHaveText(text);
  await expect(page.locator(".cage-bar.lens-mode")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cage-total")).toHaveCount(0);
  await expect(page.locator(".cage.tallied")).toHaveCount(0);
});

test("killer: tap a cage combination to cross it out in pencil; one the game ruled out only shakes", async ({ page }) => {
  await page.goto(playUrl("killer-easy"));
  const board = await readBoard(page);
  const sums = new Map(await page.$$eval(".sum[data-cage]", (els) => els.map((el) => [(el as HTMLElement).dataset.cage!, Number(el.textContent)] as const)));
  // An empty two-square cage along a row with at least three combinations (sum 7 to 13), and
  // another empty square in that row to rule one of them out from.
  const cages = new Map<string, typeof board>();
  for (const x of board) if (x.cage) cages.set(x.cage, [...(cages.get(x.cage) ?? []), x]);
  const pair = [...cages.values()].find(
    (cs) =>
      cs.length === 2 &&
      cs[0]!.r === cs[1]!.r &&
      cs.every((x) => !x.value) &&
      sums.get(cs[0]!.cage!)! >= 7 &&
      sums.get(cs[0]!.cage!)! <= 13 &&
      board.some((x) => x.r === cs[0]!.r && !x.value && x.cage !== cs[0]!.cage),
  );
  test.skip(!pair, "no empty two-square row cage in this puzzle");
  const [a] = pair!;
  const other = board.find((x) => x.r === a!.r && !x.value && x.cage !== a!.cage)!;
  const chips = page.getByTestId("combo");
  await cellLocator(page, a!.cell).click();
  const texts = await chips.allInnerTexts();
  expect(texts.length).toBeGreaterThanOrEqual(3);
  expect(await page.locator(".cage-bar .combo.out").count()).toBe(0);

  // A digit of the first combination elsewhere in the row: the game strikes that one itself.
  await cellLocator(page, other.cell).click();
  await digitKey(page, Number(texts[0]!.split("+")[0])).click();
  await cellLocator(page, a!.cell).click();
  const ruled = chips.filter({ hasText: texts[0]! });
  await expect(ruled).toHaveClass(/\bout\b/);
  // Tapping it doesn't strike it: it shakes its head. (It's aria-disabled, so Playwright needs force.)
  await ruled.click({ force: true });
  await expect(ruled).toHaveClass(/\brefuse\b/);
  await expect(ruled).toHaveAttribute("aria-pressed", "false");

  // The others cross out in pencil. Leave one standing and "needs" names its digits.
  const live = texts.slice(1);
  for (const t of live.slice(0, -1)) await chips.filter({ hasText: t }).click();
  for (const t of live.slice(0, -1)) await expect(chips.filter({ hasText: t })).toHaveAttribute("aria-pressed", "true");
  const last = live[live.length - 1]!;
  await expect(chips.filter({ hasText: last })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".cage-bar .must")).toHaveText(`needs ${last.split("+").join(",")}`);
  await page.screenshot({ path: "test-results/screens/combo-strike.png" });

  // A strike is a move like any other: undo takes the latest back.
  const undone = live[live.length - 2]!;
  await page.getByTestId("tool-undo").click();
  await expect(chips.filter({ hasText: undone })).toHaveAttribute("aria-pressed", "false");
  await chips.filter({ hasText: undone }).click();

  // And it's kept with the game.
  await expect.poll(() => page.evaluate(() => localStorage.getItem("cagecoach.game.killer") ?? "")).toMatch(/"struck":\[\d/);
  await page.goto("/");
  await page.getByTestId("resume-killer").click();
  await readBoard(page);
  await cellLocator(page, a!.cell).click();
  for (const t of live.slice(0, -1)) await expect(chips.filter({ hasText: t })).toHaveAttribute("aria-pressed", "true");
});

test("killer: a hint goes straight for a digit and places it", async ({ page }) => {
  await page.goto(playUrl("killer-easy"));
  await landed(page);
  const why = await applyNextHint(page);
  expect(why.length).toBeGreaterThan(10);
  await expect(page.locator(".board .cell.filled")).toHaveCount(1);
});

test("killer: a route is taught a step at a time — Apply pencils that step's squares and the sheet moves on to the next", async ({ page }) => {
  // On this board three lone hints come first, then a route of three narrowing steps on the way
  // to r3c9, each a cage's combinations.
  await page.goto(playUrl("killer-medium", "k257bdkekr11"));
  await readBoard(page);
  const sheet = page.getByTestId("hint-sheet");
  const pill = page.getByTestId("hint-route");
  /** Each square's notes, as the player sees them (hint pencils aside). */
  const readNotes = () =>
    page.$$eval(".board .cell", (els) =>
      Object.fromEntries(els.map((el) => [(el as HTMLElement).dataset.cell!, [...el.querySelectorAll(".notes i")].flatMap((n, k) => (n.classList.contains("on") ? [k + 1] : []))])),
    );
  const hintsUsed = async () => Number(/Hints (\d+)/.exec(await page.locator(".stats").innerText())![1]);
  let routes = 0;
  for (let i = 0; i < 6 && !routes; i++) {
    await page.getByTestId("tool-hint").click();
    await expect(sheet).toHaveClass(/open/);
    if (!(await pill.isVisible())) {
      for (let r = 0; r < 3; r++) await page.getByTestId("hint-next").click(); // a lone hint: climb and apply
      await expect(sheet).not.toHaveClass(/open/);
      continue;
    }
    routes++;
    const of = Number(/of (\d+)/.exec(await pill.innerText())![1]);
    expect(of).toBeGreaterThan(1);
    await expect(sheet.locator(".rung-1")).toContainText("No digit is certain yet.");
    for (let step = 1; step <= of; step++) {
      await expect(pill).toContainText(`Step ${step} of ${of} · toward r3c9`);
      const used = await hintsUsed();
      while (!(await sheet.locator(".rung-3").count())) await page.getByTestId("hint-next").click(); // → why
      await expect(page.locator(".board.hinting")).toHaveCount(1);
      // Each square showing any pencil, the hint's or the player's: whether the text names it, whether
      // the hint pencilled it, and the digits left unstruck.
      const drawn = await page.$$eval(".board .cell", (els) =>
        els.flatMap((el) => {
          const notes = [...el.querySelectorAll(".notes i")].map((n, k) => ({
            d: k + 1,
            shown: n.matches(".on, .ghost, [class*='m-']") && getComputedStyle(n).visibility !== "hidden",
            struck: n.matches(".m-elim"),
          }));
          if (!notes.some((x) => x.shown)) return [];
          const keep = notes.filter((x) => x.shown && !x.struck).map((x) => x.d);
          const hinted = !!el.querySelector(".notes i.ghost, .notes i[class*='m-']");
          return [{ cell: String((el as HTMLElement).dataset.cell), named: el.classList.contains("h-ref"), hinted, keep }];
        }),
      );
      expect(drawn.filter((x) => !x.named)).toEqual([]); // no pencils in squares the text doesn't name
      if (step === 1) await page.screenshot({ path: "test-results/screens/hint-route.png" });
      const before = await readNotes();
      const filled = await page.locator(".board .cell.filled").count();
      await page.getByTestId("hint-next").click(); // → apply this step
      await expect(page.locator(".stats")).toContainText(`Hints ${used + 1}`); // one hint per step taken
      if ((await page.locator(".board .cell.filled").count()) === filled) {
        // A narrowing step: the notes become what it drew, less what it struck — in its squares and nowhere else.
        const expected = { ...before, ...Object.fromEntries(drawn.filter((x) => x.hinted).map((x) => [x.cell, x.keep])) };
        expect(await readNotes()).toEqual(expected);
      }
      if (step < of) {
        // The next step opens straight at "What".
        await expect(sheet).toHaveClass(/open/);
        await expect(sheet.locator(".rung-2")).toHaveCount(1);
        await expect(sheet.locator(".rung-3")).toHaveCount(0);
      } else await expect(sheet).not.toHaveClass(/open/);
    }
  }
  expect(routes).toBe(1);
});

test("killer: a step your notes already show isn't taught — the next step's Why names it, and the round still teaches three", async ({ page }) => {
  // On this board the first hint is a round of three toward r1c3, opening with the 17 cage at
  // r2c4–r2c5: it can only be 8 and 9. Pencil those in and the round starts from the step after.
  await page.goto(playUrl("killer-medium", "k0ibcn2drkrt"));
  await readBoard(page);
  await cellLocator(page, 12).click(); // r2c4
  await page.getByTestId("tool-notes").click();
  for (const cell of [12, 13]) {
    await cellLocator(page, cell).click();
    await digitKey(page, 8).click();
    await digitKey(page, 9).click();
    await expect(cellLocator(page, cell).locator(".notes i.on")).toHaveCount(2);
  }
  await page.getByTestId("tool-notes").click();
  const sheet = page.getByTestId("hint-sheet");
  await page.getByTestId("tool-hint").click();
  await expect(sheet).toHaveClass(/open/);
  await expect(page.getByTestId("hint-route")).toContainText("Step 1 of 3 · toward r1c3");
  await expect(sheet.locator(".rung-1")).toContainText("No digit is certain yet.");
  await page.getByTestId("hint-next").click(); // → what
  await page.getByTestId("hint-next").click(); // → why
  await expect(sheet.locator(".rung-3")).toContainText("Your notes already show r2c4 and r2c5 can only be 8 or 9.");
  await expect(sheet.locator(".rung-3")).not.toContainText("already in your notes");
  // The notes it names stay in view, so you can check them against the line.
  for (const cell of [12, 13]) for (const d of [8, 9]) await expect(cellLocator(page, cell).locator(".notes i").nth(d - 1)).toBeVisible();
  await page.getByTestId("hint-next").click(); // → apply
  await expect(page.locator(".stats")).toContainText("Hints 1");
  await expect(page.getByTestId("hint-route")).toContainText("Step 2 of 3 · toward r1c3");
});

test("queens:tap toggles ✕, double-tap makes a queen, hold clears; clashes are explained; hints solve it", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(playUrl("queens-easy"));
  const cells = page.locator(".qcell");
  await expect(cells.first()).toBeVisible();
  const n = Math.round(Math.sqrt(await cells.count()));
  expect(n).toBeGreaterThanOrEqual(5);
  const pause = () => page.waitForTimeout(450); // longer than the double-tap window
  const a = cells.nth(0);
  await a.click();
  await expect(a).toHaveClass(/cross/);
  await pause();
  await a.click(); // a later tap takes the ✕ off again
  await expect(a).not.toHaveClass(/cross/);
  await pause();
  await a.dblclick();
  await expect(a).toHaveClass(/queen/);
  await pause();
  await a.click(); // a stray tap leaves a queen alone
  await expect(a).toHaveClass(/queen/);
  await expect(page.getByTestId("toast")).toContainText("Hold a queen");
  // A second queen in the same row clashes.
  await cells.nth(2).dblclick();
  await expect(page.getByTestId("toast")).toContainText("row");
  await cells.nth(2).click({ delay: 700 }); // hold clears it
  await expect(cells.nth(2)).not.toHaveClass(/queen|cross/);
  await page.getByTestId("tool-clear").click();
  await expect(page.locator(".qcell.queen")).toHaveCount(0);
  await page.screenshot({ path: "test-results/screens/queens.png" });
  await solveWithHints(page, 120);
  await expect(page.locator(".qcell.queen")).toHaveCount(n);
  await expect(page.locator(".play .title")).toContainText("Lv 2", { timeout: 8000 });
});

test("queens: scratch tries queens and ✕s without counting, then wipes back to your spot or keeps it", async ({ page }) => {
  await page.goto(playUrl("queens-easy"));
  const cells = page.locator(".qcell");
  await expect(cells.first()).toBeVisible();
  const n = Math.round(Math.sqrt(await cells.count()));
  const real = cells.nth(n + 3);
  await real.click(); // a real ✕ to come back to
  await expect(real).toHaveClass(/cross/);
  await page.getByTestId("tool-scratch").click();
  await expect(page.locator(".play.scratch-mode")).toHaveCount(1);
  await expect(page.getByTestId("tool-scratch")).toContainText("Scratch on");
  // Two touching queens: they clash and at least one is wrong, yet none of it counts.
  await cells.nth(0).dblclick();
  await page.waitForTimeout(450);
  await cells.nth(1).dblclick();
  await expect(page.locator(".qcell.queen.scratch")).toHaveCount(2);
  await expect(page.locator(".qcell.wrong")).toHaveCount(0);
  await expect(page.locator(".stats")).toContainText("Mistakes 0");
  await page.screenshot({ path: "test-results/screens/queens-scratch.png" });
  // Hints wait until the scratch is kept or wiped.
  await page.getByTestId("tool-hint").click();
  await expect(page.getByTestId("toast")).toContainText("Keep or Wipe");
  await expect(page.getByTestId("hint-sheet")).not.toHaveClass(/open/);
  // Wipe: back exactly where you were.
  await page.getByTestId("scratch-wipe").click();
  await expect(page.locator(".play.scratch-mode")).toHaveCount(0);
  await expect(page.locator(".qcell.queen")).toHaveCount(0);
  await expect(real).toHaveClass(/cross/);
  // Keep: the scratch becomes real.
  const kept = cells.nth(2 * n + 4);
  await page.getByTestId("tool-scratch").click();
  await kept.click();
  await expect(kept).toHaveClass(/scratch/);
  await page.getByTestId("scratch-keep").click();
  await expect(kept).toHaveClass(/cross/);
  await expect(kept).not.toHaveClass(/scratch/);
  // Switching the tool off wipes too.
  const tried = cells.nth(2 * n + 5);
  await page.getByTestId("tool-scratch").click();
  await tried.click();
  await expect(tried).toHaveClass(/cross/);
  await page.getByTestId("tool-scratch").click();
  await expect(tried).not.toHaveClass(/cross/);
  await expect(kept).toHaveClass(/cross/);
});

test("queens: squares named in a hint take their region's colour and light up", async ({ page }) => {
  await page.goto(playUrl("queens-medium"));
  await page.getByTestId("tool-hint").click();
  await page.getByTestId("hint-next").click();
  await page.getByTestId("hint-next").click();
  const chips = page.getByTestId("hint-sheet").locator(".ref");
  await expect(chips.first()).toBeVisible();
  const n = Math.round(Math.sqrt(await page.locator(".qcell").count()));
  const named = await chips.evaluateAll((els) => els.map((el) => ({ name: (el as HTMLElement).dataset.ref!, color: (el as HTMLElement).style.getPropertyValue("--ref") })));
  const squares = new Map(named.map((x) => [x.name, x.color]));
  await expect(page.locator(".qcell.h-ref")).toHaveCount(squares.size);
  for (const [name, color] of squares) {
    const [, r, c] = /^r(\d+)c(\d+)$/.exec(name)!;
    const cell = page.locator(`.qcell[data-cell="${(Number(r) - 1) * n + Number(c) - 1}"]`);
    await expect(cell).toHaveClass(/h-ref/);
    expect(await cell.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--rc"))).toBe(color);
  }
  await page.screenshot({ path: "test-results/screens/queens-hint-refs.png" });
});

test("queens: a tap on the board while a hint is open only closes it", async ({ page }) => {
  await page.goto(playUrl("queens-easy"));
  const cell = page.locator(".qcell").first();
  await expect(cell).toBeVisible();
  const sheet = page.getByTestId("hint-sheet");
  await page.getByTestId("tool-hint").click();
  await expect(sheet).toHaveClass(/open/);
  await cell.click();
  await expect(sheet).not.toHaveClass(/open/);
  await expect(cell).not.toHaveClass(/cross|queen/);
  await cell.click(); // closed: a tap marks as usual
  await expect(cell).toHaveClass(/cross/);
});

test("pause covers the board and holds the timer until you carry on", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  await readBoard(page);
  const timer = page.getByTestId("timer");
  const cover = page.getByTestId("paused");
  await expect(timer).not.toHaveText("0:00", { timeout: 3000 });
  // From the game menu.
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.locator(".menu-item", { hasText: "Pause" }).click();
  await expect(cover).toBeVisible();
  const held = (await timer.textContent())!;
  await expect(cover).toContainText(held);
  await page.waitForTimeout(2500);
  await expect(timer).toHaveText(held);
  await page.screenshot({ path: "test-results/screens/paused.png" });
  await cover.click(); // a tap anywhere
  await expect(cover).toHaveCount(0);
  await expect(timer).not.toHaveText(held, { timeout: 3000 });
  // From the timer itself, which is also the pause button.
  await page.getByTestId("pause").click();
  await expect(cover).toBeVisible();
  await page.getByTestId("resume").click();
  await expect(cover).toHaveCount(0);
  // P pauses, and Esc carries on without stepping back in the game too.
  await cellLocator(page, 40).click();
  await page.keyboard.press("p");
  await expect(cover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cover).toHaveCount(0);
  await expect(cellLocator(page, 40)).toHaveClass(/\bsel\b/);
  // Queens pauses from its timer the same way.
  await page.goto(playUrl("queens-easy"));
  await landed(page);
  await page.getByTestId("pause").click();
  await expect(cover).toBeVisible();
  const queensHeld = (await timer.textContent())!;
  await page.waitForTimeout(1500);
  await expect(timer).toHaveText(queensHeld);
  await page.keyboard.press("Enter");
  await expect(cover).toHaveCount(0);
});

test("learn and settings overlays open and close", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-learn").click();
  const learn = page.getByTestId("learn");
  await expect(learn).toBeVisible();
  await learn.getByRole("tab", { name: "Killer" }).click();
  await expect(learn).toContainText("45 Rule");
  await learn.getByRole("tab", { name: "Queens" }).click();
  await expect(learn).toContainText("How to play");
  await page.keyboard.press("Escape");
  await expect(learn).toHaveCount(0);
  await page.getByTestId("open-settings").click();
  // Sound & feel opens first; each tab shows only its own settings.
  await expect(page.getByTestId("settings").getByRole("tab", { name: "Sound & feel" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("settings").locator('input[data-key="cageTint"]')).toBeHidden();
  await page.getByTestId("settings").getByRole("tab", { name: "Killer" }).click();
  await expect(page.getByTestId("settings").locator('input[data-key="haptics"]')).toBeHidden();
  await page.screenshot({ path: "test-results/screens/settings-killer.png" });
  await page.getByTestId("settings").getByRole("tab", { name: "Sound & feel" }).click();
  await page.screenshot({ path: "test-results/screens/settings.png" });
  const sw = page.getByTestId("settings").locator('input[data-key="haptics"]');
  await sw.uncheck({ force: true });
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("settings").locator('input[data-key="haptics"]')).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page.getByTestId("open-scores").click();
  await expect(page.getByTestId("scores")).toContainText("Nothing here yet");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("scores")).toHaveCount(0);
});

test("learn cards show a worked example on a real board", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-learn").click();
  const card = page.locator("#tech-hidden-single");
  await card.locator("summary").click();
  await card.getByTestId("example-hidden-single").click();
  await expect(card.locator(".example .board .cell")).toHaveCount(81);
  await expect(card.locator(".example-do")).toContainText("Place");
  // The explanation's square names match rings on the example board.
  await expect(card.locator(".example-text .ref").first()).toBeVisible();
  await expect(card.locator(".example .ref-ring.on")).not.toHaveCount(0);
  await card.screenshot({ path: "test-results/screens/learn-example.png" });
  await page.getByRole("tab", { name: "Queens" }).click();
  const q = page.locator("#tech-last-cell");
  await q.locator("summary").click();
  await q.getByTestId("example-last-cell").click();
  await expect(q.locator(".example .qcell").first()).toBeVisible();
});

test("progress resumes after reload", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  await applyNextHint(page);
  await page.goto("/");
  await expect(page.getByTestId("resume-classic")).toBeVisible();
  await page.getByTestId("resume-classic").click();
  await expect(page.locator(".stats")).toContainText("Hints 1");
});

test("a game in progress from before the v2 packs resumes as it was left", async ({ page }) => {
  // Saved the way 0.4.1 saves it: a v1 pack board, its v1 id on the board and on the state.
  const entry = (JSON.parse(readFileSync("public/packs/killer-easy.json", "utf8")) as { puzzles: { id: string; s: string }[] }).puzzles[0]!;
  const zeros = Array<number>(81).fill(0);
  const grid = [...zeros];
  grid[0] = Number(entry.s[0]); // the right digit in r1c1
  const notes = [...zeros];
  notes[1] = 1 << 5; // a 5 pencilled in r1c2
  const state = { v: 1, puzzleId: entry.id, grid, notes, elapsed: 600_000, mistakes: 1, hints: 2, rungs: [0, 0, 0, 0, 0], solved: false, known: zeros, hidden: zeros, struck: [] };
  await page.goto("/");
  await page.evaluate((game) => localStorage.setItem("cagecoach.game.killer", JSON.stringify(game)), { difficulty: "easy", entry, state, savedAt: Date.now() });
  await page.reload();
  await page.getByTestId("resume-killer").click();
  await readBoard(page);
  await expect(cellLocator(page, 0).locator(".v")).toHaveText(entry.s[0]!);
  await expect(cellLocator(page, 1).locator(".notes i.on")).toHaveText("5");
  await expect(page.getByTestId("timer")).toHaveText(/^10:0\d$/);
  await expect(page.locator(".stats")).toContainText("Mistakes 1");
  await expect(page.locator(".stats")).toContainText("Hints 2");
});

test("the level number carries on from boards solved before the update", async ({ page }) => {
  // A record from 0.3: solved ids from the old packs, no level counts.
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "cagecoach.progress",
      JSON.stringify({ solved: { "killer-easy": ["killer-easy-1", "killer-easy-2", "killer-easy-5"] }, best: {}, streak: { last: "", days: 0 }, counters: {} }),
    ),
  );
  await page.reload();
  await page.getByTestId("mode-killer").locator(".mode-head").click();
  await expect(page.getByTestId("play-killer-easy")).toContainText("3 solved");
  await page.getByTestId("play-killer-easy").click();
  await expect(page.locator(".play .title")).toContainText("Lv 4");
});

test("a link opens one board; New puzzle moves on to another and doesn't count as a level", async ({ page }) => {
  const pack = packOf("classic-easy");
  const boards = new Set(pack.puzzles.map((e) => e.g));
  const givens = () => page.$$eval(".board .cell", (els) => els.map((el) => el.querySelector(".v")?.textContent || "0").join(""));
  const entry = pack.puzzles[7]!;
  await page.goto(playUrl("classic-easy", entry.id));
  await readBoard(page);
  expect(await givens()).toBe(entry.g);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "New puzzle" }).click();
  await expect.poll(async () => ((g) => g !== entry.g && boards.has(g))(await givens())).toBe(true);
  await expect(page.locator(".play .title")).toContainText("Lv 1");
});

test("killer: Auto notes is a layer — dim digits you can strike, under your own notes, gone again with a tap", async ({ page }) => {
  await page.goto(playUrl("killer-easy"));
  await readBoard(page);
  const auto = page.getByTestId("tool-auto");
  await expect(page.locator(".notes i.auto")).toHaveCount(0);
  await auto.click();
  await expect(auto).toHaveAttribute("aria-pressed", "true");
  // A square with some dim digits but not all nine: one to strike, one to add bright.
  const pick = await page.$$eval(".board .cell", (els) => {
    for (const el of els) {
      const ns = [...el.querySelectorAll(".notes i")];
      const dim = ns.findIndex((n) => n.classList.contains("auto"));
      const off = ns.findIndex((n) => !n.classList.contains("auto"));
      if (dim >= 0 && off >= 0) return { cell: Number((el as HTMLElement).dataset.cell), dim: dim + 1, off: off + 1 };
    }
    return null;
  });
  expect(pick).not.toBeNull();
  const square = cellLocator(page, pick!.cell);
  const struck = square.locator(`.notes i:nth-child(${pick!.dim})`);
  const bright = square.locator(`.notes i:nth-child(${pick!.off})`);
  await square.click();
  await page.getByTestId("tool-notes").click();
  await digitKey(page, pick!.dim).click(); // strike the dim digit: it goes, and no bright note replaces it
  await expect(struck).not.toHaveClass(/auto/);
  await expect(struck).not.toHaveClass(/\bon\b/);
  await digitKey(page, pick!.off).click(); // a digit the layer doesn't show goes in bright
  await expect(bright).toHaveClass(/\bon\b/);
  await page.screenshot({ path: "test-results/screens/auto-notes.png" });
  await auto.click(); // off: the dim digits go, the bright note stays
  await expect(page.locator(".notes i.auto")).toHaveCount(0);
  await expect(bright).toHaveClass(/\bon\b/);
  await auto.click(); // on again: the strike was remembered
  await expect(struck).not.toHaveClass(/auto/);
  await digitKey(page, pick!.dim).click(); // tapping a struck digit brings it back, dim
  await expect(struck).toHaveClass(/auto/);
  // It's a setting: the next game opens with the layer on.
  await page.goto(playUrl("classic-easy"));
  await readBoard(page);
  await expect(page.getByTestId("tool-auto")).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator(".notes i.auto").count()).toBeGreaterThan(0);
});

test("notes focus on the selection: its peers' notes brighten, a far square's stay quiet", async ({ page }) => {
  await page.goto(playUrl("classic-easy"));
  const cells = await readBoard(page);
  await page.getByTestId("tool-auto").click();
  await expect(page.locator(".notes i.auto").first()).toBeAttached();
  const empty = cells.filter((c) => !c.value);
  const a = empty[0]!;
  const peer = empty.find((c) => c.r === a.r && c.c !== a.c)!;
  const far = empty.find((c) => c.r !== a.r && c.c !== a.c && c.b !== a.b)!;
  const autoNote = (cell: number) => cellLocator(page, cell).locator(".notes i.auto").first();
  // Note colours transition for 0.15s: read one once two reads 200ms apart agree.
  const colour = async (cell: number): Promise<string> => {
    const read = () => autoNote(cell).evaluate((el) => getComputedStyle(el).color);
    let last = await read();
    for (;;) {
      await page.waitForTimeout(200);
      const now = await read();
      if (now === last) return now;
      last = now;
    }
  };
  // Nothing selected: every note is quiet, the same colour everywhere.
  const quiet = await colour(far.cell);
  expect(await colour(peer.cell)).toBe(quiet);
  await cellLocator(page, a.cell).click();
  expect(await colour(peer.cell)).not.toBe(quiet);
  expect(await colour(far.cell)).toBe(quiet);
  await page.screenshot({ path: "test-results/screens/notes-focus.png" });
});

test("backup: save a file, then restore it from the game menu over newer progress", async ({ page }, testInfo) => {
  // Pin the download path: a touch device with file sharing would open the share sheet instead.
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "canShare", { value: undefined }));
  await page.goto(playUrl("classic-easy"));
  await applyNextHint(page);
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "cagecoach.progress",
      JSON.stringify({ solved: { "classic-easy": ["classic-easy-1", "classic-easy-2", "classic-easy-3"] }, best: {}, hinted: {}, total: 3, streak: { last: "", days: 0 } }),
    ),
  );
  await page.reload();
  await expect(page.getByTestId("play-classic-easy")).toContainText("3 solved");

  await page.getByTestId("open-settings").click();
  const settingsSheet = page.getByTestId("settings");
  await settingsSheet.getByRole("tab", { name: "Data" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), settingsSheet.getByTestId("backup-save").click()]);
  await settingsSheet.locator(".set-row.backup").screenshot({ path: "test-results/screens/backup.png" });
  expect(download.suggestedFilename()).toMatch(/^nonet-backup-\d{4}-\d\d-\d\d\.json$/);
  const file = testInfo.outputPath("backup.json");
  await download.saveAs(file);
  const backup = JSON.parse(readFileSync(file, "utf8"));
  // The seed was the old shape: on load its count became this device's, and the backup is the new one.
  expect(backup).toMatchObject({ app: "nonet", version: 2 });
  expect(backup.data.progress.total).toBeUndefined();
  expect(Object.values(backup.data.progress.counters as Record<string, { total: number }>).map((c) => c.total)).toEqual([3]);
  expect(backup.data.device).toBeUndefined();
  expect(backup.data["game.classic"]).toBeTruthy();

  // Start over, then restore mid-game: the open game must not save over the backup on the way out.
  await page.evaluate(() => localStorage.clear());
  await page.goto(playUrl("classic-easy"));
  await landed(page);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await settingsSheet.getByRole("tab", { name: "Data" }).click();
  await settingsSheet.getByTestId("restore-file").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(settingsSheet.getByTestId("backup-status")).toContainText("isn't a Nonet backup");
  await settingsSheet.getByTestId("restore-file").setInputFiles(file);
  await expect(settingsSheet.locator(".backup-confirm")).toContainText("3 solved");
  await settingsSheet.locator(".set-row.backup").screenshot({ path: "test-results/screens/backup-confirm.png" });
  await settingsSheet.getByTestId("restore-confirm").click();

  await expect(page.getByTestId("toast")).toContainText("Backup restored");
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cagecoach.game.classic")!))).toEqual(backup.data["game.classic"]);
  await expect(page.getByTestId("play-classic-easy")).toContainText("3 solved");
  await page.getByTestId("resume-classic").click();
  await expect(page.locator(".stats")).toContainText("Hints 1");
});

test("settings shows the version; Changelog opens over it and Esc closes only the changelog", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  const settingsSheet = page.getByTestId("settings");
  await expect(settingsSheet.getByTestId("version")).toHaveText(/^(Version|Build|Beta) \S+/);
  await settingsSheet.getByTestId("open-changelog").click();
  const log = page.getByTestId("changelog");
  await expect(log.locator("section li").first()).toBeVisible();
  await log.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  await page.screenshot({ path: "test-results/screens/changelog.png" });
  await page.keyboard.press("Escape");
  await expect(log).toHaveCount(0);
  await expect(settingsSheet).toBeVisible();
  // A tap outside the card closes it too.
  await settingsSheet.getByTestId("open-changelog").click();
  await expect(log).toBeVisible();
  await page.mouse.click(6, 450); // the margin beside the card (its top edge slides in as it opens)
  await expect(log).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(settingsSheet).toHaveCount(0);
});

test("after an update, Settings and its Changelog glow for someone who has played, until the changelog is opened", async ({ page }) => {
  const settingsBtn = page.getByTestId("open-settings");
  const link = page.getByTestId("settings").getByTestId("open-changelog");
  // A first visit: nothing is new to a new player.
  await page.goto("/");
  await expect(settingsBtn).toBeVisible();
  await expect(settingsBtn).not.toHaveClass(/\bnews\b/);
  // Someone who played before this release was noted (as everyone has, the day this ships).
  await page.evaluate(() => {
    localStorage.setItem("cagecoach.game.killer", JSON.stringify({ clearedAt: 1 }));
    localStorage.removeItem("cagecoach.seenRelease");
  });
  await page.reload();
  await expect(settingsBtn).toHaveClass(/\bnews\b/);
  await expect(settingsBtn.locator(".news-badge")).toBeVisible();
  await page.screenshot({ path: "test-results/screens/whats-new-home.png" });
  await settingsBtn.click();
  await expect(link).toHaveClass(/\bnews\b/);
  await expect(link.locator(".news-pill")).toBeVisible();
  await page.screenshot({ path: "test-results/screens/whats-new-settings.png" });
  await link.click();
  const log = page.getByTestId("changelog");
  // With no mark to go by, the newest section is tagged (here, a local build, it's Next release).
  await expect(log.locator("section").first()).toHaveClass(/\bnew\b/);
  await expect(log.locator("section.new .news-pill")).toHaveText("New");
  await page.keyboard.press("Escape");
  await expect(log).toHaveCount(0);
  await expect(link).not.toHaveClass(/\bnews\b/);
  await page.keyboard.press("Escape");
  await expect(settingsBtn).not.toHaveClass(/\bnews\b/);
  // Seen is remembered.
  await page.reload();
  await expect(settingsBtn).toBeVisible();
  await expect(settingsBtn).not.toHaveClass(/\bnews\b/);
  // ?whatsnew shows it anyway, for one visit, and leaves the address clean.
  await page.goto("/?whatsnew");
  await expect(settingsBtn).toHaveClass(/\bnews\b/);
  expect(new URL(page.url()).search).toBe("");
});

test("on a narrow phone the settings tabs scroll sideways; the page itself never does", async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 720 });
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  const tabs = page.getByTestId("settings").getByRole("tablist");
  expect(await tabs.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.getByTestId("settings").getByRole("tab", { name: "Data" }).click();
  await expect(page.getByTestId("backup-save")).toBeVisible();
  // The chosen tab sits wholly inside the row.
  expect(
    await tabs.evaluate((el) => {
      const row = el.getBoundingClientRect();
      const tab = el.querySelector('[aria-selected="true"]')!.getBoundingClientRect();
      return tab.left >= row.left - 1 && tab.right <= row.right + 1;
    }),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/screens/settings-narrow.png" });
});
