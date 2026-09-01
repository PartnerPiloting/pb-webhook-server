#!/bin/bash
# Nightly Linked Helper backup -> Google Drive.
#
# Runs at 02:30, BEFORE the 03:00 maintenance reboot, so the machine is quiet.
# Linked Helper must be CLOSED while we copy - its own backup feature refuses to
# run on an open account for the same reason: the database is being written to.
# Sequence: stop LH -> archive the data dir -> upload -> start LH -> watchdog
# presses "Start campaigns runner" within 5 min.
set -u
. /etc/linked-helper-machine.conf
LOG=/var/log/lh-backup.log
STAMP=$(date +%Y-%m-%d)
WORK=/var/tmp/lh-backup
REMOTE_DIR="gdrive:Linked Helper Backups/${CLIENT_ID}"
KEEP_DAYS=21

say(){ echo "$(date -Is) $*" >> "$LOG"; }

say "=== backup start ==="
say "stopping Linked Helper"
pkill -f "linked-helper" 2>/dev/null
for i in $(seq 1 30); do pgrep -f "linked-helper" >/dev/null || break; sleep 2; done
pgrep -f "linked-helper" >/dev/null && { pkill -9 -f "linked-helper"; sleep 3; }

mkdir -p "$WORK"
ARCHIVE="$WORK/lh-${CLIENT_ID}-${STAMP}.tar.zst"
say "archiving data (caches excluded)"
tar --use-compress-program="zstd -3 -T2" \
    --exclude="*/Cache/*" --exclude="*/Code Cache/*" --exclude="*/GPUCache/*" \
    --exclude="*/DawnCache/*" --exclude="*/DawnGraphiteCache/*" --exclude="*/DawnWebGPUCache/*" \
    --exclude="*/ShaderCache/*" --exclude="*/Crashpad/*" \
    -cf "$ARCHIVE" -C /home/lh .config/linked-helper 2>>"$LOG"
SIZE=$(du -m "$ARCHIVE" | cut -f1)
say "archive built: ${SIZE} MB"

say "uploading to $REMOTE_DIR"
if rclone copy "$ARCHIVE" "$REMOTE_DIR" --drive-chunk-size 32M 2>>"$LOG"; then
  say "upload OK"
  rclone delete "$REMOTE_DIR" --min-age ${KEEP_DAYS}d 2>>"$LOG" && say "pruned copies older than ${KEEP_DAYS}d"
else
  say "UPLOAD FAILED - archive kept locally at $ARCHIVE"
fi
rm -f "$ARCHIVE"

say "restarting Linked Helper"
sudo -u "${LH_USER:-lh}" DISPLAY=:0 nohup "$LH_BIN" --start-account-id="$LH_ACCOUNT_ID" >/dev/null 2>&1 &
say "=== backup done ==="
