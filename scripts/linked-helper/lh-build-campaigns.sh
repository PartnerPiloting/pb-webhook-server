#!/usr/bin/env bash
# Build every standard campaign on this machine from the installed recipes.
#
# Idempotent - a campaign that already exists by name is skipped, so running it twice
# is harmless. Needs the Linked Helper instance OPEN and LOGGED IN to LinkedIn: the
# campaign attaches to the account row that only exists after that first login, which
# is why this is a post-login step and not part of the unattended build.
#
# Recipes: /usr/local/share/linked-helper/campaigns/*.json (installed by setup-ubuntu-vps.sh,
# source of truth = scripts/linked-helper/campaigns/ in the repo). The client's webhook
# address is filled from /etc/linked-helper-machine.conf.
#
#   lh-build-campaigns.sh            build all
#   lh-build-campaigns.sh --plan     print what would be sent, touch nothing
set -uo pipefail
DIR=/usr/local/share/linked-helper/campaigns
CMD=create
[ "${1:-}" = "--plan" ] && CMD=plan
rc=0
shopt -s nullglob
recipes=("$DIR"/*.json)
[ ${#recipes[@]} -gt 0 ] || { echo "no recipes in $DIR"; exit 1; }
for r in "${recipes[@]}"; do
  echo "== $(basename "$r")"
  python3 /usr/local/bin/lh-campaigns.py "$CMD" "$r" || rc=1
done
exit $rc
