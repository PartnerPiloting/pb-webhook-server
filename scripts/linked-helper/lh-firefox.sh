#!/usr/bin/env bash
# Linked Helper machine - an ordinary Firefox, so "Sign in with Google" gets back to Linked Helper.
#
# WHY (Matthew Bulat, 6 Oct 2026): Ubuntu's "firefox" package is a Snap. A Snap app runs in a
# sandbox and cannot open another program. Linked Helper's "Sign in with Google" sends you to
# Firefox for the Google part, and Firefox must then hand you back to the Launcher through a
# linked-helper:// link. The Snap could not, so he landed signed in on the Linked Helper WEBSITE
# instead, whose buttons ("Open on remote machine", "Go to Downloads") assume the app is not
# installed - and Google sign-in failed for every machine we had built.
#
# WHAT IT DOES: removes the Snap Firefox, installs Mozilla's own build from packages.mozilla.org
# (pinned so Ubuntu's Snap stand-in never comes back), and makes sure linked-helper:// links open
# Linked Helper for the desktop user. Safe to re-run. Called by setup-ubuntu-vps.sh and by
# update-lh-machine.sh.
#
# Usage (as root): bash lh-firefox.sh
set -euo pipefail

LH_USER="${LH_USER:-lh}"
[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

if dpkg-query -W -f='${Version}' firefox 2>/dev/null | grep -q -v snap \
   && grep -qs packages.mozilla.org /etc/apt/sources.list.d/mozilla.list \
   && ! snap list firefox >/dev/null 2>&1; then
  echo "firefox: already Mozilla's build ($(dpkg-query -W -f='${Version}' firefox))"
else
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg -o /etc/apt/keyrings/packages.mozilla.org.asc
  echo 'deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main' \
    > /etc/apt/sources.list.d/mozilla.list
  cat > /etc/apt/preferences.d/mozilla <<'EOF'
Package: *
Pin: origin packages.mozilla.org
Pin-Priority: 1000
EOF
  if snap list firefox >/dev/null 2>&1; then
    snap remove --purge firefox >/dev/null
  fi
  apt-get update -qq
  apt-get install -y -qq --allow-downgrades firefox >/dev/null
  echo "firefox: Mozilla's build $(dpkg-query -W -f='${Version}' firefox)"
fi

# linked-helper:// -> Linked Helper. The app's own .desktop file declares the link type; this
# makes it the default for the desktop user, which is what Firefox asks.
if [ -f /usr/share/applications/linked-helper.desktop ]; then
  sudo -u "$LH_USER" env HOME="$(getent passwd "$LH_USER" | cut -d: -f6)" \
    xdg-mime default linked-helper.desktop x-scheme-handler/linked-helper
  echo "linked-helper:// links open: $(sudo -u "$LH_USER" env HOME="$(getent passwd "$LH_USER" | cut -d: -f6)" \
    xdg-mime query default x-scheme-handler/linked-helper)"
else
  echo "Linked Helper is not installed yet - its link handler is set when it is"
fi
