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

FILES AS WELL (30 Sep 2026). The same agent, on the same polling rule, also collects a LINK to a
file and fetches the file itself into ~/Downloads. A chat cannot be handed a file, only text, and
nothing can be dragged into a screen in a browser tab - so the owner puts their old Linked
Helper's export in OneDrive, Google Drive or Dropbox and gives their Claude the share link
(wingguy_send_file_to_machine). Before this the file went by email to Guy, which put him in the
middle of every move. What it will and will not keep:
  - only a link from one of those three services, and only over https, redirects included;
  - only a Linked Helper export (.lhd2) or a CSV - decided by what the file IS, not by its name;
  - it is SAVED. Nothing is ever opened or run;
  - a web page is refused and said to be one: that is what a link that needs a sign-in returns.
The outcome is reported back, because "queued" is not "arrived" and only this machine knows.
"""
import os
import json
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

CONF = "/etc/linked-helper-machine.conf"

WATCHED_POLL_SECONDS = 2        # someone is on the screen - this is the "instant" path
HEARTBEAT_SECONDS = 300         # nobody watching - match the watchdog's cadence, no more
VNC_PORT = 5900
HTTP_TIMEOUT = 8

DOWNLOADS = os.path.expanduser("~/Downloads")
MAX_FILE_BYTES = 3 * 1024 ** 3   # the biggest export seen is 1.2 GB (Guy's own); this is the wall
FETCH_TIMEOUT = 60               # per read, not for the whole file
ACCEPTED_HOSTS = ("dropbox.com", "drive.google.com", "drive.usercontent.google.com",
                  "1drv.ms", "onedrive.live.com", "api.onedrive.com", "sharepoint.com")


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


# ------------------------------------------------------------------------------------ files

class Refused(Exception):
    """A fetch that was turned down on purpose. Its message is shown to the person who sent it."""


def accepted_host(url):
    try:
        u = urllib.parse.urlparse(url)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h or host.endswith("." + h) for h in ACCEPTED_HOSTS)


class HttpsOnly(urllib.request.HTTPRedirectHandler):
    """Follow a redirect only to another https address. These services all hand the file over
    from a second host, so the host cannot be pinned - but plain http never has a reason."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not str(newurl).lower().startswith("https://"):
            raise Refused("the link redirected to an address that is not https")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def safe_name(name):
    """A file name that can only ever land inside the Downloads folder."""
    base = os.path.basename(str(name or "").replace("\\", "/")).strip().strip(".")
    base = re.sub(r"[^A-Za-z0-9 ._()\-]+", "_", base)[:120].strip()
    return base or "file-from-link"


def name_from_headers(headers, url):
    cd = headers.get("Content-Disposition") or ""
    m = re.search(r"filename\*\s*=\s*[^']*''([^;]+)", cd, flags=re.I)
    if m:
        return urllib.parse.unquote(m.group(1))
    m = re.search(r'filename\s*=\s*"?([^";]+)"?', cd, flags=re.I)
    if m:
        return m.group(1)
    return urllib.parse.unquote(os.path.basename(urllib.parse.urlparse(url).path))


def what_is_it(path):
    """Decide from the CONTENTS what arrived. Returns (kind, extra) or raises Refused.

    A Linked Helper export opens with a 4-byte length and a JSON header naming its account. A
    web page opens with a tag - which is what a link that needs a sign-in returns, and the most
    likely way for this to go wrong, so it gets its own words.
    """
    with open(path, "rb") as f:
        head = f.read(65536)
    if not head:
        raise Refused("the file that came back was empty")
    n = int.from_bytes(head[:4], "little")
    if 2 <= n <= 60000 and head[4:5] == b"{":
        try:
            hdr = json.loads(head[4:4 + n].decode())
            if isinstance(hdr, dict) and "linkedInAccountId" in hdr:
                return "linked-helper-export", {"account": str(hdr.get("linkedInAccountId")),
                                                "version": str(hdr.get("version") or "")}
        except (ValueError, UnicodeDecodeError):
            pass
    text = head[:4096].decode("utf-8", errors="replace").lstrip("﻿ \r\n\t").lower()
    if text.startswith("<!doctype") or text.startswith("<html") or "<head" in text[:600]:
        raise Refused("the link returned a web page, not the file - it needs a sign-in. "
                      "Share it so that anyone with the link can view it, and send the new link")
    if b"\x00" in head[:4096]:
        raise Refused("that is not a Linked Helper export or a CSV file, so it was not kept")
    first = text.splitlines()[0] if text.splitlines() else ""
    if "," in first or ";" in first or "\t" in first:
        return "csv", {}
    raise Refused("that is not a Linked Helper export or a CSV file, so it was not kept")


def fetch(url, folder=None, opener=None):
    """Fetch url into folder. Returns a report dict. Raises Refused with words for a person."""
    folder = folder or DOWNLOADS
    os.makedirs(folder, exist_ok=True)
    opener = opener or urllib.request.build_opener(HttpsOnly())
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Wingguy machine)"})
    part = os.path.join(folder, ".wingguy-fetch-%d.part" % os.getpid())
    try:
        try:
            r = opener.open(req, timeout=FETCH_TIMEOUT)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise Refused("the link needs a sign-in (the service answered %d). Share it so that "
                              "anyone with the link can view it, and send the new link" % e.code)
            if e.code == 404:
                raise Refused("the service says there is no file at that link (404) - it may have been "
                              "moved, deleted, or the link copied incompletely")
            raise Refused("the service refused the link (answered %d)" % e.code)
        except urllib.error.URLError as e:
            raise Refused("could not reach the service: %s" % e.reason)
        with r:
            declared = r.headers.get("Content-Length")
            if declared and declared.isdigit() and int(declared) > MAX_FILE_BYTES:
                raise Refused("the file is bigger than this machine will take (%d GB)" % (MAX_FILE_BYTES // 1024 ** 3))
            name = safe_name(name_from_headers(r.headers, r.geturl()))
            got = 0
            with open(part, "wb") as out:
                while True:
                    chunk = r.read(1024 * 1024)
                    if not chunk:
                        break
                    got += len(chunk)
                    if got > MAX_FILE_BYTES:
                        raise Refused("the file is bigger than this machine will take (%d GB)" % (MAX_FILE_BYTES // 1024 ** 3))
                    out.write(chunk)
        kind, extra = what_is_it(part)
        ext = ".lhd2" if kind == "linked-helper-export" else ".csv"
        if not name.lower().endswith(ext):
            name = os.path.splitext(name)[0] + ext
        dest = os.path.join(folder, name)
        if os.path.exists(dest):
            stem, e2 = os.path.splitext(name)
            dest = os.path.join(folder, "%s (%s)%s" % (stem, time.strftime("%d %b %H.%M"), e2))
        os.replace(part, dest)
        os.chmod(dest, 0o644)      # a file to read, never one to run
        return dict({"ok": True, "name": os.path.basename(dest), "bytes": got, "kind": kind,
                     "folder": "the Downloads folder"}, **extra)
    finally:
        if os.path.exists(part):
            try:
                os.remove(part)
            except OSError:
                pass


def collect_file(conf):
    """Ask the server whether there is a link to fetch. Returns the job, or None. Never raises."""
    url = conf.get("REPORT_URL", "").rstrip("/") + "/files"
    req = urllib.request.Request(url, headers={"x-lh-machine-secret": conf.get("REPORT_SECRET", "")})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            return json.loads(r.read().decode()).get("file") or None
    except urllib.error.HTTPError as e:
        if e.code != 404:          # 404 = a server that predates this; nothing to say
            print(f"file poll rejected ({e.code})", flush=True)
    except Exception as e:
        print(f"file poll failed (non-fatal): {e}", flush=True)
    return None


def report_file(conf, job_id, report):
    url = conf.get("REPORT_URL", "").rstrip("/") + "/files"
    body = json.dumps(dict(report, id=job_id)).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json", "x-lh-machine-secret": conf.get("REPORT_SECRET", "")})
    try:
        urllib.request.urlopen(req, timeout=HTTP_TIMEOUT).read()
    except Exception as e:
        print(f"file report failed (non-fatal): {e}", flush=True)


def fetch_job(conf, job):
    """One link, start to finish, on its own thread so a big file never holds up the clipboard."""
    try:
        if not accepted_host(job.get("url")) or not accepted_host(job.get("share_url") or job.get("url")):
            raise Refused("that link is not from OneDrive, Google Drive or Dropbox")
        report = fetch(job["url"])
        print("fetched %s (%d bytes, %s)" % (report["name"], report["bytes"], report["kind"]), flush=True)
    except Refused as e:
        report = {"ok": False, "error": str(e)}
        print("fetch refused: %s" % e, flush=True)
    except Exception as e:
        report = {"ok": False, "error": "the fetch failed part-way (%s)" % str(e)[:160]}
        print("fetch failed: %s" % e, flush=True)
    report_file(conf, job.get("id"), report)


# ----------------------------------------------------------------------------------- top-ups
#
# CAMPAIGN TOP-UPS (5 Nov 2026). The same agent, on the same polling rule, also collects a
# TOP-UP: a LinkedIn / Sales Navigator search link the owner gave their Claude (or pasted on the
# top-up page) to put more people into their campaign. Before this, "time to top up the search"
# in the Monday numbers email left the clicks to the client, and clients forgot them. Now
# lh-topup.py puts the search into the campaign as Linked Helper's own auto-collect step, makes
# sure the campaign is running, and this agent reports progress until the collect has finished -
# that final report is the email the owner gets. One top-up at a time; a newer one replaces it.

TOPUP_SCRIPT = next((p for p in ("/usr/local/bin/lh-topup.py",
                                 os.path.join(os.path.dirname(os.path.abspath(__file__)), "lh-topup.py"))
                     if os.path.exists(p)), "/usr/local/bin/lh-topup.py")
TOPUP_PROGRESS_SECONDS = 120      # how often the server hears how the collect is going
TOPUP_STALL_MINUTES = 15          # no new person this long, and LH not on the step = finished
TOPUP_MAX_HOURS = 20              # a huge search runs into LH's daily page limit; stop reporting here
topup_busy = threading.Lock()


def topup_cmd(*args):
    """Run lh-topup.py and parse its one JSON line. Never raises."""
    try:
        r = subprocess.run([sys.executable, TOPUP_SCRIPT, *[str(a) for a in args]],
                           capture_output=True, text=True, timeout=300)
        line = (r.stdout or "").strip().splitlines()
        return json.loads(line[-1]) if line else {"ok": False, "error": "no output from lh-topup.py: %s" % (r.stderr or "")[-200:]}
    except Exception as e:
        return {"ok": False, "error": "lh-topup.py failed: %s" % str(e)[:200]}


def collect_topup(conf):
    """Ask the server whether a top-up is waiting. Returns the job, or None. Never raises."""
    url = conf.get("REPORT_URL", "").rstrip("/") + "/topups"
    req = urllib.request.Request(url, headers={"x-lh-machine-secret": conf.get("REPORT_SECRET", "")})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            return json.loads(r.read().decode()).get("topup") or None
    except urllib.error.HTTPError as e:
        if e.code != 404:          # 404 = a server that predates this; nothing to say
            print(f"top-up poll rejected ({e.code})", flush=True)
    except Exception as e:
        print(f"top-up poll failed (non-fatal): {e}", flush=True)
    return None


def report_topup(conf, job_id, report):
    """Tell the server. Returns False when the server says this job is no longer live (replaced)."""
    url = conf.get("REPORT_URL", "").rstrip("/") + "/topups"
    body = json.dumps(dict(report, id=job_id)).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json", "x-lh-machine-secret": conf.get("REPORT_SECRET", "")})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            return json.loads(r.read().decode()).get("live", True) is not False
    except Exception as e:
        print(f"top-up report failed (non-fatal): {e}", flush=True)
        return True


def topup_job(conf, job):
    """One top-up, start to finish, on its own thread: apply, then report progress until done."""
    if not topup_busy.acquire(blocking=False):
        print("top-up %s skipped - one is already running" % job.get("id"), flush=True)
        return
    try:
        job_id = job.get("id")
        applied = topup_cmd("apply", job.get("campaign_id"), job.get("url"))
        if not applied.get("ok"):
            print("top-up %s refused: %s" % (job_id, applied.get("error")), flush=True)
            report_topup(conf, job_id, {"ok": False, "stage": "final", "error": applied.get("error") or "apply failed"})
            return
        print("top-up %s: %s auto-collect step %s in campaign %s" % (
            job_id, applied.get("how"), applied.get("action_id"), applied.get("campaign_id")), flush=True)
        if not report_topup(conf, job_id, dict(applied, stage="applied")):
            return
        started = time.time()
        quiet_since = started
        while True:
            time.sleep(TOPUP_PROGRESS_SECONDS)
            st = topup_cmd("status", applied["campaign_id"], applied["action_id"], applied["since"])
            if not st.get("ok"):
                print("top-up %s status failed: %s" % (job_id, st.get("error")), flush=True)
                continue
            elapsed_h = (time.time() - started) / 3600
            finished = None
            if st.get("collecting_now"):
                quiet_since = time.time()
            elif st.get("last_collect_at") and (st.get("minutes_since_last") or 0) >= TOPUP_STALL_MINUTES:
                finished = "collect finished - nothing new for %d minutes" % st["minutes_since_last"]
            elif not st.get("last_collect_at") and time.time() - quiet_since > TOPUP_STALL_MINUTES * 60:
                finished = "Linked Helper did not start collecting within %d minutes" % TOPUP_STALL_MINUTES
            if st.get("finished_normally"):
                finished = "collect finished"
            elif st.get("postpone_reason") and st.get("postpone_reason") != "Waiter" and not st.get("collecting_now"):
                # Page credits or a LinkedIn limit: Linked Helper stops and carries on by itself later.
                finished = "Linked Helper paused the collect (%s) - it carries on by itself when the daily page limit resets" % st["postpone_reason"]
            if elapsed_h >= TOPUP_MAX_HOURS and not finished:
                finished = "still collecting after %d hours - a very large search; it carries on by itself" % TOPUP_MAX_HOURS
            stage = "final" if finished else "progress"
            live = report_topup(conf, job_id, dict(st, stage=stage, how=applied.get("how"),
                                                   waiting_before=applied.get("waiting_before"),
                                                   finished_because=finished))
            if finished or not live:
                print("top-up %s %s: %s collected" % (job_id, "done" if finished else "superseded", st.get("collected")), flush=True)
                return
    except Exception as e:
        print("top-up thread failed: %s" % e, flush=True)
        try:
            report_topup(conf, job.get("id"), {"ok": False, "stage": "final", "error": "the machine's top-up step failed part-way (%s)" % str(e)[:160]})
        except Exception:
            pass
    finally:
        topup_busy.release()


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
                job = collect_file(conf)
                if job:
                    threading.Thread(target=fetch_job, args=(conf, job), daemon=True).start()
                # A top-up is only asked for when none is running - the server would hand the same
                # job back and the thread would refuse it, which is noise.
                if not topup_busy.locked():
                    topup = collect_topup(conf)
                    if topup:
                        threading.Thread(target=topup_job, args=(conf, topup), daemon=True).start()
        except Exception as e:
            # The loop must outlive anything - a dead agent is a silently broken clipboard.
            print(f"cycle error (continuing): {e}", flush=True)
        time.sleep(WATCHED_POLL_SECONDS)


if __name__ == "__main__":
    main()
