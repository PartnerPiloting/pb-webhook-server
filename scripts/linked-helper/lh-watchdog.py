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

Config: /etc/linked-helper-machine.conf (written by setup-ubuntu-vps.sh).
Status: WRITTEN 2026-08-29, NOT YET RUN ON A REAL VPS.
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


def lh_pids():
    out = sh("pgrep -f 'linked-helper' || true")
    return [int(p) for p in out.split() if p.isdigit()]


def instance_title():
    # The instance window title carries the whole health picture.
    out = sh("wmctrl -l | grep 'Instance #' || true")
    if not out:
        out = sh("xdotool search --name 'Instance #' getwindowname %@ 2>/dev/null | head -1 || true")
        return out
    return out.split(None, 3)[3] if len(out.split(None, 3)) == 4 else out


def parse_title(t):
    if not t:
        return {"state": "NOT OPEN", "linkedin": "unknown", "account": None, "version": None}
    m = re.search(r"Instance #(\d+)", t)
    v = re.search(r"\|\s*([\d.]+)\s*\|", t)
    if "Running campaigns" in t:
        state = "RUNNING"
    elif re.search(r"\|\s*Idle\s*\|", t):
        state = "IDLE"
    else:
        state = "UNKNOWN"
    linkedin = "ok" if "LinkedIn logged in" in t else "LOGGED OUT"
    return {"state": state, "linkedin": linkedin,
            "account": m.group(1) if m else None,
            "version": v.group(1) if v else None}


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

    if not lh_pids():
        actions.append("started-lh")
        print("Linked Helper not running - starting it")
        start_lh(conf)
        time.sleep(45)  # give the instance time to open before reading state

    health = parse_title(instance_title())
    print(f"health: {health}")

    if health["state"] == "IDLE":
        ws_url = find_ui_page()
        if ws_url:
            result = asyncio.get_event_loop().run_until_complete(press_start(ws_url))
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
                  "health": health, "actions": actions, "ts": int(time.time())})

    # Non-zero exit makes failures visible in systemd/journalctl.
    if health["state"] not in ("RUNNING",) and actions:
        sys.exit(1)


if __name__ == "__main__":
    main()
