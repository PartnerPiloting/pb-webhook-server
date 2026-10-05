#!/usr/bin/env python3
"""Reconnect removals - collect the people this client approved for disconnection and put them in
Linked Helper's removal campaign.

WHY THIS EXISTS (Guy, 5 Oct 2026): on the Follow-Ups screen a client presses Disconnect on a person,
or approves a batch of suggested disconnects. Nothing on the server can remove a LinkedIn
connection - only this machine's Linked Helper can. So once a night, shortly before the removal
campaign's window (midnight to 5am - never while a person is using LinkedIn by day), this script:

  1. asks the server for the approved profile links nobody has collected yet
     (GET <REPORT_URL>/removals, behind this machine's own secret - it can only get its own client's);
  2. makes sure the campaign "Remove approved connections" exists (built from recipe 04 if not);
  3. adds the links to that campaign's queue - the same command as the UI's "Add people by URL";
  4. makes sure the campaign is switched on;
  5. tells the server which people it took (POST <REPORT_URL>/removals), and only then does the
     screen stop offering Undo for them.

If step 3 fails nothing is confirmed, so the same people are offered again the next night.
Nothing to collect is the normal answer and costs one small request.

Run nightly by cron as root (see setup-ubuntu-vps.sh):  50 23 * * *  lh-removals.py
  lh-removals.py            do it
  lh-removals.py --dry-run  show what would be collected; change nothing

Config: /etc/linked-helper-machine.conf (REPORT_URL, REPORT_SECRET). No REPORT_URL = nothing to do.
"""
import importlib.util
import json
import os
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CAMPAIGN_NAME = "Remove approved connections"
ACTION_TYPE = "RemoveFromFirstConnection"
RECIPE_NAMES = ("04-remove-connections.json",)
RECIPE_DIRS = (os.path.join(HERE, "campaigns"), "/usr/local/share/linked-helper/campaigns", HERE)


def say(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%S%z"), "removals:", *a, flush=True)


def load_builder():
    """lh-campaigns.py has a hyphen in its name, so it is loaded by path."""
    for d in (HERE, "/usr/local/share/linked-helper/campaigns", "/usr/local/bin"):
        p = os.path.join(d, "lh-campaigns.py")
        if os.path.exists(p):
            spec = importlib.util.spec_from_file_location("lh_campaigns", p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise RuntimeError("lh-campaigns.py not found beside this script")


def find_recipe():
    for d in RECIPE_DIRS:
        for n in RECIPE_NAMES:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return p
    return None


def call(url, secret, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET", headers={
        "Content-Type": "application/json", "x-lh-machine-secret": secret})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def campaign_id(b, c):
    with b.db(c) as con:
        rows = [r for r in b.campaign_rows(con) if r["name"] == CAMPAIGN_NAME and not r["is_archived"]]
    return (rows[0]["id"], bool(rows[0]["is_paused"])) if rows else (None, None)


def main():
    dry = "--dry-run" in sys.argv
    b = load_builder()
    c = b.conf()
    url = (c.get("REPORT_URL") or "").rstrip("/")
    secret = c.get("REPORT_SECRET") or ""
    if not url or not secret:
        say("no REPORT_URL / REPORT_SECRET in the machine config - nothing to do")
        return 0

    people = [p for p in (call(url + "/removals", secret).get("people") or []) if p.get("link") and p.get("key")]
    if not people:
        say("nothing approved for removal")
        return 0
    say(f"{len(people)} approved for removal")
    if dry:
        for p in people[:20]:
            say("  would add", p["link"])
        return 0

    cid, paused = campaign_id(b, c)
    if cid is None:
        recipe = find_recipe()
        if not recipe:
            say("FAILED: no removal campaign and no recipe 04 on this machine")
            return 1
        say("building the removal campaign from", recipe)
        if b.cmd_create(c, recipe) != 0:
            return 1
        cid, paused = campaign_id(b, c)
        if cid is None:
            say("FAILED: the campaign was not there after building it")
            return 1

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write("\n".join(p["link"] for p in people) + "\n")
        path = f.name
    try:
        if b.cmd_queue(c, cid, path, ACTION_TYPE) != 0:
            say("FAILED: could not add them to the campaign - nothing confirmed, they will be offered again")
            return 1
    finally:
        os.unlink(path)

    if paused:
        b.cmd_set_paused(c, cid, False)

    r = call(url + "/removals", secret, {"queued": [p["key"] for p in people]})
    say(f"confirmed to the server: {r.get('count')} marked as handed to Linked Helper")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never a traceback into cron mail - one plain line
        say("FAILED:", e)
        sys.exit(1)
