import { applySyncedSettings, clampLimit, DEFAULT_SETTINGS, flagsMistakes, mistakesAllowed, settings, syncedSettings, updateSettings } from "../../src/ui/settings";

describe("mistake rules", () => {
  afterEach(() => updateSettings({ allowMistakes: "yes", mistakeLimit: 3, checkMistakes: true }));

  it("default to allowing mistakes, with 3 ready for Limited", () => {
    expect(DEFAULT_SETTINGS.allowMistakes).toBe("yes");
    expect(DEFAULT_SETTINGS.mistakeLimit).toBe(3);
  });

  it("turn into the number a game forgives; Limited keeps its number across a change of mode", () => {
    expect(mistakesAllowed(settings())).toBeNull();
    updateSettings({ allowMistakes: "limited", mistakeLimit: 5 });
    expect(mistakesAllowed(settings())).toBe(5);
    updateSettings({ allowMistakes: "hardcore" });
    expect(mistakesAllowed(settings())).toBe(0);
    updateSettings({ allowMistakes: "limited" });
    expect(mistakesAllowed(settings())).toBe(5);
  });

  it("a limit keeps mistakes flagged, whatever the toggle says", () => {
    updateSettings({ checkMistakes: false });
    expect(flagsMistakes(settings())).toBe(false);
    updateSettings({ allowMistakes: "limited" });
    expect(flagsMistakes(settings())).toBe(true);
    updateSettings({ allowMistakes: "hardcore" });
    expect(flagsMistakes(settings())).toBe(true);
    expect(settings().checkMistakes).toBe(false); // the player's own choice comes back with Yes
  });

  it("the number stays a whole number from 1 to 99", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-4)).toBe(1);
    expect(clampLimit(2.6)).toBe(3);
    expect(clampLimit(500)).toBe(99);
  });
});

describe("synced settings", () => {
  afterEach(() => updateSettings({ allowMistakes: "yes", mistakeLimit: 3, showTimer: true }));

  it("travel with the mistake rules", () => {
    updateSettings({ allowMistakes: "limited", mistakeLimit: 7 });
    expect(syncedSettings()).toMatchObject({ allowMistakes: "limited", mistakeLimit: 7 });
  });

  it("bring in another device's mistake rules, not just its toggles", () => {
    applySyncedSettings({ allowMistakes: "hardcore", mistakeLimit: 9, showTimer: false }, 5);
    expect(settings()).toMatchObject({ allowMistakes: "hardcore", mistakeLimit: 9, showTimer: false });
  });

  it("leave out what a device can't have meant, and what a device from before them didn't send", () => {
    applySyncedSettings({ allowMistakes: "limited", mistakeLimit: 4 }, 5);
    const bad = { allowMistakes: "sometimes", mistakeLimit: 0, showTimer: "no" } as unknown as Parameters<typeof applySyncedSettings>[0];
    applySyncedSettings(bad, 6);
    applySyncedSettings({ mistakeLimit: 2.5 }, 7);
    applySyncedSettings({ autoNotes: false }, 8);
    expect(settings()).toMatchObject({ allowMistakes: "limited", mistakeLimit: 4, showTimer: true });
  });
});
