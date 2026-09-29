#!/usr/bin/env bash
# Linked Helper machine - open it in a web browser.
#
# Method status: NEW 29 Sep 2026, being proven on one machine (Roland Illyes) before the fleet.
# Replaces the client's Tailscale + Remote Desktop icon. Guy keeps Tailscale + RDP for himself -
# this script touches neither.
#
# WHY: every step the client had to take to reach their own machine was a place to fail. Rick
# Wong's Tailscale signup with a work email landed on a paid trial; Roland Illyes picked "Linux"
# when adding his Windows laptop, so it never joined and his icon said "not available on the
# network" (both 29 Sep 2026). A web link has no install, no account and nothing to keep running.
#
# WHAT IT PUTS ON THE MACHINE:
#   1. noVNC - a web page that shows the machine's ONE screen (the same x11vnc mirror RDP uses,
#      so Guy on RDP and the client in a browser see the same thing at the same time).
#      Served by websockify on 127.0.0.1 ONLY.
#   2. cloudflared - an OUTBOUND tunnel to Cloudflare. No port is opened on this machine.
#      Cloudflare Access sits in front of it: the client types their email, gets a one-time code.
#      Who is allowed is set on the Cloudflare side by scripts/machine-browser-link.js, which also
#      mints the TUNNEL_TOKEN this script needs.
#
# Usage (as root, on a machine already built by setup-ubuntu-vps.sh). Safe to re-run.
#   TUNNEL_TOKEN='eyJ...' bash lh-browser-access.sh
#   bash lh-browser-access.sh            # the web page only, no tunnel - for testing over ssh:
#                                        #   ssh -L 6080:127.0.0.1:6080 root@<machine>
#                                        #   then open http://localhost:6080
#   bash lh-browser-access.sh --remove   # take it all off again

set -euo pipefail

TUNNEL_TOKEN="${TUNNEL_TOKEN:-}"
LH_USER="${LH_USER:-lh}"
WEB_DIR=/usr/local/share/lh-browser
WEB_PORT=6080
VNC_PORT=5900
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }

if [ "${1:-}" = "--remove" ]; then
  systemctl disable --now lh-browser.service 2>/dev/null || true
  rm -f /etc/systemd/system/lh-browser.service
  if command -v cloudflared >/dev/null 2>&1; then
    cloudflared service uninstall 2>/dev/null || true
  fi
  rm -rf "$WEB_DIR"
  systemctl daemon-reload
  echo "browser access removed (noVNC and cloudflared packages left installed; RDP untouched)"
  exit 0
fi

systemctl is-enabled x11vnc.service >/dev/null 2>&1 || {
  echo "x11vnc.service is not on this machine - build it with setup-ubuntu-vps.sh first"; exit 1; }
[ -f "$SRC_DIR/lh-browser-page.html" ] || { echo "lh-browser-page.html must sit beside this script"; exit 1; }

echo "== packages (noVNC + websockify) =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq novnc websockify >/dev/null
[ -f /usr/share/novnc/core/rfb.js ] || { echo "noVNC installed but core/rfb.js is missing"; exit 1; }

echo "== the page =="
# Our own page plus a COPY of noVNC's engine. A copy, not a link to /usr/share/novnc: the folder
# websockify serves should hold exactly what we mean to serve and nothing else.
rm -rf "$WEB_DIR"
install -d -m 750 -o root -g "$LH_USER" "$WEB_DIR"
cp -r /usr/share/novnc/core "$WEB_DIR/core"
[ -d /usr/share/novnc/vendor ] && cp -r /usr/share/novnc/vendor "$WEB_DIR/vendor"
install -m 644 "$SRC_DIR/lh-browser-page.html" "$WEB_DIR/index.html"

# The screen password, for the page to hand to x11vnc. Read from where setup-ubuntu-vps.sh
# already keeps it (xrdp.ini) so nobody has to type it again, and written as JSON by python so a
# password with quotes or backslashes in it survives.
WEB_DIR="$WEB_DIR" python3 - <<'PY'
import json
import os
import re
s = open('/etc/xrdp/xrdp.ini').read()
m = re.search(r'\[LinkedHelperConsole\][^\[]*?\npassword=([^\n]*)', s, flags=re.S)
pw = m.group(1).strip() if m else ''
if not pw or pw == 'ask':
    raise SystemExit('no screen password in /etc/xrdp/xrdp.ini [LinkedHelperConsole] - re-run setup-ubuntu-vps.sh')
path = os.path.join(os.environ['WEB_DIR'], 'machine.json')
with open(path, 'w') as f:
    json.dump({'password': pw}, f)
print('machine.json written')
PY
chown -R root:"$LH_USER" "$WEB_DIR"
chmod -R g+rX,o-rwx "$WEB_DIR"

echo "== websockify (the page + the bridge to the screen, this machine only) =="
cat > /etc/systemd/system/lh-browser.service <<EOF
[Unit]
Description=Linked Helper machine in a web browser (noVNC on 127.0.0.1:$WEB_PORT)
After=x11vnc.service network-online.target
[Service]
User=$LH_USER
ExecStart=/usr/bin/websockify --web=$WEB_DIR 127.0.0.1:$WEB_PORT 127.0.0.1:$VNC_PORT
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable lh-browser.service >/dev/null 2>&1
systemctl restart lh-browser.service
sleep 2
if curl -fsS --max-time 5 "http://127.0.0.1:$WEB_PORT/" | grep -q 'Linked Helper machine'; then
  echo "page is up on 127.0.0.1:$WEB_PORT"
else
  echo "FAILED: the page did not answer on 127.0.0.1:$WEB_PORT - journalctl -u lh-browser"; exit 1
fi
if ss -tln | grep -E ":$WEB_PORT " | grep -v -q '127.0.0.1'; then
  echo "FAILED: port $WEB_PORT is listening on more than this machine - stopping it"
  systemctl disable --now lh-browser.service; exit 1
fi

if [ -z "$TUNNEL_TOKEN" ]; then
  echo
  echo "WARNING: no TUNNEL_TOKEN given - the page is installed but there is NO road to it from"
  echo "         outside. Mint one with: node scripts/machine-browser-link.js <Client-ID>"
  exit 0
fi

echo "== cloudflared (outbound tunnel - nothing is opened inbound) =="
if ! command -v cloudflared >/dev/null 2>&1; then
  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -qq
  apt-get install -y -qq cloudflared >/dev/null
fi
# Re-running with a new token must replace the old one, not fail on "service already installed".
cloudflared service uninstall >/dev/null 2>&1 || true
cloudflared service install "$TUNNEL_TOKEN" >/dev/null
systemctl enable cloudflared >/dev/null 2>&1 || true
sleep 5
if systemctl is-active --quiet cloudflared; then
  echo "tunnel is running"
else
  echo "FAILED: cloudflared is not running - journalctl -u cloudflared"; exit 1
fi

echo
echo "DONE. Open the machine's link in a browser: email, one-time code, then the desktop."
