#!/bin/bash
#
# Wingguy extension updater - macOS.
#
# Same design as wingguy-update.ps1 (read that header for WHY this lane exists); only the
# mechanisms differ: launchd instead of Task Scheduler, ~/Wingguy instead of C:\Wingguy, curl
# instead of Invoke-WebRequest.
#
# NO JSON PARSER IS USED. Modern macOS ships no guaranteed python3 (it needs the Command Line
# Tools) and installing anything on a client machine would defeat the point of this lane, so the
# server offers a plain-line listing at ?format=text that `while read` handles natively.
#
# INSTALL (Guy does this once, over remote access - the client never runs anything):
#   chmod +x wingguy-update.sh
#   ./wingguy-update.sh --install --server "https://pb-webhook-server.onrender.com" --token "<portal token>"
#
# Then load ~/Wingguy into the browser once (developer mode -> Load unpacked) and open their
# portal once in that browser to sign the extension in.
#
# ⚠ UNPROVEN ON A REAL MAC as at 2026-09-03 - written from the proven Windows version, but the
# only Mac in the client base is Julian's. Walk it with him before sending it to anyone.

set -uo pipefail

SERVER="https://pb-webhook-server.onrender.com"
TOKEN=""
FOLDER="$HOME/Wingguy"
INSTALL=0
FORCE=0
LABEL="com.wingguy.update"

while [ $# -gt 0 ]; do
  case "$1" in
    --install) INSTALL=1; shift ;;
    --force)   FORCE=1; shift ;;
    --server)  SERVER="$2"; shift 2 ;;
    --token)   TOKEN="$2"; shift 2 ;;
    --folder)  FOLDER="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

SUPPORT_DIR="$HOME/Library/Application Support/Wingguy"
LOG_FILE="$SUPPORT_DIR/update.log"

log() {
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S')  $*"
  echo "$line"
  mkdir -p "$SUPPORT_DIR" 2>/dev/null
  echo "$line" >> "$LOG_FILE" 2>/dev/null || true   # logging must never fail a run
}

local_version() {
  local m="$FOLDER/manifest.json"
  [ -f "$m" ] || { echo ""; return; }
  # One field out of a small JSON file - a grep is honest here and needs no interpreter.
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$m" | head -1
}

checkin() {
  # Monitoring only. A machine that stops checking in is the signal we want - but a failed
  # check-in must never fail the update itself.
  local version="$1" action="$2" note="${3:-}"
  curl -sS -m 20 -X POST "$SERVER/extension/dist/checkin" \
    -H "x-portal-token: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"version\":\"$version\",\"action\":\"$action\",\"agent\":\"macos-sh\",\"machine\":\"$(scutil --get ComputerName 2>/dev/null || hostname)\",\"note\":\"$note\"}" \
    >/dev/null 2>&1 || log "check-in failed (ignored)"
}

# ---------------------------------------------------------------- install ----
if [ "$INSTALL" = "1" ]; then
  [ -n "$TOKEN" ] || { echo "--token is required when installing" >&2; exit 2; }

  log "Installing Wingguy updater -> $FOLDER"
  mkdir -p "$FOLDER" "$SUPPORT_DIR"

  # Keep the script beside its data so launchd has a stable path, and so a client who goes
  # looking can see exactly what runs on their machine.
  INSTALLED="$SUPPORT_DIR/wingguy-update.sh"
  cp "$0" "$INSTALLED"
  chmod +x "$INSTALLED"

  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$INSTALLED</string>
    <string>--server</string><string>$SERVER</string>
    <string>--token</string><string>$TOKEN</string>
    <string>--folder</string><string>$FOLDER</string>
  </array>
  <!-- RunAtLoad covers the laptop that was shut at 3am; launchd also runs a missed
       StartCalendarInterval at the next opportunity, so a missed run is a delay, not a failure. -->
  <key>RunAtLoad</key><true/>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$SUPPORT_DIR/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$SUPPORT_DIR/launchd.err.log</string>
</dict>
</plist>
PLISTEOF

  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  # Verify rather than assume - the Windows equivalent silently claimed success when
  # registration was denied (found by testing 2026-09-03), and launchctl can fail just as
  # quietly. An install that cannot schedule itself must fail loudly, not look perfect.
  if ! launchctl list | grep -q "$LABEL"; then
    log "ERROR: launchd job '$LABEL' did not load - the extension would never update itself."
    exit 1
  fi
  log "launchd job '$LABEL' loaded and verified (daily 3am + at login)"

  # Prove it works before walking away - the whole point of installing this in person.
  "$INSTALLED" --server "$SERVER" --token "$TOKEN" --folder "$FOLDER" --force
  log "Install complete. Now load $FOLDER into the browser (developer mode -> Load unpacked)."
  exit 0
fi

# ----------------------------------------------------------------- update ----
[ -n "$TOKEN" ] || { echo "--token is required" >&2; exit 2; }

LISTING="$(curl -sS -m 60 -H "x-portal-token: $TOKEN" "$SERVER/extension/dist?format=text")" || {
  log "ERROR: could not reach the server"
  checkin "$(local_version)" "error" "server unreachable"
  exit 1
}

REMOTE_VERSION="$(echo "$LISTING" | sed -n 's/^version //p' | head -1)"
LOCAL_VERSION="$(local_version)"
log "server=${REMOTE_VERSION:-unknown} local=${LOCAL_VERSION:-none}"

if [ -z "$REMOTE_VERSION" ]; then
  log "ERROR: no version in the listing (token rejected?)"
  checkin "$LOCAL_VERSION" "error" "no version in listing"
  exit 1
fi

if [ "$LOCAL_VERSION" = "$REMOTE_VERSION" ] && [ "$FORCE" = "0" ]; then
  checkin "$LOCAL_VERSION" "current"
  log "Already current - nothing to do."
  exit 0
fi

# Download EVERYTHING to a staging folder first. Writing in place only starts once we know the
# whole set arrived, so a dropped connection can never leave a half-updated extension.
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/wingguy.XXXXXX")"
cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT

COUNT=0
while read -r kind bytes relpath; do
  [ "$kind" = "file" ] || continue
  dest="$STAGING/$relpath"
  mkdir -p "$(dirname "$dest")"
  encoded="$(printf '%s' "$relpath" | sed 's:/:%2F:g')"
  if ! curl -sS -m 60 -H "x-portal-token: $TOKEN" -o "$dest" "$SERVER/extension/dist/file?path=$encoded"; then
    log "ERROR: download failed for $relpath"
    checkin "$LOCAL_VERSION" "error" "download failed: $relpath"
    exit 1
  fi
  got="$(wc -c < "$dest" | tr -d ' ')"
  if [ "$got" != "$bytes" ]; then
    log "ERROR: size mismatch on $relpath (got $got, expected $bytes)"
    checkin "$LOCAL_VERSION" "error" "size mismatch: $relpath"
    exit 1
  fi
  COUNT=$((COUNT + 1))
done <<< "$LISTING"

log "staged $COUNT file(s)"
mkdir -p "$FOLDER"

# manifest.json goes LAST and on its own. If anything interrupts the copy, the version on disk
# still reads as the OLD one, so the next run simply tries again. Self-correcting.
( cd "$STAGING" && find . -type f ! -name manifest.json -print0 | while IFS= read -r -d '' f; do
    mkdir -p "$FOLDER/$(dirname "${f#./}")"
    cp -f "$f" "$FOLDER/${f#./}"
  done )
cp -f "$STAGING/manifest.json" "$FOLDER/manifest.json"

NOW="$(local_version)"
log "updated to $NOW"
checkin "$NOW" "updated"
