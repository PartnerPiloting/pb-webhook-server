#!/usr/bin/env python3
"""Create or restore Linked Helper's own .lhd2 backup, with nothing to click.

Why this exists: the nightly job archives the DATA DIRECTORY, which is a fine
copy but is not what Linked Helper accepts back, and is not something a client
could take elsewhere. The .lhd2 is both. Linked Helper will make one on demand -
we just have to reach the function.

Two facts discovered the hard way (7 Sep 2026), both worth not re-deriving:

  * exportBackup lives on the LAUNCHER window only. Calling it on the instance
    gives "this.mainWindow[$] is not a function".
  * The launcher gets NO DevTools port on a normal start - only the instance
    does. So we start the launcher ourselves with --remote-debugging-port=0 and
    WITHOUT --start-account-id, which also means no instance opens: the export
    refuses while the instance is running for that account.

Both commands therefore expect Linked Helper to be stopped, and they leave it
stopped - the caller restarts it.

  lh-lhd2.py export <path>    write a backup   (~75 s for a 1.2 GB database)
  lh-lhd2.py import <path>    restore one

Exit 0 on success, 1 on failure. Everything goes to stdout for the caller's log.
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import zipfile

CONF = "/etc/linked-helper-machine.conf"
LAUNCHER_SETTLE_S = 120     # how long to wait for the launcher UI to appear
CALL_TIMEOUT_S = 900        # a big database can take a while to pack


def say(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%S%z"), "lhd2:", *a, flush=True)


def conf():
    c = {}
    with open(CONF) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                c[k] = v
    return c


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()


def user_data_dir(c):
    return "/home/" + c.get("LH_USER", "lh") + "/.config/linked-helper"


def instance_version(c):
    """Newest installed instance version. Never hardcode it - Linked Helper
    self-updates every few days and a pinned version would quietly rot."""
    d = os.path.join(user_data_dir(c), "Instances")
    versions = [x for x in os.listdir(d) if re.match(r"^\d+\.\d+", x)]
    if not versions:
        raise RuntimeError("no instance versions under " + d)
    return sorted(versions, key=lambda v: [int(n) for n in re.findall(r"\d+", v)])[-1]


def lh_pids():
    # NOTE the [l] - without it pgrep matches the shell running this very command.
    out = sh("pgrep -f '[l]inked-helper' || true")
    return [int(p) for p in out.split() if p.isdigit()]


def stop_lh():
    if not lh_pids():
        return
    subprocess.run("pkill -f '[l]inked-helper'", shell=True)
    for _ in range(30):
        if not lh_pids():
            return
        time.sleep(2)
    subprocess.run("pkill -9 -f '[l]inked-helper'", shell=True)
    time.sleep(3)


def start_launcher_alone(c):
    """Launcher only, with a DevTools port. No --start-account-id => no instance."""
    user = c.get("LH_USER", "lh")
    subprocess.Popen(
        ["sudo", "-u", user, "env", "DISPLAY=:0", "setsid",
         c["LH_BIN"], "--remote-debugging-port=0"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def devtools_ports():
    ports = []
    for line in sh("ss -ltnp 2>/dev/null || true").splitlines():
        if "linked-helper" in line:
            m = re.search(r"[\d.\[\]:]*:(\d+)\s", line)
            if m:
                ports.append(int(m.group(1)))
    return sorted(set(ports))


def find_launcher_page():
    """The launcher serves its own UI over http; the instance page is a file:// URL.
    Both are titled "Linked Helper 2", so match on the URL, not the title."""
    for port in devtools_ports():
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/json/list" % port, timeout=4) as r:
                for t in json.loads(r.read().decode()):
                    url = t.get("url") or ""
                    if t.get("type") == "page" and url.startswith("http://localhost:"):
                        return t["webSocketDebuggerUrl"]
        except Exception:
            continue
    return None


READY_JS = (
    "(function(){try{var s=window.mainWindowService;"
    "return !!(s&&s.mainWindow&&typeof s.mainWindow.%s===\"function\");}"
    "catch(e){return false;}})()"
)


async def eval_js(ws_url, expr, timeout=20):
    import websockets
    async with websockets.connect(ws_url, max_size=2 ** 24, open_timeout=timeout) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": expr, "returnByValue": True, "awaitPromise": True}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
            if msg.get("id") == 1:
                return msg.get("result", {}).get("result", {}).get("value")
    return None


def wait_for_launcher(method):
    """A page appearing is NOT the same as the page being usable. The launcher
    serves its DevTools target within a few seconds but takes ~25 s to build the
    UI, and calling too early gives "Cannot read properties of undefined
    (reading 'callWrite')" - which is exactly what happened on the first live
    run. So poll for the function itself, not for the page."""
    deadline = time.time() + LAUNCHER_SETTLE_S
    seen_page = False
    while time.time() < deadline:
        ws = find_launcher_page()
        if ws:
            if not seen_page:
                say("launcher page is up - waiting for it to finish loading")
                seen_page = True
            try:
                if asyncio.run(eval_js(ws, READY_JS % method)) is True:
                    return ws
            except Exception:
                pass
        time.sleep(3)
    if seen_page:
        say("the launcher page never exposed %s in %ds" % (method, LAUNCHER_SETTLE_S))
    return None


async def call_main_window(ws_url, method, args):
    """mainWindowService.callWrite(name, ...) forwards to the launcher's main window."""
    import websockets
    js = (
        "(async function(){try{"
        "await window.mainWindowService.callWrite(" + json.dumps(method) + ", " + json.dumps(args) + ");"
        "return JSON.stringify({ok:true});"
        "}catch(e){return JSON.stringify({ok:false,error:String(e&&e.message||e).slice(0,400)});}})()"
    )
    async with websockets.connect(ws_url, max_size=2 ** 24, open_timeout=30) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": js, "returnByValue": True, "awaitPromise": True}}))
        deadline = time.time() + CALL_TIMEOUT_S
        while time.time() < deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=max(5, deadline - time.time()))
            msg = json.loads(raw)
            if msg.get("id") == 1:
                # DevTools reports a destroyed context (page reloaded mid-call) as a
                # top-level "error", not inside "result". The first version only
                # looked in "result" and reported it as "no value returned".
                if "error" in msg:
                    return {"ok": False, "error": "devtools: " + json.dumps(msg["error"])[:400]}
                res = msg.get("result", {})
                if "exceptionDetails" in res:
                    return {"ok": False, "error": json.dumps(res["exceptionDetails"])[:400]}
                value = res.get("result", {}).get("value")
                if not value:
                    return {"ok": False, "error": "no value; raw reply: " + json.dumps(res)[:400]}
                return json.loads(value)
    return {"ok": False, "error": "timed out"}


def ensure_writable(path, user):
    """The launcher runs as the LH user, but this tool is run by root (cron). A
    directory root creates is 755 and the launcher cannot write into it - the
    export then runs its full ~90 s and produces nothing. That was the second
    live failure. So own the directory to the LH user and prove it is writable."""
    import shutil
    d = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(d, exist_ok=True)
    try:
        shutil.chown(d, user=user, group=user)
    except Exception as e:
        say("could not chown %s to %s (%s) - continuing, the write test decides" % (d, user, e))
    probe = subprocess.run(["sudo", "-u", user, "test", "-w", d])
    if probe.returncode != 0:
        raise RuntimeError("user %s cannot write to %s" % (user, d))
    if os.path.exists(path):
        os.remove(path)     # so a stale file can never be mistaken for this run's


def wait_for_file(path, quiet_s=10, timeout_s=300):
    """The file on disk is the success signal, whatever the JS reply said. Wait
    for it to appear and stop growing."""
    deadline = time.time() + timeout_s
    last = -1
    while time.time() < deadline:
        if os.path.exists(path):
            size = os.path.getsize(path)
            if size == last and size > 0:
                return True
            last = size
        time.sleep(quiet_s)
    return os.path.exists(path) and os.path.getsize(path) > 0


def verify(path):
    """A .lhd2 is a 4-byte header length, a JSON header, then a zip holding lh.db.
    Check the header agrees with the zip - a truncated write is the likely failure."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        n = int.from_bytes(f.read(4), "little")
        hdr = json.loads(f.read(n).decode())
    tmp = path + ".zipcheck"
    subprocess.run("tail -c +%d '%s' > '%s'" % (4 + n + 1, path, tmp), shell=True, check=True)
    try:
        z = zipfile.ZipFile(tmp)
        names = z.namelist()
        if names != ["lh.db"]:
            raise RuntimeError("unexpected zip contents: %s" % names)
        entry = z.getinfo("lh.db")
        if entry.file_size != hdr["size"]:
            raise RuntimeError("header says %d bytes, zip holds %d" % (hdr["size"], entry.file_size))
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    say("verified: %d bytes on disk, holds lh.db of %d bytes, version %s, account %s"
        % (size, hdr["size"], hdr.get("version"), hdr.get("linkedInAccountId")))
    return hdr


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("export", "import"):
        print(__doc__)
        return 1
    action, path = sys.argv[1], sys.argv[2]
    c = conf()

    if action == "import" and not os.path.exists(path):
        say("FAILED: no such file " + path)
        return 1

    account = int(c["LH_ACCOUNT_ID"])
    version = instance_version(c)
    user = c.get("LH_USER", "lh")
    say("%s account %s, instance version %s, path %s" % (action, account, version, path))

    if action == "export":
        try:
            ensure_writable(path, user)
        except Exception as e:
            say("FAILED before starting: %s" % e)
            return 1

    if lh_pids():
        say("Linked Helper is running - stopping it (the export refuses while the instance is up)")
        stop_lh()

    say("starting the launcher alone, with a DevTools port")
    start_launcher_alone(c)
    ws = wait_for_launcher(action + "Backup")
    if not ws:
        say("FAILED: the launcher never became usable")
        stop_lh()
        return 1
    # The function existing is necessary, not sufficient - the by-hand run that
    # worked had waited 25 s. Give the launcher a moment to finish settling.
    time.sleep(10)
    say("launcher ready")

    t0 = time.time()
    result = asyncio.run(call_main_window(
        ws, action + "Backup",
        {"linkedInAccountId": account, "version": version, "backupPath": path}))
    took = round(time.time() - t0, 1)
    say("launcher replied after %ss: %s" % (took, json.dumps(result)))

    if action == "export":
        # Whatever the reply said, the file is the truth.
        if not wait_for_file(path):
            say("FAILED: no file appeared at %s" % path)
            stop_lh()
            return 1

    say("stopping the launcher")
    stop_lh()

    if action == "import":
        if not result.get("ok"):
            say("FAILED: %s" % result.get("error"))
            return 1
        say("import finished in %ss" % took)
        return 0

    try:
        verify(path)
    except Exception as e:
        say("FAILED verification: %s" % e)
        return 1
    if not result.get("ok"):
        say("note: the launcher reported a problem but the file verifies - treating as success")
    say("export finished in %ss" % took)
    return 0


if __name__ == "__main__":
    sys.exit(main())
