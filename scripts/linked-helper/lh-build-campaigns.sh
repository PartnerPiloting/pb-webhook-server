#!/usr/bin/env bash
# Build standard campaigns on this machine from the installed recipes.
#
# By default it builds ONE campaign: the connect campaign (recipe 03). That is the whole method
# now - connection request, keep only who accepts, extract them into Wingguy, where they are
# scored and worked on Thanks for Connecting (Guy, 2026-09-25). The other two recipes stay
# installed and are built only when asked for by name:
#   visit-and-extract  - scores a list without inviting anyone; used to wake up a client's
#                        existing network (feeds the Top Scoring Leads "existing network" view)
#   top-scorers        - the old score-first-then-invite route, for a narrow-audience client
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
#   lh-build-campaigns.sh                       build the connect campaign
#   lh-build-campaigns.sh visit-and-extract     build a named recipe (any part of its file name)
#   lh-build-campaigns.sh --all                 build every recipe
#   lh-build-campaigns.sh --plan [names...]     print what would be sent, touch nothing
set -uo pipefail
DIR=/usr/local/share/linked-helper/campaigns
DEFAULT=fractional-in-profile
CMD=create
ALL=0
names=()
for a in "$@"; do
  case "$a" in
    --plan) CMD=plan ;;
    --all)  ALL=1 ;;
    *)      names+=("$a") ;;
  esac
done
[ ${#names[@]} -gt 0 ] || names=("$DEFAULT")
rc=0
shopt -s nullglob
recipes=()
if [ $ALL = 1 ]; then
  recipes=("$DIR"/*.json)
else
  for n in "${names[@]}"; do
    hit=("$DIR"/*"$n"*.json)
    [ ${#hit[@]} -gt 0 ] || { echo "no recipe matching '$n' in $DIR"; rc=1; continue; }
    recipes+=("${hit[@]}")
  done
fi
[ ${#recipes[@]} -gt 0 ] || { echo "nothing to build"; exit 1; }
for r in "${recipes[@]}"; do
  echo "== $(basename "$r")"
  python3 /usr/local/bin/lh-campaigns.py "$CMD" "$r" || rc=1
done
exit $rc
