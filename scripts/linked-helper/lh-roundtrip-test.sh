#!/bin/bash
# Backup round trip on the live machine: export, import the SAME file straight
# back, and compare every table's row count either side.
#
# Linked Helper stays stopped from the first count to the last, so nothing can
# drift in between - any difference in the counts is a real fault, not campaigns
# having moved on. A separate copy of lh.db is taken first as a rollback.
#
# Restart is delegated to the watchdog, whose start path is the proven one.
# Never launch Linked Helper from a script with setsid/& - it dies with the
# thing that started it.
set -u
. /etc/linked-helper-machine.conf
LH_USER="${LH_USER:-lh}"
W=/var/tmp/roundtrip
mkdir -p "$W" && chown "$LH_USER:$LH_USER" "$W"   # the launcher (user lh) writes the export here
say(){ echo "$(date -Is) TEST: $*"; }

restart_lh(){
  say "handing Linked Helper back to the watchdog"
  systemctl start lh-watchdog.timer 2>/dev/null
  systemctl start --no-block lh-watchdog.service 2>/dev/null
}
trap restart_lh EXIT

systemctl stop lh-watchdog.timer lh-watchdog.service 2>/dev/null && say "watchdog held off (timer and any run in flight)"

say "stopping Linked Helper"
pkill -f '[l]inked-helper' 2>/dev/null
for i in $(seq 1 30); do pgrep -f '[l]inked-helper' >/dev/null || break; sleep 2; done
pgrep -f '[l]inked-helper' >/dev/null && { pkill -9 -f '[l]inked-helper'; sleep 3; }
say "stopped"

DBDIR=$(dirname "$(find /home/$LH_USER/.config/linked-helper -name lh.db -print -quit 2>/dev/null)")
say "database directory: $DBDIR"

say "taking a rollback copy of lh.db before touching anything"
cp "$DBDIR/lh.db" "$W/rollback-lh.db" || { say "ROLLBACK COPY FAILED - stopping here"; exit 1; }
say "rollback copy: $(du -m "$W/rollback-lh.db" | cut -f1) MB at $W/rollback-lh.db"

say "--- counting BEFORE ---"
python3 /usr/local/bin/lh-counts.py "$DBDIR/lh.db" "$W/before.json" || exit 1

say "--- exporting ---"
/usr/local/bin/lh-lhd2.py export "$W/roundtrip.lhd2" || { say "EXPORT FAILED - nothing was changed"; exit 1; }

say "--- importing that same file straight back ---"
/usr/local/bin/lh-lhd2.py import "$W/roundtrip.lhd2" || { say "IMPORT FAILED - rollback copy is at $W/rollback-lh.db"; exit 2; }

DBDIR2=$(dirname "$(find /home/$LH_USER/.config/linked-helper -name lh.db -print -quit 2>/dev/null)")
say "database directory after import: $DBDIR2"

say "--- counting AFTER ---"
python3 /usr/local/bin/lh-counts.py "$DBDIR2/lh.db" "$W/after.json" || exit 1

say "--- comparing ---"
python3 /usr/local/bin/lh-counts.py compare "$W/before.json" "$W/after.json"
RC=$?
say "comparison exit code: $RC (0 = identical)"
exit $RC
