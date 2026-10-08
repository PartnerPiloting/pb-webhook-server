#!/usr/bin/env python3
"""Linked Helper watchdog - Linux port of the mechanism proven on Windows 2026-08-28.

Every run (systemd timer, 5 min):
  1. If Linked Helper is not running at all -> start it with --start-account-id=<id>.
  2. Read health from the instance WINDOW TITLE (account, version, runner state,
     LinkedIn session state) - the same one-line health check as Windows.
  3. If the runner is IDLE -> press "Start campaigns runner" via LH's own DevTools
     channel (--remote-debugging-port=0, discovered fresh each run - never hardcode).
     Matches ^start campaigns runner$ ONLY, so it is a no-op on a healthy machine and
     can never press Stop.
  4. If REPORT_URL is set -> POST a small JSON status (best-effort; failures logged).

LEAVING A PERSON ALONE (29 Sep 2026). Step 1 used to fire whenever there was no instance window,
by killing Linked Helper and starting it again. On a machine nobody has signed in to yet there
is never an instance window, so that was every cycle: found on Roland Illyes's machine, where
Linked Helper had been killed and restarted every few minutes for two weeks - which is also
what anyone trying to sign in on it would have had happen under their hands. Three rules now:
  - NEVER SIGNED IN (no account has ever been opened here): keep the Launcher open and wait.
    Nothing is killed. State reads WAITING FOR SIGN-IN.
  - SOMEONE IS ON THE SCREEN and the instance is closed: they are probably in the middle of
    something (signing in, an import - which needs the instance closed). Hold off, but only for
    HOLD_OFF_S: a browser tab left open for days must not stop a dead Linked Helper being
    restarted, because nobody noticing is the failure this whole thing exists to prevent.
  - Otherwise: the restart, exactly as before.

LEARNING THE ACCOUNT (29 Sep 2026). A machine is built before its owner has signed in, so its
config carries a placeholder account number (000000, 1). Once they sign in, the real number is
on disk as a partition folder. The watchdog adopts it - into the config and the desktop
autostart - so the machine comes back from its nightly reboot as the right account without
anybody patching it by hand.

Config: /etc/linked-helper-machine.conf (written by setup-ubuntu-vps.sh).
Status: PROVEN - running on every machine since 1 Sep 2026.
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

CONF = "/etc/linked-helper-machine.conf"
LH_DATA = os.path.expanduser("~/.config/linked-helper")
AUTOSTART = os.path.expanduser("~/.config/autostart/linked-helper.desktop")
HOLD_OFF_FILE = os.path.expanduser("~/.cache/lh-watchdog-hold-off")
RESTART_NOW = os.path.expanduser("~/.cache/lh-watchdog-restart-now")
HOLD_OFF_S = 30 * 60        # how long a person on the screen can keep a closed instance closed
VNC_PORT = 5900


def load_conf():
    conf = {}
    with open(CONF) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                conf[k] = v
    return conf


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()


def machine_info():
    # What the machine knows about itself, for the status report -> the client's Clients row
    # (routes/linkedHelperMachineRoutes.js). Every item best-effort: a missing tool or a slow
    # lookup must never stop the watchdog from doing its real job.
    info = {}
    try:
        info["hostname"] = sh("hostname")
        info["tailscale_ip"] = sh("tailscale ip -4 2>/dev/null | head -1")
        info["tailscale_name"] = sh("tailscale status --self --json 2>/dev/null | "
                                    "python3 -c 'import sys,json;print(json.load(sys.stdin)[\"Self\"][\"HostName\"])' 2>/dev/null")
        info["public_ip"] = sh("curl -4 -s --max-time 5 https://api.ipify.org 2>/dev/null")
        info["disk_pct"] = sh("df --output=pcent / | tail -1 | tr -dc '0-9'")
        info["launcher"] = sh("wmctrl -l | grep -o 'Launcher v[0-9.]*' | head -1 | sed 's/Launcher v//'")
        # The client's way in through a web browser (lh-browser-access.sh): the page AND the
        # tunnel must both be running. Blank when this machine has no web link installed, so a
        # machine still on the desktop icon says nothing rather than crying DOWN.
        if sh("systemctl is-enabled lh-browser.service 2>/dev/null") == "enabled":
            page = sh("systemctl is-active lh-browser.service 2>/dev/null")
            tunnel = sh("systemctl is-active cloudflared.service 2>/dev/null")
            info["browser"] = "up" if (page == "active" and tunnel == "active") else "down"
    except Exception as e:
        info["error"] = str(e)[:80]
    return info


def lh_pids():
    # NOTE the [l] - without it pgrep matches the shell running this very
    # command (its cmdline contains "linked-helper"), so this never returned
    # empty and the watchdog could never start a fully-stopped Linked Helper.
    out = sh("pgrep -f '[l]inked-helper' || true")
    return [int(p) for p in out.split() if p.isdigit()]


def instance_title():
    # The instance window title carries the whole health picture.
    out = sh("wmctrl -l | grep 'Instance #' || true")
    if not out:
        out = sh("xdotool search --name 'Instance #' getwindowname %@ 2>/dev/null | head -1 || true")
        return out
    return out.split(None, 3)[3] if len(out.split(None, 3)) == 4 else out


# What the last part of the instance window title says about LinkedIn. The wording is Linked
# Helper's own, read out of its program on 6 Oct 2026 (version 2.130.55): the title ends with the
# page the built-in browser is on, and "LinkedIn logged in (...)" is only what it says on a page
# with no name of its own. Mid-task it says LinkedIn "Veronica Mesce" profile page (...), which
# is just as signed in - and reading that as LOGGED OUT told Guy two working machines were
# signed out (5 Oct 2026). So: LOGGED OUT only when the title SAYS so; anything else is unknown.
# lh-watchdog.py and lh-first-run.py each carry a copy; tests/lh-linkedin-state.test.py fails
# if the two ever disagree.
_LI_PRODUCTS = r"(?:LinkedIn|SalesNavigator|Recruiter|Talent)"
_LI_SIGNED_IN = re.compile(
    r"^" + _LI_PRODUCTS + r" (?:logged in|loading profile page|\".*\" profile page|"
    r"\".*\" organization page|loading messaging page|messaging page|settings page)")
_LI_SIGNED_OUT = re.compile(r"^LinkedIn (?:login|signup|authwall|home) page")
_LI_RESTRICTED = re.compile(r"^LinkedIn restricted account page")
_LI_CHALLENGE = re.compile(
    r"^LinkedIn (?:checkpoint challenge page|captcha puzzle page|"
    r"enter phone to confirm its you page|check add phone page|check manage account)")


def linkedin_state(title):
    """ok / LOGGED OUT / RESTRICTED / CHALLENGE / unknown, from the instance window title.

    A person's name or a campaign's name can itself contain " | ", so every " | LinkedIn ..."
    in the title is tried, last first, and the first one that says something wins.
    """
    t = title or ""
    starts = [m.start(1) for m in re.finditer(r"\| (" + _LI_PRODUCTS + r" )", t)]
    for at in reversed(starts):
        tail = t[at:]
        if _LI_SIGNED_IN.match(tail):
            return "ok"
        if _LI_SIGNED_OUT.match(tail):
            return "LOGGED OUT"
        if _LI_RESTRICTED.match(tail):
            return "RESTRICTED"
        if _LI_CHALLENGE.match(tail):
            return "CHALLENGE"
    return "unknown"


def parse_title(t):
    if not t:
        return {"state": "NOT OPEN", "linkedin": "unknown", "account": None, "version": None}
    m = re.search(r"Instance #(\d+)", t)
    v = re.search(r"\|\s*([\d.]+)\s*\|", t)
    if "Running campaign" in t:
        state = "RUNNING"
    elif re.search(r"\|\s*Idle\s*\|", t):
        state = "IDLE"
    else:
        state = "UNKNOWN"
    return {"state": state, "linkedin": linkedin_state(t),
            "account": m.group(1) if m else None,
            "version": v.group(1) if v else None}


def known_accounts(data_dir=None):
    """Every Linked Helper account that has ever been opened on this machine.

    Linked Helper keeps one partition folder per account (linked-helper-account-<id>-main) from
    the first time that account is opened. None = nobody has signed in here yet.
    """
    try:
        names = os.listdir(os.path.join(data_dir or LH_DATA, "Partitions"))
    except OSError:
        return []
    ids = set()
    for n in names:
        m = re.match(r"^linked-helper-account-(\d+)-main$", n)
        if m:
            ids.add(m.group(1))
    return sorted(ids, key=int)


def account_to_adopt(conf_id, accounts):
    """The real account number, when the config's one is a placeholder. None = leave it alone.

    Only ever adopts when there is exactly ONE account on the machine and the config names
    none of them - two accounts and no match is a question for a person, not a guess.
    """
    have = str(conf_id or "").strip()
    if have in accounts or len(accounts) != 1:
        return None
    return accounts[0]


def adopt_account(conf, real, actions):
    """Write the real account number where the machine starts from. Best-effort, and loud."""
    conf["LH_ACCOUNT_ID"] = real                     # this run uses it whatever happens below
    try:
        with open(CONF) as f:
            lines = f.read().splitlines()
        lines = [("LH_ACCOUNT_ID=" + real) if l.startswith("LH_ACCOUNT_ID=") else l for l in lines]
        with open(CONF, "w") as f:
            f.write("\n".join(lines) + "\n")
        actions.append("account-learned:" + real)
    except OSError as e:
        # An older build left the config owned by root. The autostart below still gets fixed,
        # and this says so every cycle until someone makes the file writable.
        actions.append("account-learned:" + real + " (config locked)")
        print(f"could not write {CONF}: {e}")
    try:
        with open(AUTOSTART) as f:
            s = f.read()
        fixed = re.sub(r"--start-account-id=\S+", "--start-account-id=" + real, s)
        if fixed != s:
            with open(AUTOSTART, "w") as f:
                f.write(fixed)
    except OSError as e:
        print(f"could not update {AUTOSTART}: {e}")


def someone_is_watching():
    """An open connection to the screen - Remote Desktop or the web page. Local check only.

    Fails towards NO: a wrong "yes" postpones restarting a dead Linked Helper.
    """
    try:
        out = sh(f"ss -tn state established '( sport = :{VNC_PORT} )' 2>/dev/null")
    except Exception:
        return False
    return len([l for l in out.splitlines() if str(VNC_PORT) in l]) > 0


def hold_off(now=None):
    """True while a person on the screen is still inside their HOLD_OFF_S. Starts the clock on
    first call; clear_hold_off() resets it."""
    now = now or time.time()
    try:
        with open(HOLD_OFF_FILE) as f:
            since = float(f.read().strip())
    except (OSError, ValueError):
        since = now
        try:
            os.makedirs(os.path.dirname(HOLD_OFF_FILE), exist_ok=True)
            with open(HOLD_OFF_FILE, "w") as f:
                f.write(str(since))
        except OSError:
            return False     # cannot keep time, so cannot promise an end - do not hold off
    return (now - since) < HOLD_OFF_S


def clear_hold_off():
    try:
        os.remove(HOLD_OFF_FILE)
    except OSError:
        pass


def start_lh(conf):
    subprocess.Popen(
        [conf["LH_BIN"], f"--start-account-id={conf['LH_ACCOUNT_ID']}"],
        env={**os.environ, "DISPLAY": ":0"},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def devtools_ports(pids):
    # The port is random every launch (--remote-debugging-port=0) - discover, never hardcode.
    ports = []
    out = sh("ss -ltnp 2>/dev/null || true")
    for line in out.splitlines():
        if "linked-helper" not in line:
            continue
        m = re.search(r"[\d.\[\]:]*:(\d+)\s", line)
        if m:
            ports.append(int(m.group(1)))
    return sorted(set(ports))


def http_json(url, timeout=3):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode())


def find_ui_page():
    for port in devtools_ports(lh_pids()):
        for host in ("127.0.0.1", "[::1]"):
            try:
                http_json(f"http://{host}:{port}/json/version")
                for page in http_json(f"http://{host}:{port}/json/list"):
                    if page.get("type") == "page" and page.get("title") == "Linked Helper 2":
                        return page["webSocketDebuggerUrl"]
            except Exception:
                continue
    return None


PRESS_JS = (
    '(function(){var re=/^start campaigns runner$/i;'
    'var els=[].slice.call(document.querySelectorAll(\'button,[role="button"],div,span\'))'
    '.filter(function(e){var t=(e.innerText||"").trim();return re.test(t)&&e.offsetParent!==null;});'
    'if(!els.length)return "NOT FOUND";'
    'var b=els.filter(function(e){return e.tagName==="BUTTON";})[0]||els[0];'
    'b.click();return "CLICKED <"+b.tagName+">";})()'
)


async def press_start(ws_url):
    import websockets
    async with websockets.connect(ws_url, max_size=2**22) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                                  "params": {"expression": PRESS_JS, "returnByValue": True}}))
        for _ in range(30):
            resp = json.loads(await ws.recv())
            if resp.get("id") == 1:
                return resp.get("result", {}).get("result", {}).get("value")
    return "NO RESPONSE"


def backup_state():
    """What the nightly backup last managed, as it left /var/lib/lh-backup-state.json.

    Carried on every watchdog report so the server learns the age of the newest
    OFFSITE copy without a second endpoint, a second secret or a second thing to
    install. Best-effort by design: a machine with no backup job, or a state file
    that is missing or malformed, reports {} and the watchdog carries on. Losing
    the backup line must never cost the health line.
    """
    try:
        with open("/var/lib/lh-backup-state.json") as f:
            st = json.load(f)
        if not isinstance(st, dict):
            return {}
        return {k: st.get(k) for k in ("last_run", "last_ok", "result", "what") if st.get(k)}
    except Exception:
        return {}


def campaign_state(account_id, data_dir=None):
    """What the campaigns have actually done, read from Linked Helper's own database.

    WHY (8 Oct 2026): Rick Wong's campaign sent nothing for two days and nobody knew - the window
    title said RUNNING the whole time. The server now warns when invitations stop and before a
    trial runs out, and both need facts only the database has:
      first_action_at   the first campaign action ever recorded - the trial's 14 days start here
      last_invite_at    the newest invitation actually sent
      waiting_running   people queued to be invited in campaigns that are switched on
      waiting_paused    people queued in campaigns that are paused
    Read-only (mode=ro), a few cheap queries. Best-effort: anything odd returns {} and the
    watchdog carries on - losing this block must never cost the health line.
    """
    acct = str(account_id or "").strip()
    if not acct.isdigit() or int(acct) <= 1:
        return {}
    db = os.path.join(data_dir or LH_DATA, "Partitions", f"linked-helper-account-{acct}-main", "lh.db")
    if not os.path.exists(db):
        return {}
    try:
        import sqlite3
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        try:
            invite_actions = ("SELECT DISTINCT av.action_id FROM action_versions av "
                              "JOIN action_configs ac ON ac.id = av.config_id "
                              "WHERE ac.actionType = 'InvitePerson'")
            first = con.execute("SELECT min(created_at) FROM action_results").fetchone()[0]
            last = con.execute(
                "SELECT max(ar.created_at) FROM action_results ar "
                "JOIN action_versions av ON av.id = ar.action_version_id "
                f"WHERE ar.result = 1 AND av.action_id IN ({invite_actions})").fetchone()[0]
            waiting = {0: 0, 1: 0}
            for paused, n in con.execute(
                    "SELECT c.is_paused, count(*) FROM action_target_people t "
                    "JOIN actions a ON a.id = t.action_id "
                    "JOIN campaigns c ON c.id = a.campaign_id "
                    f"WHERE t.state = 1 AND c.is_archived = 0 AND t.action_id IN ({invite_actions}) "
                    "GROUP BY c.is_paused"):
                waiting[1 if paused else 0] = int(n)
        finally:
            con.close()
        return {"first_action_at": first, "last_invite_at": last,
                "waiting_running": waiting[0], "waiting_paused": waiting[1]}
    except Exception as e:
        print(f"campaign state unreadable (non-fatal): {e}")
        return {}


def restart_wanted():
    """True once, when lh-first-run.py has left its flag. Reading it uses it up."""
    if not os.path.exists(RESTART_NOW):
        return False
    try:
        os.remove(RESTART_NOW)
    except OSError:
        pass
    return True


def first_run_state():
    """One line from lh-first-run.py about the machine finishing its own setup, for a week after
    it last changed - long enough to be seen, not so long it becomes wallpaper. Best-effort."""
    path = "/var/lib/lh-first-run.json"
    try:
        if time.time() - os.path.getmtime(path) > 7 * 86400:
            return ""
        with open(path) as f:
            return str(json.load(f).get("summary") or "")[:90]
    except Exception:
        return ""


def report(conf, payload):
    if not conf.get("REPORT_URL"):
        return
    try:
        req = urllib.request.Request(
            conf["REPORT_URL"], data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json",
                     "x-lh-machine-secret": conf.get("REPORT_SECRET", "")})
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:
        print(f"report failed (non-fatal): {e}")


def main():
    conf = load_conf()
    actions = []

    health = parse_title(instance_title())
    print(f"health: {health}")

    accounts = known_accounts()
    real = account_to_adopt(conf.get("LH_ACCOUNT_ID"), accounts)
    if real:
        print(f"config says account {conf.get('LH_ACCOUNT_ID')}, this machine has {real} - adopting it")
        adopt_account(conf, real, actions)

    if health["state"] != "NOT OPEN":
        clear_hold_off()
    elif not accounts:
        # Nobody has ever signed in here. Keep the Launcher up for them and wait - see the header.
        if not lh_pids():
            actions.append("opened-launcher")
            start_lh(conf)
        health["state"] = "WAITING FOR SIGN-IN"
        print("nobody has signed in on this machine yet - leaving the Launcher alone")
    elif restart_wanted():
        # lh-first-run.py has just finished an import and needs Linked Helper back NOW. The person
        # on the screen is who that was done for, so there is nobody to hold off for.
        print("restart asked for by the first-run job - not holding off")
    elif someone_is_watching() and hold_off():
        health["state"] = "NOT OPEN - IN USE"
        print("no instance window, but someone is on the screen - holding off")

    # Decide from the WINDOW, not from process presence: stray child processes
    # with no instance window used to leave the watchdog doing nothing at all.
    if health["state"] == "NOT OPEN":
        clear_hold_off()
        actions.append("started-lh")
        print("no Linked Helper instance window - starting it")
        subprocess.run("pkill -f '[l]inked-helper' || true", shell=True)
        time.sleep(5)
        start_lh(conf)
        # Poll until it settles rather than guessing a fixed wait - the app
        # shows "Initializing..."/"Loading..." for a while, and a fixed 60s
        # landed mid-load and wasted the whole cycle.
        for _ in range(18):          # up to ~3 min
            time.sleep(10)
            health = parse_title(instance_title())
            if health["state"] in ("IDLE", "RUNNING"):
                break
        print(f"health after start: {health}")

    if health["state"] == "IDLE":
        ws_url = find_ui_page()
        if ws_url:
            # asyncio.run, not get_event_loop(): Python 3.14 (Ubuntu 26.04) no longer creates
            # a loop implicitly and raises RuntimeError, which crashed the watchdog on every
            # IDLE cycle on the first Binary Lane build (Julian Davis, 9 Sep 2026).
            result = asyncio.run(press_start(ws_url))
            # Straight after a start the button is not drawn yet: Rick Wong's machine 1 Oct 2026
            # got NOT FOUND and his campaign waited another whole round. Try again a few times.
            tries = 1
            while result == "NOT FOUND" and "started-lh" in actions and tries < 4:
                time.sleep(15)
                tries += 1
                result = asyncio.run(press_start(ws_url))
            actions.append(f"press:{result}")
            print(f"press result: {result}")
            time.sleep(20)
            health = parse_title(instance_title())
            print(f"health after press: {health}")
        else:
            actions.append("press:NO-DEVTOOLS-PAGE")
            print("could not find the LH UI page on any DevTools port")

    report(conf, {"client_id": conf.get("CLIENT_ID"),
                  "account_id": conf.get("LH_ACCOUNT_ID"),
                  "health": health, "actions": actions, "ts": int(time.time()),
                  "backup": backup_state(),
                  "setup": first_run_state(),
                  "campaign": campaign_state(health.get("account") or conf.get("LH_ACCOUNT_ID")),
                  "machine": machine_info() if conf.get("REPORT_URL") else {}})

    # Non-zero exit makes failures visible in systemd/journalctl.
    if health["state"] not in ("RUNNING",) and actions:
        sys.exit(1)


if __name__ == "__main__":
    main()
