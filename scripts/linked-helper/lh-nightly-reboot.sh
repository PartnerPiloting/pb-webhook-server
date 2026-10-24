#!/bin/bash
# Nightly maintenance reboot (03:00, from /etc/cron.d/lh-nightly-reboot).
#
# Skips the night when rebooting would cut something short (24 Oct 2026):
#   - a collect is running (people being pulled in from a search - it can run for hours), or
#   - the 02:30 backup is still going (it waits for a collect, so it can run late).
# Missing one maintenance reboot costs nothing; the next night catches up.
set -u
LOG=/var/log/lh-backup.log
say(){ echo "$(date -Is) [reboot] $*" >> "$LOG"; }

if sudo -u "${LH_USER:-lh}" DISPLAY=:0 wmctrl -l 2>/dev/null | grep 'Instance #' | grep -qE '\|[[:space:]]*Collecting'; then
  say "a collect is running - no reboot tonight"
  exit 0
fi
if pgrep -f "[l]h-nightly-backup.sh" >/dev/null; then
  say "the backup is still running - no reboot tonight"
  exit 0
fi
/sbin/shutdown -r +1 "Linked Helper nightly maintenance reboot"
