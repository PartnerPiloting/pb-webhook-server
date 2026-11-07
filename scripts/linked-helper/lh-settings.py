#!/usr/bin/env python3
"""Read and change a campaign's MESSAGE and WORKING HOURS - on the machine, driven by Wingguy.

WHY (Guy, 7 Nov 2026, on a call with Alex Solti): every client gets to the point of wanting to
see the message their campaign sends and tweak it, and to change the hours it runs. Doing that
inside Linked Helper means opening the machine, pausing the campaign, finding each step, copying
text between machines, and remembering to start it again - fiddly, and people forget. Now the
client asks their Claude; the server keeps the latest snapshot this script reports, and leaves a
change for this machine, which this script makes.

HOW - the same data layer lh-campaigns.py and lh-topup.py drive (DevTools -> callWrite):
  message  people.actions.createActionVersion with the step's config, messageTemplate swapped
           (the same call the top-up uses to change its search link, proven 5 Nov 2026)
  hours    workingHours.saveWorkingHours per step (lh-campaigns.py `hours`, proven Sep 2026)
Every change: pause the campaign if it is running, change, read it back from lh.db, and start it
again ONLY if it was running before - a campaign its owner paused stays paused.

THE TEMPLATE IS BUILT ON THE SERVER (services/lhCampaignSettings.js) so there is one place that
turns "Hi {firstName}, ..." into Linked Helper's node tree. This script installs what it is
handed and refuses when the step changed since the client looked (the hash it last reported).

Times: Linked Helper stores hours in UTC. The machine carries its owner's time zone (setup), so
hours go in and come out in the machine's local time, converted with lh-campaigns.py.

Commands (each prints one JSON line; exit 0 = ok):
  snapshot              every live campaign: steps, message text nodes, hours in local time
  apply <job.json>      make one change: {"kind":"message"|"hours", "campaign_id", ...}
"""
import datetime as dt
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import time

CANDIDATES = (
    "/usr/local/bin/lh-campaigns.py",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "lh-campaigns.py"),
)


def load_campaigns_module():
    for p in CANDIDATES:
        if os.path.exists(p):
            spec = importlib.util.spec_from_file_location("lh_campaigns", p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise RuntimeError("lh-campaigns.py not found in " + ", ".join(CANDIDATES))


def template_hash(t):
    """What the server echoes back so a change made in Linked Helper meanwhile is never overwritten."""
    return hashlib.sha256(json.dumps(t, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def machine_tz():
    try:
        out = subprocess.run(["timedatectl", "show", "-p", "Timezone", "--value"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
        if out:
            return out
    except Exception:
        pass
    try:
        with open("/etc/timezone") as f:
            return f.read().strip() or None
    except OSError:
        return None


def step_out(lhc, a, off):
    s = a.get("actionSettings") or {}
    t = s.get("messageTemplate") if isinstance(s, dict) else None
    return {
        "id": a["id"], "name": a.get("name") or "", "type": a.get("actionType"),
        "template": t if isinstance(t, dict) else None,
        "template_hash": template_hash(t) if isinstance(t, dict) else None,
        "hours": lhc.rows_to_recipe_hours(a["hours"], off) if a.get("hours") else None,
    }


def cmd_snapshot():
    lhc = load_campaigns_module()
    c = lhc.conf()
    off = lhc.local_offset_minutes()
    out = []
    with lhc.db(c) as con:
        for r in lhc.campaign_rows(con):
            if r["is_archived"]:
                continue
            d = lhc.campaign_detail(con, r["id"])
            out.append({"id": d["id"], "name": d["name"], "paused": bool(d["is_paused"]),
                        "steps": [step_out(lhc, a, off) for a in d["actions"]]})
    print(json.dumps({"ok": True, "tz": machine_tz(), "offset_min": off,
                      "at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "campaigns": out}))
    return 0


def find_step(d, step_id):
    for a in d["actions"]:
        if int(a["id"]) == int(step_id):
            return a
    return None


def change_message(lhc, c, li, d, job):
    step = find_step(d, job.get("step_id"))
    if not step:
        return {"ok": False, "error": "that step is no longer in the campaign"}
    settings = step.get("actionSettings")
    if not isinstance(settings, dict) or not isinstance(settings.get("messageTemplate"), dict):
        return {"ok": False, "error": "that step has no message to change"}
    if job.get("expect_hash") and template_hash(settings["messageTemplate"]) != job["expect_hash"]:
        return {"ok": False, "stale": True,
                "error": "the message was changed in Linked Helper after you looked - ask to see it again, then make the change"}
    new_settings = dict(settings, messageTemplate=job["template"])
    config = {"actionType": step["actionType"], "overridePlatform": step.get("overridePlatform"),
              "actionSettings": new_settings, "coolDown": step.get("coolDown"),
              "maxActionResultsPerIteration": step.get("maxActionResultsPerIteration")}
    r = lhc.live_call(c, "people.actions.createActionVersion", [{"actionId": step["id"], "config": config, "liAccount": li}])
    if not r.get("ok"):
        return {"ok": False, "error": "Linked Helper refused the new message: " + str(r.get("error"))[:300]}
    time.sleep(2)
    with lhc.db(c) as con:
        now = find_step(lhc.campaign_detail(con, d["id"]), step["id"])
    got = ((now or {}).get("actionSettings") or {}).get("messageTemplate")
    if template_hash(got) != template_hash(job["template"]):
        return {"ok": False, "error": "Linked Helper took the change but the step does not show the new message"}
    return {"ok": True, "step_id": step["id"], "template_hash": template_hash(got)}


def change_hours(lhc, c, li, d, job):
    off = lhc.local_offset_minutes()
    schedule = lhc.build_working_hours(job["hours"], off)
    want = lhc.schedule_to_rows(schedule)
    ids = [int(x) for x in (job.get("step_ids") or [a["id"] for a in d["actions"]])]
    done, failed = [], []
    for sid in ids:
        if not find_step(d, sid):
            failed.append({"id": sid, "error": "no longer in the campaign"})
            continue
        r = lhc.live_call(c, "workingHours.saveWorkingHours", [schedule, {"type": "action", "campaignId": d["id"], "actionId": sid}, li])
        if r.get("ok"):
            done.append(sid)
        else:
            failed.append({"id": sid, "error": str(r.get("error"))[:160]})
    time.sleep(2)
    with lhc.db(c) as con:
        d2 = lhc.campaign_detail(con, d["id"])
    wrong = []
    for sid in done:
        rows = sorted((h["day"], h["all_day"], h["start"], h["end"]) for h in find_step(d2, sid)["hours"])
        if rows != want:
            wrong.append(sid)
    if failed or wrong:
        return {"ok": False, "changed": [s for s in done if s not in wrong], "failed": failed, "not_matching": wrong,
                "error": "some steps did not take the new hours"}
    hours = lhc.rows_to_recipe_hours(find_step(d2, ids[0])["hours"], off) if ids else None
    return {"ok": True, "changed": done, "hours": hours, "offset_min": off}


def cmd_apply(path):
    with open(path, encoding="utf-8") as f:
        job = json.load(f)
    kind = job.get("kind")
    if kind not in ("message", "hours"):
        print(json.dumps({"ok": False, "error": "unknown change %r" % kind}))
        return 1
    lhc = load_campaigns_module()
    c = lhc.conf()
    cid = int(job["campaign_id"])
    with lhc.db(c) as con:
        li, _who = lhc.li_account_db_id(con, c)
        d = lhc.campaign_detail(con, cid)
    if d["is_archived"]:
        print(json.dumps({"ok": False, "error": "that campaign has been archived"}))
        return 1
    was_running = not bool(d["is_paused"])
    paused_by_us = False
    out = {"ok": False}
    try:
        if was_running:
            p = lhc.live_call(c, "campaigns.setCampaignPaused", [cid, True, li])
            if not p.get("ok"):
                print(json.dumps({"ok": False, "error": "could not pause the campaign to make the change: " + str(p.get("error"))[:200]}))
                return 1
            paused_by_us = True
            time.sleep(2)
        out = change_message(lhc, c, li, d, job) if kind == "message" else change_hours(lhc, c, li, d, job)
    finally:
        if paused_by_us:
            r = lhc.live_call(c, "campaigns.setCampaignPaused", [cid, False, li])
            time.sleep(2)
            with lhc.db(c) as con:
                running_again = not bool(lhc.campaign_detail(con, cid)["is_paused"])
            out["restarted"] = running_again
            if not running_again:
                out["ok"] = False
                out["error"] = (out.get("error") + "; " if out.get("error") else "") + \
                    "the campaign is PAUSED and could not be started again: " + str(r.get("error"))[:120]
    out.update(kind=kind, campaign_id=cid, campaign_name=d["name"], was_running=was_running)
    print(json.dumps(out))
    return 0 if out.get("ok") else 1


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("snapshot", "apply"):
        print(__doc__)
        return 2
    try:
        if sys.argv[1] == "snapshot":
            return cmd_snapshot()
        return cmd_apply(sys.argv[2])
    except Exception as e:  # one JSON line, always - the agent parses stdout
        print(json.dumps({"ok": False, "error": str(e)[:400]}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
