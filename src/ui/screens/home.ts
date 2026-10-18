/** Title screen: three glowing mode cards with difficulty picks, plus Learn and Settings. */
import { DIFFICULTIES, type Difficulty } from "../../engine/types";
import type { Mode } from "../../game/packs";
import { loadSaved, type App, type Screen } from "../app";
import { h, svgIcon } from "../dom";
import { ICONS } from "../icons";
import { DIFFICULTY_LABEL } from "../messages";
import { THEMES } from "../palette";
import { sound } from "../sound";
import { load, loadProgress } from "../store";
import { hasNews, onWhatsNew } from "../whats-new";
import { openLearn } from "./learn";
import { openScores } from "./scores";
import { openSettings } from "./settings-sheet";

interface ModeInfo {
  mode: Mode;
  title: string;
  tagline: string;
  icon: string;
  theme: keyof typeof THEMES;
}

const MODES: ModeInfo[] = [
  { mode: "classic", title: "Sudoku", tagline: "Nine digits. No repeats. Pure logic.", icon: ICONS.grid, theme: "abyss" },
  { mode: "killer", title: "Killer Sudoku", tagline: "Cages with sums instead of givens.", icon: ICONS.cage, theme: "ember" },
  { mode: "queens", title: "Queens", tagline: "One crown per row, column and colour.", icon: ICONS.crown, theme: "aurora" },
];

export function createHome(app: App): Screen {
  const progress = loadProgress();
  let open: Mode | null = null;
  const cards = new Map<Mode, HTMLElement>();

  const toggle = (mode: Mode) => {
    sound.unlock();
    sound.ui(open === mode ? "close" : "open");
    open = open === mode ? null : mode;
    for (const [m, el] of cards) el.classList.toggle("open", m === open);
  };

  for (const info of MODES) {
    const th = THEMES[info.theme];
    const saved = loadSaved<{ solved?: boolean }>(info.mode);
    const solvedTotal = DIFFICULTIES.reduce((a, d) => a + (progress.beaten[`${info.mode}-${d}`] ?? 0), 0);
    const chips = DIFFICULTIES.map((d: Difficulty) =>
      h(
        "button",
        {
          class: "chip",
          type: "button",
          "data-testid": `play-${info.mode}-${d}`,
          onclick: (e: Event) => {
            e.stopPropagation();
            sound.unlock();
            sound.ui("tap");
            void app.play(info.mode, d);
          },
        },
        h("b", null, DIFFICULTY_LABEL[d]!),
        h("small", null, `${progress.beaten[`${info.mode}-${d}`] ?? 0} solved`),
      ),
    );
    const resume =
      saved && !saved.state?.solved
        ? h(
            "button",
            {
              class: "btn primary resume",
              type: "button",
              "data-testid": `resume-${info.mode}`,
              onclick: (e: Event) => {
                e.stopPropagation();
                sound.unlock();
                void app.play(info.mode, saved.difficulty, true);
              },
            },
            svgIcon(ICONS.play),
            `Continue · ${DIFFICULTY_LABEL[saved.difficulty]}`,
          )
        : null;
    const card = h(
      "article",
      {
        class: `mode-card mode-${info.mode}`,
        style: { "--m1": th.accents[0], "--m2": th.accents[1], "--m3": th.accents[2] },
        "data-testid": `mode-${info.mode}`,
      },
      h(
        "button",
        { class: "mode-head", type: "button", "aria-expanded": "false", onclick: () => toggle(info.mode) },
        h("div", { class: "mode-icon" }, svgIcon(info.icon)),
        h("div", { class: "mode-text" }, h("h2", null, info.title), h("p", null, info.tagline)),
        h("div", { class: "mode-count" }, solvedTotal ? `${solvedTotal}` : "", solvedTotal ? h("small", null, "solved") : null),
      ),
      h("div", { class: "mode-body" }, resume, h("div", { class: "chips" }, ...chips)),
    );
    cards.set(info.mode, card);
  }

  const streak = progress.streak.days > 1 ? h("div", { class: "streak" }, `${progress.streak.days}-day streak`) : null;

  // After an update it glows, with a badge, until the changelog is opened.
  const settingsBtn = h(
    "button",
    { class: "btn ghost", type: "button", "data-testid": "open-settings", onclick: () => openSettings() },
    svgIcon(ICONS.gear),
    "Settings",
    h("i", { class: "news-badge", "aria-hidden": "true" }, "!"),
  );
  const showNews = () => {
    settingsBtn.classList.toggle("news", hasNews());
    if (hasNews()) settingsBtn.setAttribute("aria-label", "Settings: there's a new version");
    else settingsBtn.removeAttribute("aria-label");
  };
  showNews();
  const offNews = onWhatsNew(showNews);

  const el = h(
    "main",
    { class: "screen home" },
    h(
      "header",
      { class: "home-head" },
      h("h1", { class: "wordmark", "aria-label": "Nonet" }, h("span", null, "NONET"), import.meta.env.VITE_CHANNEL === "beta" ? h("i", { class: "channel" }, "beta") : null),
      h("p", { class: "tagline" }, "Sudoku · Killer · Queens — with a coach that teaches"),
      streak,
    ),
    h("div", { class: "mode-list" }, ...cards.values()),
    h(
      "footer",
      { class: "home-foot" },
      h("button", { class: "btn ghost", type: "button", "data-testid": "open-learn", onclick: () => openLearn() }, svgIcon(ICONS.book), "Learn"),
      h("button", { class: "btn ghost", type: "button", "data-testid": "open-scores", onclick: () => openScores() }, svgIcon(ICONS.trophy), "Scores"),
      settingsBtn,
    ),
  );
  // Open the most recently played mode's card so "Continue" is one tap away.
  const last = load<string | null>("lastMode", null);
  const recent = MODES.find((m) => m.mode === last) ?? MODES.find((m) => loadSaved(m.mode));
  if (recent) {
    open = recent.mode;
    cards.get(recent.mode)!.classList.add("open");
  }
  return { el, destroy: offNews };
}
