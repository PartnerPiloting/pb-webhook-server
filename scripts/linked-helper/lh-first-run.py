#!/usr/bin/env python3
"""Finish a new machine by itself, once its owner has signed in.

Method status: NEW 29 Sep 2026. Written for Roland Illyes's machine, which is its first real run.
Until that run is on record, treat every line here as unproven.

WHY. A machine is built before its owner signs in. After they sign in to Linked Helper and to
LinkedIn - the two things only they can do, because only they have the password and the phone -
three jobs were left, and all three needed Guy: bring their history across from the old copy,
put the real account number where the machine starts from, and build the campaign. So the client
finished their part and then waited for a message to be read. Guy (29 Sep 2026): "the problem
with this approach is that I need to be involved. Is it possible for him to do the whole thing
on his own?" This is that.

WHAT IT DOES, every few minutes until it is done, then never again:
  1. Nobody signed in yet            -> nothing. (The watchdog keeps the Launcher open for them.)
  2. Signed in, LinkedIn not yet     -> nothing. They are still at it.
  3. Signed in to both               -> a. make sure the config and autostart carry the real account
                                        b. IMPORT their old copy's export, if one is waiting
                                        c. BUILD the connect campaign
                                        d. leave a note on the desktop saying it is done
The client sees Linked Helper close and reopen once. The page they are following tells them so.

THE IMPORT REPLACES WHAT IS ON THE MACHINE, so it is fenced:
  - only an export whose own header names THIS machine's account;
  - only when the machine has NO campaigns yet - a machine with work on it is never overwritten;
  - a safety export is taken first;
  - it is tried twice at most, and a failure is written where Guy will see it (Machine Status).
An export is "waiting" when it is a .lhd2 sitting in the desktop user's Home, Desktop or
Downloads. Linked Helper's own parked copies (lh.db.backup.*) are never picked up.

Run by root from /etc/cron.d/lh-first-run (installed by setup-ubuntu-vps.sh), under flock. It
removes its own cron line when it finishes. State: /var/lib/lh-first-run.json (world-readable -
the watchdog carries a one-line summary to the server).

  lh-first-run.py            do the next thing
  lh-first-run.py --plan     say what it would do, touch nothing
"""
import glob
import json
import os
import re
import sqlite3
import subprocess
import sys
import time

CONF = "/etc/linked-helper-machine.conf"
STATE = "/var/lib/lh-first-run.json"
CRON = "/etc/cron.d/lh-first-run"
SAFETY_DIR = "/var/backups/lh-first-run"
LHD2 = "/usr/local/bin/lh-lhd2.py"
BUILD = "/usr/local/bin/lh-build-campaigns.sh"
MAX_IMPORT_TRIES = 2
MAX_BUILD_TRIES = 3

NOTE_NAME = "Your machine is ready - read me.txt"
NOTE = """Your Linked Helper machine is set up.

{history}
Your campaign is built. It has nobody in it yet - it needs your search.

What to do next: in Claude, start a new chat and type

    Help me with my first campaign

and it will walk you through putting your search in and making the
invitation note sound like you.

You can close this browser tab whenever you like. Linked Helper keeps
running on the machine.

- Guy
"""


def say(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%S%z"), "first-run:", *a, flush=True)


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()


def load_conf(path=CONF):
    c = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                c[k] = v
    return c


def load_state(path=STATE):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state, path=STATE):
    state["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    state["summary"] = summary(state)          # what the watchdog carries to Machine Status
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(state, f, indent=1)
    os.chmod(path, 0o644)


# --------------------------------------------------------------------- what the machine knows

def known_accounts(data_dir):
    try:
        names = os.listdir(os.path.join(data_dir, "Partitions"))
    except OSError:
        return []
    ids = set()
    for n in names:
        m = re.match(r"^linked-helper-account-(\d+)-main$", n)
        if m:
            ids.add(m.group(1))
    return sorted(ids, key=int)


def linkedin_ready(title, account):
    """The instance window for THIS account is open and says LinkedIn is signed in."""
    t = title or ""
    return ("Instance #%s" % account) in t and "LinkedIn logged in" in t


def campaign_count(data_dir, account):
    """How many campaigns this machine already has. None = could not tell - and a machine we
    cannot read is treated as one with work on it, never as an empty one."""
    path = os.path.join(data_dir, "Partitions", "linked-helper-account-%s-main" % account, "lh.db")
    if not os.path.exists(path):
        return None
    try:
        con = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=5)
        try:
            return int(con.execute("SELECT COUNT(*) FROM campaigns").fetchone()[0])
        finally:
            con.close()
    except sqlite3.Error:
        return None


def export_header(path):
    """A .lhd2 opens with a 4-byte length and a JSON header. None when it is not one."""
    try:
        with open(path, "rb") as f:
            n = int.from_bytes(f.read(4), "little")
            if not 2 <= n <= 65536:
                return None
            return json.loads(f.read(n).decode())
    except (OSError, ValueError, UnicodeDecodeError):
        return None


def waiting_export(home, account):
    """The newest export in Home, Desktop or Downloads that is for THIS account."""
    found = []
    for d in (home, os.path.join(home, "Desktop"), os.path.join(home, "Downloads")):
        for p in glob.glob(os.path.join(d, "*.lhd2")):
            if os.path.basename(p).startswith("lh.db.backup."):
                continue          # Linked Helper's own parked copy of THIS machine
            hdr = export_header(p)
            if hdr and str(hdr.get("linkedInAccountId")) == str(account):
                found.append((os.path.getmtime(p), p))
    return sorted(found)[-1][1] if found else None


# ------------------------------------------------------------------------------ the decision

def decide(state, accounts, title, campaigns, export):
    """What to do next. Pure - everything it needs is handed in - so it can be tested whole.

    Returns (action, why). Actions: done, wait, stop, import, skip-import, build, finish.
    """
    if state.get("done"):
        return "done", "already finished"
    if not accounts:
        return "wait", "nobody has signed in to Linked Helper yet"
    if len(accounts) > 1:
        return "stop", "more than one account on this machine (%s) - one for a person" % ", ".join(accounts)
    account = accounts[0]
    if not linkedin_ready(title, account):
        return "wait", "signed in to Linked Helper as %s, not yet to LinkedIn" % account

    if "import" not in state:
        if not export:
            return "skip-import", "no export waiting for account %s" % account
        if campaigns is None:
            return "skip-import", "could not read this machine's campaigns, so it is not being overwritten"
        if campaigns > 0:
            return "skip-import", "this machine already has %d campaign(s), so it is not being overwritten" % campaigns
        if state.get("import_tries", 0) >= MAX_IMPORT_TRIES:
            return "skip-import", "FAILED %d times - left for a person" % MAX_IMPORT_TRIES
        return "import", export

    if "campaign" not in state:
        if state.get("build_tries", 0) >= MAX_BUILD_TRIES:
            return "stop", "campaign build FAILED %d times - one for a person" % MAX_BUILD_TRIES
        return "build", "the connect campaign"

    return "finish", "everything is in place"


def summary(state):
    """One short line for Machine Status."""
    if state.get("done"):
        bits = []
        imp = str(state.get("import", ""))
        bits.append("history imported" if imp.startswith("ok") else "no history imported")
        bits.append("campaign built" if str(state.get("campaign", "")).startswith("ok") else "campaign NOT built")
        return "done - " + ", ".join(bits)
    if state.get("stopped"):
        return "STOPPED - " + str(state["stopped"])[:70]
    return "waiting - " + str(state.get("waiting", "not started"))[:70]


# --------------------------------------------------------------------------------- the doing

def ensure_account(conf, account, autostart):
    """Root's half of what the watchdog also does - here so the import never runs on a placeholder."""
    if str(conf.get("LH_ACCOUNT_ID")) != str(account):
        with open(CONF) as f:
            lines = f.read().splitlines()
        lines = [("LH_ACCOUNT_ID=%s" % account) if l.startswith("LH_ACCOUNT_ID=") else l for l in lines]
        with open(CONF, "w") as f:
            f.write("\n".join(lines) + "\n")
        conf["LH_ACCOUNT_ID"] = str(account)
        say("config now carries account", account)
    try:
        with open(autostart) as f:
            s = f.read()
        fixed = re.sub(r"--start-account-id=\S+", "--start-account-id=%s" % account, s)
        if fixed != s:
            with open(autostart, "w") as f:
                f.write(fixed)
            say("autostart now carries account", account)
    except OSError as e:
        say("could not update the autostart:", e)


def instance_title(user):
    return sh("sudo -u %s env DISPLAY=:0 wmctrl -l 2>/dev/null | grep 'Instance #' | head -1" % user)


def bring_linked_helper_back(user, home, wait_s=240):
    """The import leaves Linked Helper stopped. The watchdog is the one proven way to start it
    (anything launched from a script dies with the script) - and it is told not to hold off for
    whoever is watching, because the person watching is who we are doing this for."""
    flag = os.path.join(home, ".cache", "lh-watchdog-restart-now")
    subprocess.run(["sudo", "-u", user, "sh", "-c", "mkdir -p '%s' && : > '%s'" % (os.path.dirname(flag), flag)])
    subprocess.run(["systemctl", "start", "lh-watchdog.service"])
    deadline = time.time() + wait_s
    while time.time() < deadline:
        if "Instance #" in instance_title(user):
            return True
        time.sleep(10)
    return False


def do_import(state, export, account, user, home):
    state["import_tries"] = state.get("import_tries", 0) + 1
    save_state(state)
    os.makedirs(SAFETY_DIR, exist_ok=True)
    safety = os.path.join(SAFETY_DIR, "before-import-%s-%s.lhd2" % (account, time.strftime("%Y%m%d-%H%M%S")))
    subprocess.run(["systemctl", "stop", "lh-watchdog.timer"])
    try:
        say("safety export first ->", safety)
        rc = subprocess.run(["python3", LHD2, "export", safety]).returncode
        say("safety export", "ok" if rc == 0 else "FAILED (the machine has no campaigns, so carrying on)")
        say("importing", export)
        rc = subprocess.run(["python3", LHD2, "import", export]).returncode
        if rc == 0:
            state["import"] = "ok %s from %s" % (time.strftime("%Y-%m-%d %H:%M"), os.path.basename(export))
            say("import ok")
        else:
            say("import FAILED (try %d of %d)" % (state["import_tries"], MAX_IMPORT_TRIES))
    finally:
        subprocess.run(["systemctl", "start", "lh-watchdog.timer"])
        back = bring_linked_helper_back(user, home)
        say("Linked Helper is back" if back else "Linked Helper did NOT come back within the wait - the watchdog keeps trying")
    save_state(state)


def do_build(state, user):
    state["build_tries"] = state.get("build_tries", 0) + 1
    save_state(state)
    r = subprocess.run(["sudo", "-u", user, "-H", "env", "DISPLAY=:0", BUILD], capture_output=True, text=True)
    for line in (r.stdout + r.stderr).splitlines()[-12:]:
        say("  build:", line)
    if r.returncode == 0:
        state["campaign"] = "ok %s" % time.strftime("%Y-%m-%d %H:%M")
        say("campaign built")
    else:
        say("campaign build FAILED (try %d of %d)" % (state["build_tries"], MAX_BUILD_TRIES))
    save_state(state)


def do_finish(state, user, home):
    imported = str(state.get("import", "")).startswith("ok")
    history = ("Your history from your old copy of Linked Helper has been brought\nacross, so it knows who you have already contacted.\n"
               if imported else "")
    desk = os.path.join(home, "Desktop")
    os.makedirs(desk, exist_ok=True)
    note = os.path.join(desk, NOTE_NAME)
    with open(note, "w") as f:
        f.write(NOTE.format(history=history))
    subprocess.run(["chown", "%s:%s" % (user, user), note])
    # A box on the screen as well: the person is looking at Linked Helper, not at the desktop.
    subprocess.Popen(
        ["sudo", "-u", user, "env", "DISPLAY=:0", "xmessage", "-center", "-timeout", "900",
         "-file", note],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    state["done"] = time.strftime("%Y-%m-%d %H:%M")
    state.pop("waiting", None)
    save_state(state)
    try:
        os.remove(CRON)
    except OSError:
        pass
    say("finished -", summary(state))


def main():
    plan = "--plan" in sys.argv
    conf = load_conf()
    user = conf.get("LH_USER", "lh")
    home = "/home/" + user
    data = os.path.join(home, ".config", "linked-helper")
    autostart = os.path.join(home, ".config", "autostart", "linked-helper.desktop")
    state = load_state()

    for _ in range(4):                       # import -> build -> finish, in the one run
        accounts = known_accounts(data)
        account = accounts[0] if len(accounts) == 1 else None
        title = instance_title(user) if account else ""
        campaigns = campaign_count(data, account) if account else None
        export = waiting_export(home, account) if account else None
        action, why = decide(state, accounts, title, campaigns, export)
        say(action, "-", why)
        if plan or action == "done":
            return 0
        if action == "wait":
            state["waiting"] = why
            save_state(state)
            return 0
        if action == "stop":
            state["stopped"] = why
            save_state(state)
            return 1
        state.pop("stopped", None)
        state.pop("waiting", None)
        ensure_account(conf, account, autostart)
        if action == "skip-import":
            state["import"] = "skipped: " + why
            save_state(state)
        elif action == "import":
            do_import(state, export, account, user, home)
            if "import" not in state:
                return 1                     # failed this time; the next run tries once more
        elif action == "build":
            do_build(state, user)
            if "campaign" not in state:
                return 1
        elif action == "finish":
            do_finish(state, user, home)
            return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
