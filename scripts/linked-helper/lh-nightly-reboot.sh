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

# Keep cloudflared (the client's web link) current, every night, even when the reboot is skipped.
# Ubuntu's automatic updates never touch Cloudflare's own package source, so without this every
# machine sat on the build it was made with - Cloudflare's "upgrade to 2026.10.2" notice on
# 27 Oct 2026 found all nine behind. Only this one package and only its own source are refreshed.
if [ -f /etc/apt/sources.list.d/cloudflared.list ]; then
  before=$(cloudflared --version 2>/dev/null | awk '{print $3}')
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o DPkg::Lock::Timeout=300 -qq update -o Dir::Etc::sourcelist=sources.list.d/cloudflared.list \
    -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0 >/dev/null 2>&1
  apt-get -o DPkg::Lock::Timeout=300 install -y -qq --only-upgrade cloudflared >/dev/null 2>&1
  after=$(cloudflared --version 2>/dev/null | awk '{print $3}')
  if [ "$before" != "$after" ]; then
    systemctl restart cloudflared
    say "cloudflared $before -> $after"
  fi
fi

if sudo -u "${LH_USER:-lh}" DISPLAY=:0 wmctrl -l 2>/dev/null | grep 'Instance #' | grep -qE '\|[[:space:]]*Collecting'; then
  say "a collect is running - no reboot tonight"
  exit 0
fi
if pgrep -f "[l]h-nightly-backup.sh" >/dev/null; then
  say "the backup is still running - no reboot tonight"
  exit 0
fi
/sbin/shutdown -r +1 "Linked Helper nightly maintenance reboot"
