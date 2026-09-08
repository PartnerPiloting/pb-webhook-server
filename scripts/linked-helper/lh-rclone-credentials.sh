#!/bin/bash
# Install our own Google client_id/secret + a matching token into this
# machine's rclone config, replacing whatever was there. Run as root.
#
# Why: rclone's built-in shared client_id is rate-limited across every rclone
# user worldwide and is being retired during 2026. Uploads were refused on
# 7 Sep 2026 because of it.
#
# The three values are typed/pasted by the person running this, never put on
# a command line or in chat:
#   sudo lh-rclone-credentials.sh
# Get them first, on a laptop with a browser:
#   rclone authorize "drive" "<client_id>" "<client_secret>"
# and copy the token JSON it prints (the {...} block, one line).
set -u
CONF=/root/.config/rclone/rclone.conf
read -r -p "client_id: " CID
read -r -s -p "client_secret: " CSEC; echo
read -r -p "token JSON (one line, starts with {): " TOKEN
[ -n "$CID" ] && [ -n "$CSEC" ] && [ "${TOKEN:0:1}" = "{" ] || { echo "missing or malformed value - nothing changed"; exit 1; }
install -d -m 700 /root/.config/rclone
[ -f "$CONF" ] && cp "$CONF" "$CONF.bak-$(date +%F-%H%M)"
{
  printf '[gdrive]\ntype = drive\nscope = drive\n'
  printf 'client_id = %s\nclient_secret = %s\n' "$CID" "$CSEC"
  printf 'token = %s\n' "$TOKEN"
} > "$CONF"
chmod 600 "$CONF"
echo "written. testing..."
if rclone lsd "gdrive:Linked Helper Backups" >/dev/null 2>&1; then
  echo "OK - Drive reachable with the new credentials"
else
  echo "FAILED - restoring the previous config"; cp "$CONF".bak-* "$CONF" 2>/dev/null; exit 1
fi
