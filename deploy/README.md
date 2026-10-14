# Deploying Nonet

Everything the host needs, so a new server can be stood up from this directory. The live
host is **ktn** (Ubuntu, nginx, a self-hosted GitHub Actions runner), fronted by Cloudflare.

## What runs where

- **Production**: static files from `/opt/services/nonet/dist`, a checkout of this repo that
  `.github/workflows/deploy.yml` moves to each `v*` release tag and builds in place.
- **Beta** (`/beta/`): the same from `/opt/services/nonet-beta/dist`, which
  `deploy-beta.yml` moves to every push to `main` and builds with `VITE_CHANNEL=beta`. The
  workflow creates the clone itself if it is missing.
- **Sync** (`/api/sync/`): one JSON file per player in `/var/lib/nonet-sync/`, served and
  written by nginx's DAV module. No application code; see
  `docs/design/2026-10-14-cross-device-sync.md`. Production and beta share it.
- **nginx**: `nginx/nonet.kautiontape.com.conf` (the site) and `nginx/conf.d/nonet-sync.conf`
  (the sync rate-limit zone). The copies in this repo are the source of truth; `sync-setup.sh`
  installs them.
- **Cleanup**: `systemd/nonet-sync-gc.timer` runs daily and deletes sync files untouched for a
  year. A returning player's device re-uploads from its local copy on the next sync.

## A new server

1. Ubuntu with `nginx` (the Ubuntu package has the DAV module; check with
   `nginx -V 2>&1 | grep dav`), `git`, and the host's shared TLS snippet at
   `/etc/nginx/snippets/ssl-kautiontape.conf` (the certificate for `*.kautiontape.com`; it is
   not Nonet's and lives outside this repo). DNS for `nonet.kautiontape.com` proxied through
   Cloudflare.
2. A GitHub Actions runner registered to the `Kautiontape` org with the label `ktn`, running as
   a user that owns `/opt/services` (on ktn: `shawn`, service
   `actions.runner.Kautiontape.ktn.service`). The workflows use `actions/setup-node`, so the
   host needs no Node of its own. Registration tokens come from GitHub's runner settings page
   and are not stored anywhere.
3. The production checkout:
   ```
   sudo install -d -o shawn -g shawn /opt/services
   git clone https://github.com/Kautiontape/nonet.git /opt/services/nonet
   ```
4. nginx, the sync directory and the timer, from the checkout:
   ```
   sudo /opt/services/nonet/deploy/sync-setup.sh
   ```
   It refuses to run without the DAV module or the TLS snippet, backs up any live site file
   it replaces (`*.bak-<timestamp>` beside it, with a diff), runs `nginx -t`, then reloads.
5. Run `Deploy to production` and `Deploy to beta` by hand once (workflow_dispatch) to build
   both checkouts. After that, tags and pushes to `main` do it.

Check: `https://nonet.kautiontape.com/` serves the app, and
`https://nonet.kautiontape.com/api/sync/0000000000000000000000000000000000000000000000000000000000000000.json`
answers `404` (the location is live, nothing stored under that name).

## Changing the nginx config

Edit the copy in `nginx/`, merge it, then run the script on the host from the checkout that has
the change (`/opt/services/nonet-beta` right after a push to `main`, `/opt/services/nonet`
after a release). Running it from a working copy that was `scp`'d over works too. Host writes
are not something Claude can do from a session; Shawn runs the script.

## Sync storage

- `/var/lib/nonet-sync/<sha256>.json`, owned by `www-data`, mode 750 on the directory. The name
  is the hash of the player's sync code; the code itself never reaches the server.
- Backing it up is copying the directory. Nothing else holds player data.
- A file is a Nonet backup (`{ app, version, exported, data }`), so `cat` shows a player's
  synced state and `jq .data.progress` their scores.
- Limits: 512 KB per PUT, five requests a second per client with a burst of ten, keyed on the
  address Cloudflare reports (`CF-Connecting-IP`).

## Cloudflare

- Cloudflare rewrites `Cache-Control` on JavaScript to `max-age=14400` (both `/sw.js` and
  `/beta/sw.js`) even though nginx sends `no-cache`. Pages, the manifest and JSON under `/api/`
  keep what nginx sends. Known, not a config bug.
- No `set_real_ip_from` is configured for Cloudflare's ranges, so nginx's own
  `$remote_addr` is the edge. The sync zone keys on `CF-Connecting-IP` for that reason; the
  host's general `limit_req_zone` (`/etc/nginx/conf.d/rate-limit.conf`) does not.
