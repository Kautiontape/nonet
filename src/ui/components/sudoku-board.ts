/**
 * The 9×9 board. DOM cells (crisp digits, accessible gridcells) under an SVG overlay that carries
 * the glowing grid lines, killer cage outlines, and hint visuals: sight lines from the digits that
 * justify a step, chain arrows between candidates, and virtual (45-rule) cages.
 */
import { digitsOf } from "../../engine/combos";
import { boxOf, CELL_HOUSES, cellName, colOf, HOUSE_CELLS, houseIndex, parseCellName, rowOf } from "../../engine/geometry";
import { hintMarks, type SudokuHint } from "../../engine/hints/index";
import type { CandidateMark, CellId, Puzzle } from "../../engine/types";
import { cageAnchor } from "../../engine/hints/format";
import { ladderColors } from "../cell-refs";
import type { LadderText } from "../../engine/hint-types";
import { flipOffset, h, s } from "../dom";
import type { Stage } from "../fx/levels";
import { DIGIT_COLORS } from "../palette";
import { cagePath, colorCages } from "./cage-paths";
import { Coords } from "./coords";
import { Radial, radialPick } from "./radial";

/** The long-press number wheel's callbacks. The board runs the gesture; the screen plays the sound
 *  and turns a pick into a placement. */
export interface RadialHandler {
  /** The wheel opened over `cell`. */
  onOpen?(cell: CellId): void;
  /** The targeted digit changed (0 = none, back in the dead zone). */
  onTick?(digit: number): void;
  /** Released on a digit: drop it into `cell`. */
  onPick(cell: CellId, digit: number): void;
}

/** How long an empty square is held before the number wheel opens (one knob — raise toward 3000 for
 *  a more deliberate hold, lower for a snappier one). A long threshold is deliberate: it keeps a slow
 *  tap and a press-then-drag from ever being mistaken for the wheel. */
const RADIAL_HOLD_MS = 1500;

export interface BoardView {
  grid: Uint8Array;
  notes: Uint16Array;
  /** The auto-note layer: dim digits per cell (all zero, or absent, when it's off). */
  auto?: Uint16Array;
  given: Uint8Array;
  solution: Uint8Array;
  selected: CellId | null;
  /** Digit to highlight across the board (0 = none). */
  highlightDigit: number;
  /** Extra cells selected by dragging (bulk notes). */
  multi?: readonly CellId[];
  showWrong: boolean;
  cageTint: boolean;
}

const UNIT = 100; // SVG units per cell
const CAGE_TINTS = 5;

export class SudokuBoard {
  readonly el: HTMLElement;
  private board: HTMLElement;
  private cellEls: HTMLElement[] = [];
  private valEls: HTMLElement[] = [];
  private noteWrap: HTMLElement[] = [];
  private noteEls: HTMLElement[][] = [];
  private svg: SVGSVGElement;
  private tintG: SVGGElement;
  private cageG: SVGGElement;
  private hintG: SVGGElement;
  /** Rings around the squares the hint text names, one per cell, made on first use. */
  private refG: SVGGElement;
  private refRects = new Map<CellId, SVGRectElement>();
  private refSvg: SVGSVGElement;
  private sums: HTMLElement;
  private coords = new Coords(9);
  private cagePaths = new Map<number, SVGPathElement>();
  private cageOfCell = new Int16Array(81).fill(-1);
  private hint: SudokuHint | null = null;
  private hintRung = 0;
  private hintCand: Uint16Array | null = null;
  private last: BoardView | null = null;
  private radialView: Radial | null = null;

  constructor(
    private puzzle: Puzzle,
    onSelect: (cell: CellId, e: PointerEvent) => void,
    onDragSelect?: (cells: CellId[]) => void,
    onTap?: (cell: CellId) => void,
    radial?: RadialHandler,
  ) {
    const killer = puzzle.cages.length > 0;
    this.board = h("div", { class: `board${killer ? " killer" : ""}`, role: "grid", "aria-label": "Sudoku board", "data-testid": "board" });
    for (let c = 0; c < 81; c++) {
      const val = h("span", { class: "v" });
      const notes = h("div", { class: "notes" });
      const ns: HTMLElement[] = [];
      for (let d = 1; d <= 9; d++) {
        const i = h("i", null, String(d));
        ns.push(i);
        notes.append(i);
      }
      const cell = h(
        "div",
        {
          class: "cell",
          role: "gridcell",
          "data-cell": String(c),
          "data-r": String(rowOf(c)),
          "data-c": String(colOf(c)),
          "data-b": String(boxOf(c)),
        },
        val,
        notes,
      );
      this.cellEls.push(cell);
      this.valEls.push(val);
      this.noteWrap.push(notes);
      this.noteEls.push(ns);
      this.board.append(cell);
    }

    this.svg = s("svg", { class: "board-svg", viewBox: `0 0 ${9 * UNIT} ${9 * UNIT}`, preserveAspectRatio: "none" });
    const defs = s(
      "defs",
      null,
      s("filter", { id: "glow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, s("feGaussianBlur", { stdDeviation: "6", result: "b" }), s("feMerge", null, s("feMergeNode", { in: "b" }), s("feMergeNode", { in: "SourceGraphic" }))),
      s("marker", { id: "arrow", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse" }, s("path", { d: "M0,0 L10,5 L0,10 z", class: "arrow-head" })),
    );
    this.tintG = s("g", { class: "tints" });
    const grid = s("g", { class: "gridlines" });
    for (let i = 1; i < 9; i++) {
      const cls = i % 3 === 0 ? "box-line" : "cell-line";
      grid.append(s("line", { x1: i * UNIT, y1: 0, x2: i * UNIT, y2: 9 * UNIT, class: cls }));
      grid.append(s("line", { x1: 0, y1: i * UNIT, x2: 9 * UNIT, y2: i * UNIT, class: cls }));
    }
    this.cageG = s("g", { class: "cages" });
    this.hintG = s("g", { class: "hint-layer" });
    this.svg.append(defs, this.tintG, grid, this.cageG, this.hintG);
    // Rings get their own layer: above selected and focused cells, below the digits.
    this.refG = s("g", { class: "refs" });
    const refSvg = (this.refSvg = s("svg", { class: "ref-svg", viewBox: `0 0 ${9 * UNIT} ${9 * UNIT}`, preserveAspectRatio: "none", "aria-hidden": "true" }, this.refG));

    const sums = (this.sums = h("div", { class: "sums" }));
    if (killer) {
      const colors = colorCages(puzzle.cages, CAGE_TINTS);
      puzzle.cages.forEach((cage, i) => {
        for (const c of cage.cells) {
          this.cageOfCell[c] = i;
          this.cellEls[c]!.dataset.cage = String(cage.id);
        }
        this.tintG.append(s("path", { d: cagePath(cage.cells, 0, UNIT), class: `tint t${colors[i]}` }));
        const p = s("path", { d: cagePath(cage.cells, 0.085, UNIT), class: "cage" });
        this.cagePaths.set(cage.id, p);
        this.cageG.append(p);
        const a = cageAnchor(cage);
        sums.append(
          h(
            "span",
            { class: "sum", style: { left: `${(colOf(a) / 9) * 100}%`, top: `${(rowOf(a) / 9) * 100}%` }, "data-cage": String(cage.id) },
            String(cage.sum),
          ),
        );
        this.cellEls[a]!.classList.add("has-sum");
      });
    }
    this.el = h("div", { class: "board-wrap" }, this.board, this.svg, refSvg, sums, this.coords.el);
    this.attachInput(onSelect, onDragSelect, onTap, radial);
  }

  /**
   * Press selects a cell; dragging across cells selects them all (for bulk notes). `onTap` fires on
   * release only if the press never left its cell, so starting a drag is never mistaken for a tap.
   * Holding still on an empty square opens the number wheel: a flick toward a digit enters it.
   */
  private attachInput(
    onSelect: (cell: CellId, e: PointerEvent) => void,
    onDragSelect?: (cells: CellId[]) => void,
    onTap?: (cell: CellId) => void,
    radial?: RadialHandler,
  ): void {
    let dragging: CellId[] | null = null;
    let pressed: CellId | null = null;
    let moved = false;
    let longTimer = 0;
    let radialCell: CellId | null = null;
    let radialDigit = 0;
    let pressX = 0;
    let pressY = 0;
    const cellAt = (x: number, y: number): CellId | null => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(".cell");
      return el && this.board.contains(el) ? Number(el.dataset.cell) : null;
    };

    if (radial) {
      this.radialView = new Radial();
      this.el.append(this.radialView.el);
    }

    /** The wheel only opens where a digit can go: an empty, non-given square. */
    const canRadial = (c: CellId): boolean => !!this.radialView && !!this.last && this.last.grid[c] === 0 && this.last.given[c] === 0;

    const openRadial = (c: CellId): void => {
      radialCell = c;
      radialDigit = 0;
      dragging = null; // drag-select steps aside
      moved = true; // so release isn't read as a tap (which would repeat the last digit)
      const rect = this.cellEls[c]!.getBoundingClientRect();
      const wrap = this.el.getBoundingClientRect();
      const size = rect.width;
      const radius = size * 1.15;
      // Keep the whole wheel on-screen near the edges. The pick still reads from the press point, so
      // nudging the dots inward never changes which digit a flick lands on.
      const reach = radius + size * 0.5;
      const cx = Math.min(Math.max(rect.left + size / 2, reach), innerWidth - reach);
      const cy = Math.min(Math.max(rect.top + size / 2, reach), innerHeight - reach);
      this.radialView!.open(cx - wrap.left, cy - wrap.top, radius);
      radial!.onOpen?.(c);
    };

    const closeRadial = (): void => {
      if (radialCell === null) return;
      this.radialView?.close();
      radialCell = null;
      radialDigit = 0;
    };

    this.board.addEventListener("pointerdown", (e) => {
      const c = cellAt(e.clientX, e.clientY);
      if (c === null) return;
      pressed = c;
      moved = false;
      pressX = e.clientX;
      pressY = e.clientY;
      if (onDragSelect) {
        this.board.setPointerCapture?.(e.pointerId);
        dragging = [c];
      }
      onSelect(c, e);
      // A bare hold (no modifier, so not an add-to-selection) over an empty square opens the wheel.
      if (radial && !e.shiftKey && !e.ctrlKey && !e.metaKey && canRadial(c)) longTimer = window.setTimeout(() => openRadial(c), RADIAL_HOLD_MS);
    });
    this.board.addEventListener("pointermove", (e) => {
      if (radialCell !== null) {
        const digit = radialPick(e.clientX - pressX, e.clientY - pressY, this.cellSize() * 0.42);
        if (digit !== radialDigit) {
          radialDigit = digit;
          this.radialView!.highlight(digit);
          radial!.onTick?.(digit);
        }
        return;
      }
      if (!dragging || !onDragSelect) return;
      const c = cellAt(e.clientX, e.clientY);
      if (c === null || dragging.includes(c)) return;
      clearTimeout(longTimer); // moving onto another cell is a drag, not a hold
      moved = true;
      dragging.push(c);
      onDragSelect([...dragging]);
    });
    this.board.addEventListener("pointerup", () => {
      clearTimeout(longTimer);
      if (radialCell !== null) {
        const c = radialCell;
        const digit = radialDigit;
        closeRadial();
        dragging = null;
        pressed = null;
        moved = false;
        if (digit > 0) radial!.onPick(c, digit);
        return;
      }
      if (pressed !== null && !moved) onTap?.(pressed);
      dragging = null;
      pressed = null;
    });
    this.board.addEventListener("pointercancel", () => {
      clearTimeout(longTimer);
      closeRadial();
      dragging = null;
      pressed = null;
    });
    // A long touch on Android would otherwise raise the context menu or start a text selection
    // (which arrives as a pointercancel and kills the hold).
    this.board.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  cell(c: CellId): HTMLElement {
    return this.cellEls[c]!;
  }

  /** Where a square sits once any glide (the hint sheet opening or closing) has landed. */
  /** The board for level entrances and exits. */
  stage(): Stage {
    return { wrap: this.el, grid: this.board, cells: this.cellEls, n: 9, overlays: [this.svg, this.refSvg, this.sums], tiles: true };
  }

  center(c: CellId): { x: number; y: number } {
    const r = this.cellEls[c]!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 - flipOffset(this.el) };
  }

  cellSize(): number {
    return this.cellEls[0]!.getBoundingClientRect().width;
  }

  // ------------------------------------------------------------------------------------------

  render(v: BoardView): void {
    this.last = v;
    const sel = v.selected;
    const selHouses = sel !== null ? CELL_HOUSES[sel]! : null;
    const selCage = sel !== null ? this.cageOfCell[sel]! : -1;
    const hd = v.highlightDigit;
    this.board.classList.toggle("tinted", v.cageTint);
    for (let c = 0; c < 81; c++) {
      const el = this.cellEls[c]!;
      const d = v.grid[c]!;
      const wrong = v.showWrong && d !== 0 && d !== v.solution[c];
      const cls = el.classList;
      cls.toggle("given", v.given[c] === 1);
      cls.toggle("user", d !== 0 && v.given[c] !== 1);
      cls.toggle("filled", d !== 0);
      cls.toggle("wrong", wrong);
      cls.toggle("sel", c === sel);
      cls.toggle("msel", !!v.multi && v.multi.length > 1 && v.multi.includes(c));
      cls.toggle("peer", sel !== null && c !== sel && CELL_HOUSES[c]!.some((x) => selHouses!.includes(x)));
      cls.toggle("cage-peer", selCage >= 0 && c !== sel && this.cageOfCell[c] === selCage);
      cls.toggle("same", hd !== 0 && d === hd);
      if (d) el.style.setProperty("--dc", DIGIT_COLORS[d]!);
      this.valEls[c]!.textContent = d ? String(d) : "";
      const notes = d ? 0 : v.notes[c]!;
      const auto = d ? 0 : (v.auto?.[c] ?? 0) & ~notes;
      const ns = this.noteEls[c]!;
      for (let k = 1; k <= 9; k++) {
        const on = (notes & (1 << k)) !== 0;
        const dim = (auto & (1 << k)) !== 0;
        const n = ns[k - 1]!;
        n.classList.toggle("on", on);
        n.classList.toggle("auto", dim);
        n.classList.toggle("match", (on || dim) && k === hd);
        n.className = n.className.replace(/\bm-\w+\b|\bghost\b/g, "").trim();
      }
      el.setAttribute(
        "aria-label",
        d
          ? `${cellName(c)}, ${d}${v.given[c] ? ", given" : ""}${wrong ? ", wrong" : ""}`
          : `${cellName(c)}, empty${notes ? `, notes ${digitsOf(notes).join(" ")}` : ""}${auto ? `, auto ${digitsOf(auto).join(" ")}` : ""}`,
      );
    }
    // Conflicts: any wrong digit lights up the cells it clashes with.
    for (let c = 0; c < 81; c++) this.cellEls[c]!.classList.remove("conflict");
    if (v.showWrong)
      for (let c = 0; c < 81; c++) {
        const d = v.grid[c]!;
        if (!d || d === v.solution[c]) continue;
        for (const hh of CELL_HOUSES[c]!) for (const p of HOUSE_CELLS[hh]!) if (p !== c && v.grid[p] === d) this.cellEls[p]!.classList.add("conflict");
      }
    this.applyHint();
  }

  // ------------------------------------------------------------------------------------------
  // Animations

  /** Replay a class-driven animation. With `anim`, only that animation's end clears the class. */
  private restart(el: Element, cls: string, anim?: string): void {
    el.classList.remove(cls);
    el.getBoundingClientRect(); // flush styles so the animation restarts (works for SVG too)
    el.classList.add(cls);
    const done = (e: AnimationEvent) => {
      if (anim && e.animationName !== anim) return;
      el.classList.remove(cls);
      el.removeEventListener("animationend", done as EventListener);
    };
    el.addEventListener("animationend", done as EventListener);
  }

  pop(c: CellId): void {
    this.restart(this.cellEls[c]!, "pop");
  }

  shake(c: CellId): void {
    this.restart(this.cellEls[c]!, "shake");
  }

  /** Sequential light sweep over cells (house completion). */
  sweep(cells: CellId[], stagger = 38): void {
    cells.forEach((c, i) => {
      const el = this.cellEls[c]!;
      el.style.setProperty("--delay", `${i * stagger}ms`);
      this.restart(el, "sweep");
    });
  }

  /** Light running around a cage outline. */
  litCage(id: number): void {
    const p = this.cagePaths.get(id);
    if (p) this.restart(p, "lit");
  }

  /** Solve wave: every cell flares, delayed by distance from the last move. */
  wave(from: CellId): void {
    const r0 = rowOf(from);
    const c0 = colOf(from);
    for (let c = 0; c < 81; c++) {
      const el = this.cellEls[c]!;
      const dist = Math.hypot(rowOf(c) - r0, colOf(c) - c0);
      el.style.setProperty("--delay", `${Math.round(dist * 70)}ms`);
      this.restart(el, "wave");
    }
  }

  punch(): void {
    this.restart(this.el, "punch");
  }

  /** Light the cages a selection adds up (the cage bar shows their total). */
  setTally(ids: readonly number[]): void {
    for (const [id, p] of this.cagePaths) p.classList.toggle("tallied", ids.includes(id));
  }

  /** 45-rule lens: tint a region and ring its innies and outies. */
  setLens(lens: { region: CellId[]; innies: CellId[]; outies: CellId[] } | null): void {
    for (const el of this.cellEls) el.classList.remove("lens-region", "lens-in", "lens-out");
    if (!lens) return;
    for (const c of lens.region) this.cellEls[c]!.classList.add("lens-region");
    for (const c of lens.innies) this.cellEls[c]!.classList.add("lens-in");
    for (const c of lens.outies) this.cellEls[c]!.classList.add("lens-out");
  }

  // ------------------------------------------------------------------------------------------
  // Hints

  showHint(hint: SudokuHint | null, rung: number, cand: Uint16Array | null): void {
    this.hint = hint;
    this.hintRung = rung;
    this.hintCand = cand;
    this.applyHint();
  }

  private applyHint(): void {
    const hint = this.hint;
    const rung = this.hintRung;
    for (const el of this.cellEls) el.classList.remove("h-area", "h-dim", "h-focus", "h-source", "h-target", "h-place", "h-elim", "h-ref", "h-quiet");
    while (this.hintG.firstChild) this.hintG.firstChild.remove();
    for (const p of this.cagePaths.values()) p.classList.remove("h-cage");
    this.board.classList.toggle("hinting", !!hint && rung > 0);
    this.showRefs(hint && rung > 0 ? this.refColors(hint.ladder, rung) : new Map());
    if (!hint || rung <= 0) return;

    const step = hint.step;
    const area = new Set<CellId>();
    if (step) {
      for (const hs of step.focus.houses) for (const c of HOUSE_CELLS[houseIndex(hs)]!) area.add(c);
      for (const id of step.focus.cages) for (const c of this.puzzle.cages.find((x) => x.id === id)?.cells ?? []) area.add(c);
      if (!area.size) for (const c of step.focus.cells) area.add(c);
    } else for (const c of hint.cells ?? []) for (const x of HOUSE_CELLS[CELL_HOUSES[c]![2]]!) area.add(x);

    for (let c = 0; c < 81; c++) this.cellEls[c]!.classList.toggle(area.has(c) ? "h-area" : "h-dim", true);
    if (rung < 2) return;

    const focus = step ? step.focus.cells : (hint.cells ?? []);
    for (const c of focus) this.cellEls[c]!.classList.add("h-focus");
    // A chained hint lights the cages its narrowing steps use, too.
    const prior = hint.prior ?? [];
    if (step) for (const id of [...step.focus.cages, ...prior.flatMap((p) => p.focus.cages)]) this.cagePaths.get(id)?.classList.add("h-cage");
    if (rung < 3) return;

    // From "why" on, notes stay in view only in the squares the hint marks, names or outlines; the
    // play screen hides the rest (style.css .h-quiet), Learn examples keep theirs.
    const marks = step ? hintMarks(hint) : [];
    const keep = new Set([...focus, ...marks.map((m) => m.cell)]);
    for (let c = 0; c < 81; c++) if (!keep.has(c) && !this.cellEls[c]!.classList.contains("h-ref")) this.cellEls[c]!.classList.add("h-quiet");
    if (step) {
      for (const c of step.sources ?? []) this.cellEls[c]!.classList.add("h-source");
      for (const e of [...prior.flatMap((p) => p.eliminations), ...step.eliminations]) this.cellEls[e.cell]!.classList.add("h-target");
      for (const p of step.placements) this.cellEls[p.cell]!.classList.add("h-place");
      // Every step's marks, the narrowing steps' too, in only the squares they mark.
      this.drawMarks(marks, (step.marks ?? []).filter((m) => m.role === "digit"));
      this.drawSightLines();
      for (const l of step.links ?? []) this.drawLink(l.from, l.to, l.strong);
      for (const vc of [...prior.flatMap((p) => p.virtualCages ?? []), ...(step.virtualCages ?? [])])
        this.hintG.append(s("path", { d: cagePath(vc.cells, 0.17, UNIT), class: "virtual-cage" }));
    } else {
      for (const c of hint.cells ?? []) this.cellEls[c]!.classList.add(hint.kind === "mistake" ? "h-elim" : "h-target");
    }
  }

  /** Colours for the squares a hint's visible text names (the hint sheet colours them to match). */
  refColors(ladder: LadderText, rung: number): Map<string, string> {
    return ladderColors(ladder, rung);
  }

  /** Ring each named square in its colour. Rings that stay lit aren't rebuilt, so they don't re-animate. */
  private showRefs(colors: ReadonlyMap<string, string>): void {
    const lit = new Map<CellId, string>();
    for (const [name, color] of colors) {
      const c = parseCellName(name);
      if (c !== null) lit.set(c, color);
    }
    for (const [c, rect] of this.refRects) if (!lit.has(c)) rect.classList.remove("on");
    for (const [c, color] of lit) {
      let rect = this.refRects.get(c);
      if (!rect) {
        const pad = 3;
        rect = s("rect", { x: colOf(c) * UNIT + pad, y: rowOf(c) * UNIT + pad, width: UNIT - 2 * pad, height: UNIT - 2 * pad, rx: 13, class: "ref-ring", "data-cell": c });
        this.refG.append(rect);
        this.refRects.set(c, rect);
      }
      rect.style.setProperty("--ref", color);
      rect.classList.add("on");
      this.cellEls[c]!.classList.add("h-ref");
    }
    this.coords.light([...lit].map(([c, color]) => ({ row: rowOf(c), col: colOf(c), color })));
  }

  /** Pulse a named square's ring (its name was tapped in the hint text). */
  flashRef(name: string): void {
    const c = parseCellName(name);
    const rect = c === null ? undefined : this.refRects.get(c);
    if (rect?.classList.contains("on")) this.restart(rect, "flash", "ref-flash");
  }

  /**
   * Ghost candidates with SudokuWiki-style roles, pencilled into the marked squares only. `context`
   * marks ("every other 9") outline a digit already pencilled there, never adding one.
   */
  private drawMarks(marks: readonly CandidateMark[], context: readonly CandidateMark[]): void {
    const byCell = new Map<CellId, CandidateMark[]>();
    for (const m of marks) byCell.set(m.cell, [...(byCell.get(m.cell) ?? []), m]);
    const v = this.last;
    // A digit already showing — the player's note, or the auto layer's dim one — needs no ghost.
    const showing = (n: HTMLElement) => n.classList.contains("on") || n.classList.contains("auto");
    for (const [c, ms] of byCell) {
      if (v?.grid[c]) continue;
      const ns = this.noteEls[c]!;
      const shown = this.hintCand?.[c] ?? 0;
      for (let d = 1; d <= 9; d++) {
        const n = ns[d - 1]!;
        if (shown & (1 << d) && !showing(n)) n.classList.add("ghost");
      }
      for (const m of ms) {
        const n = ns[m.digit - 1]!;
        if (!showing(n)) n.classList.add("ghost");
        n.classList.add(`m-${m.role}`);
      }
    }
    // Any m- class shows a note (style.css), so only ones already showing get the outline — and
    // one an earlier step marks keeps its role.
    const marked = new Set(marks.map((m) => m.cell * 10 + m.digit));
    for (const m of context) {
      const n = this.noteEls[m.cell]![m.digit - 1]!;
      if (v?.grid[m.cell] || marked.has(m.cell * 10 + m.digit)) continue;
      if (showing(n) || n.classList.contains("ghost")) n.classList.add("m-digit");
    }
  }

  /** Lines from the digits that justify a single to the cells they block. */
  private drawSightLines(): void {
    const step = this.hint?.step;
    if (!step?.sources?.length) return;
    const ex = step.explain as Record<string, unknown>;
    const pairs: [CellId, CellId][] = [];
    if (Array.isArray(ex.blocked))
      for (const b of ex.blocked as { cell: CellId; by: CellId | null }[]) if (b.by !== null) pairs.push([b.by, b.cell]);
    if (Array.isArray(ex.seen)) for (const b of ex.seen as { by: CellId | null }[]) if (b.by !== null) pairs.push([b.by, ex.cell as CellId]);
    if (!pairs.length) for (const src of step.sources) for (const p of step.placements) pairs.push([src, p.cell]);
    // Collapse to the farthest target per source and direction.
    const best = new Map<string, [CellId, CellId]>();
    for (const [a, b] of pairs) {
      const dir = rowOf(a) === rowOf(b) ? `r${Math.sign(colOf(b) - colOf(a))}` : colOf(a) === colOf(b) ? `c${Math.sign(rowOf(b) - rowOf(a))}` : `x${b}`;
      const key = `${a}:${dir}`;
      const cur = best.get(key);
      const dist = Math.abs(rowOf(b) - rowOf(a)) + Math.abs(colOf(b) - colOf(a));
      if (!cur || dist > Math.abs(rowOf(cur[1]) - rowOf(a)) + Math.abs(colOf(cur[1]) - colOf(a))) best.set(key, [a, b]);
    }
    for (const [a, b] of best.values()) {
      const [x1, y1] = [(colOf(a) + 0.5) * UNIT, (rowOf(a) + 0.5) * UNIT];
      const [x2, y2] = [(colOf(b) + 0.5) * UNIT, (rowOf(b) + 0.5) * UNIT];
      this.hintG.append(s("line", { x1, y1, x2, y2, class: "sight" }));
    }
  }

  private candPoint(cell: CellId, digit: number): [number, number] {
    const n = this.noteEls[cell]![digit - 1]!.getBoundingClientRect();
    const b = this.board.getBoundingClientRect();
    if (!b.width) {
      const k = digit - 1;
      return [(colOf(cell) + 0.17 + (k % 3) * 0.33) * UNIT, (rowOf(cell) + 0.17 + Math.floor(k / 3) * 0.33) * UNIT];
    }
    return [((n.left + n.width / 2 - b.left) / b.width) * 9 * UNIT, ((n.top + n.height / 2 - b.top) / b.height) * 9 * UNIT];
  }

  private drawLink(from: { cell: CellId; digit: number }, to: { cell: CellId; digit: number }, strong: boolean): void {
    const [x1, y1] = this.candPoint(from.cell, from.digit);
    const [x2, y2] = this.candPoint(to.cell, to.digit);
    // Shorten both ends so arrows don't cover the digits, and bow the curve slightly.
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(14, len / 3);
    const ax = x1 + (dx / len) * k;
    const ay = y1 + (dy / len) * k;
    const bx = x2 - (dx / len) * k;
    const by = y2 - (dy / len) * k;
    const mx = (ax + bx) / 2 - (dy / len) * len * 0.12;
    const my = (ay + by) / 2 + (dx / len) * len * 0.12;
    this.hintG.append(s("path", { d: `M${ax} ${ay} Q${mx} ${my} ${bx} ${by}`, class: strong ? "link strong" : "link weak", "marker-end": "url(#arrow)" }));
  }
}
