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

# --- tidy-up: Linked Helper leaves a ~292 MB lh.db.backup.<version>.archived.lhd2
# behind on every self-update and never removes them. Keep the most recent one
# (its safety net if an update goes bad); remove the rest once they are older
# than STALE_DAYS. Also removes our own .imported.lhd2 migration artefact.
# Runs here because Linked Helper is stopped - safe to touch its files.
STALE_DAYS=3
DBDIR=$(dirname "$(find /home/lh/.config/linked-helper -name lh.db -print -quit 2>/dev/null)")
if [ -n "$DBDIR" ] && [ -d "$DBDIR" ]; then
  FREED=0
  # every .archived.lhd2 EXCEPT the newest, if older than STALE_DAYS
  find "$DBDIR" -maxdepth 1 -name "*.archived.lhd2" -printf "%T@ %p
" 2>/dev/null     | sort -rn | tail -n +2 | cut -d" " -f2- | while read -r f; do
        if [ -n "$(find "$f" -mtime +$STALE_DAYS 2>/dev/null)" ]; then
          MB=$(du -m "$f" | cut -f1); rm -f "$f"; say "tidied ${MB} MB: $(basename "$f")"
        fi
      done
  # our own migration artefact
  find "$DBDIR" -maxdepth 1 -name "*.imported.lhd2" -mtime +$STALE_DAYS 2>/dev/null | while read -r f; do
        MB=$(du -m "$f" | cut -f1); rm -f "$f"; say "tidied ${MB} MB: $(basename "$f")"
      done
  # any archive left behind by a failed run
  find /var/tmp/lh-backup -name "*.tar.zst" -mtime +1 -delete 2>/dev/null || true
  say "disk after tidy: $(df -h / | awk "NR==2{print \$5\" used, \"\$4\" free\"}")"
fi

mkdir -p "$WORK"
ARCHIVE="$WORK/lh-${CLIENT_ID}-${STAMP}.tar.zst"
say "archiving data (caches excluded)"
tar --use-compress-program="zstd -3 -T2" --exclude="*/Cache/*" --exclude="*/Code Cache/*" --exclude="*/GPUCache/*" --exclude="*/DawnCache/*" --exclude="*/DawnGraphiteCache/*" --exclude="*/DawnWebGPUCache/*" --exclude="*/ShaderCache/*" --exclude="*/Crashpad/*" --exclude="*/Shared Dictionary/cache/*" --exclude="*/Instances" --exclude="*/Instances/*" --exclude="*.archived.lhd2" --exclude="*.imported.lhd2" -cf "$ARCHIVE" -C /home/lh .config/linked-helper 2>>"$LOG"
SIZE=$(du -m "$ARCHIVE" | cut -f1)
say "archive built: ${SIZE} MB"

# Restart Linked Helper BEFORE uploading. The upload does not need LH stopped,
# and a throttled upload used to hold campaigns down for the whole transfer
# (seen 7 Sep 2026: Google returned rateLimitExceeded and LH stayed down ~30 min).
say "restarting Linked Helper (before the upload, so a slow upload costs no downtime)"
systemd-run --uid="${LH_USER:-lh}" --gid="${LH_USER:-lh}" --setenv=DISPLAY=:0   --unit=lh-after-backup --collect "$LH_BIN" --start-account-id="$LH_ACCOUNT_ID" >/dev/null 2>&1 ||   sudo -u "${LH_USER:-lh}" DISPLAY=:0 setsid "$LH_BIN" --start-account-id="$LH_ACCOUNT_ID" >/dev/null 2>&1 &
LH_RESTARTED=yes

say "uploading to $REMOTE_DIR"
# --timeout/--retries so a throttled transfer fails cleanly instead of hanging.
if timeout 40m rclone copy "$ARCHIVE" "$REMOTE_DIR" --drive-chunk-size 32M      --retries 3 --low-level-retries 10 --timeout 5m --drive-pacer-min-sleep 200ms 2>>"$LOG"; then
  say "upload OK"
  rclone delete "$REMOTE_DIR" --min-age ${KEEP_DAYS}d 2>>"$LOG" && say "pruned copies older than ${KEEP_DAYS}d"
else
  say "UPLOAD FAILED - archive kept locally at $ARCHIVE"
fi
rm -f "$ARCHIVE"

# Safety net: if the restart above somehow did not happen, do it now.
if [ "${LH_RESTARTED:-no}" != "yes" ] || ! pgrep -f "[l]inked-helper" >/dev/null; then
  say "restarting Linked Helper (fallback)"
  sudo -u "${LH_USER:-lh}" DISPLAY=:0 setsid "$LH_BIN" --start-account-id="$LH_ACCOUNT_ID" >/dev/null 2>&1 &
fi
say "=== backup done ==="
