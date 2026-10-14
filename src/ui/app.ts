/**
 * App shell: owns the global layers (nebula background, FX canvas, callouts, toasts), swaps
 * screens, and applies each mode's stage theme.
 */
import type { Difficulty } from "../engine/types";
import type { Mode } from "../game/packs";
import type { Background } from "./fx/background";
import type { Fx } from "./fx/particles";
import { applyTheme, THEMES, type ThemeName } from "./palette";
import { onSettings, settings } from "./settings";
import { sound } from "./sound";
import { save } from "./store";

export interface Screen {
  el: HTMLElement;
  destroy(): void;
}

export const MODE_THEME: Record<Mode, ThemeName> = { classic: "abyss", killer: "ember", queens: "aurora" };

export { clearSaved, loadSaved, storeSaved, type ClearedGame, type SavedGame } from "./store";

type ScreenFactory = (app: App) => Screen | Promise<Screen>;

export class App {
  private current: Screen | null = null;
  private kind: "home" | "play" | null = null;
  private factories: {
    home?: ScreenFactory;
    play?: (app: App, mode: Mode, difficulty: Difficulty, resume: boolean, avoid?: string, board?: string) => Promise<Screen>;
  } = {};

  constructor(
    readonly root: HTMLElement,
    readonly fx: Fx,
    readonly bg: Background,
  ) {
    const apply = () => {
      const st = settings();
      fx.setLevel(st.effects);
      bg.setAnimated(st.effects !== "low");
      sound.setSettings({ sfx: st.sfx, music: st.music, volume: st.volume });
      document.documentElement.dataset.effects = st.effects;
    };
    apply();
    onSettings(apply);
  }

  register(f: App["factories"]): void {
    Object.assign(this.factories, f);
  }

  theme(name: ThemeName): void {
    applyTheme(name);
    this.bg.setTheme(name);
    this.fx.setMoteColors([...THEMES[name].accents]);
    if (name !== "prism") sound.setTheme(name);
  }

  mount(screen: Screen, theme: ThemeName): void {
    this.current?.destroy();
    this.current = screen;
    this.root.replaceChildren(screen.el);
    this.theme(theme);
    window.scrollTo(0, 0);
  }

  async home(): Promise<void> {
    const s = await this.factories.home!(this);
    this.mount(s, "prism");
    this.kind = "home";
    this.bg.setIntensity(0.15);
  }

  /** Build the home screen again if it is showing: after sync brings scores or a game in progress from another device. */
  refreshHome(): void {
    if (this.kind === "home") void this.home();
  }

  /** Open a game: the saved one (`resume`), the board with id `board`, or a new pick that isn't `avoid`. */
  async play(mode: Mode, difficulty: Difficulty, resume = false, avoid?: string, board?: string): Promise<void> {
    // Tear down first so the old screen's final save can't overwrite the new game's.
    this.current?.destroy();
    this.current = null;
    this.kind = null;
    try {
      const s = await this.factories.play!(this, mode, difficulty, resume, avoid, board);
      this.mount(s, MODE_THEME[mode]);
      this.kind = "play";
      save("lastMode", mode);
    } catch (err) {
      console.error(err);
      await this.home();
      this.onError?.("Couldn't load that puzzle pack.");
    }
  }

  onError?: (message: string) => void;
}
