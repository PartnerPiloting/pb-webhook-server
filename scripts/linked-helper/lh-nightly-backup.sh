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
KEEP_DAYS=28         # weekly folder copies: four of them
KEEP_LHD2=7          # nightly supported-format exports kept in <client>/lhd2
# Day for the full folder copy (ISO weekday, 7 = Sunday). Decided 8 Sep 2026: a
# folder copy and an export are the SAME size (~300 MB), the folder copy only adds
# the saved LinkedIn session, and a week-old session is nearly as good as a
# day-old one - so the export goes nightly and the folder copy weekly. That also
# halves the upload most nights, which is what Google throttles on.
TAR_WEEKDAY="${TAR_WEEKDAY:-7}"
# Where Linked Helper publishes its launcher package (the setup script installs from the same URL).
LH_DEB_URL="${LH_DEB_URL:-https://do0ca1hx6twig.cloudfront.net/linked-helper/444657160c922f6b8048468fef840020/latest/linux/x64/linked-helper.deb}"

say(){ echo "$(date -Is) $*" >> "$LOG"; }

say "=== backup start ==="

# Hold the watchdog off for the duration. It starts Linked Helper whenever it
# sees no instance window, and this job now keeps LH down for ~2.5 min (the
# export) rather than the ~15 s it used to - comfortably inside the watchdog's
# 5-minute cycle. An instance opening mid-export would break it, since the
# export refuses while one is running. The trap puts the timer back whatever
# happens, including on a crash.
restore_watchdog(){ systemctl start lh-watchdog.timer 2>/dev/null && say "watchdog timer restored"; }
trap restore_watchdog EXIT INT TERM
systemctl stop lh-watchdog.timer 2>/dev/null && say "watchdog timer held off"

say "stopping Linked Helper"
pkill -f "linked-helper" 2>/dev/null
for i in $(seq 1 30); do pgrep -f "linked-helper" >/dev/null || break; sleep 2; done
pgrep -f "linked-helper" >/dev/null && { pkill -9 -f "linked-helper"; sleep 3; }

# --- tidy-up: Linked Helper leaves a ~292 MB lh.db.backup.<version>.archived.lhd2
# behind on every self-update and never removes them. Keep the most recent one
# (its safety net if an update goes bad); remove the rest once they are older
# than STALE_DAYS. Also removes our own .imported.lhd2 migration artefact.
# Runs here because Linked Helper is stopped - safe to touch its files.
#
# The newest .archived.lhd2 is ALSO the only supported-format backup we get for
# free: Linked Helper writes it itself (doAutoBackup) on every self-update. Unlike
# our tar it is the artefact LH accepts back on a rebuild, and the one a client
# could take elsewhere. Uploaded below, AFTER Linked Helper is back up.
STALE_DAYS=3
LHD2_SRC=""
DBDIR=$(dirname "$(find /home/lh/.config/linked-helper -name lh.db -print -quit 2>/dev/null)")
if [ -n "$DBDIR" ] && [ -d "$DBDIR" ]; then
  FREED=0
  # newest .archived.lhd2 - kept on disk, and uploaded after the restart
  LHD2_SRC=$(find "$DBDIR" -maxdepth 1 -name "*.archived.lhd2" -printf "%T@ %p
" 2>/dev/null              | sort -rn | head -1 | cut -d" " -f2-)
  [ -n "$LHD2_SRC" ] && say "supported-format export on disk: $(basename "$LHD2_SRC") ($(du -m "$LHD2_SRC" | cut -f1) MB)"
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
  find /var/tmp/lh-backup -name "*.lhd2" -mtime +1 -delete 2>/dev/null || true
  say "disk after tidy: $(df -h / | awk "NR==2{print \$5\" used, \"\$4\" free\"}")"
fi

mkdir -p "$WORK"

# --- keep the LAUNCHER current. Linked Helper is two programs: the instance
# (runs campaigns) updates itself fine; the launcher is a system package the
# app cannot replace as an ordinary user, so it sits on its install version
# saying "downloading update" forever. This job runs as root with LH stopped -
# the one safe moment - so fetch the vendor's latest and install it if newer.
# wget -N only re-downloads when the file has changed upstream. Never fatal.
# Off switch: LH_UPGRADE_LAUNCHER=no in /etc/linked-helper-machine.conf.
if [ "${LH_UPGRADE_LAUNCHER:-yes}" = yes ]; then
  if timeout 10m wget -q -N -P "$WORK" "$LH_DEB_URL" 2>>"$LOG" && [ -f "$WORK/linked-helper.deb" ]; then
    NEW=$(dpkg-deb -f "$WORK/linked-helper.deb" Version 2>/dev/null)
    CUR=$(dpkg-query -W -f '${Version}' linked-helper 2>/dev/null)
    if [ -n "$NEW" ] && dpkg --compare-versions "$NEW" gt "${CUR:-0}"; then
      say "launcher upgrade available: ${CUR:-none} -> $NEW - installing"
      if DEBIAN_FRONTEND=noninteractive timeout 10m apt-get install -y -qq "$WORK/linked-helper.deb" >>"$LOG" 2>&1; then
        say "launcher upgraded to $(dpkg-query -W -f '${Version}' linked-helper)"
      else
        say "LAUNCHER UPGRADE FAILED - still on ${CUR:-none}, carrying on"
      fi
    else
      say "launcher ${CUR:-none} is current (vendor latest ${NEW:-unknown})"
    fi
  else
    say "could not fetch the launcher package - skipping the upgrade check"
  fi
fi

# --- Linked Helper's own supported-format export, taken while LH is stopped.
# lh-lhd2.py starts the launcher on its own (the export only exists there, and
# refuses while the instance is running), drives it, and leaves LH stopped for
# the tar below. Roughly 100 s for a 1.2 GB database. If it fails we still take
# the tar - losing the nicer artefact must never cost us the working one.
# OFF by default: set LH_EXPORT_NIGHTLY=yes in /etc/linked-helper-machine.conf
# to enable it on a machine. The export itself is proven - it produced a valid
# file by hand on 7 Sep - but driven from this job it has not yet succeeded
# end to end, and a step that costs ~2 min of campaign downtime does not run on
# a client machine until it earns it. Until then LH's own .archived.lhd2 (see
# the tidy-up above) is the supported-format artefact we ship.
EXPORT=""
if [ "${LH_EXPORT_NIGHTLY:-no}" = yes ]; then
  EXPORT="$WORK/lh-${CLIENT_ID}-${STAMP}.lhd2"
  if /usr/local/bin/lh-lhd2.py export "$EXPORT" >>"$LOG" 2>&1; then
    say "export built: $(du -m "$EXPORT" | cut -f1) MB"
  else
    say "EXPORT FAILED - carrying on with the data-directory archive"
    rm -f "$EXPORT"
    EXPORT=""
  fi
fi

# Folder copy on TAR_WEEKDAY - or on any night the export failed, so no night
# passes without some backup leaving the machine.
ARCHIVE=""
if [ "$(date +%u)" = "$TAR_WEEKDAY" ] || [ -z "${EXPORT:-}" ]; then
ARCHIVE="$WORK/lh-${CLIENT_ID}-${STAMP}.tar.zst"
say "archiving data (caches excluded)"
tar --use-compress-program="zstd -3 -T2" --exclude="*/Cache/*" --exclude="*/Code Cache/*" --exclude="*/GPUCache/*" --exclude="*/DawnCache/*" --exclude="*/DawnGraphiteCache/*" --exclude="*/DawnWebGPUCache/*" --exclude="*/ShaderCache/*" --exclude="*/Crashpad/*" --exclude="*/Shared Dictionary/cache/*" --exclude="*/Instances" --exclude="*/Instances/*" --exclude="*.archived.lhd2" --exclude="*.imported.lhd2" -cf "$ARCHIVE" -C /home/lh .config/linked-helper 2>>"$LOG"
SIZE=$(du -m "$ARCHIVE" | cut -f1)
say "archive built: ${SIZE} MB"
else
  say "no folder copy tonight (weekday $(date +%u), folder copy day is $TAR_WEEKDAY)"
fi

# Restart Linked Helper BEFORE uploading. The upload does not need LH stopped,
# and a throttled upload used to hold campaigns down for the whole transfer
# (seen 7 Sep 2026: Google returned rateLimitExceeded and LH stayed down ~30 min).
say "restarting Linked Helper (before the upload, so a slow upload costs no downtime)"
systemd-run --uid="${LH_USER:-lh}" --gid="${LH_USER:-lh}" --setenv=DISPLAY=:0   --unit=lh-after-backup --collect "$LH_BIN" --start-account-id="$LH_ACCOUNT_ID" >/dev/null 2>&1 ||   sudo -u "${LH_USER:-lh}" DISPLAY=:0 setsid "$LH_BIN" --start-account-id="$LH_ACCOUNT_ID" >/dev/null 2>&1 &
LH_RESTARTED=yes

if [ -n "$ARCHIVE" ]; then
say "uploading to $REMOTE_DIR"
# --timeout/--retries so a throttled transfer fails cleanly instead of hanging.
if timeout 40m rclone copy "$ARCHIVE" "$REMOTE_DIR" --drive-chunk-size 32M      --retries 3 --low-level-retries 10 --timeout 5m --drive-pacer-min-sleep 200ms 2>>"$LOG"; then
  say "upload OK"
  # --max-depth 1 so this only ages out the nightly tars, never the lhd2/ folder
  # below. Those are produced irregularly - only when Linked Helper updates itself
  # - so an age rule would delete one and then re-upload it the same night.
  rclone delete "$REMOTE_DIR" --max-depth 1 --min-age ${KEEP_DAYS}d 2>>"$LOG" && say "pruned copies older than ${KEEP_DAYS}d"
else
  say "UPLOAD FAILED - archive kept locally at $ARCHIVE"
fi
rm -f "$ARCHIVE"
fi

# Our nightly export, taken above.
if [ -f "${EXPORT:-}" ]; then
  say "uploading nightly export $(basename "$EXPORT")"
  if timeout 40m rclone copy "$EXPORT" "$REMOTE_DIR/lhd2" --drive-chunk-size 32M       --retries 3 --low-level-retries 10 --timeout 5m --drive-pacer-min-sleep 200ms 2>>"$LOG"; then
    say "nightly export upload OK"
  else
    say "NIGHTLY EXPORT UPLOAD FAILED - kept locally at $EXPORT"
    KEEP_EXPORT=yes
  fi
fi
[ "${KEEP_EXPORT:-no}" = yes ] || rm -f "${EXPORT:-}"

# Linked Helper's own supported-format export. Its filename carries the LH
# version, so each update contributes one file and re-running is a no-op -
# rclone skips a file already there at the same size and modtime.
if [ -n "$LHD2_SRC" ] && [ -f "$LHD2_SRC" ]; then
  say "uploading supported-format export $(basename "$LHD2_SRC")"
  if timeout 40m rclone copy "$LHD2_SRC" "$REMOTE_DIR/lhd2" --drive-chunk-size 32M       --retries 3 --low-level-retries 10 --timeout 5m --drive-pacer-min-sleep 200ms 2>>"$LOG"; then
    say "export upload OK"
    rclone lsf "$REMOTE_DIR/lhd2" --format "tp" 2>>"$LOG" | sort -r | tail -n +$((KEEP_LHD2 + 1))       | cut -d";" -f2- | while read -r old; do
        rclone deletefile "$REMOTE_DIR/lhd2/$old" 2>>"$LOG" && say "pruned old export: $old"
      done
  else
    say "EXPORT UPLOAD FAILED - stays on the machine, next run retries"
  fi
else
  say "no .archived.lhd2 on disk - none uploaded (LH writes one on its next self-update)"
fi

# Safety net: if the restart above somehow did not happen, do it now.
if [ "${LH_RESTARTED:-no}" != "yes" ] || ! pgrep -f "[l]inked-helper" >/dev/null; then
  say "restarting Linked Helper (fallback)"
  sudo -u "${LH_USER:-lh}" DISPLAY=:0 setsid "$LH_BIN" --start-account-id="$LH_ACCOUNT_ID" >/dev/null 2>&1 &
fi
say "=== backup done ==="
