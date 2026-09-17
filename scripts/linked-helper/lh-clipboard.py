#!/usr/bin/env python3
"""Linked Helper machine clipboard agent - collects text left for this machine and pastes it.

WHY THIS EXISTS (Rick Wong, 17 Sep 2026): you cannot paste from your own laptop into one of these
machines. Not a missing setting - a consequence of the design. The desktop is ONE always-on screen
(x11vnc on :0) so Linked Helper keeps running with nobody connected and Guy and the client see the
same thing; xrdp bridges onto that screen rather than starting a session of its own, and the
clipboard only travels on a session of its own. xrdp-chansrv, which carries it, is never started
on this session type. Every clipboard setting on the machine is already correct and always was.

So the text comes the other way: somebody asks Claude to send it (wingguy_send_to_machine), it
waits on the server, and this agent collects it and puts it on the clipboard here. Ctrl+V.

THE POLLING RULE - this is the whole design, do not "simplify" it:
  Check LOCALLY, every couple of seconds, whether anyone is actually looking at the screen. That
  is a cheap `ss` call and costs nothing. Only talk to the server when someone IS looking, or
  every HEARTBEAT_SECONDS otherwise. An unwatched machine therefore makes almost no requests, and
  a watched one feels instant. Polling the server on a fixed fast interval instead would be
  thousands of pointless requests a day per machine, multiplied by every client.

Someone is "looking" when there is an established TCP connection to the VNC port: xrdp opens one
for the length of an RDP session, and a direct VNC viewer would too.

Config: /etc/linked-helper-machine.conf (written by setup-ubuntu-vps.sh). No REPORT_URL means no
clipboard service - the agent idles quietly rather than failing, exactly like the watchdog's report.

Runs as the desktop user with DISPLAY=:0, under lh-clipboard.service (Restart=always).
"""
import os
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

CONF = "/etc/linked-helper-machine.conf"

WATCHED_POLL_SECONDS = 2        # someone is on the screen - this is the "instant" path
HEARTBEAT_SECONDS = 300         # nobody watching - match the watchdog's cadence, no more
VNC_PORT = 5900
HTTP_TIMEOUT = 8


def load_conf():
    conf = {}
    try:
        with open(CONF) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    conf[k] = v
    except FileNotFoundError:
        pass
    return conf


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()


def someone_is_watching():
    """Established connection to the VNC port = an RDP or VNC session is open on the screen.

    Local only - no network, no server. Fails SAFE: if `ss` is missing or odd, say yes, because a
    slightly chattier agent is a much smaller problem than a paste that never arrives.
    """
    try:
        out = sh(f"ss -tn state established '( sport = :{VNC_PORT} )' 2>/dev/null")
    except Exception:
        return True
    if not out:
        return False
    # First line is the header when there are rows; no rows means nobody is connected.
    return len([ln for ln in out.splitlines() if ":%d" % VNC_PORT in ln]) > 0


def set_clipboard(text):
    """Put text on the X clipboard, and on PRIMARY too so middle-click works.

    X11 has no clipboard daemon: whichever process last claimed the selection SERVES it, so the
    helper has to stay alive afterwards. Hence -loops 0 ("serve indefinitely") and a detached
    process - without the first, the text vanishes after one paste; without the second, xclip
    blocks this loop forever. Each new call takes ownership and the previous owner exits.

    CLOSE STDIN. xclip reads until end-of-input before it claims the selection, so a pipe left
    open means it waits forever and the clipboard never changes - while everything here still
    reports success. That was the first version of this function (17 Sep 2026): the agent logged
    "pasted 77 chars" and the clipboard was untouched.
    """
    env = {**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":0")}
    data = text.encode("utf-8")
    ok = False
    for sel in ("clipboard", "primary"):
        try:
            p = subprocess.Popen(
                ["xclip", "-selection", sel, "-loops", "0"],
                stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                env=env, start_new_session=True,
            )
            p.stdin.write(data)
            p.stdin.close()          # the handover - see above
            ok = True
        except Exception as e:
            print(f"xclip {sel} failed: {e}", flush=True)
    return ok


def collect(conf):
    """Ask the server for anything waiting. Returns the text, or None. Never raises."""
    url = conf.get("REPORT_URL", "").rstrip("/") + "/clipboard"
    req = urllib.request.Request(
        url, headers={"x-lh-machine-secret": conf.get("REPORT_SECRET", "")})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            payload = json.loads(r.read().decode())
        return payload.get("clipboard") or None
    except urllib.error.HTTPError as e:
        # 401 means the secret is wrong or absent - worth saying loudly, once per occurrence.
        print(f"clipboard poll rejected ({e.code})", flush=True)
    except Exception as e:
        print(f"clipboard poll failed (non-fatal): {e}", flush=True)
    return None


def main():
    conf = load_conf()
    if not conf.get("REPORT_URL"):
        print("no REPORT_URL in %s - clipboard service not configured; idling" % CONF, flush=True)
        # Exit 0, not a crash loop: this machine simply has no clipboard service.
        return
    if not shutil.which("xclip"):
        print("xclip is not installed - cannot set the clipboard. Install it and restart.", flush=True)
        sys.exit(1)

    print("clipboard agent up: watched poll %ss, heartbeat %ss"
          % (WATCHED_POLL_SECONDS, HEARTBEAT_SECONDS), flush=True)

    last_server_poll = 0.0
    while True:
        try:
            watching = someone_is_watching()
            now = time.time()
            due = watching or (now - last_server_poll >= HEARTBEAT_SECONDS)
            if due:
                last_server_poll = now
                text = collect(conf)
                if text:
                    if set_clipboard(text):
                        print("pasted %d chars onto the clipboard" % len(text), flush=True)
        except Exception as e:
            # The loop must outlive anything - a dead agent is a silently broken clipboard.
            print(f"cycle error (continuing): {e}", flush=True)
        time.sleep(WATCHED_POLL_SECONDS)


if __name__ == "__main__":
    main()
