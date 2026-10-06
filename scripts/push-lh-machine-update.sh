#!/usr/bin/env bash
# Bring existing Linked Helper machines up to date, from the laptop.
#
#   bash scripts/push-lh-machine-update.sh 100.82.222.113 [more addresses...]
#
# Copies scripts/linked-helper/ to each machine over ssh (Guy's Tailscale road, the client key)
# and runs update-lh-machine.sh there - see that file for what changes and why. Run it from a
# clean worktree at origin/main: it ships the files in THIS checkout, so a stale checkout would
# roll machines back.
#
# Never while a client is on a call on that machine - the screen connection restarts.
# Guy's own machine logs in as ubuntu, not root: SSH_USER=ubuntu SSH_KEY=~/.ssh/lh_vps_ed25519
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/wg_clients_ed25519}"
SSH_USER="${SSH_USER:-root}"
SRC="$(cd "$(dirname "$0")/linked-helper" && pwd)"
[ $# -gt 0 ] || { echo "usage: $0 <machine address>..."; exit 1; }

for host in "$@"; do
  echo "######## $host"
  ssh -o ConnectTimeout=15 -o BatchMode=yes -i "$SSH_KEY" "$SSH_USER@$host" 'rm -rf /tmp/lh-update && mkdir -p /tmp/lh-update'
  scp -q -r -i "$SSH_KEY" "$SRC"/. "$SSH_USER@$host:/tmp/lh-update/"
  SUDO=""; [ "$SSH_USER" = root ] || SUDO="sudo"
  if ssh -o BatchMode=yes -i "$SSH_KEY" "$SSH_USER@$host" "$SUDO bash /tmp/lh-update/update-lh-machine.sh"; then
    echo "######## $host OK"
  else
    echo "######## $host FAILED - read the lines above"
  fi
done
