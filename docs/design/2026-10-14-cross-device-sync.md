# Sync across devices

*Design, 2026-10-14. Decided in a brainstorm with Shawn; this file is the why. Build from it.*

## Problem

People play on a phone and on a computer and want the same scores, streak, settings and
half-finished puzzles on both. Today everything lives in one browser's `localStorage` and the
only way across is Settings → Data → Save backup, then Restore on the other device, which
replaces everything there. The spec lists cloud sync under non-goals; this moves it out. Accounts
stay a non-goal.

Two facts shape the design:

- **Nobody plays on two devices at once.** So the server needs no compare-and-swap, no versions,
  no retry loops. A plain GET and PUT of one file is enough.
- **The app works offline** (installed PWA, service worker). So two devices *do* diverge: five
  puzzles solved on the phone on a plane, two on the laptop that evening. "Last push wins" would
  lose one batch. The merge that handles this is pure client code, cheap, and property-testable.

## Decisions

**Identity is a sync code, not an account.** "Turn on sync" generates a random secret (16
Crockford base32 characters in four groups, 80 bits from `crypto.getRandomValues`). Other devices
join by opening a link that carries it or typing it. Possession is the whole authorisation. The
server holds no user table, no email, no session; losing the code and every device orphans the
cloud copy, local data is never touched, and turning sync on again starts a fresh one.
Alternatives considered: email magic links (needs a sender with deliverability, sessions, and
holding addresses for a sudoku game), sign in with Google/Apple/GitHub (a registration per
provider plus token validation), the player's own cloud drive (one OAuth integration per
provider, token refresh inside a PWA, only helps players on that provider). If accounts ever
arrive, an account simply owns a sync code.

**The server is an nginx location on ktn, no application code.** Its nginx has the DAV module
compiled in; Node is not on the path there. One file per player under `/var/lib/nonet-sync/`,
named by the SHA-256 of the code with a fixed prefix (computed on the device, so the secret never
goes over the wire or into access logs). Alternatives considered: a ~150-line Node service (real
compare-and-swap and content validation, but a runtime to install and a unit to run, for
guarantees we don't need), a Cloudflare Worker with a Durable Object (nothing to run on ktn and
sync survives ktn outages, but wrangler, an API token in Actions and a second deploy path), a
managed backend (only earns its weight for real accounts).

**The cloud copy is a backup file.** Same `{ app, version, exported, data }` shape that Save
backup writes, minus device-only keys. `makeBackup` / `parseBackup` are reused, so the cloud
format gets a reader, a writer and validation for free. The backup version goes 1 → 2 because
the stored shapes of progress and autosaves change (below); migration runs on load whatever the
source, so old backups still restore.

**Merging is a join, key by key.** Every rule gives the same answer in any order and merging a
copy with itself changes nothing. That is what "consistent" means here, and what the property
tests check.

**Counters are per device.** Total solves and per-technique hint counts can't be unioned or
maxed across devices without undercounting. Stored as `counters[deviceId] = { total, hinted }`;
each device bumps only its own entry; the merge takes the max per device, which is exact.
`loadProgress()` keeps returning `total` and `hinted` as sums, so the home and Learn screens
don't change. Alternative: plain max on plain numbers (no migration, undercounts when both
devices played unsynced). Rejected: the whole point is that the numbers agree.

**Cleared games leave tombstones.** Finishing a puzzle removes its autosave today. Under a union
that absence would let the other device's stale copy of the same game come back. So clearing a
slot writes `{ clearedAt }` and the resume path reads that as nothing.

**No encryption in v1.** The server operator (Shawn) can read a player's sudoku stats. Blobs are
small JSON files you can `cat`, which is worth more while this is new. The blob carries a
`version`, so client-side encryption keyed from the code can be added later without a new
endpoint.

## What syncs

| Key | Synced | Merge rule |
| --- | --- | --- |
| `progress.solved` | yes | union of ids per mode-difficulty |
| `progress.best` | yes | minimum per mode-difficulty |
| `progress.streak` | yes | later `last` wins; same day, larger `days` |
| `progress.counters` | yes | per device, per field maximum |
| `results` | yes | union keyed by `id@at`, sorted by `at` desc then key, cap 300 |
| `seen` | yes | union |
| `settings` (gameplay subset) | yes | whole subset, later `settingsAt` wins |
| `game.classic` / `game.killer` / `game.queens` | yes | later time wins; a save has `savedAt`, a tombstone `clearedAt` |
| `settings` (feel subset) | no | sound, music, volume, haptics, effects stay per device |
| `lastMode`, `device`, `sync` | no | device-local |

The gameplay subset: `highlightSame`, `autoClearNotes`, `autoNotes`, `checkMistakes`,
`showTimer`, `cageTint`, `showCombos`, `autoCross`.

The cap on results is safe: anything dropped from a union of two sides is below the 300th entry
of any larger union too, so capping early and late give the same top 300.

Later-wins trusts device clocks. Fine for one person moving between their own devices.

### Storage changes

- `Progress` gains `counters: Record<string, { total: number; hinted: Record<string, number> }>`.
  `total` and `hinted` on the loaded object are sums. `recordSolve` / `recordHint` bump
  `counters[deviceId]`. Legacy top-level `total` / `hinted` migrate into this device's entry on
  first load and are no longer stored.
- `device`: a random id (8 bytes hex) made on first run. **Excluded from backups**, so a backup
  restored onto another device freezes the old device's counts under the old id and the new
  device counts under its own. No double counting either way.
- `SavedGame` gains `savedAt` (set by `storeSaved`). `clearSaved` writes `{ clearedAt }`;
  `loadSaved` returns null for a tombstone.
- `settings.ts` stores `settingsAt` (in the store, not on the `Settings` object) whenever a
  synced key changes. Applying merged settings goes through an internal path that does not stamp
  it, so two devices can't ping-pong.
- `sync` config: `{ code, etag?, lastSync?, pending: boolean, error?: string }`. Included in
  backups (the file is the player's own; a restored backup is already paired).
- The restore path keeps replacing everything, then the next sync merges the cloud copy back in.

## Server

```nginx
# /etc/nginx/sites-available/nonet.kautiontape.com, inside the server block
location ~ ^/api/sync/([0-9a-f]{64})\.json$ {
    alias /var/lib/nonet-sync/$1.json;
    dav_methods PUT DELETE;
    dav_access user:rw group:r;
    limit_except GET HEAD PUT DELETE { deny all; }
    client_max_body_size 512k;
    limit_req zone=sync burst=10 nodelay;
    add_header Cache-Control "no-store" always;
}
```

- Only 64-hex names resolve, so nothing else on disk is reachable and the directory can't be
  listed. The directory is owned by `www-data`.
- GET returns the file with an ETag (nginx's, from mtime and size) or 404 before the first push.
  HEAD gives the ETag after a PUT (nginx's PUT reply carries none). PUT replaces the file; nginx
  writes to a temp file and renames, so a reader never sees a half-written blob. DELETE is "turn
  off sync and forget the cloud copy".
- `limit_req_zone` for `sync`: key it on `$http_cf_connecting_ip`, since Cloudflare fronts the
  site and the existing `general` zone keys on the edge's address. A few requests per second per
  player with a burst of ten is generous for a debounced client.
- A systemd timer runs `find /var/lib/nonet-sync -name '*.json' -mtime +365 -delete` daily. A
  player who comes back later re-uploads from local on the next sync (the client treats 404 as
  "nothing in the cloud", not as an error).
- Beta (`/beta/`) and production share the location: same origin, same files. The client refuses
  a blob whose `version` is above its own (status "Update Nonet to sync") and never pushes over
  it, so an old production build can't clobber what a newer beta wrote.
- Cloudflare: PUT and 304 pass through; `no-store` keeps it out of the cache. (Cloudflare does
  rewrite cache headers on JavaScript, see the deploy notes; JSON under `/api/` is not affected.)
- Setup is one idempotent script (location block, directory, zone, timer) that Shawn runs over
  SSH; host writes are blocked for Claude. Nothing in the deploy workflows changes. The script
  lives in the repo under `deploy/`.

What this gives up, knowingly: no compare-and-swap (unneeded, see Problem) and no server-side
validation beyond size (every reader validates; an invalid blob is ignored and overwritten by the
next good push).

## Client

New `src/sync/`, **pure TypeScript like `engine/` and `game/`**: no DOM, no `window`, fetch and
storage access passed in. Add that to the rules in `CLAUDE.md` and the map in
`docs/ARCHITECTURE.md`.

- `merge.ts`: `merge(a: Data, b: Data): Data` over the backup's `data` map, the rules above.
- `code.ts`: generate, normalise (any case, dashes optional), validate, format for display,
  `bucketId(code)` = hex SHA-256 of `"nonet-sync:" + code` via `crypto.subtle` (present in Node
  and browsers).
- `client.ts`: the cycle, with `fetch`, a store adapter and a clock injected.

### The cycle

One at a time; a trigger during a run queues exactly one more.

1. GET `/api/sync/<id>.json`, with `If-None-Match` when an ETag is known. 304: nothing new.
   404: nothing in the cloud yet. Unparseable or wrong `app`: treat as empty. `version` above
   ours: stop, status "Update Nonet to sync", push nothing.
2. `merged = merge(local, remote)`. If it differs from local, write it key by key (without
   marking pending) and emit `change`.
3. PUT the merged blob if `pending` or the cloud copy was missing, then HEAD for the new ETag.
   Clear `pending` on success; keep it on failure.

### Triggers

App start, `visibilitychange` to visible, the `online` event, and any write to a synced key,
debounced ~2 s so a burst of moves is one push. On `pagehide`, a final `fetch(..., { keepalive:
true })` push if pending. No polling timers. A failed cycle sets a status and waits for the next
trigger; a network error reads as "Offline, will sync later", any other failure as "Couldn't
sync". Nothing ever blocks play; the only place a failure shows is the Settings row.

### Mid-game

A play screen keeps its in-memory game and autosaves it with a fresh `savedAt`, so a pull during
play never swaps the puzzle under the player and the local game wins the next merge. Finishing a
puzzle writes a tombstone stamped now, which beats the other device's older autosave. The home
screen subscribes to `change` and refreshes Continue, the streak and Scores. Merged settings are
applied through the non-stamping path and the usual listeners fire.

## UI: Settings → Data, above Backup

- **Off.** Row "Sync across devices": "Keep scores, settings and games in progress the same on
  every device you play on." Buttons *Turn on* and *Have a code?*.
- **Turn on.** Makes the code, saves the config, pushes the first blob, then shows the code large
  in its four groups with *Copy* and *Share link*. The link is the site root with `?sync=CODE`,
  through the same share sheet Backup uses, falling back to copy. A status line under it:
  "Synced just now" (relative time afterwards), "Offline, will sync later", "Couldn't sync",
  "Update Nonet to sync". *Turn off* below.
- **Have a code?** An input that takes any case with or without dashes. Joining requires the
  cloud copy to exist: a 404 shows "No sync found for that code. Check it and try again." and
  pushes nothing, which catches typos without a check digit. On success the local data merges in
  (so a device with its own history keeps it), the sheet shows the code and status, the home
  screen refreshes.
- **Opening a sync link** (`?sync=CODE`) asks "Join this sync? Scores here will be merged with
  it." with *Join* and *Not now*, then strips the parameter with `history.replaceState`. If sync
  is already on with another code, it says so and offers to switch; switching merges local into
  the new one and leaves the old cloud copy alone.
- **Turn off** keeps everything local and asks whether to delete the cloud copy too: *Keep cloud
  copy* / *Delete it too*.
- The line under Backup changes from "live in this browser only" to say sync exists.
- Not in v1: a QR code (would be the project's first runtime dependency; typing 16 characters
  works), a sync indicator outside Settings, a prompt to turn sync on.

## Testing

- `tests/sync/merge.test.ts`: fast-check properties on generated `Data` (idempotent, commutative,
  associative, sets compared as sets) plus fixtures: tombstone beats an older save, a newer save
  beats a tombstone, counters sum across devices, results cap, streak same-day, settings subset
  later-wins, unknown keys pass through untouched.
- `tests/sync/code.test.ts`: round trip, normalisation, rejection of bad lengths and characters,
  bucket id is stable and 64 hex.
- `tests/sync/client.test.ts` with a fake fetch: 404 → push; 200 → merge, write, push only when
  pending; 304 → nothing; newer version → no push and the status; network error → pending kept and
  the status; one cycle at a time with a queued rerun.
- `tests/ui/backup.test.ts`: legacy progress migrates into `counters[device]`, device excluded
  from the backup, version 2 restores, version 1 still restores.
- Playwright: route `**/api/sync/*` to an in-memory map implementing GET/HEAD/PUT/DELETE with
  ETags. Two browser contexts: A turns on sync and solves (or is seeded through `localStorage`),
  B joins with A's code and sees A's record in Scores; B flips a gameplay setting, A reloads and
  has it; B's effects level is untouched; a wrong code is refused with the message; a sync link
  shows the join prompt.
- Manual, once: the nginx script on ktn, then a real phone and laptop, including a solve made
  with the phone in airplane mode.

## Rollout

1. Merge, code, client and storage changes with tests (no UI yet). `npm run check` green.
2. Settings UI and the link flow; the e2e spec.
3. The `deploy/` script, run on ktn by Shawn; verify against `/beta/` first, since every push to
   main deploys there and the location is shared.
4. `CHANGELOG.md`: one bullet under Unreleased. `docs/SPEC.md`: a Sync paragraph in §6 and cloud
   sync out of §7. `docs/MILESTONES.md`. `docs/ARCHITECTURE.md`: `src/sync/` and the server note.
5. Tag a release.

## Open points, deliberately deferred

- QR pairing (needs an encoder).
- Client-side encryption keyed from the code (bump the blob version).
- Real client IPs in nginx (`set_real_ip_from` for Cloudflare's ranges) if the per-IP limit ever
  matters beyond this location.
