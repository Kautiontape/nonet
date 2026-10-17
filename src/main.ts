import "@fontsource-variable/outfit";
import "@fontsource-variable/exo-2/wght-italic.css";
import "./ui/style.css";
import { DIFFICULTIES, type Difficulty } from "./engine/types";
import type { Mode } from "./game/packs";
import { App } from "./ui/app";
import { mountResults } from "./ui/components/result-banner";
import { mountToasts, toast } from "./ui/components/toast";
import { Background } from "./ui/fx/background";
import { mountCallouts } from "./ui/fx/callout";
import { Fx } from "./ui/fx/particles";
import { createHome } from "./ui/screens/home";
import { createQueensPlay } from "./ui/screens/queens-play";
import { openSettings } from "./ui/screens/settings-sheet";
import { createSudokuPlay } from "./ui/screens/sudoku-play";
import { audio } from "./ui/audio/synth";
import { connectSound, sound } from "./ui/sound";
import { startSync, SYNC_AVAILABLE } from "./ui/sync";

connectSound(audio);

const bgCanvas = Object.assign(document.createElement("canvas"), { id: "bg" });
const fxCanvas = Object.assign(document.createElement("canvas"), { id: "fx" });
bgCanvas.setAttribute("aria-hidden", "true");
fxCanvas.setAttribute("aria-hidden", "true");
document.body.prepend(bgCanvas);
document.body.append(fxCanvas);
mountCallouts(document.body);
mountToasts(document.body);
mountResults(document.body);

const app = new App(document.getElementById("app")!, new Fx(fxCanvas), new Background(bgCanvas));
app.register({
  home: createHome,
  play: (a, mode, difficulty, resume, avoid) =>
    mode === "queens" ? createQueensPlay(a, difficulty, resume, avoid) : createSudokuPlay(a, mode, difficulty, resume, avoid),
});
app.onError = (message) => toast(message, "bad");
if (SYNC_AVAILABLE) startSync(app);

// Backspace erases in the game; it must never navigate the browser back. Capture phase, so it
// runs before any screen handler and regardless of which element has focus.
const TEXT_INPUT = /^(text|search|email|number|password|tel|url)$/;
window.addEventListener(
  "keydown",
  (e: KeyboardEvent) => {
    if (e.key !== "Backspace") return;
    const t = e.target as HTMLElement | null;
    const typing = t?.isContentEditable || t?.tagName === "TEXTAREA" || (t instanceof HTMLInputElement && TEXT_INPUT.test(t.type));
    if (!typing) e.preventDefault();
  },
  { capture: true },
);

// A mouse click shouldn't leave focus on a game control, or Space / Enter would press it again.
addEventListener(
  "mousedown",
  (e: MouseEvent) => {
    if ((e.target as Element | null)?.closest?.(".tool, .num, .icon-btn, .timer-btn, .qchip, .lens-btn, .lens-chip, .hs-actions .btn")) e.preventDefault();
  },
  { capture: true },
);

// Browsers only allow audio after a gesture: unlock on the first touch anywhere.
addEventListener("pointerdown", () => sound.unlock(), { capture: true, once: true });

// Offline play once installed. Skipped in dev and wherever service workers aren't allowed.
if (import.meta.env.PROD && import.meta.env.VITE_TARGET !== "artifact" && "serviceWorker" in navigator && location.protocol === "https:")
  navigator.serviceWorker.register("./sw.js").catch(() => {});

// ?play=killer-medium jumps straight into a game (handy for sharing and for tests).
const params = new URLSearchParams(location.search);
const play = params.get("play");
// Settings loads the page with ?restored after restoring a backup.
if (params.has("restored")) {
  history.replaceState(null, "", location.pathname);
  toast("Backup restored.", "good");
}
// A sync link from another device (?sync=CODE) opens the join prompt; it wins over ?play=.
const joinCode = params.get("sync");
const [mode, difficulty] = (play ?? "").split("-") as [Mode, Difficulty];
if (joinCode !== null && SYNC_AVAILABLE) {
  history.replaceState(null, "", location.pathname);
  void app.home().then(() => openSettings({ tab: "data", join: joinCode }));
} else if (["classic", "killer", "queens"].includes(mode) && DIFFICULTIES.includes(difficulty)) void app.play(mode, difficulty);
else void app.home();
