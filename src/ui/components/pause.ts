/**
 * Pause: a frosted cover over the whole game until the player is back. The timer holds (it never
 * runs while an overlay is open) and the music fades out. A tap anywhere, Esc, Enter, Space or P
 * carries on.
 */
import { h, svgIcon } from "../dom";
import { ICONS } from "../icons";
import { sound } from "../sound";

/** The top bar's timer doubles as the pause button: the time, then a faint pause glyph. */
export function timerButton(onclick: () => void): { el: HTMLButtonElement; time: HTMLElement } {
  const time = h("span", { class: "timer", "data-testid": "timer" });
  const el = h("button", { class: "timer-btn", type: "button", "aria-label": "Pause", "data-testid": "pause", onclick }, time, svgIcon(ICONS.pauseBars));
  return { el, time };
}

/** Put the cover up. `time` is what the clock reads, or null when the timer is hidden. */
export function openPause(time: string | null): void {
  let done = false;
  const resume = () => {
    if (done) return;
    done = true;
    removeEventListener("keydown", onKey);
    sound.ui("close");
    sound.startMusic();
    overlay.classList.add("closing");
    // Gone when its fade ends; the timeout covers a fade that never runs.
    const remove = () => overlay.remove();
    overlay.addEventListener("animationend", (e) => e.target === overlay && remove());
    setTimeout(remove, 500);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !RESUME_KEYS.has(e.key)) return;
    e.preventDefault();
    resume();
  };
  addEventListener("keydown", onKey);
  const overlay = h(
    "div",
    { class: "overlay pause", role: "dialog", "aria-label": "Paused", "data-testid": "paused", onclick: resume },
    h("div", { class: "pause-orb" }, h("i"), h("i"), h("i"), svgIcon(ICONS.pause)),
    h("h2", { class: "pause-word" }, "Paused"),
    time ? h("p", { class: "pause-time" }, time) : null,
    h("button", { class: "btn primary pause-resume", type: "button", "data-testid": "resume" }, svgIcon(ICONS.play), "Resume"),
    h("p", { class: "pause-tip" }, "The timer's stopped. Tap anywhere to carry on."),
  );
  document.body.append(overlay);
  overlay.querySelector<HTMLElement>(".pause-resume")?.focus();
  sound.ui("open");
  sound.stopMusic();
}

const RESUME_KEYS = new Set(["Escape", "Enter", " ", "p", "P"]);
