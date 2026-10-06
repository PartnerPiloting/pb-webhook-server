#!/usr/bin/env bash
# Linked Helper machine - bring an EXISTING machine up to what a new build gets today.
#
# WHY (6 Oct 2026): improvements kept landing on new builds and on whichever machine they were
# proven on, and the rest of the fleet was updated by hand steps that were then lost (the 30 Sep
# "update an existing machine" script never reached the repo). Matthew Bulat's call showed the
# cost: no copy and paste, no "sign in here" help, and a Google sign-in that could not work.
#
# WHAT IT DOES (as root, on the machine, with the other scripts in this folder beside it):
#   1. The web page + lh-wake (lh-browser-access.sh, no token - the tunnel is left alone):
#      copy and paste, the banners, the Launcher brought back over the Linked Helper website,
#      and a page that reloads itself in any tab already open.
#   2. x11vnc -noprimary - copy and paste needs it (only selecting text must not count as a copy).
#   3. The current watchdog (lh-watchdog.py) - lh-browser-access.sh does not replace it.
#   4. Mozilla's Firefox instead of the Snap (lh-firefox.sh) - so "Sign in with Google" works.
#
# The screen connection restarts, so anyone looking sees a few seconds of "Reconnecting".
# Linked Helper itself keeps running. NEVER run it while a client is on a call on that machine.
#
# From the laptop, use scripts/push-lh-machine-update.sh - it copies this folder over and runs it.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
LH_USER="${LH_USER:-lh}"

echo "== 1. web page + lh-wake =="
LH_USER="$LH_USER" bash "$SRC_DIR/lh-browser-access.sh"

echo "== 2. x11vnc -noprimary =="
UNIT=/etc/systemd/system/x11vnc.service
if grep -q -- "-noprimary" "$UNIT"; then
  echo "already set"
else
  cp -p "$UNIT" "$UNIT.before-update"
  sed -i '/^ExecStart=/ s/$/ -noprimary/' "$UNIT"
  systemctl daemon-reload
  systemctl restart x11vnc
  echo "set, x11vnc restarted"
fi

echo "== 3. watchdog =="
if cmp -s "$SRC_DIR/lh-watchdog.py" /usr/local/bin/lh-watchdog.py; then
  echo "already current"
else
  [ -f /usr/local/bin/lh-watchdog.py ] && cp -p /usr/local/bin/lh-watchdog.py /usr/local/bin/lh-watchdog.py.before-update
  install -m 755 "$SRC_DIR/lh-watchdog.py" /usr/local/bin/lh-watchdog.py
  echo "replaced (old copy: /usr/local/bin/lh-watchdog.py.before-update)"
fi
# The watchdog writes the account number it learns into the machine config.
if [ -f /etc/linked-helper-machine.conf ]; then
  chown root:"$LH_USER" /etc/linked-helper-machine.conf
  chmod 664 /etc/linked-helper-machine.conf
fi

echo "== 4. Firefox =="
LH_USER="$LH_USER" bash "$SRC_DIR/lh-firefox.sh"

echo
echo "DONE - $(hostname): page $(grep -o "PAGE_VERSION = '[0-9][^']*'" /usr/local/share/lh-browser/index.html | head -1)"
