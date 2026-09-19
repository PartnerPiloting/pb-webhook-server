#!/bin/bash
# Install our own Google client_id/secret + a matching token into this
# machine's rclone config, replacing whatever was there. Run as root.
#
# Why: rclone's built-in shared client_id is rate-limited across every rclone
# user worldwide and is being retired during 2026. Uploads were refused on
# 7 Sep 2026 because of it.
#
# The three values are typed/pasted by the person running this, never put on
# a command line or in chat:
#   sudo lh-rclone-credentials.sh
# Get them first, on a laptop with a browser:
#   rclone authorize "drive" "<client_id>" "<client_secret>"
# and copy the token JSON it prints (the {...} block, one line).
#
# WHY THE CHECKING BELOW EXISTS (19 Sep 2026). The client_secret prompt is
# hidden, the way a password box is. On 8 Sep Guy pasted the secret, saw
# nothing appear, reasonably concluded the paste had not taken, and pasted
# again - seven times. All seven landed on one input line and were saved as a
# 245-character secret. Google answered invalid_client on every refresh from
# then on, and EVERY Linked Helper machine went unbacked for eleven nights
# before anyone noticed. A hidden prompt removes the feedback a person needs,
# so the script has to give it back: check the shape, and say what it got.
set -u
CONF=/root/.config/rclone/rclone.conf

# Show enough of a secret to prove the paste took, and nothing more.
mask() { printf '%s…%s (%d chars)' "${1:0:7}" "${1: -4}" "${#1}"; }

read -r -p "client_id: " CID
read -r -s -p "client_secret: " CSEC; echo
read -r -p "token JSON (one line, starts with {): " TOKEN

fail() { echo "$1"; echo "nothing changed."; exit 1; }

[ -n "$CID" ] || fail "no client_id given."
case "$CID" in
  *.apps.googleusercontent.com) ;;
  *) fail "that client_id does not end in .apps.googleusercontent.com - is it the right value?" ;;
esac

# Google issues secrets of GOCSPX- plus 28 characters. The range is deliberately
# loose in case Google changes the length, but anything near a MULTIPLE of 35 is
# the repeated-paste signature and gets named as such, because that is the
# mistake people actually make at a prompt that shows them nothing.
[ -n "$CSEC" ] || fail "no client_secret given."
case "$CSEC" in
  GOCSPX-*) ;;
  *) fail "a Google client secret starts with GOCSPX- and this one does not." ;;
esac
case "$CSEC" in
  *[[:space:]]*) fail "that client_secret contains a space or newline - it has picked up something extra." ;;
esac
if [ "${#CSEC}" -lt 30 ] || [ "${#CSEC}" -gt 50 ]; then
  echo "that client_secret is ${#CSEC} characters. A Google one is about 35."
  [ $(( ${#CSEC} % 35 )) -eq 0 ] && [ "${#CSEC}" -gt 35 ] &&
    echo "It looks like the same value $(( ${#CSEC} / 35 )) times over - the prompt hides what you paste, so a second paste is easy to do by accident."
  fail "check it and run this again."
fi

[ "${TOKEN:0:1}" = "{" ] || fail "the token must be the whole {...} block that rclone authorize printed, on one line."
# python3 is always present on these machines (the watchdog is written in it),
# but if it ever is not, skip the parse rather than reject a good token. Test
# that it RUNS, not merely that it is on PATH - a name on PATH that fails to
# execute would otherwise reject a perfectly good token.
if python3 -c "" >/dev/null 2>&1; then
  echo "$TOKEN" | python3 -c "import json,sys; json.loads(sys.stdin.read())" 2>/dev/null ||
    fail "that token is not valid JSON - it has probably been cut short or wrapped."
fi

# Say back what was actually captured. This is the line that would have caught
# 8 September, in the second it happened rather than eleven days later.
echo
echo "using:"
echo "  client_id     ...${CID: -34}"
echo "  client_secret $(mask "$CSEC")"
echo "  token         ${#TOKEN} chars of JSON"
echo

install -d -m 700 /root/.config/rclone
# Keep the exact path we backed up to. The old code rolled back with a glob
# (cp "$CONF".bak-* "$CONF"), which matches nothing at all on a FIRST install -
# so a failed test left the bad credentials sitting in place, silently.
BAK=""
if [ -f "$CONF" ]; then
  BAK="$CONF.bak-$(date +%F-%H%M%S)"
  cp "$CONF" "$BAK"
fi
{
  printf '[gdrive]\ntype = drive\nscope = drive\n'
  printf 'client_id = %s\nclient_secret = %s\n' "$CID" "$CSEC"
  printf 'token = %s\n' "$TOKEN"
} > "$CONF"
chmod 600 "$CONF"

echo "written. testing..."
if rclone lsd "gdrive:Linked Helper Backups" >/dev/null 2>&1; then
  echo "OK - Drive reachable with the new credentials"
else
  echo "FAILED - Drive is not reachable with these credentials."
  if [ -n "$BAK" ]; then
    cp "$BAK" "$CONF"
    echo "previous config restored from $BAK"
  else
    # No previous config to go back to. Removing it beats leaving credentials
    # that do not work, because a config that is present but broken looks
    # configured - which is how the 8 Sep failure hid for eleven nights.
    rm -f "$CONF"
    echo "there was no previous config, so the broken one has been removed."
  fi
  exit 1
fi
