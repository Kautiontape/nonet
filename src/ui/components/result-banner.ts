/**
 * The results banner: after a level, a translucent strip across the top with the time, whether
 * it's a record, mistakes and hints — readable at a glance while the next level drops in below.
 * It never blocks play; it fades on its own, or sooner with a tap. Scores keeps the history.
 * A level lost to the mistake limit gets the same strip, with how far it got in place of a best,
 * and it stays: the play screen holds until the player moves on, then calls `hideResult`.
 */
import { formatTime, h } from "../dom";
import { DIFFICULTY_LABEL, MODE_LABEL } from "../messages";
import type { ResultEntry } from "../store";

let layer: HTMLElement | null = null;
let timer = 0;

export function mountResults(root: HTMLElement): void {
  layer = h("div", { class: "results-layer", role: "status", "aria-live": "polite" });
  root.append(layer);
}

const word = (n: number, one: string) => (n === 1 ? one : `${one}s`);
const stat = (value: string, label: string, cls = "") => h("span", { class: `rstat ${cls}` }, h("b", null, value), h("small", null, label));
const kicker = (r: Pick<ResultEntry, "mode" | "difficulty" | "level">) =>
  h("span", { class: "result-kicker" }, `${MODE_LABEL[r.mode] ?? r.mode} · ${DIFFICULTY_LABEL[r.difficulty] ?? r.difficulty} · Level ${r.level}`);

export function showResult(r: ResultEntry, ms = 6500): void {
  const best = r.record
    ? stat(formatTime(r.prevBest ?? r.time), "old best", "dim")
    : r.first
      ? stat("—", "first clear", "dim")
      : stat(formatTime(r.prevBest ?? r.time), "best", "dim");
  present(
    `result${r.perfect ? " perfect" : ""}${r.record ? " record" : ""}`,
    h(
      "span",
      { class: "result-head" },
      kicker(r),
      r.record ? h("span", { class: "result-badge" }, "★ New record") : null,
      h("b", { class: "result-title" }, r.perfect ? "Perfect" : "Solved"),
    ),
    [
      stat(formatTime(r.time), "time", r.record ? "gold" : ""),
      stat(String(r.mistakes), word(r.mistakes, "mistake"), r.mistakes ? "" : "clean"),
      stat(String(r.hints), word(r.hints, "hint"), r.hints ? "" : "clean"),
      best,
    ],
    ms,
  );
}

/** A level lost to the mistake limit. `progress` is how much of the board was right, 0 to 1. */
export function showLoss(r: Pick<ResultEntry, "mode" | "difficulty" | "level" | "time" | "mistakes" | "hints"> & { progress: number }): void {
  present(
    "result lost",
    h("span", { class: "result-head" }, kicker(r), h("b", { class: "result-title" }, "Game over")),
    [
      stat(formatTime(r.time), "time"),
      stat(String(r.mistakes), word(r.mistakes, "mistake")),
      stat(String(r.hints), word(r.hints, "hint"), r.hints ? "" : "clean"),
      stat(`${Math.round(r.progress * 100)}%`, "solved", "dim"),
    ],
  );
}

/** Put a banner up: for `ms`, and a tap dismisses it. Without `ms` it stays until `hideResult`. */
function present(cls: string, head: HTMLElement, stats: HTMLElement[], ms?: number): void {
  if (!layer) return;
  const banner = h(
    "div",
    { class: cls, "data-testid": "result", title: ms ? "Tap to dismiss" : undefined, onclick: ms ? () => hide(banner) : undefined },
    head,
    h("span", { class: "result-stats" }, ...stats),
  );
  layer.replaceChildren(banner);
  clearTimeout(timer);
  if (ms) timer = window.setTimeout(() => hide(banner), ms);
}

/** Fade the banner out now. */
export function hideResult(): void {
  clearTimeout(timer);
  const banner = layer?.firstElementChild;
  if (banner) hide(banner as HTMLElement);
}

function hide(banner: HTMLElement): void {
  if (!banner.isConnected || banner.classList.contains("out")) return;
  banner.classList.add("out");
  banner.addEventListener("animationend", () => banner.remove(), { once: true });
}

export function clearResult(): void {
  clearTimeout(timer);
  layer?.replaceChildren();
}
