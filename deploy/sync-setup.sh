#!/usr/bin/env bash
# Host setup for nonet.kautiontape.com: the nginx site (including the sync location), the sync
# data directory and the cleanup timer. Idempotent. Run as root on the server from a checkout
# of this repo, e.g.  sudo /opt/services/nonet-beta/deploy/sync-setup.sh
# What it assumes about the host is in deploy/README.md.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
site=nonet.kautiontape.com
data=/var/lib/nonet-sync
web_user=www-data

[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo $0" >&2; exit 1; }
case "$(nginx -V 2>&1)" in
  *http_dav_module*) ;;
  *) echo "this nginx lacks the DAV module (nginx -V); the sync location needs it" >&2; exit 1 ;;
esac
[ -f /etc/nginx/snippets/ssl-kautiontape.conf ] || { echo "missing /etc/nginx/snippets/ssl-kautiontape.conf (the host's shared TLS snippet)" >&2; exit 1; }

install -d -o "$web_user" -g "$web_user" -m 750 "$data"

stamp=$(date +%Y%m%d%H%M%S)
changed=() # "dst<tab>backup" for every nginx file this run touched, for rollback

# Install a file if it differs, keeping a dated copy of what was live and showing the change.
put() {
  local src=$1 dst=$2 bak=""
  if [ -f "$dst" ]; then
    cmp -s "$src" "$dst" && return 0
    bak="$dst.bak-$stamp"
    cp -p "$dst" "$bak"
    echo "replacing $dst (previous copy kept at $bak):"
    diff -u "$dst" "$src" || true
  else
    echo "installing $dst"
  fi
  install -m 644 "$src" "$dst"
  changed+=("$dst"$'\t'"$bak")
}

# nginx rejected the new config: put every touched file back as it was, so a later restart
# can't fail on it, and leave the config test's own message as the reason.
rollback() {
  echo "nginx rejected the config; restoring what was live" >&2
  local entry dst bak
  for entry in "${changed[@]}"; do
    dst=${entry%%$'\t'*}
    bak=${entry#*$'\t'}
    if [ -n "$bak" ]; then mv -f "$bak" "$dst"; else rm -f "$dst"; fi
  done
  nginx -t
  exit 1
}

put "$here/nginx/conf.d/nonet-sync.conf" /etc/nginx/conf.d/nonet-sync.conf
put "$here/nginx/$site.conf" "/etc/nginx/sites-available/$site"
ln -sfn "../sites-available/$site" "/etc/nginx/sites-enabled/$site"
nginx -t || rollback
systemctl reload nginx

put "$here/systemd/nonet-sync-gc.service" /etc/systemd/system/nonet-sync-gc.service
put "$here/systemd/nonet-sync-gc.timer" /etc/systemd/system/nonet-sync-gc.timer
systemctl daemon-reload
systemctl enable --now nonet-sync-gc.timer
echo "ok: $data ready, nginx reloaded, nonet-sync-gc.timer enabled"
