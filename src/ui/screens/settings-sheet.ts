/** Settings as a sheet of tabs (toggles, effects, sync, a save backup) over the version and changelog. */
import type { SyncStatus } from "../../sync/client";
import { formatCode, normalizeCode } from "../../sync/code";
import { versionLabel } from "../changelog";
import { h, svgIcon } from "../dom";
import { ICONS } from "../icons";
import { onSettings, settings, updateSettings, type EffectsLevel, type Settings } from "../settings";
import { sound } from "../sound";
import { backupSolved, makeBackup, parseBackup, restoreBackup, todayKey, type Backup } from "../store";
import { SYNC_AVAILABLE, syncClient, syncCode } from "../sync";
import { openChangelog } from "./changelog";

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type Toggle = { key: BoolKey; label: string; hint?: string };
type TabId = "sound" | "play" | "killer" | "queens" | "data";

const TABS: { id: TabId; label: string }[] = [
  { id: "sound", label: "Sound & feel" },
  { id: "play", label: "Play" },
  { id: "killer", label: "Killer" },
  { id: "queens", label: "Queens" },
  { id: "data", label: "Data" },
];

const TOGGLES: Record<Exclude<TabId, "data">, Toggle[]> = {
  sound: [
    { key: "sfx", label: "Sound effects", hint: "Every move plays a note in the music." },
    { key: "music", label: "Ambient music" },
    { key: "haptics", label: "Haptics", hint: "Vibration on supported phones." },
  ],
  play: [
    { key: "checkMistakes", label: "Flag mistakes instantly", hint: "Explains why a digit is wrong." },
    { key: "autoClearNotes", label: "Auto-remove notes", hint: "Placing a digit clears the notes it rules out." },
    { key: "autoNotes", label: "Show auto-notes", hint: "Digits the rules still allow, under your own notes; tap one in notes mode to strike it." },
    { key: "highlightSame", label: "Highlight matching digits" },
    { key: "showTimer", label: "Show timer" },
  ],
  killer: [
    { key: "cageTint", label: "Tint cages" },
    { key: "showCombos", label: "Show cage combinations", hint: "Lists the sums a selected cage can make." },
  ],
  queens: [{ key: "autoCross", label: "Auto-cross attacked cells", hint: "Shows ✕ where a queen rules cells out." }],
};

export interface SettingsOptions {
  tab?: TabId;
  /** A sync code from a link: open on Data with the join prompt. */
  join?: string;
}

export function openSettings(opts: SettingsOptions = {}): void {
  sound.ui("open");
  // Rows listen for settings that sync brings in while the sheet is open; stopped on close.
  const offs: (() => void)[] = [];
  // Every panel is built once and switched with `hidden`, so a half-done restore survives a tab change.
  const panels: Record<TabId, HTMLElement[]> = {
    sound: [effectsRow(offs), ...TOGGLES.sound.map((t) => toggleRow(t, offs))],
    play: TOGGLES.play.map((t) => toggleRow(t, offs)),
    killer: TOGGLES.killer.map((t) => toggleRow(t, offs)),
    queens: TOGGLES.queens.map((t) => toggleRow(t, offs)),
    data: [...(SYNC_AVAILABLE ? [syncRow(offs, opts.join)] : []), backupRow()],
  };
  const tabs = TABS.map((t) =>
    h("button", { class: "tab", type: "button", role: "tab", id: `set-tab-${t.id}`, "aria-controls": `set-panel-${t.id}`, "data-tab": t.id, onclick: () => show(t.id) }, t.label),
  );
  const panelEls = TABS.map((t) =>
    h("section", { class: "settings-list", role: "tabpanel", id: `set-panel-${t.id}`, "aria-labelledby": `set-tab-${t.id}`, "data-tab": t.id }, ...panels[t.id]),
  );
  const show = (id: TabId) => {
    for (const b of tabs) {
      const on = b.dataset.tab === id;
      b.setAttribute("aria-selected", String(on));
      // On a narrow phone the row scrolls: bring a half-hidden tab fully into view.
      if (on) b.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    for (const p of panelEls) p.hidden = p.dataset.tab !== id;
  };
  const close = () => {
    sound.ui("close");
    overlay.classList.add("closing");
    overlay.addEventListener("animationend", () => overlay.remove(), { once: true });
    removeEventListener("keydown", onKey);
    for (const off of offs) off();
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  addEventListener("keydown", onKey);
  const overlay = h(
    "div",
    { class: "overlay settings", role: "dialog", "aria-label": "Settings", "data-testid": "settings" },
    h("header", { class: "sheet-head" }, h("h2", null, "Settings"), h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, svgIcon(ICONS.close))),
    h("nav", { class: "tabs settings-tabs", role: "tablist", "aria-label": "Settings" }, ...tabs),
    ...panelEls,
    h(
      "footer",
      { class: "settings-foot" },
      h("span", { "data-testid": "version" }, versionLabel()),
      h("button", { class: "link-btn", type: "button", "data-testid": "open-changelog", onclick: () => openChangelog() }, "Changelog"),
    ),
  );
  show(opts.tab ?? "sound");
  document.body.append(overlay);
}

function effectsRow(offs: (() => void)[]): HTMLElement {
  const levels = ["low", "normal", "epic"] as EffectsLevel[];
  const effects = h(
    "div",
    { class: "segmented", role: "radiogroup", "aria-label": "Effects" },
    ...levels.map((lvl) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(settings().effects === lvl),
          onclick: () => {
            updateSettings({ effects: lvl });
            sound.ui("toggle");
          },
        },
        lvl === "low" ? "Calm" : lvl === "normal" ? "Vivid" : "Epic",
      ),
    ),
  );
  const reflect = (s: Settings) => {
    for (const [i, b] of [...effects.children].entries()) b.setAttribute("aria-checked", String(levels[i] === s.effects));
  };
  offs.push(onSettings(reflect));
  return h("div", { class: "set-row" }, h("div", null, h("b", null, "Effects"), h("small", null, "Calm is easiest on battery and motion.")), effects);
}

function toggleRow(r: Toggle, offs: (() => void)[]): HTMLElement {
  const input = h("input", { type: "checkbox", role: "switch", "data-key": r.key }) as HTMLInputElement;
  input.checked = settings()[r.key];
  input.addEventListener("change", () => {
    updateSettings({ [r.key]: input.checked } as Partial<Settings>);
    sound.ui("toggle");
  });
  // A setting sync brings in from another device shows up without reopening the sheet.
  offs.push(onSettings((s) => (input.checked = s[r.key])));
  return h("label", { class: "set-row" }, h("div", null, h("b", null, r.label), r.hint ? h("small", null, r.hint) : null), h("span", { class: "switch" }, input, h("i")));
}

/** "just now", "5 min ago", "3 h ago", or the date. */
function ago(at: number | undefined, now = Date.now()): string {
  if (!at) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * Sync across devices: turn it on here and share the code, or join with a code from another
 * device. While it is on, the row shows the code and the status. Joining merges what is here
 * into the sync; turning off keeps everything here. Messages go in the row (toasts sit under
 * this sheet).
 */
function syncRow(offs: (() => void)[], join?: string): HTMLElement {
  const client = syncClient();
  const status = h("small", { class: "backup-status", role: "status", "data-testid": "sync-status" });
  const body = h("div", { class: "sync-body" });
  const btn = (label: string, testid: string, onclick: () => void, primary = false) =>
    h("button", { class: `btn${primary ? " primary" : ""}`, type: "button", "data-testid": testid, onclick }, label);
  const actions = (...buttons: HTMLElement[]) => h("div", { class: "backup-actions" }, ...buttons);
  const say = (text: string) => (status.textContent = text);
  const statusText = (s: SyncStatus): string => {
    if (s.state === "off") return "";
    if (s.state === "syncing") return "Syncing…";
    if (s.state === "synced") return `Synced ${ago(s.lastSync)}`;
    return s.message ?? "";
  };

  const code = syncCode;

  const showOff = () => {
    say("");
    body.replaceChildren(actions(btn("Turn on", "sync-on", () => void turnOn(), true), btn("Have a code?", "sync-have-code", () => showEntry())));
  };

  const turnOn = async () => {
    body.replaceChildren(actions(h("button", { class: "btn primary", type: "button", disabled: true }, "Turning on…")));
    await client.turnOn();
    showOn();
  };

  const showEntry = (prefill = "", prompt?: string) => {
    const input = h("input", {
      class: "sync-input",
      type: "text",
      autocomplete: "off",
      autocapitalize: "characters",
      spellcheck: "false",
      placeholder: "ABCD-2345-EFGH-6789",
      "aria-label": "Sync code",
      "data-testid": "sync-code-input",
    }) as HTMLInputElement;
    input.value = prefill;
    const joinBtn = btn("Join", "sync-join", () => void doJoin(), true);
    const doJoin = async () => {
      joinBtn.disabled = true;
      say("Joining…");
      const message = await client.join(input.value);
      joinBtn.disabled = false;
      if (message) say(message);
      else showOn();
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && void doJoin());
    say("");
    body.replaceChildren(
      ...(prompt ? [h("p", { class: "sync-prompt" }, prompt)] : []),
      input,
      actions(joinBtn, btn(prompt ? "Not now" : "Cancel", "sync-cancel", () => (client.status().state === "off" ? showOff() : showOn()))),
    );
    if (!prefill) input.focus();
  };

  const showOn = () => {
    const c = code();
    if (!c) return showOff();
    const shown = formatCode(c);
    const link = `${location.origin}${location.pathname}?sync=${c}`;
    const copy = async (text: string, done: string) => {
      try {
        await navigator.clipboard.writeText(text);
        say(done);
      } catch {
        say("Couldn't copy. Select the code and copy it by hand.");
      }
    };
    const share = async () => {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        try {
          await navigator.share({ title: "Nonet sync", text: `Open this on your other device to sync Nonet: ${link}` });
          return;
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
        }
      }
      await copy(link, "Link copied. Open it on your other device.");
    };
    say(statusText(client.status()));
    body.replaceChildren(
      h("code", { class: "sync-code", "data-testid": "sync-code" }, shown),
      actions(
        btn("Copy", "sync-copy", () => void copy(shown, "Code copied.")),
        btn("Share link", "sync-share", () => void share()),
        btn("Turn off", "sync-off", () => showConfirmOff()),
      ),
    );
  };

  const showConfirmOff = () => {
    say("");
    const off = async (deleteCloud: boolean) => {
      await client.turnOff(deleteCloud);
      showOff();
    };
    body.replaceChildren(
      h("p", { class: "sync-prompt" }, "Turn off sync on this device? Your scores, settings and games stay here."),
      actions(
        btn("Keep cloud copy", "sync-off-keep", () => void off(false)),
        btn("Delete it too", "sync-off-delete", () => void off(true)),
        btn("Cancel", "sync-off-cancel", () => showOn()),
      ),
    );
  };

  offs.push(
    client.onStatus((s) => {
      // The status line is the row's while sync is on; while joining or turning on the row manages it.
      if (s.state !== "off" && body.querySelector('[data-testid="sync-code"]')) say(statusText(s));
    }),
  );

  if (join !== undefined) {
    const current = code();
    if (current && current === normalizeCode(join)) showOn();
    else if (current) {
      body.replaceChildren(
        h("p", { class: "sync-prompt" }, "Sync is already on here with another code. Switch to this one? Scores here will be merged into it."),
        actions(btn("Switch", "sync-switch", () => showEntry(join, "Join this sync? Scores here will be merged with it."), true), btn("Not now", "sync-cancel", () => showOn())),
      );
    } else showEntry(join, "Join this sync? Scores here will be merged with it.");
  } else if (code()) showOn();
  else showOff();

  return h(
    "div",
    { class: "set-row sync", "data-testid": "sync-row" },
    h("div", null, h("b", null, "Sync across devices"), h("small", null, "Keep your scores, settings and games in progress the same on every device you play on.")),
    body,
    status,
  );
}

/**
 * Save everything to a file, or restore from one. A restore replaces what's here and loads the
 * page again, so every screen starts from the backup. Toasts sit under this sheet: messages go
 * in the row itself.
 */
function backupRow(): HTMLElement {
  const status = h("small", { class: "backup-status", role: "status", "data-testid": "backup-status" });
  const file = h("input", { type: "file", hidden: true, "data-testid": "restore-file" }) as HTMLInputElement;
  const actions = h(
    "div",
    { class: "backup-actions" },
    h("button", { class: "btn", type: "button", "data-testid": "backup-save", onclick: () => void saveBackup(status) }, svgIcon(ICONS.download), "Save backup"),
    h("button", { class: "btn", type: "button", "data-testid": "backup-restore", onclick: () => file.click() }, svgIcon(ICONS.upload), "Restore…"),
  );
  const confirm = h("div", { class: "backup-confirm", hidden: true });
  const ask = (b: Backup) => {
    const when = new Date(b.exported);
    const solved = backupSolved(b);
    confirm.replaceChildren(
      h(
        "p",
        null,
        `Replace everything here with the backup${Number.isNaN(when.getTime()) ? "" : ` from ${when.toLocaleDateString(undefined, { dateStyle: "medium" })}`}`,
        ` (${solved} solved)? Scores, settings and games in progress are all swapped for it.`,
      ),
      h(
        "div",
        { class: "backup-actions" },
        h("button", { class: "btn", type: "button", onclick: () => show(false) }, "Cancel"),
        h(
          "button",
          {
            class: "btn primary",
            type: "button",
            "data-testid": "restore-confirm",
            onclick: () => {
              if (!restoreBackup(b)) return show(false, "This browser wouldn't let Nonet save. Nothing was restored.");
              // A plain load of the page: a ?play= link would start a game and save over the backup.
              location.assign(`${location.pathname}?restored`);
            },
          },
          "Replace",
        ),
      ),
    );
    show(true);
  };
  const show = (asking: boolean, message = "") => {
    actions.hidden = asking;
    confirm.hidden = !asking;
    status.textContent = message;
  };
  file.addEventListener("change", async () => {
    const picked = file.files?.[0];
    file.value = ""; // so picking the same file again still fires
    if (!picked) return;
    const b = parseBackup(await picked.text());
    if (b) ask(b);
    else show(false, "That file isn't a Nonet backup this version can read.");
  });
  return h(
    "div",
    { class: "set-row backup" },
    h(
      "div",
      null,
      h("b", null, "Your progress"),
      h("small", null, "Scores, settings and games in progress are saved in this browser. Save a backup file to keep them safe, or to move them without sync."),
    ),
    actions,
    confirm,
    status,
    file,
  );
}

/** The share sheet on a phone (save to Files or Drive, or send it on), a download elsewhere. */
async function saveBackup(status: HTMLElement): Promise<void> {
  const name = `nonet-backup-${todayKey()}.json`;
  const file = new File([JSON.stringify(makeBackup())], name, { type: "application/json" });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      /* sharing refused: download it instead */
    }
  }
  const url = URL.createObjectURL(file);
  const a = h("a", { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  status.textContent = `Saved ${name}.`;
}
