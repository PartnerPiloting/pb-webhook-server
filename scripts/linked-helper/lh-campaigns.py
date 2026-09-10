#!/usr/bin/env python3
"""Build Linked Helper campaigns from a recipe, with nothing to click.

Why this exists: every client used to get campaigns built by hand in a screen-share, or
from a CSV template that carried Guy's webhook and could not be edited (LH rejects a
changed file). This script asks the running Linked Helper instance to create the
campaign itself - the same internal command the "Create campaign" button uses - with
the client's own webhook address filled in from the machine config.

How it reaches Linked Helper (discovered 11 Sep 2026, see memory
"project_lh_campaign_automation_discovery"): the instance runs with a DevTools port.
Its interface page is a webpack bundle; pushing a fake chunk hands back the bundle's
require(), and the module whose source contains `async _callWriteImpl` exports the
data-layer singleton with callRead/callWrite. `callWrite("people.campaigns.createCampaign",
{name, excludeList, actions, liAccount})` is exactly what the UI sends.

  ⚠ NEVER touch window.mainWindowService.mainWindow / browserWindow / window /
    contentWindow from a probe. They are @electron/remote proxies; enumerating them
    raised "An object could not be cloned" in the MAIN process, put up a modal error
    dialog, hung DevTools and killed the instance (Guy's box, 11 Sep 2026).
  ⚠ Module ids drift with every LH update - the data layer is found by TEXT, never by id.
  ⚠ Working hours are stored in UTC minutes. Recipes are written in the machine's
    LOCAL time (the VPS carries the client's TZ) and converted here, which matches what
    the LH interface shows (it displays with the machine's fixed UTC offset).

Commands (run as root or the LH user; the DB is read with mode=ro, never written):

  lh-campaigns.py list                         campaigns in the database
  lh-campaigns.py show <campaign-id>           every action, setting and hour (UTC + local)
  lh-campaigns.py diff <id-a> <id-b>           field-by-field comparison of two campaigns
  lh-campaigns.py plan <recipe.json>           print the payload that WOULD be sent, no LH contact
  lh-campaigns.py export <campaign-id> [--name NAME] [--out recipe.json]
                                               existing campaign -> recipe (webhook -> placeholder,
                                               hours -> local), with a round-trip check
  lh-campaigns.py create <recipe.json> [--name NAME] [--compare ID] [--force]
                                               create it through the running instance

Idempotent: `create` skips when a non-archived campaign of the same name exists.
Refuses while an action is mid-flight (title says "Running campaign #N") unless --force;
the runner sleeping ("Running campaigns...") or "Idle" is fine. Exit 0 = created or
already there, 1 = failed. Everything goes to stdout for the caller's log.
"""
import argparse
import asyncio
import datetime as dt
import glob
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request

CONF = "/etc/linked-helper-machine.conf"
WEBHOOK_BASE = "https://pb-webhook-server.onrender.com/lh-webhook/upsertLeadOnly?client="
MIN_IN_DAY = 1440
MIN_IN_WEEK = 7 * MIN_IN_DAY
UI_URL_MARK = "front/build/index.html"   # the instance interface page, vs LinkedIn tabs
CALL_TIMEOUT_S = 120


def say(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%S%z"), "campaigns:", *a, flush=True)


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()


def conf():
    c = {}
    if os.path.exists(CONF):
        with open(CONF) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    c[k] = v
    return c


# ---------------------------------------------------------------- database (read-only)

def db_path(c):
    user = c.get("LH_USER", "lh")
    acct = c.get("LH_ACCOUNT_ID")
    pattern = f"/home/{user}/.config/linked-helper/Partitions/linked-helper-account-{acct or '*'}-main/lh.db"
    hits = sorted(glob.glob(pattern))
    if not hits:
        raise RuntimeError("no lh.db at " + pattern)
    return hits[0]


def db(c):
    con = sqlite3.connect("file:%s?mode=ro" % db_path(c), uri=True)
    con.row_factory = sqlite3.Row
    return con


def li_account_db_id(con, c):
    """createCampaign wants the DB row id from li_accounts, NOT the 16045-style account number."""
    acct = c.get("LH_ACCOUNT_ID")
    row = con.execute("SELECT id, external_id, full_name FROM li_accounts WHERE external_id = ?", (acct,)).fetchone()
    if row:
        return row["id"], row["full_name"]
    rows = con.execute("SELECT id, external_id, full_name FROM li_accounts").fetchall()
    if len(rows) == 1:
        return rows[0]["id"], rows[0]["full_name"]
    raise RuntimeError(f"cannot pick the LinkedIn account: LH_ACCOUNT_ID={acct}, rows={[dict(r) for r in rows]}")


def campaign_rows(con):
    return con.execute(
        "SELECT id, name, is_paused, is_archived, is_valid, created_at FROM campaigns ORDER BY id").fetchall()


def campaign_detail(con, cid):
    """Everything LH stores for one campaign, in workflow order, ready to diff."""
    camp = con.execute("SELECT * FROM campaigns WHERE id = ?", (cid,)).fetchone()
    if not camp:
        raise RuntimeError(f"no campaign {cid}")
    ver = con.execute("SELECT id, exclude_list_id FROM campaign_versions WHERE campaign_id = ? ORDER BY id DESC LIMIT 1",
                      (cid,)).fetchone()
    actions = []
    if ver:
        for (aid,) in con.execute("SELECT action_id FROM campaign_version_actions WHERE version_id = ? ORDER BY id",
                                  (ver["id"],)).fetchall():
            a = con.execute("SELECT id, name, description FROM actions WHERE id = ?", (aid,)).fetchone()
            av = con.execute("SELECT id, config_id, exclude_list_id FROM action_versions WHERE action_id = ? ORDER BY id DESC LIMIT 1",
                             (aid,)).fetchone()
            cfg = con.execute("SELECT * FROM action_configs WHERE id = ?", (av["config_id"],)).fetchone() if av else None
            hours = con.execute(
                "SELECT working_week_day AS day, day_and_night AS all_day, started_at AS start, ended_at AS end "
                "FROM working_intervals WHERE action_id = ? ORDER BY working_week_day, started_at", (aid,)).fetchall()
            actions.append({
                "id": a["id"], "name": a["name"] or "", "description": a["description"] or "",
                "actionType": cfg["actionType"] if cfg else None,
                "actionSettings": json.loads(cfg["actionSettings"]) if cfg and cfg["actionSettings"] else None,
                "coolDown": cfg["coolDown"] if cfg else None,
                "maxActionResultsPerIteration": cfg["maxActionResultsPerIteration"] if cfg else None,
                "isDraft": cfg["isDraft"] if cfg else None,
                "overridePlatform": cfg["override_platform"] if cfg else None,
                "excludeListId": av["exclude_list_id"] if av else None,
                "hours": [dict(h) for h in hours],
            })
    return {
        "id": camp["id"], "name": camp["name"], "description": camp["description"] or "",
        "type": camp["type"], "is_paused": camp["is_paused"], "is_archived": camp["is_archived"],
        "is_valid": camp["is_valid"], "li_account_id": camp["li_account_id"],
        "created_at": camp["created_at"], "exclude_list_id": ver["exclude_list_id"] if ver else None,
        "actions": actions,
    }


# ---------------------------------------------------------------- working hours

def local_offset_minutes():
    off = dt.datetime.now().astimezone().utcoffset()
    return int(off.total_seconds() // 60)


def hhmm_to_min(s):
    h, m = s.split(":")
    v = int(h) * 60 + int(m)
    if v == MIN_IN_DAY:      # "24:00" as an end time
        v = MIN_IN_DAY - 1
    if not 0 <= v < MIN_IN_DAY:
        raise ValueError("bad time " + s)
    return v


def min_to_hhmm(v):
    return "%02d:%02d" % (v // 60, v % 60)


# Day numbering follows JavaScript's Date#getDay(): 0 = Sunday ... 6 = Saturday.
DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]


def recipe_days(spec):
    if spec in (None, "all", "every day"):
        return list(range(7))
    if spec == "weekdays":
        return [1, 2, 3, 4, 5]
    return [DAY_NAMES.index(d[:3].lower()) for d in spec]


def _merge(intervals):
    """Sort [s, e] minute pairs on one timeline and join the ones that touch (e + 1 == next s)."""
    out = []
    for s, e in sorted(intervals):
        if out and s <= out[-1][1] + 1:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out


def _shift_and_split(intervals_by_day, delta_min):
    """Shift per-day [s, e] minute windows by delta on a week timeline, then cut them at day
    boundaries and merge what touches. Used both ways: local -> UTC (delta = -offset) and
    UTC -> local (delta = +offset). Returns {day: [[s, e], ...]} with s, e in minutes of day."""
    timeline = []
    for d, wins in intervals_by_day.items():
        for s, e in wins:
            s = d * MIN_IN_DAY + s + delta_min
            e = d * MIN_IN_DAY + e + delta_min
            s %= MIN_IN_WEEK
            e %= MIN_IN_WEEK
            if e < s:                       # wrapped past Saturday night
                e += MIN_IN_WEEK
            timeline.append([s, e])
    # A window that wraps past Saturday night is split so both pieces sit inside the week.
    pieces = []
    for s, e in timeline:
        if e >= MIN_IN_WEEK:
            pieces += [[s, MIN_IN_WEEK - 1], [0, e - MIN_IN_WEEK]]
        else:
            pieces.append([s, e])
    out = {d: [] for d in range(7)}
    for s, e in _merge(pieces):
        while True:
            day = s // MIN_IN_DAY
            day_end = (day + 1) * MIN_IN_DAY - 1
            seg_end = min(e, day_end)
            out[day].append([s - day * MIN_IN_DAY, seg_end - day * MIN_IN_DAY])
            if seg_end == e:
                break
            s = seg_end + 1
    return {d: _merge(v) for d, v in out.items()}


def build_working_hours(spec, offset_min):
    """Recipe -> LH IWeekWorkingSchedule (UTC): {"0": [{"start":[h,m],"end":[h,m]}] | true | false, ...}.

    spec = "always"
         | {"days": "all"|"weekdays"|[names], "windows": [["00:00","03:00"], ...]}
         | a list of the above dicts (union), for schedules that differ by day.
    Local windows are shifted to UTC on a week timeline and split where they cross a UTC
    day boundary, so a Brisbane 00:00-03:00 lands as 14:00-17:00 UTC the previous day.
    A day that ends up covered 00:00-23:59 is sent as `true`, which is how LH stores "all day".
    """
    if spec == "always":
        return {str(d): True for d in range(7)}
    specs = spec if isinstance(spec, list) else [spec]
    local = {d: [] for d in range(7)}
    for one in specs:
        for d in recipe_days(one.get("days")):
            for start, end in one["windows"]:
                s, e = hhmm_to_min(start), hhmm_to_min(end)
                if e < s:
                    raise ValueError(f"window ends before it starts: {start}-{end}")
                local[d].append([s, e])
    utc = _shift_and_split(local, -offset_min)
    sched = {}
    for d in range(7):
        wins = utc[d]
        if not wins:
            sched[str(d)] = False
        elif wins == [[0, MIN_IN_DAY - 1]]:
            sched[str(d)] = True
        else:
            sched[str(d)] = [{"start": [s // 60, s % 60], "end": [e // 60, e % 60]} for s, e in wins]
    return sched


def schedule_to_rows(sched):
    """What LH's toWeekWorkingIntervals will store for a schedule: (day, all_day, start, end) tuples."""
    rows = []
    for d in range(7):
        v = sched[str(d)]
        if v is False or v == []:
            rows.append((d, 0, None, None))
        elif v is True:
            rows.append((d, 1, 0, MIN_IN_DAY - 1))
        else:
            for w in v:
                s, e = w["start"][0] * 60 + w["start"][1], w["end"][0] * 60 + w["end"][1]
                rows.append((d, 1 if (s == 0 and e == MIN_IN_DAY - 1) else 0, s, e))
    return sorted(rows)


def rows_to_recipe_hours(rows, offset_min):
    """DB rows (UTC) -> recipe workingHours in local time: "always", one dict, or a list of dicts."""
    if rows and all(h["all_day"] for h in rows) and len({h["day"] for h in rows}) == 7:
        return "always"
    utc = {d: [] for d in range(7)}
    for h in rows:
        if h["all_day"]:
            utc[h["day"]].append([0, MIN_IN_DAY - 1])
        elif h["start"] is not None:
            utc[h["day"]].append([h["start"], h["end"]])
    local = _shift_and_split(utc, offset_min)
    # Group days that share the same windows so the recipe stays readable.
    groups = {}
    for d in range(7):
        if local[d]:
            key = tuple((s, e) for s, e in local[d])
            groups.setdefault(key, []).append(d)
    specs = []
    for key, days in groups.items():
        specs.append({"days": "all" if len(days) == 7 else [DAY_NAMES[d] for d in days],
                      "windows": [[min_to_hhmm(s), min_to_hhmm(e)] for s, e in key]})
    if not specs:
        return {"days": "all", "windows": []}     # never works - preserved as found
    return specs[0] if len(specs) == 1 else specs


def hours_local(rows, offset_min):
    """DB rows (UTC minutes) -> readable local windows, for `show`."""
    spec = rows_to_recipe_hours(rows, offset_min)
    if spec == "always":
        return ["every day, all day"]
    out = []
    for one in (spec if isinstance(spec, list) else [spec]):
        days = one["days"] if isinstance(one["days"], str) else ",".join(one["days"])
        out.append(f"{days}: " + (", ".join(f"{s}-{e}" for s, e in one["windows"]) or "never"))
    out.append("utc rows: " + ", ".join(
        f"{DAY_NAMES[h['day']]} " + ("all day" if h["all_day"] else "off" if h["start"] is None
                                     else f"{min_to_hhmm(h['start'])}-{min_to_hhmm(h['end'])}") for h in rows))
    return out


# ---------------------------------------------------------------- recipe -> payload

def fill(obj, values):
    """Replace {{KEY}} placeholders anywhere in a JSON structure."""
    if isinstance(obj, str):
        for k, v in values.items():
            obj = obj.replace("{{" + k + "}}", v)
        if re.search(r"\{\{[A-Z_]+\}\}", obj):
            raise ValueError("unfilled placeholder in " + obj)
        return obj
    if isinstance(obj, list):
        return [fill(x, values) for x in obj]
    if isinstance(obj, dict):
        return {k: fill(v, values) for k, v in obj.items()}
    return obj


def build_payload(recipe, c, li_account, name_override=None):
    values = {
        "CLIENT_ID": c.get("CLIENT_ID", ""),
        "WEBHOOK_URL": c.get("LH_WEBHOOK_URL") or (WEBHOOK_BASE + c.get("CLIENT_ID", "")),
    }
    if not c.get("CLIENT_ID") and not c.get("LH_WEBHOOK_URL"):
        raise RuntimeError("CLIENT_ID missing from " + CONF + " - the webhook address needs it")
    offset = local_offset_minutes()
    actions = []
    for a in recipe["actions"]:
        cool_ms = int(a.get("coolDownMinutes", 0)) * 60000 if "coolDownMinutes" in a else int(a.get("coolDown", 0))
        actions.append({
            "name": a.get("name", ""),
            "description": a.get("description", ""),
            # The UI sends an empty target and exclude list on every new action. Leave `target`
            # out and the engine throws "invalid `people`" (found on the first live run, 11 Sep 2026).
            "target": [],
            "excludeList": [],
            "config": {
                "actionType": a["actionType"],
                "overridePlatform": a.get("overridePlatform"),
                "actionSettings": fill(a.get("actionSettings"), values),
                "coolDown": cool_ms,
                "maxActionResultsPerIteration": int(a.get("maxActionResultsPerIteration", -1)),
            },
            "workingHours": build_working_hours(a.get("workingHours", "always"), offset),
        })
    return {
        "name": name_override or recipe["name"],
        "description": recipe.get("description", ""),
        "excludeList": [],
        "actions": actions,
        "liAccount": li_account,
    }


# ---------------------------------------------------------------- the running instance

def instance_title(c):
    user = c.get("LH_USER", "lh")
    return sh(f"sudo -u {user} DISPLAY=:0 xdotool search --name 'Instance #' getwindowname %@ 2>/dev/null | head -1 || true")


def devtools_ports():
    ports = []
    for line in sh("ss -ltnp 2>/dev/null || true").splitlines():
        if "linked-helper" in line:
            m = re.search(r"[\d.\[\]:]*:(\d+)\s", line)
            if m:
                ports.append(int(m.group(1)))
    return sorted(set(ports))


def find_ui_page():
    """The instance interface page. The launcher port answers 404 on /json/list; skip it."""
    for port in devtools_ports():
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/json/list" % port, timeout=10) as r:
                for t in json.loads(r.read().decode()):
                    if t.get("type") == "page" and UI_URL_MARK in (t.get("url") or ""):
                        return t["webSocketDebuggerUrl"]
        except Exception:
            continue
    return None


CREATE_JS = r"""
(async function(){
  try {
    var req = null;
    self.webpackChunk_linked_helper_front.push([[Symbol('lh-campaigns')], {}, function(r){ req = r; }]);
    if (!req || !req.m) return JSON.stringify({ok:false, error:'webpack require not exposed'});
    var id = null;
    for (var k in req.m) { if (String(req.m[k]).indexOf('async _callWriteImpl') > -1) { id = k; break; } }
    if (!id) return JSON.stringify({ok:false, error:'data layer module not found by text'});
    var ex = req(id), dl = null;
    for (var kk of Object.keys(ex)) { var v = ex[kk]; if (v && typeof v === 'object' && typeof v.callWrite === 'function') { dl = v; break; } }
    if (!dl) return JSON.stringify({ok:false, error:'data layer export has no callWrite'});
    var r = await dl.callWrite("people.campaigns.createCampaign", __PAYLOAD__);
    return JSON.stringify({ok:true, id: r && r.id, uuid: r && r.uuid});
  } catch (e) {
    return JSON.stringify({ok:false, error:String(e && e.message || e).slice(0, 600)});
  }
})()
"""


async def run_create(ws_url, payload):
    import websockets
    js = CREATE_JS.replace("__PAYLOAD__", json.dumps(payload))
    async with websockets.connect(ws_url, max_size=2 ** 24, open_timeout=30, close_timeout=2) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": js, "returnByValue": True, "awaitPromise": True,
            "timeout": CALL_TIMEOUT_S * 1000}}))
        deadline = time.time() + CALL_TIMEOUT_S
        while time.time() < deadline:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=max(5, deadline - time.time())))
            if msg.get("id") == 1:
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


# ---------------------------------------------------------------- commands

def cmd_list(c):
    with db(c) as con:
        for r in campaign_rows(con):
            n = con.execute("SELECT COUNT(*) FROM campaign_version_actions WHERE version_id = "
                            "(SELECT id FROM campaign_versions WHERE campaign_id = ? ORDER BY id DESC LIMIT 1)",
                            (r["id"],)).fetchone()[0]
            flags = ("archived " if r["is_archived"] else "") + ("paused" if r["is_paused"] else "running")
            print(f"{r['id']:>4}  {n:>2} actions  {flags:<16} {r['created_at'][:10]}  {r['name']!r}")
    return 0


def cmd_show(c, cid):
    with db(c) as con:
        d = campaign_detail(con, cid)
    off = local_offset_minutes()
    print(json.dumps({k: v for k, v in d.items() if k != "actions"}, indent=2))
    for i, a in enumerate(d["actions"], 1):
        print(f"\n--- action {i}: {a['actionType']}  (id {a['id']}, name {a['name']!r})")
        print("    coolDown", a["coolDown"], "ms   maxActionResultsPerIteration", a["maxActionResultsPerIteration"],
              "  isDraft", a["isDraft"], "  overridePlatform", a["overridePlatform"], "  excludeList", a["excludeListId"])
        print("    actionSettings", json.dumps(a["actionSettings"], sort_keys=True))
        for line in hours_local(a["hours"], off):
            print("    hours", line)
    return 0


def normalise(d):
    """What matters for 'is this the same campaign': per action, in order."""
    return [{
        "actionType": a["actionType"],
        "actionSettings": a["actionSettings"],
        "coolDown": a["coolDown"],
        "maxActionResultsPerIteration": a["maxActionResultsPerIteration"],
        # isDraft is left out on purpose: 1 until a campaign is first started, 0 after.
        "overridePlatform": a["overridePlatform"],
        "hours": sorted((h["day"], h["all_day"], h["start"], h["end"]) for h in a["hours"]),
    } for a in d["actions"]]


def flatten(obj, prefix=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from flatten(v, f"{prefix}.{k}" if prefix else k)
    elif isinstance(obj, list) and obj and isinstance(obj[0], (dict, list)):
        for i, v in enumerate(obj):
            yield from flatten(v, f"{prefix}[{i}]")
    else:
        yield prefix, obj


def diff_campaigns(a, b):
    """Returns a list of (path, value_a, value_b). Empty = identical in every field that matters."""
    fa, fb = dict(flatten(normalise(a))), dict(flatten(normalise(b)))
    out = []
    for k in sorted(set(fa) | set(fb)):
        if fa.get(k, "<absent>") != fb.get(k, "<absent>"):
            out.append((k, fa.get(k, "<absent>"), fb.get(k, "<absent>")))
    return out


def cmd_diff(c, a_id, b_id):
    with db(c) as con:
        a, b = campaign_detail(con, a_id), campaign_detail(con, b_id)
    print(f"A = {a_id} {a['name']!r} ({len(a['actions'])} actions)")
    print(f"B = {b_id} {b['name']!r} ({len(b['actions'])} actions)")
    diffs = diff_campaigns(a, b)
    if not diffs:
        print("IDENTICAL in every action type, setting, pacing value and working interval.")
        return 0
    print(f"{len(diffs)} difference(s):")
    for k, va, vb in diffs:
        print(f"  {k}\n      A: {json.dumps(va)}\n      B: {json.dumps(vb)}")
    return 2


def load_recipe(path):
    with open(path) as f:
        return json.load(f)


def cmd_plan(c, recipe_path, name=None):
    recipe = load_recipe(recipe_path)
    with db(c) as con:
        li, who = li_account_db_id(con, c)
    payload = build_payload(recipe, c, li, name)
    say(f"account row {li} ({who}), local offset {local_offset_minutes()} min, webhook {c.get('LH_WEBHOOK_URL') or WEBHOOK_BASE + c.get('CLIENT_ID', '')}")
    print(json.dumps(payload, indent=2))
    return 0


def cmd_export(c, cid, name=None, out=None):
    """An existing campaign -> recipe JSON, webhook swapped for the placeholder, hours in local
    time. Then proves the recipe rebuilds the exact working-interval rows LH holds now."""
    with db(c) as con:
        d = campaign_detail(con, cid)
    off = local_offset_minutes()
    actions = []
    for a in d["actions"]:
        settings = a["actionSettings"]
        if isinstance(settings, dict) and isinstance(settings.get("url"), str) and "/lh-webhook/" in settings["url"]:
            settings = {**settings, "url": "{{WEBHOOK_URL}}"}
        item = {"name": a["name"]}
        if a["description"]:
            item["description"] = a["description"]
        item["actionType"] = a["actionType"]
        if a["overridePlatform"]:
            item["overridePlatform"] = a["overridePlatform"]
        item["actionSettings"] = settings          # None stays null - that is what LH stores for it
        cool = a["coolDown"] or 0
        if cool % 60000 == 0:
            item["coolDownMinutes"] = cool // 60000
        else:
            item["coolDown"] = cool
        item["maxActionResultsPerIteration"] = a["maxActionResultsPerIteration"]
        item["workingHours"] = rows_to_recipe_hours(a["hours"], off)
        actions.append(item)
    recipe = {
        "_comment": [
            f"Exported from campaign {cid} {d['name']!r} on {time.strftime('%Y-%m-%d')} (machine offset {off:+d} min).",
            "Times are the MACHINE'S local time (the VPS carries the client's TZ).",
            "{{WEBHOOK_URL}} is filled from /etc/linked-helper-machine.conf (CLIENT_ID or LH_WEBHOOK_URL).",
        ],
        "name": name or d["name"],
        "description": d["description"],
        "actions": actions,
    }
    problems = 0
    for i, (a, r) in enumerate(zip(d["actions"], recipe["actions"]), 1):
        want = sorted((h["day"], h["all_day"], h["start"], h["end"]) for h in a["hours"])
        got = schedule_to_rows(build_working_hours(r["workingHours"], off))
        if want != got:
            problems += 1
            say(f"action {i} {a['actionType']}: hours do NOT round-trip\n   db:     {want}\n   recipe: {got}")
    text = json.dumps(recipe, indent=2, ensure_ascii=False) + "\n"
    verdict = "ROUND-TRIP FAILED" if problems else "round-trip OK: recipe rebuilds every working-interval row"
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
        say(f"wrote {out} ({len(actions)} actions) - {verdict}")
    else:
        print(text, end="")
        say(verdict)
    return 1 if problems else 0


def cmd_create(c, recipe_path, name=None, compare=None, force=False):
    recipe = load_recipe(recipe_path)
    with db(c) as con:
        li, who = li_account_db_id(con, c)
        payload = build_payload(recipe, c, li, name)
        existing = [r for r in campaign_rows(con) if r["name"] == payload["name"] and not r["is_archived"]]
    if existing:
        say(f"already there: campaign {existing[0]['id']} {payload['name']!r} - nothing to do")
        return 0

    title = instance_title(c)
    say("instance title:", title or "<no instance window>")
    if not title:
        say("FAILED: no Linked Helper instance window - it must be open and logged in to LinkedIn")
        return 1
    if "Running campaign #" in title and not force:
        say("REFUSED: an action is mid-flight; wait for the runner to sleep or pass --force")
        return 1

    ws = find_ui_page()
    if not ws:
        say("FAILED: could not find the instance interface page on any DevTools port")
        return 1
    say(f"creating {payload['name']!r} with {len(payload['actions'])} action(s) for account row {li} ({who})")
    result = asyncio.run(run_create(ws, payload))
    if not result.get("ok"):
        say("FAILED:", result.get("error"))
        return 1
    new_id = result.get("id")
    say(f"created campaign id {new_id} uuid {result.get('uuid')}")

    time.sleep(2)
    with db(c) as con:
        d = campaign_detail(con, new_id)
    say(f"database shows {len(d['actions'])} action(s), paused={d['is_paused']}, valid={d['is_valid']}")
    if len(d["actions"]) != len(payload["actions"]):
        say("FAILED: action count does not match the recipe")
        return 1
    if compare:
        rc = cmd_diff(c, compare, new_id)
        if rc:
            say("created, but it differs from the reference campaign - see above")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    s = sub.add_parser("show"); s.add_argument("id", type=int)
    s = sub.add_parser("diff"); s.add_argument("a", type=int); s.add_argument("b", type=int)
    s = sub.add_parser("plan"); s.add_argument("recipe"); s.add_argument("--name")
    s = sub.add_parser("export"); s.add_argument("id", type=int); s.add_argument("--name")
    s.add_argument("--out", help="write the recipe here instead of stdout")
    s = sub.add_parser("create"); s.add_argument("recipe"); s.add_argument("--name")
    s.add_argument("--compare", type=int, help="campaign id to diff the new one against")
    s.add_argument("--force", action="store_true", help="create even while an action is mid-flight")
    args = p.parse_args()
    c = conf()
    try:
        if args.cmd == "list":
            return cmd_list(c)
        if args.cmd == "show":
            return cmd_show(c, args.id)
        if args.cmd == "diff":
            return cmd_diff(c, args.a, args.b)
        if args.cmd == "plan":
            return cmd_plan(c, args.recipe, args.name)
        if args.cmd == "export":
            return cmd_export(c, args.id, args.name, args.out)
        if args.cmd == "create":
            return cmd_create(c, args.recipe, args.name, args.compare, args.force)
    except Exception as e:
        say("FAILED:", e)
        return 1


if __name__ == "__main__":
    sys.exit(main())
