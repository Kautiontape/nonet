/**
 * The hint ladder as a bottom sheet. Each tap reveals the next rung:
 *   1 Where → 2 What (technique named) → 3 Why (full reasoning, board lights up) → 4 Do (apply).
 * Mistake / notes hints climb the same ladder, ending in a fix instead of a step.
 * Every square the text names ("r9c8") is coloured, and the board rings it in the same colour.
 * A route (several steps toward a digit) is shown one step at a time: a pill in the header says
 * which step this is and where the route leads, and the screen reopens the sheet for the next.
 */
import type { HintCommon } from "../../engine/hint-types";
import { TIER_NAMES } from "../../engine/hint-types";
import type { LadderText } from "../../engine/hint-types";
import { refNodes } from "../cell-refs";
import { h, svgIcon } from "../dom";
import { ICONS } from "../icons";

export interface HintSheetHandlers {
  /** Called whenever a rung (1..4) becomes visible, before rendering. */
  onRung(rung: number): void;
  onApply(): void;
  onLearn(technique: string): void;
  onClose(): void;
  /** Colours for the squares the visible rungs name — the board's, so text and board match. */
  refColors(ladder: LadderText, rung: number): ReadonlyMap<string, string>;
  /** A square's name was tapped. */
  onRef(name: string): void;
}

const RUNG_LABELS = ["", "Where", "What", "Why", "Do"];

/** Where a hint sits in a route, for the pill in the header. */
export interface RouteInfo {
  /** 1-based. */
  step: number;
  of: number;
  /** The square the route leads to, as the player sees it named ("r5c6"). */
  target: string;
}

export interface OpenOptions {
  /** The rung to open at (1 by default): later steps of a route skip straight to "What". */
  startRung?: number;
  route?: RouteInfo;
}

export class HintSheet {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private actions: HTMLElement;
  private titleEl: HTMLElement;
  private badge: HTMLElement;
  private routeEl: HTMLElement;
  private hint: HintCommon | null = null;
  private route: RouteInfo | null = null;
  private rung = 0;

  constructor(private handlers: HintSheetHandlers) {
    this.titleEl = h("div", { class: "hs-title" });
    this.badge = h("div", { class: "hs-badge" });
    this.routeEl = h("div", { class: "hs-route", "data-testid": "hint-route" });
    const close = h("button", { class: "icon-btn", type: "button", "aria-label": "Close hint", onclick: () => this.handlers.onClose() }, svgIcon(ICONS.close));
    this.body = h("div", { class: "hs-body" });
    this.actions = h("div", { class: "hs-actions" });
    this.el = h(
      "section",
      { class: "hint-sheet", role: "dialog", "aria-label": "Hint", "data-testid": "hint-sheet" },
      h("div", { class: "hs-grip" }),
      h("header", { class: "hs-head" }, h("div", { class: "hs-icon" }, svgIcon(ICONS.bulb)), h("div", { class: "hs-heading" }, this.routeEl, this.titleEl, this.badge), close),
      this.body,
      this.actions,
    );
    this.el.inert = true; // off-screen until opened: keep its buttons out of the Tab order
  }

  get isOpen(): boolean {
    return this.el.classList.contains("open");
  }

  /** While the sheet is open, a press on `el` (the board) only closes it; nothing underneath acts. */
  dismissOn(el: HTMLElement): void {
    el.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.isOpen) return;
        e.preventDefault();
        e.stopPropagation();
        this.handlers.onClose();
      },
      { capture: true },
    );
  }

  get currentRung(): number {
    return this.rung;
  }

  open(hint: HintCommon, opts: OpenOptions = {}): void {
    this.hint = hint;
    this.route = opts.route ?? null;
    this.rung = Math.max(0, (opts.startRung ?? 1) - 1);
    this.el.classList.add("open");
    this.el.inert = false;
    this.el.dataset.kind = hint.kind;
    this.advance();
  }

  close(): void {
    this.el.classList.remove("open");
    this.el.inert = true;
    this.hint = null;
    this.route = null;
    this.rung = 0;
  }

  advance(): void {
    if (!this.hint) return;
    const max = this.hint.kind === "solved" ? 1 : 4;
    if (this.rung >= max) return;
    this.rung++;
    this.handlers.onRung(this.rung);
    this.render();
  }

  private render(): void {
    const hint = this.hint!;
    const r = this.rung;
    const named = hint.kind !== "step" || r >= 2;
    this.titleEl.textContent = named ? hint.title : "Hint";
    this.badge.textContent = hint.kind === "step" && r >= 2 && hint.tier ? `${TIER_NAMES[hint.tier] ?? ""} · tier ${hint.tier}` : hint.kind === "mistake" ? "Fix first" : hint.kind === "notes" ? "Notes check" : "";
    this.badge.style.setProperty("--tier", String(hint.tier ?? 0));
    const route = this.route;
    this.routeEl.classList.toggle("on", !!route);
    this.routeEl.textContent = route ? `Step ${route.step} of ${route.of} · toward ${route.target}` : "";

    const rows: HTMLElement[] = [];
    const ladder = hint.ladder;
    const texts: (string | string[])[] = ["", ladder.where, ladder.what, ladder.why, ladder.do];
    const colors = this.handlers.refColors(ladder, r);
    const para = (p: string) => h("p", null, ...refNodes(p, colors, (name) => this.handlers.onRef(name)));
    for (let i = 1; i <= r; i++) {
      const t = texts[i]!;
      const content = Array.isArray(t) ? t.map(para) : [para(t)];
      rows.push(
        h(
          "div",
          { class: `rung rung-${i}${i === r ? " latest" : ""}`, "data-rung": String(i) },
          h("div", { class: "rung-label" }, h("span", null, String(i)), RUNG_LABELS[i]!),
          h("div", { class: "rung-text" }, ...content),
        ),
      );
    }
    this.body.replaceChildren(...rows);
    this.body.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });

    const buttons: HTMLElement[] = [];
    if (hint.technique && r >= 2)
      buttons.push(h("button", { class: "btn ghost", type: "button", onclick: () => this.handlers.onLearn(hint.technique!) }, svgIcon(ICONS.book), "Learn"));
    if (r < 4 && hint.kind !== "solved") {
      const next = ["", "Which technique?", "Why does it work?", hint.kind === "step" ? "Apply it" : "Fix it"][r]!;
      buttons.push(
        h(
          "button",
          { class: "btn primary", type: "button", "data-testid": "hint-next", onclick: () => (r === 3 ? this.applyNow() : this.advance()) },
          next,
          svgIcon(ICONS.next),
        ),
      );
    } else if (r >= 4 && hint.kind !== "solved") {
      buttons.push(h("button", { class: "btn primary", type: "button", "data-testid": "hint-apply", onclick: () => this.handlers.onApply() }, svgIcon(ICONS.check), "Apply"));
    }
    this.actions.replaceChildren(...buttons);
  }

  /** What the main button does right now (Enter): the next rung, or apply. */
  primary(): void {
    if (!this.hint || this.hint.kind === "solved") return;
    if (this.rung >= 4) this.handlers.onApply();
    else if (this.rung === 3) this.applyNow();
    else this.advance();
  }

  /** Rung 3 → reveal "Do" and apply in one tap. */
  private applyNow(): void {
    this.advance();
    this.handlers.onApply();
  }
}
