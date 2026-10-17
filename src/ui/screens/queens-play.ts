/** Queens play screen: the board, tools, hint ladder and crown-burst feedback. */
import { attacks, colOf, rowOf } from "../../engine/queens/geometry";
import type { QueensHint, RegionNamer } from "../../engine/queens/hints";
import { decodeQueens, encodeQueens, type QueensPackEntry } from "../../engine/queens/pack";
import { CROSS, EMPTY, QUEEN, type QCell, type QueensPuzzle } from "../../engine/queens/types";
import type { Difficulty } from "../../engine/types";
import { loadQueensPack, pickNext } from "../../game/packs";
import { QueensGame, type QueensEvent, type SavedQueens } from "../../game/queens-game";
import { clearSaved, loadSaved, storeSaved, type App, type Screen } from "../app";
import { HintSheet } from "../components/hint-sheet";
import { openPause, timerButton } from "../components/pause";
import { QueensBoard } from "../components/queens-board";
import { showResult } from "../components/result-banner";
import { clearToast, toast } from "../components/toast";
import { flip, formatTime, h, svgIcon } from "../dom";
import { callout } from "../fx/callout";
import { levelOf } from "../fx/level-order";
import { enterLevel, leaveLevel } from "../fx/levels";
import { buzz } from "../haptics";
import { ICONS } from "../icons";
import { DIFFICULTY_LABEL } from "../messages";
import { REGION_COLORS } from "../palette";
import { onSettings, settings, updateSettings } from "../settings";
import { sound } from "../sound";
import { finishPuzzle, firstTime, loadProgress, recordHint } from "../store";
import { openLearn } from "./learn";
import { openScores } from "./scores";
import { openSettings } from "./settings-sheet";

const NAMES: RegionNamer = { region: (i) => REGION_COLORS[i % REGION_COLORS.length]!.name };

export async function createQueensPlay(app: App, difficulty: Difficulty, resume: boolean, avoid?: string): Promise<Screen> {
  let puzzle: QueensPuzzle | null = null;
  let saved: SavedQueens | null = null;
  if (resume) {
    const s = loadSaved<SavedQueens>("queens");
    if (s) {
      puzzle = decodeQueens(s.entry as QueensPackEntry);
      saved = s.state;
      difficulty = s.difficulty;
    }
  }
  if (!puzzle) {
    const pack = await loadQueensPack(difficulty);
    puzzle = pickNext(pack, loadProgress().solved[`queens-${difficulty}`] ?? [], avoid);
    if (!puzzle) throw new Error("empty pack");
  }
  return new QueensPlay(app, difficulty, puzzle, saved);
}

class QueensPlay implements Screen {
  readonly el: HTMLElement;
  private game: QueensGame;
  private board: QueensBoard;
  private sheet: HintSheet;
  private hint: QueensHint | null = null;
  private timerEl: HTMLElement;
  private progressEl: HTMLElement;
  private statsEl: HTMLElement;
  private autoBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private scratchBtn: HTMLButtonElement;
  /** Gesture help, or the scratch bar (Wipe / Keep) while scratching. */
  private helpEl: HTMLElement;
  private helpScratch: boolean | null = null;
  /** What the current drag paints: ✕s, or (started on an ✕) empties. */
  private dragMark: typeof CROSS | typeof EMPTY = CROSS;
  private tick = 0;
  /** After a solve: the countdown to the next level. */
  private advanceTimer = 0;
  private finished = false;
  private offs: (() => void)[] = [];
  private discard = false;
  private last: QCell = 0;

  constructor(
    private app: App,
    private difficulty: Difficulty,
    private puzzle: QueensPuzzle,
    saved: SavedQueens | null,
  ) {
    this.game = new QueensGame(puzzle, saved);
    this.game.settings.checkMistakes = settings().checkMistakes;
    this.board = new QueensBoard(puzzle, {
      onTap: (c) => this.tap(c),
      onDoubleTap: (c) => this.doubleTap(c),
      onLong: (c) => this.hold(c),
      onDrag: (cells, first) => this.drag(cells, first),
    });
    this.sheet = new HintSheet({
      onRung: (r) => this.onRung(r),
      onApply: () => this.applyHint(),
      onLearn: (id) => openLearn(id),
      onClose: () => this.closeHint(),
      refColors: (ladder, rung) => this.board.refColors(ladder, rung),
      onRef: (name) => this.board.flashRef(name),
    });
    this.sheet.dismissOn(this.board.el);
    const timer = timerButton(() => this.pause());
    this.timerEl = timer.time;
    this.progressEl = h("i");
    this.statsEl = h("div", { class: "stats" });
    const btn = (key: string, icon: string, label: string, onclick: () => void, extra = "") =>
      h("button", { class: `tool ${extra}`, type: "button", "aria-label": label, "data-testid": `tool-${key}`, onclick }, svgIcon(icon), h("span", null, label)) as HTMLButtonElement;
    this.undoBtn = btn("undo", ICONS.undo, "Undo", () => this.game.undo());
    this.autoBtn = btn("autox", ICONS.cross, "Auto ✕", () => {
      updateSettings({ autoCross: !settings().autoCross });
      sound.ui("toggle");
    });
    this.scratchBtn = btn("scratch", ICONS.pencil, "Scratch", () => this.toggleScratch());
    this.helpEl = h("div", { class: "qhelp", "data-testid": "qhelp" });
    this.el = h(
      "main",
      { class: "screen play queens", "data-testid": "play" },
      h(
        "header",
        { class: "topbar" },
        h("button", { class: "icon-btn", type: "button", "aria-label": "Back to menu", "data-testid": "back", onclick: () => void this.app.home() }, svgIcon(ICONS.back)),
        h("div", { class: "title" }, h("b", null, "Queens"), h("span", null, `${DIFFICULTY_LABEL[difficulty]} · ${puzzle.n}×${puzzle.n} · Lv ${levelOf(puzzle.id)}`)),
        timer.el,
        h("button", { class: "icon-btn", type: "button", "aria-label": "Menu", onclick: () => this.openMenu() }, svgIcon(ICONS.menu)),
      ),
      h("div", { class: "progress" }, this.progressEl),
      this.statsEl,
      h("div", { class: "board-area" }, this.board.el),
      this.helpEl,
      h(
        "div",
        { class: "tools" },
        this.undoBtn,
        btn("clear", ICONS.trash, "Clear", () => this.game.clearAll()),
        this.autoBtn,
        this.scratchBtn,
        btn("hint", ICONS.bulb, "Hint", () => this.openHint(), "hint-tool"),
      ),
      this.sheet.el,
    );
    this.offs.push(this.game.on((e) => this.onEvent(e)));
    this.offs.push(onSettings(() => {
      this.game.settings.checkMistakes = settings().checkMistakes;
      this.render();
    }));
    // Undo/redo use Ctrl/⌘; the rest are bare keys (Ctrl/⌘/Alt combinations stay the browser's),
    // acting once per press. A focused button keeps Enter for itself.
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".overlay")) return;
      const k = e.key;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && (k.toLowerCase() === "z" || k.toLowerCase() === "y")) {
        e.preventDefault();
        if (k.toLowerCase() === "y" || e.shiftKey) this.game.redo();
        else this.game.undo();
        return;
      }
      if (mod || e.altKey || e.repeat) return;
      if (k === "Escape" && this.sheet.isOpen) this.closeHint();
      else if (k === "Enter" && this.sheet.isOpen && !(e.target as Element | null)?.closest?.("button")) {
        e.preventDefault();
        this.sheet.primary();
      } else if (k === "h" || k === "H") this.sheet.isOpen ? this.sheet.advance() : this.openHint();
      else if (k === "s" || k === "S") this.toggleScratch();
      else if (k === "p" || k === "P") this.pause();
    };
    addEventListener("keydown", onKey);
    this.offs.push(() => removeEventListener("keydown", onKey));
    this.tick = window.setInterval(() => this.onTick(), 1000);
    this.render();
    this.save();
    sound.startMusic();
    requestAnimationFrame(() => this.enter());
    if (firstTime("tip-queens"))
      setTimeout(() => !this.sheet.isOpen && toast("One queen per row, column and colour, and queens never touch, not even diagonally.", "info", 6500, true), 900);
  }

  destroy(): void {
    this.save();
    clearInterval(this.tick);
    clearTimeout(this.advanceTimer);
    for (const off of this.offs) off();
  }

  /** The level drops in (the style rotates level to level). Marked on the screen until it lands. */
  private enter(): void {
    const { style, ms } = enterLevel(this.board.stage(), this.app, levelOf(this.puzzle.id));
    this.el.dataset.entering = style.id;
    window.setTimeout(() => delete this.el.dataset.entering, ms);
  }

  /** On to the next level: the solved board leaves, the next one arrives. Waits out open overlays. */
  private advance(): void {
    if (document.querySelector(".overlay")) {
      this.advanceTimer = window.setTimeout(() => this.advance(), 600);
      return;
    }
    clearTimeout(this.advanceTimer);
    const ms = leaveLevel(this.board.stage(), this.app);
    this.advanceTimer = window.setTimeout(() => void this.app.play("queens", this.difficulty, false, this.puzzle.id), ms);
  }

  private render(): void {
    const g = this.game;
    const st = settings();
    const base = g.scratchBase;
    // Only real queens are ever called wrong: judging a scratch queen would give the answer away.
    const wrong = new Set<QCell>();
    if (st.checkMistakes) for (const q of g.queens()) if (!g.isSolutionCell(q) && (!base || base[q] === QUEEN)) wrong.add(q);
    const attacked = st.autoCross ? g.attacked() : null;
    // Scratch marks, and the auto-✕s that only a scratch queen causes, are drawn sketchily.
    let scratch: Set<QCell> | undefined;
    if (base) {
      const realAttacked = attacked && g.attacked(base);
      scratch = new Set();
      g.marks.forEach((m, c) => {
        if (m !== EMPTY ? m !== base[c] : attacked?.[c] && !realAttacked?.[c]) scratch!.add(c);
      });
    }
    this.board.render({ marks: g.marks, attacked, conflicts: g.conflicts(), wrong, scratch, scratching: g.scratching });
    this.el.classList.toggle("scratch-mode", g.scratching);
    this.undoBtn.disabled = !g.canUndo();
    this.autoBtn.classList.toggle("on", st.autoCross);
    this.autoBtn.setAttribute("aria-pressed", String(st.autoCross));
    this.scratchBtn.classList.toggle("on", g.scratching);
    this.scratchBtn.setAttribute("aria-pressed", String(g.scratching));
    this.scratchBtn.lastElementChild!.textContent = g.scratching ? "Scratch on" : "Scratch";
    this.renderHelp();
    const p = g.progress();
    this.progressEl.style.width = `${(p * 100).toFixed(1)}%`;
    this.timerEl.textContent = st.showTimer ? formatTime(g.elapsedMs) : "";
    this.statsEl.replaceChildren(
      h("span", { class: g.mistakes ? "bad" : "" }, `Mistakes ${g.mistakes}`),
      g.scratching ? h("span", { class: "notes-flag" }, "✎ Scratch") : h("span", null, `Hints ${g.hintsUsed}`),
      h("span", { class: "dim" }, `${g.queens().length} / ${g.n} queens`),
    );
    this.app.bg.setIntensity(0.15 + p * 0.85);
    sound.setIntensity(p);
  }

  /** The gesture line, swapped for Wipe / Keep while scratching (rebuilt only when that flips). */
  private renderHelp(): void {
    const on = this.game.scratching;
    if (this.helpScratch === on) return;
    this.helpScratch = on;
    this.helpEl.replaceChildren(
      ...(on
        ? [
            h("span", null, "Scratch: try anything, none of it counts"),
            h("button", { class: "qchip", type: "button", "data-testid": "scratch-wipe", onclick: () => this.game.wipeScratch() }, "Wipe"),
            h("button", { class: "qchip keep", type: "button", "data-testid": "scratch-keep", onclick: () => this.game.keepScratch() }, "Keep"),
          ]
        : [h("span", null, "Tap ✕ · double-tap queen · hold to clear · drag to ✕ many")]),
    );
  }

  /** Tap: ✕ on, or off again. A queen ignores taps, so a stray tap can't knock one off. */
  private tap(c: QCell): void {
    sound.unlock();
    if (this.game.marks[c] === QUEEN) {
      this.board.shake(c);
      toast("Hold a queen to clear it.", "info", 2200);
      return;
    }
    this.game.tap(c);
  }

  private doubleTap(c: QCell): void {
    this.game.doubleTap(c);
  }

  /** Hold: clear the cell. */
  private hold(c: QCell): void {
    sound.unlock();
    if (this.game.marks[c] === EMPTY) return;
    this.game.clear(c);
    buzz("tap");
  }

  /** A drag paints ✕s, or erases them if it started on one. */
  private drag(cells: QCell[], first: boolean): void {
    if (first) this.dragMark = this.game.marks[cells[0]!] === CROSS ? EMPTY : CROSS;
    this.game.paint(cells, this.dragMark, !first);
  }

  /** Scratch on, or off — which wipes it (Keep, on the scratch bar, makes it real instead). */
  private toggleScratch(): void {
    sound.unlock();
    if (this.game.solved) return;
    if (this.sheet.isOpen) this.closeHint();
    if (this.game.scratching) this.game.wipeScratch();
    else this.game.beginScratch();
  }

  private onEvent(e: QueensEvent): void {
    const fx = this.app.fx;
    const n = this.game.n;
    switch (e.type) {
      case "mark":
        if (e.mark === 1) {
          sound.cross();
          const p = this.board.center(e.cell);
          fx.burst(p.x, p.y, "#9fb3c8", { count: 4, speed: 70, size: 4, life: 0.35 });
        } else if (e.mark === 0) sound.erase();
        break;
      case "marks":
        if (this.game.marks[e.cells[0]!] === EMPTY) sound.erase();
        else sound.cross();
        break;
      case "scratch-queen": {
        // Hypothetical: a soft pencil tick, never right or wrong — but rule clashes still show.
        const p = this.board.center(e.cell);
        this.board.pop(e.cell);
        sound.note(Math.min(9, colOf(e.cell, n) + 1), true);
        buzz("note");
        if (e.conflicts.length) {
          for (const q of e.conflicts) {
            const o = this.board.center(q);
            fx.beam(p.x, p.y, o.x, o.y, "#ffb347", 6, 0.55);
          }
          toast(conflictText(this.game, e.cell, e.conflicts[0]!), "info");
        } else fx.ring(p.x, p.y, "#ffffff", this.board.cellSize() * 0.9, 0.5, 2);
        break;
      }
      case "scratch":
        if (e.on) {
          sound.ui("toggle");
          buzz("tap");
        } else if (e.kept) sound.ui("select");
        else {
          sound.erase();
          if (e.cells.length) this.board.sweep(e.cells, 25);
        }
        break;
      case "queen": {
        this.last = e.cell;
        const p = this.board.center(e.cell);
        const color = REGION_COLORS[this.game.region(e.cell) % REGION_COLORS.length]!.color;
        this.board.pop(e.cell);
        sound.queen(colOf(e.cell, n), n);
        if (e.conflicts.length) {
          this.board.shake(e.cell);
          for (const q of e.conflicts) {
            const o = this.board.center(q);
            fx.beam(p.x, p.y, o.x, o.y, "#ff4d6d", 10, 0.7);
          }
          sound.mistake();
          buzz("mistake");
          toast(conflictText(this.game, e.cell, e.conflicts[0]!), "bad");
        } else if (!e.correct && settings().checkMistakes) {
          fx.burst(p.x, p.y, "#ff4d6d", { count: 10, speed: 120, size: 6 });
          sound.mistake();
          buzz("mistake");
          toast("That queen doesn't fit the solution. Hint can show you why.", "bad");
        } else {
          fx.burst(p.x, p.y, color, { count: 22, speed: 240, size: 9 });
          fx.ring(p.x, p.y, color, this.board.cellSize() * 1.4, 0.7, 3);
          this.app.bg.pulse(p.x, p.y, color, 0.8);
          buzz("place");
        }
        break;
      }
      case "complete": {
        const color = REGION_COLORS[this.game.region(e.cell) % REGION_COLORS.length]!.color;
        const r = rowOf(e.cell, n);
        const k = colOf(e.cell, n);
        const a = this.board.center(r * n);
        const b = this.board.center(r * n + n - 1);
        const c = this.board.center(k);
        const d = this.board.center((n - 1) * n + k);
        fx.beam(a.x, a.y, b.x, b.y, color, this.board.cellSize() * 0.7, 0.8);
        fx.beam(c.x, c.y, d.x, d.y, color, this.board.cellSize() * 0.7, 0.8);
        const regionCells = this.puzzle.regions.map((g, i) => (g === this.game.region(e.cell) ? i : -1)).filter((i) => i >= 0);
        this.board.sweep(regionCells, 30);
        const placed = this.game.queens().filter((q) => this.game.isSolutionCell(q)).length;
        if (placed < n) {
          const box = this.board.el.getBoundingClientRect();
          callout(`${placed} / ${n}`, { size: "small", color, y: box.top + box.height * 0.45 });
        }
        sound.complete(["region"]);
        break;
      }
      case "solved":
        this.finale();
        break;
      default:
        break;
    }
    this.render();
    this.save();
  }

  private finale(): void {
    if (this.finished) return; // a level is scored once
    this.finished = true;
    const g = this.game;
    this.el.dataset.solved = "true";
    this.closeHint();
    this.board.wave(this.last);
    const pts = g.queens().map((q) => ({ ...this.board.center(q), color: REGION_COLORS[g.region(q) % REGION_COLORS.length]!.color }));
    setTimeout(() => this.app.fx.fireworks(pts), 250);
    const perfect = g.mistakes === 0 && g.hintsUsed === 0;
    const box = this.board.el.getBoundingClientRect();
    setTimeout(() => callout(perfect ? "PERFECT" : "SOLVED", { size: "huge", sub: formatTime(g.elapsedMs), y: box.top + box.height * 0.4 }), 350);
    this.app.bg.pulse(innerWidth / 2, box.top + box.height / 2, "#ffffff", 2.5);
    sound.solved();
    buzz("solved");
    const result = finishPuzzle({
      mode: "queens",
      difficulty: this.difficulty,
      id: this.puzzle.id,
      level: levelOf(this.puzzle.id),
      time: g.elapsedMs,
      mistakes: g.mistakes,
      hints: g.hintsUsed,
    });
    clearSaved("queens");
    // The results ride along at the top while the next level drops in: play never stops.
    window.setTimeout(() => showResult(result), 600);
    this.advanceTimer = window.setTimeout(() => this.advance(), ADVANCE_MS);
  }

  private openHint(): void {
    sound.unlock();
    if (this.game.solved) return;
    if (this.game.scratching) {
      toast("Hints read your real board: Keep or Wipe the scratch first.", "info");
      return;
    }
    if (this.sheet.isOpen) return this.sheet.advance();
    this.hint = this.game.hint(NAMES);
    clearToast();
    flip(this.board.el, () => this.el.classList.add("hint-open"));
    this.sheet.open(this.hint);
  }

  private onRung(r: number): void {
    if (!this.hint) return;
    this.game.recordRung(this.hint.kind === "step" ? r : 0);
    this.board.showHint(this.hint, r);
    sound.hint(r);
  }

  private applyHint(): void {
    const hint = this.hint;
    if (!hint) return;
    if (hint.technique) recordHint(hint.technique);
    this.closeHint();
    this.game.applyHint(hint);
    if (hint.step && !hint.step.placements.length) toast(`${hint.title}: ${hint.ladder.do}`, "good");
  }

  private closeHint(): void {
    this.sheet.close();
    this.hint = null;
    flip(this.board.el, () => this.el.classList.remove("hint-open"));
    this.board.showHint(null, 0);
  }

  private onTick(): void {
    if (document.hidden || this.game.solved || document.querySelector(".overlay")) return;
    this.game.elapsedMs += 1000;
    if (settings().showTimer) this.timerEl.textContent = formatTime(this.game.elapsedMs);
    if (Math.round(this.game.elapsedMs / 1000) % 5 === 0) this.save();
  }

  /** The cover goes up and the timer holds. Saved first, in case they don't come back. */
  private pause(): void {
    if (this.game.solved) return;
    this.save();
    openPause(settings().showTimer ? formatTime(this.game.elapsedMs) : null);
  }

  private save(): void {
    if (this.game.solved || this.discard) return;
    storeSaved("queens", { difficulty: this.difficulty, entry: encodeQueens(this.puzzle), state: this.game.toJSON() });
  }

  private openMenu(): void {
    // Esc closes it; focus starts on the first item for keyboard players.
    const close = () => {
      menu.remove();
      removeEventListener("keydown", onEsc);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && close();
    addEventListener("keydown", onEsc);
    const item = (label: string, icon: string, fn: () => void) =>
      h("button", { class: "menu-item", type: "button", onclick: () => (close(), fn()) }, svgIcon(icon), label);
    const menu = h(
      "div",
      { class: "overlay menu", role: "dialog", "aria-label": "Game menu", onclick: (e: Event) => e.target === menu && close() },
      h(
        "div",
        { class: "menu-panel" },
        !this.game.solved && item("Pause", ICONS.pause, () => this.pause()),
        item("New puzzle", ICONS.next, () => void this.app.play("queens", this.difficulty, false, this.puzzle.id)),
        item("Restart this puzzle", ICONS.restart, () => {
          this.discard = true;
          storeSaved("queens", { difficulty: this.difficulty, entry: encodeQueens(this.puzzle), state: new QueensGame(this.puzzle).toJSON() });
          void this.app.play("queens", this.difficulty, true);
        }),
        item("Scores", ICONS.trophy, () => openScores()),
        item("How to play & techniques", ICONS.book, () => openLearn("last-cell")),
        item("Settings", ICONS.gear, () => openSettings()),
      ),
    );
    document.body.append(menu);
    menu.querySelector<HTMLElement>(".menu-item")?.focus();
  }
}

/** From the solve to the next level: the fireworks play and the finale's chord resolves first. */
const ADVANCE_MS = 2400;

function conflictText(g: QueensGame, a: QCell, b: QCell): string {
  const n = g.n;
  if (rowOf(a, n) === rowOf(b, n)) return "Two queens can't share a row.";
  if (colOf(a, n) === colOf(b, n)) return "Two queens can't share a column.";
  if (g.region(a) === g.region(b)) return `The ${REGION_COLORS[g.region(a) % REGION_COLORS.length]!.name} region already has a queen.`;
  if (attacks(g.board, a).includes(b)) return "Queens can't touch — not even diagonally.";
  return "Those queens clash.";
}
