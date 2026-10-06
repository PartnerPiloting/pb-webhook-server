#!/usr/bin/env python3
"""Linked Helper machine - opening the web link wakes Linked Helper, and the page says so.

WHY (1 Oct 2026): Rick Wong opened his machine's link just after Linked Helper had closed itself
to install an update. The watchdog saw someone on the screen and politely held off restarting it
(lh-watchdog.py, "SOMEONE IS ON THE SCREEN"), so the one person looking was the one left staring
at an empty desktop. He emailed Guy asking what to do. Linked Helper updates itself every day or
two, so any client could land in that gap.

WHAT THIS DOES, every few seconds (as root, lh-wake.service, installed by lh-browser-access.sh):
  - Works out what the page should tell the person looking, and writes it to status.json beside
    the page (lh-browser-page.html shows it as a banner):
      ready     Linked Helper is open                       -> no banner
      sign-in   nobody has ever signed in here              -> "sign in in the dark Linked Helper window"
      paused    the watchdog timer is off on purpose        -> "switched off for a moment"
                (lh-first-run.py stops it for an import; Guy stops it to work on the machine)
      starting  closed, and someone is looking              -> "Starting Linked Helper for you"
      closed    closed, and nobody is looking               -> the watchdog's 5-minute round covers it
  - When someone is looking and Linked Helper has been closed for GRACE_S, asks the watchdog to
    start it NOW and not to hold off - the same handoff lh-first-run.py uses after an import
    (~/.cache/lh-watchdog-restart-now + start the service). The watchdog stays the one thing
    that starts Linked Helper: anything launched from a script dies with the script.
  - Before anyone has signed in: if the person looking has wandered onto the Linked Helper
    WEBSITE in Firefox for SITE_GRACE_S, brings the Launcher back to the front (at most every
    RERAISE_S). WHY (Matthew Bulat, 6 Oct 2026): Firefox on linkedhelper.com covered the
    Launcher, and the website's "Open on remote machine" and "Where do you want to run this
    account? - Go to Downloads" both assume Linked Helper is not installed. He went round in
    circles there. The grace leaves time for a "Sign in with Google" round trip, which passes
    through that website on its way back to the Launcher.

To keep Linked Helper closed while working on a machine: systemctl stop lh-watchdog.timer
(this then reads "paused" and leaves it alone). Start the timer again when done.
"""
import json
import os
import re
import subprocess
import sys
import time

LH_USER = os.environ.get("LH_USER", "lh")
WEB_DIR = os.environ.get("WEB_DIR", "/usr/local/share/lh-browser")
VNC_PORT = 5900
TICK_S = 5
GRACE_S = 45        # Linked Helper may be reopening itself after an update - give it that long
REWAKE_S = 240      # one wake, then let the watchdog's own start (up to ~3 min) finish
SITE_GRACE_S = 30   # on the Linked Helper website this long before the Launcher is brought back
RERAISE_S = 90      # then not again for this long - never a tug of war with the person
LAUNCHER_TITLE = "Linked Helper 2 Launcher"


def lh_account():
    import pwd      # here, not at the top: Linux-only, and the test imports this file on Windows
    return pwd.getpwnam(LH_USER)


def decide(instance_open, has_account, watchdog_on, watching, closed_for_s, last_wake_ago_s):
    """(state for the page, whether to wake Linked Helper now). Pure - see the header."""
    if instance_open:
        return "ready", False
    if not has_account:
        return "sign-in", False
    if not watchdog_on:
        return "paused", False
    if not watching:
        return "closed", False
    if closed_for_s < GRACE_S:
        return "starting", False
    if last_wake_ago_s is not None and last_wake_ago_s < REWAKE_S:
        return "starting", False
    return "starting", True


def on_lh_website(title):
    """The active window is Firefox showing a linkedhelper.com page (its tab titles all say
    "Linked Helper"). Google's own sign-in pages do not match."""
    t = (title or "").lower()
    return "firefox" in t and "linked helper" in t and "google" not in t


def should_raise_launcher(state, watching, on_site_for_s, last_raise_ago_s):
    """Bring the Launcher back over the website? Pure - see the header."""
    if state != "sign-in" or not watching or on_site_for_s is None:
        return False
    if on_site_for_s < SITE_GRACE_S:
        return False
    return last_raise_ago_s is None or last_raise_ago_s >= RERAISE_S


def sh(cmd):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ""


def instance_open(home):
    # Root reads the screen with the desktop user's X key - not through sudo, which would write
    # two lines to the system log every round.
    xauth = os.path.join(home, ".Xauthority")
    return "Instance #" in sh("DISPLAY=:0 XAUTHORITY='%s' wmctrl -l 2>/dev/null" % xauth)


def active_title(home):
    xauth = os.path.join(home, ".Xauthority")
    return sh("DISPLAY=:0 XAUTHORITY='%s' xdotool getactivewindow getwindowname 2>/dev/null" % xauth)


def raise_launcher(home):
    xauth = os.path.join(home, ".Xauthority")
    sh("DISPLAY=:0 XAUTHORITY='%s' wmctrl -a '%s' 2>/dev/null" % (xauth, LAUNCHER_TITLE))


def has_account(home):
    try:
        names = os.listdir(os.path.join(home, ".config", "linked-helper", "Partitions"))
    except OSError:
        return False
    return any(re.match(r"^linked-helper-account-\d+-main$", n) for n in names)


def watchdog_on():
    return sh("systemctl is-active lh-watchdog.timer") == "active"


def watching():
    out = sh("ss -tn state established '( sport = :%d )'" % VNC_PORT)
    return any(str(VNC_PORT) in l for l in out.splitlines())


def wake(home):
    """The lh-first-run.py handoff: a flag the watchdog reads as 'do not hold off', then a run."""
    u = lh_account()
    cache = os.path.join(home, ".cache")
    os.makedirs(cache, exist_ok=True)
    flag = os.path.join(cache, "lh-watchdog-restart-now")
    open(flag, "w").close()
    os.chown(cache, u.pw_uid, u.pw_gid)
    os.chown(flag, u.pw_uid, u.pw_gid)
    subprocess.run(["systemctl", "start", "--no-block", "lh-watchdog.service"])


def write_status(state, since):
    """Atomic, so the page never reads half a file. Readable by the page's server (group lh)."""
    path = os.path.join(WEB_DIR, "status.json")
    tmp = path + ".new"
    with open(tmp, "w") as f:
        json.dump({"state": state, "since": int(since), "at": int(time.time())}, f)
    os.chmod(tmp, 0o640)
    os.chown(tmp, 0, lh_account().pw_gid)
    os.replace(tmp, path)


def main():
    home = lh_account().pw_dir
    closed_since = None
    last_wake = None
    site_since = None
    last_raise = None
    state, since = None, time.time()
    while True:
        now = time.time()
        try:
            is_open = instance_open(home)
            if is_open:
                closed_since = None
            elif closed_since is None:
                closed_since = now
            looking = watching()
            new, go = decide(is_open, has_account(home), watchdog_on(), looking,
                             0 if is_open else now - closed_since,
                             None if last_wake is None else now - last_wake)
            if new == "sign-in" and on_lh_website(active_title(home)):
                site_since = site_since or now
            else:
                site_since = None
            if should_raise_launcher(new, looking, None if site_since is None else now - site_since,
                                     None if last_raise is None else now - last_raise):
                print("on the Linked Helper website %ds before signing in - Launcher to the front" % (now - site_since), flush=True)
                raise_launcher(home)
                last_raise = now
                site_since = None
            if go:
                print("someone is looking and Linked Helper has been closed %ds - waking it" % (now - closed_since), flush=True)
                wake(home)
                last_wake = now
            if new != state:
                print("state: %s -> %s" % (state, new), flush=True)
                state, since = new, now
            write_status(state, since)
        except Exception as e:      # one bad round must never stop the next
            print("round failed: %s" % e, file=sys.stderr, flush=True)
        time.sleep(TICK_S)


if __name__ == "__main__":
    main()
