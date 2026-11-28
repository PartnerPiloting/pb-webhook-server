#!/usr/bin/env python3
"""Connections from your searches - the machine end (docs/CONNECTIONS-SEARCH-BUILD-PLAN.md, step 2).

WHAT IT DOES (Guy, 27-28 Nov 2026): a client searched their OWN LinkedIn connections, narrowed it
(CEOs in Melbourne, say), and sent the link to Wingguy with one sentence on why. This script, run by
cron every 15 minutes, takes that search from the server and puts it into the campaign
"Connections from your searches" as Linked Helper's auto-collect step - the same proven step a
campaign top-up uses (lh-topup.py apply). Linked Helper walks the search, and the campaign visits
each person and sends them to the client's webhook, at most SEARCH_VISITS_PER_DAY a day. NO invite,
NO message - ever.

It then tells the server who came from which search, so /wg knows WHY the client picked each person
(their reason, their share link). A person's LinkedIn address is only certain once Linked Helper has
the profile, so people are reported as their address appears - over the days the visits take.

ONE RUN, step by step - every step is quick; nothing waits in a loop:
  1. A collect already started by an earlier run? Read how far it got (lh-topup.py status). It is
     over when Linked Helper parks the step (its own "done until next time" - also when the search
     added nobody new), or nothing new has come for an hour while the step is neither running nor
     held back by a Linked Helper limit, or 20 hours have gone. Then report "done" with the count.
  2. Otherwise ask the server for the next search (GET <REPORT_URL>/connection-searches). Build the
     campaign from recipe 07 if this machine has none, put the search in (lh-topup.py apply
     --allow-no-invite), save that BEFORE anything else, and report "collecting". Only a link
     Linked Helper cannot use is reported "failed"; anything passing (Linked Helper restarting, a
     DevTools hiccup) is tried again next run, and reported failed only after a day of trying.
  3. Every run: each search keeps a WINDOW - from the moment it went in until the next search went in -
     and anyone the collect step added in that window belongs to it, however late they were walked.
     People whose LinkedIn address is now known are reported to their search, once each.
  lh-connection-search.py            one run (cron as root, */15)
  lh-connection-search.py --dry-run  say what it would do; change nothing, report nothing

Config, /etc/linked-helper-machine.conf:
  REPORT_URL, REPORT_SECRET          the machine's door on the server (already there for the watchdog)
  CONNECTION_SEARCH=on               switched on for this machine. Absent = this script does nothing.
  SEARCH_VISITS_PER_DAY=25           visits a day. UNSET = 5, the safe number for a Standard licence
                                     (its webhook allowance is 20 a day for the whole machine); set 25
                                     on a Pro machine.
"""
import fcntl
import importlib.util
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CAMPAIGN_NAME = "Connections from your searches"   # services/leadCampaign.js SEARCH_CONNECTIONS
RECIPE = "07-connections-from-search.json"
RECIPE_DIRS = (os.path.join(HERE, "campaigns"), "/usr/local/share/linked-helper/campaigns", HERE)
STATE = "/var/lib/lh-connection-search.json"
LOCK = "/run/lh-connection-search.lock"
OWN_HOLD = "/var/lib/lh-own-connections-hold.json"
TOPUP_HOLD = "/home/%s/.wingguy-topup-hold.json"

QUIET_MIN = 60                 # nothing new for this long, not on the step, not held by a limit = over
SAFE_PER_DAY = 5               # when the machine config does not say (a Standard licence must not be starved)
RETRY_HOURS = 24               # a search Linked Helper keeps refusing for passing reasons is failed after this
# Linked Helper's postpone reasons that mean "finished / started by hand", not "held back by a limit"
NOT_A_HOLD = (None, "", "Waiter", "Manually")
GIVE_UP_HOURS = 20             # a collect that has not finished by then is reported with what it has
PEOPLE_PER_REPORT = 500
KEEP_PEOPLE_DAYS = 120         # how long people without an address yet keep being looked up. Sales Navigator
                               # people have none until visited (Guy's BDM campaign: 61 of 917) and at 25 a day
                               # a 900-person search takes 36 days - 30 would lose the reason for the last ones


def say(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%S%z"), "connection-search:", *a, flush=True)


def load(name, filename):
    for d in ("/usr/local/bin", HERE, "/usr/local/share/linked-helper/campaigns"):
        p = os.path.join(d, filename)
        if os.path.exists(p):
            spec = importlib.util.spec_from_file_location(name, p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise RuntimeError(filename + " not found beside this script")


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, dict) else None
    except Exception:
        return None


def write_json(path, value):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f)
    os.replace(tmp, path)


# ------------------------------------------------------------------ pure (tested)

def _iso_to_epoch(v):
    import datetime as dt
    try:
        return dt.datetime.strptime(str(v)[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc).timestamp()
    except (TypeError, ValueError):
        return None


def collect_finished(status, started_at, now):
    """Is the collect over? From lh-topup.py status output. Pure. (Review 28 Nov 2026: a search that
    added NOBODY new must finish too, and a collect held back by a Linked Helper limit must not.)"""
    if status.get("finished_normally"):
        return True, "Linked Helper finished the search"
    reason = status.get("postpone_reason")
    nxt = _iso_to_epoch(status.get("next_run_at"))
    if reason == "Waiter" and nxt and nxt > now + 3600 and not status.get("collecting_now"):
        return True, "Linked Helper parked the step - nothing more to collect"
    if now - float(started_at or now) > GIVE_UP_HOURS * 3600:
        return True, "stopped waiting after %d hours" % GIVE_UP_HOURS
    quiet = status.get("minutes_since_last")
    if (status.get("collected") and quiet is not None and quiet >= QUIET_MIN
            and not status.get("collecting_now") and reason in NOT_A_HOLD):
        return True, "nothing new for %d minutes" % quiet
    return False, None


def recipe_for(recipe, per_day):
    """The recipe with this machine's daily number written in. Pure."""
    out = json.loads(json.dumps(recipe))
    try:
        n = int(per_day)
    except (TypeError, ValueError):
        n = SAFE_PER_DAY
    n = max(1, min(100, n))
    for a in out.get("actions") or []:
        if a.get("actionType") in ("VisitAndExtract", "SendPersonToWebhook"):
            a["maxActionResultsPerIteration"] = n
    return out


def close_window(windows, until):
    """A new search went in: the last open window ends where the new one starts. Pure."""
    for w in windows:
        if not w.get("until"):
            w["until"] = until
    return windows


def live_windows(windows, now, keep_days=KEEP_PEOPLE_DAYS):
    """Windows still worth looking at. Pure."""
    return [w for w in windows or [] if now - float(w.get("at") or now) < keep_days * 86400]


def new_people(pids, reported, slugs_by_pid):
    """[(pid, slug)] for people of a window not yet reported whose address is known. Pure."""
    done = set(int(x) for x in reported or [])
    return [(int(p), slugs_by_pid[int(p)]) for p in pids if int(p) not in done and slugs_by_pid.get(int(p))]


def final_refusal(apply_out):
    """Is an apply refusal about the LINK (final), rather than something passing? Pure."""
    link = apply_out.get("link")
    return bool(isinstance(link, dict) and not link.get("ok")) or "archived" in str(apply_out.get("error") or "")


# ------------------------------------------------------------------ the server

def server(c):
    url = (c.get("REPORT_URL") or "").rstrip("/")
    secret = c.get("REPORT_SECRET") or ""
    return url, secret


def fetch_search(c):
    url, secret = server(c)
    if not url or not secret:
        raise RuntimeError("REPORT_URL / REPORT_SECRET missing from the machine config")
    req = urllib.request.Request(url + "/connection-searches", headers={"x-lh-machine-secret": secret})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode()).get("search")


def report(c, body, dry):
    if dry:
        say("dry run: would report", json.dumps(body)[:300])
        return {"ok": True}
    url, secret = server(c)
    req = urllib.request.Request(url + "/connection-searches", data=json.dumps(body).encode(), method="POST",
                                 headers={"x-lh-machine-secret": secret, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


# ------------------------------------------------------------------ Linked Helper

def ensure_campaign(lhc, c, dry):
    with lhc.db(c) as con:
        rows = [dict(r) for r in lhc.campaign_rows(con) if r["name"] == CAMPAIGN_NAME and not r["is_archived"]]
    if rows:
        return int(rows[0]["id"])
    if dry:
        say("dry run: would build", repr(CAMPAIGN_NAME), "from", RECIPE)
        return None
    path = next((os.path.join(d, RECIPE) for d in RECIPE_DIRS if os.path.exists(os.path.join(d, RECIPE))), None)
    if not path:
        raise RuntimeError("recipe %s is not on this machine" % RECIPE)
    with open(path, encoding="utf-8") as f:
        recipe = recipe_for(json.load(f), c.get("SEARCH_VISITS_PER_DAY") or SAFE_PER_DAY)
    tmp = "/tmp/lh-connection-search-recipe.json"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(recipe, f)
    say("building", repr(CAMPAIGN_NAME), "-", recipe["actions"][0]["maxActionResultsPerIteration"], "visits a day")
    if lhc.cmd_create(c, tmp) != 0:
        raise RuntimeError("could not build " + repr(CAMPAIGN_NAME))
    with lhc.db(c) as con:
        rows = [dict(r) for r in lhc.campaign_rows(con) if r["name"] == CAMPAIGN_NAME and not r["is_archived"]]
    if not rows:
        raise RuntimeError(repr(CAMPAIGN_NAME) + " was not there after building it")
    return int(rows[0]["id"])


def run_topup(topup, *args):
    """lh-topup.py prints one JSON line; capture it."""
    import contextlib
    import io
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        if args[0] == "apply":
            rc = topup.cmd_apply(int(args[1]), args[2], allow_no_invite=True)
        else:
            rc = topup.cmd_status(int(args[1]), int(args[2]), args[3], int(args[4]))
    line = (buf.getvalue().strip().splitlines() or ["{}"])[-1]
    try:
        out = json.loads(line)
    except ValueError:
        out = {"ok": False, "error": line[:300]}
    out["rc"] = rc
    return out


def collected_pids(lhc, c, w):
    """Everyone the collect step added inside this search's window."""
    sql = ("SELECT DISTINCT person_id FROM person_in_campaigns_history "
           "WHERE campaign_id = ? AND action_id = ? AND result_status = 1 AND result_created_at > ?")
    args = [w["cid"], w["action_id"], w["since"]]
    if w.get("until"):
        sql += " AND result_created_at <= ?"
        args.append(w["until"])
    with lhc.db(c) as con:
        return [int(r[0]) for r in con.execute(sql, args)]


def slugs_for(lhc, c, pids):
    if not pids:
        return {}
    out = {}
    with lhc.db(c) as con:
        for i in range(0, len(pids), 500):
            chunk = pids[i:i + 500]
            marks = ",".join("?" * len(chunk))
            for pid, slug in con.execute(
                    "SELECT person_id, external_id FROM person_external_ids WHERE type_group = 'public' "
                    "AND person_id IN (%s) ORDER BY id" % marks, chunk):
                out[int(pid)] = slug          # newest last, so it wins
    return out


def busy_elsewhere(c):
    user = c.get("LH_USER", "lh")
    if os.path.exists(TOPUP_HOLD % user):
        return "a campaign top-up is collecting"
    if os.path.exists(OWN_HOLD):
        return "the nightly own-connections read is running"
    return None


# ------------------------------------------------------------------ one run

def step_current(lhc, c, topup, state, now, dry):
    cur = state["current"]
    try:
        st = run_topup(topup, "status", cur["cid"], cur["action_id"], cur["since"], cur.get("baseline", 0))
    except Exception as e:
        st = {"ok": False, "error": str(e)}
    if not st.get("ok"):
        err = str(st.get("error") or "")
        if "no campaign" in err:
            # the campaign was deleted by hand: nothing more can come of this search
            say("campaign %s is gone - search %s ends here" % (cur["cid"], cur["searchId"]))
            report(c, {"searchId": cur["searchId"], "stage": "done"}, dry)
            if not dry:
                state["current"] = None
            return 0
        say("could not read the collect for", cur["searchId"], "-", err[:200])
        return 1
    done, why = collect_finished(st, cur.get("started_at"), now)
    if not done:
        say("search %s still collecting: %s so far (%s)" % (cur["searchId"], st.get("collected"), st.get("postpone_reason") or "running"))
        return 0
    say("search %s finished (%s): %s collected" % (cur["searchId"], why, st.get("collected")))
    report(c, {"searchId": cur["searchId"], "stage": "done", "collected": int(st.get("collected") or 0)}, dry)
    if not dry:
        state["current"] = None
    return 0


def step_next(lhc, c, topup, state, now, dry):
    busy = busy_elsewhere(c)
    if busy:
        say("not taking a new search now:", busy)
        return 0
    s = fetch_search(c)
    if not s:
        return 0
    sid = s["searchId"]
    say("search %s: %s" % (sid, s["url"][:120]))
    cid = ensure_campaign(lhc, c, dry)
    if cid is None or dry:
        say("dry run: would put the search into campaign", cid)
        return 0
    a = run_topup(topup, "apply", cid, s["url"])
    if a.get("ok"):
        state["current"] = {"searchId": sid, "cid": cid, "action_id": a["action_id"],
                            "since": a["since"], "baseline": a.get("baseline", 0), "started_at": now}
        windows = close_window(state.setdefault("windows", []), a["since"])
        windows.append({"searchId": sid, "cid": cid, "action_id": a["action_id"], "since": a["since"], "until": None, "at": now})
        state.get("attempts", {}).pop(sid, None)
        write_json(STATE, state)          # saved BEFORE anything else can go wrong (review 28 Nov 2026)
        say("search %s is in campaign %s (step %s)" % (sid, cid, a["action_id"]))
        report(c, {"searchId": sid, "stage": "collecting", "collected": 0}, dry)
        return 0
    if a.get("busy"):
        say("the auto-collect step is still busy - next run")
        return 0
    first = state.setdefault("attempts", {}).setdefault(sid, now)
    if final_refusal(a) or now - float(first) > RETRY_HOURS * 3600:
        say("search %s refused: %s" % (sid, a.get("error")))
        report(c, {"searchId": sid, "stage": "failed", "error": a.get("error") or "Linked Helper refused it"}, dry)
        state["attempts"].pop(sid, None)
    else:
        say("search %s not in yet (%s) - tried again next run" % (sid, str(a.get("error"))[:160]))
    return 0


def step_people(lhc, c, state, now, dry):
    windows = live_windows(state.get("windows") or [], now)
    reported = state.setdefault("reported", {})
    for w in windows:
        pids = collected_pids(lhc, c, w)
        fresh = new_people(pids, reported.get(w["searchId"]), slugs_for(lhc, c, pids))
        for i in range(0, len(fresh), PEOPLE_PER_REPORT):
            chunk = fresh[i:i + PEOPLE_PER_REPORT]
            r = report(c, {"searchId": w["searchId"], "people": [slug for _pid, slug in chunk]}, dry)
            say("search %s: %d people reported, %s new to it" % (w["searchId"], len(chunk), r.get("added")))
            if not dry:
                reported.setdefault(w["searchId"], []).extend(pid for pid, _slug in chunk)
    keep = {w["searchId"] for w in windows}
    state["windows"] = windows
    state["reported"] = {k: v for k, v in reported.items() if k in keep}
    return 0


def main():
    dry = "--dry-run" in sys.argv[1:]
    lhc = load("lh_campaigns", "lh-campaigns.py")
    c = lhc.conf()
    if (c.get("CONNECTION_SEARCH") or "").strip().lower() not in ("on", "yes", "1", "true"):
        return 0                                   # switched off on this machine - silent, every 15 minutes
    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 0
    topup = load("lh_topup", "lh-topup.py")
    state = read_json(STATE) or {}
    now = time.time()
    rc = 0
    # Each step on its own: one failing never stops the other, and the state is saved at the end
    # whatever happened (and straight after a search goes in).
    first = ((lambda: step_current(lhc, c, topup, state, now, dry)) if state.get("current")
             else (lambda: step_next(lhc, c, topup, state, now, dry)))
    for name, fn in (("collect", first), ("people", lambda: step_people(lhc, c, state, now, dry))):
        try:
            rc = max(rc, fn() or 0)
        except Exception as e:
            say("FAILED in the %s step: %s" % (name, str(e)[:200]))
            rc = 1
    if not dry:
        write_json(STATE, state)
    return rc


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:   # one plain line into the log, never a traceback into cron mail
        say("FAILED:", e)
        sys.exit(1)
