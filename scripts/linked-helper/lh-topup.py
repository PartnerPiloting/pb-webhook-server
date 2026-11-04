#!/usr/bin/env python3
"""Top up a Linked Helper campaign from a search link - on the machine, driven by Wingguy.

WHY (Guy, 5 Nov 2026): clients forget how to top up. Roland asked where to click; Matthew ran out
of people twice. The Monday numbers email said "time to top up the search" and gave no way to do
it. Now a client hands their Claude (or the top-up page) a LinkedIn / Sales Navigator search link,
the server leaves a job for this machine, and this script puts the search into their campaign.

HOW (proven on Guy's own machine, 5 Nov 2026, campaign 48): Linked Helper has a built-in action
type "Auto-collect people from LinkedIn" (AutoCollectPeople). Its settings are a collecting URL,
the page type, and a repeat interval. Put one at the HEAD of the campaign chain and Linked Helper
walks the search itself, page by page, and every person it finds flows into the next step (the
invite). 30 people in 3 minutes, 70 in 10, all 2nd-degree, all queued behind the invite step.
So a top-up is:
  1. the campaign has no auto-collect step yet -> people.actions.createAction at position 0;
     it has one                                -> people.actions.createActionVersion with the new URL
  2. make sure the campaign is not paused (campaigns.setCampaignPaused false)
  3. report: how many people were waiting before, and later how many the collect added.
Everything goes through the data layer that lh-campaigns.py already drives (DevTools -> the
instance page's callWrite). This file imports that one rather than copying it.

WHAT IT CANNOT KNOW from the link: whether the people look right, how many the search holds,
and who is already in the campaign (Linked Helper skips those itself). Those come after the
collect, from lh.db, or are the client's to judge.

The repeat interval is set to a year: Linked Helper would otherwise re-walk the same search every
interval. A new top-up replaces the URL, so "once, until the next top-up" is the behaviour we want.

Commands (all print one JSON object; exit 0 = ok):
  check  <url>                          what kind of search link, and which connection degrees it asks for
  apply  <campaign_id> <url>            put the search into the campaign and make sure it runs
  status <campaign_id> <action_id> <since_iso>   what the collect has done since `since`
"""
import argparse
import datetime as dt
import importlib.util
import json
import os
import re
import sys
import urllib.parse

CANDIDATES = (
    "/usr/local/bin/lh-campaigns.py",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "lh-campaigns.py"),
    "/tmp/lh-campaigns.py",
)

REPEAT_MS = 365 * 86400000          # effectively once; the next top-up replaces the URL
ACTION_NAME = "Collect from your search (Wingguy top-up)"


def load_campaigns_module():
    for p in CANDIDATES:
        if os.path.exists(p):
            spec = importlib.util.spec_from_file_location("lh_campaigns", p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise RuntimeError("lh-campaigns.py not found in " + ", ".join(CANDIDATES))


# ------------------------------------------------------------------ the link itself

# The same shapes Linked Helper's own validator accepts (canCollectFromUrlAsType, read from the
# app bundle 5 Nov 2026): a people search on LinkedIn, a people search in Sales Navigator, or a
# Sales Navigator lead list. Nothing else is a top-up.
KINDS = (
    ("sn-search-page", re.compile(r"linkedin\.com/sales/search/people", re.I)),
    ("sn-list-people-page", re.compile(r"linkedin\.com/sales/lists/people/[^/&#?]+", re.I)),
    ("search-page", re.compile(r"linkedin\.com/search/results/people", re.I)),
)


def check_url(url):
    """Classify a pasted link. Returns {ok, kind, degrees, problem}. Never raises."""
    u = str(url or "").strip()
    out = {"ok": False, "kind": None, "degrees": None, "problem": None, "url": u}
    if not u:
        out["problem"] = "no link"
        return out
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
        out["url"] = u
    if re.search(r"linkedin\.com/search/results/people/.*?[&?]eventAttending=", u, re.I):
        out["problem"] = "that is an event's attendee list, not a people search"
        return out
    for kind, rx in KINDS:
        if rx.search(u):
            out["kind"] = kind
            break
    if not out["kind"]:
        if re.search(r"linkedin\.com/in/", u, re.I):
            out["problem"] = "that is one person's profile, not a search"
        elif re.search(r"linkedin\.com/search/results/(companies|all|content)", u, re.I):
            out["problem"] = "that search is not a PEOPLE search - switch LinkedIn's filter to People and copy the link again"
        elif re.search(r"linkedin\.com/sales/", u, re.I):
            out["problem"] = "that Sales Navigator page is not a people search or a lead list"
        elif "linkedin.com" in u.lower():
            out["problem"] = "that LinkedIn page is not a people search"
        else:
            out["problem"] = "that is not a LinkedIn link"
        return out
    out["degrees"] = degrees_in(u, out["kind"])
    out["ok"] = True
    return out


def degrees_in(url, kind):
    """Which connection degrees the link asks for: {'first','second','third'} booleans plus
    'known' (False when the link carries no degree filter we can read - e.g. a saved search)."""
    d = {"first": False, "second": False, "third": False, "known": False}
    raw = urllib.parse.unquote(url)
    if kind == "search-page":
        m = re.search(r"[?&]network=(\[[^\]&#]*\])", raw)
        if m:
            codes = re.findall(r'"([FSO])"', m.group(1))
            d.update(first="F" in codes, second="S" in codes, third="O" in codes, known=bool(codes))
        return d
    if kind == "sn-search-page":
        # Both Sales Navigator URL dialects: relationship:List(S,O) and
        # (type:RELATIONSHIP,values:List((id:S,...),(id:O,...)))
        m = re.search(r"relationship:List\(([^)]*)\)", raw)
        codes = re.findall(r"\b([FSO])\b", m.group(1)) if m else []
        if not codes:
            m = re.search(r"type:RELATIONSHIP,values:List\((.*?)\)\)", raw)
            codes = re.findall(r"id:([FSO])\b", m.group(1)) if m else []
        d.update(first="F" in codes, second="S" in codes, third="O" in codes, known=bool(codes))
        return d
    return d   # a lead list carries no degree filter in its address


# ------------------------------------------------------------------ reading the campaign

def chain(lhc, con, cid):
    d = lhc.campaign_detail(con, cid)
    return d, [a for a in d["actions"]]


def invite_action_ids(actions):
    return [a["id"] for a in actions if a.get("actionType") == "InvitePerson"]


def waiting_on_invite(con, cid, invite_ids):
    if not invite_ids:
        return None
    marks = ",".join("?" * len(invite_ids))
    return con.execute(
        f"SELECT count(*) FROM person_in_campaigns_history h WHERE h.campaign_id = ? AND h.result_id IS NULL "
        f"AND h.action_id IN ({marks})", (cid, *invite_ids)).fetchone()[0]


def autocollect_action(actions):
    for a in actions:
        if a.get("actionType") == "AutoCollectPeople":
            return a
    return None


def collecting_now(lhc, c, action_id):
    """Linked Helper names the step it is on in the instance window title - the one live signal."""
    title = lhc.instance_title(c) or ""
    return f"action #{action_id} AutoCollectPeople" in title


def iso_now():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def live_call_js(lhc, c, method, args_js):
    """Like lhc.live_call, but the argument list is a JS expression - for a call that needs a real
    Date (postponeAction rejects an ISO string with "Invalid time value", 5 Nov 2026)."""
    import asyncio
    import json as _json
    import time as _time
    if not lhc.instance_title(c):
        return {"ok": False, "error": "no Linked Helper instance window"}
    ws_url = lhc.find_ui_page()
    if not ws_url:
        return {"ok": False, "error": "could not find the instance interface page"}
    js = lhc.CALL_JS.replace("__METHOD__", _json.dumps(method)).replace("__ARGS__", args_js)

    async def go():
        import websockets
        async with websockets.connect(ws_url, max_size=2 ** 24, open_timeout=30, close_timeout=2) as ws:
            await ws.send(_json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
                "expression": js, "returnByValue": True, "awaitPromise": True, "timeout": lhc.CALL_TIMEOUT_S * 1000}}))
            deadline = _time.time() + lhc.CALL_TIMEOUT_S
            while _time.time() < deadline:
                msg = _json.loads(await asyncio.wait_for(ws.recv(), timeout=max(5, deadline - _time.time())))
                if msg.get("id") == 1:
                    res = msg.get("result", {})
                    if "error" in msg or "exceptionDetails" in res:
                        return {"ok": False, "error": _json.dumps(msg.get("error") or res.get("exceptionDetails"))[:400]}
                    value = res.get("result", {}).get("value")
                    return _json.loads(value) if value else {"ok": False, "error": "no value"}
        return {"ok": False, "error": "timed out"}
    return asyncio.run(go())


# ------------------------------------------------------------------ commands

def cmd_check(url):
    r = check_url(url)
    print(json.dumps(r))
    return 0 if r["ok"] else 1


def cmd_apply(cid, url, allow_no_invite=False):
    lhc = load_campaigns_module()
    c = lhc.conf()
    link = check_url(url)
    if not link["ok"]:
        print(json.dumps({"ok": False, "error": link["problem"], "link": link}))
        return 1
    with lhc.db(c) as con:
        li, who = lhc.li_account_db_id(con, c)
        d, actions = chain(lhc, con, cid)
        invite_ids = invite_action_ids(actions)
        before = waiting_on_invite(con, cid, invite_ids)
        existing = autocollect_action(actions)
        paused_before = bool(d["is_paused"])
    if d["is_archived"]:
        print(json.dumps({"ok": False, "error": f"campaign {cid} is archived"}))
        return 1
    if not invite_ids and not allow_no_invite:
        print(json.dumps({"ok": False, "error": f"campaign {cid} {d['name']!r} has no invite step - a top-up needs somewhere for the people to go"}))
        return 1

    config = {
        "actionType": "AutoCollectPeople",
        "overridePlatform": None,
        "actionSettings": {
            "collectingSource": {
                "autoCollectSourceType": "LinkedInURL",
                "linkedInCollectingType": link["kind"],
                "linkedInCollectingUrl": link["url"],
            },
            "repeatIntervalInMs": REPEAT_MS,
        },
        "coolDown": 0,
        "maxActionResultsPerIteration": -1,
    }
    since = iso_now()
    if existing and collecting_now(lhc, c, existing["id"]):
        # A new URL does not interrupt a running collect (proven 5 Nov 2026: the old search finished
        # first) - and the new one would then wait a whole repeat interval. Say so instead.
        print(json.dumps({"ok": False, "error": "the previous top-up is still being collected - wait for its email, then send the new search", "busy": True}))
        return 1
    if existing:
        r = lhc.live_call(c, "people.actions.createActionVersion", [{"actionId": existing["id"], "config": config, "liAccount": li}])
        how = "updated"
        action_id = existing["id"]
        if r.get("ok"):
            # A finished auto-collect sits postponed until its next repeat (a year). The UI's own
            # "start now" is postponeAction(id, date, "Manually"): pull the next run to now.
            p = live_call_js(lhc, c, "people.actions.postponeAction",
                             "[%d, new Date(%d), %s, %d]" % (int(existing["id"]), int(dt.datetime.now().timestamp() * 1000), json.dumps("Manually"), int(li)))
            if not p.get("ok"):
                print(json.dumps({"ok": False, "error": "the search went in but Linked Helper would not schedule it to start now: " + str(p.get("error"))[:200], "how": how}))
                return 1
    else:
        r = lhc.live_call(c, "people.actions.createAction", [{
            "campaignId": cid, "name": ACTION_NAME, "target": [], "excludeList": [],
            "config": config, "at": 0, "liAccount": li}])
        how = "inserted"
        action_id = None
        if r.get("ok") and isinstance(r.get("result"), dict):
            action_id = r["result"].get("id")
    if not r.get("ok"):
        print(json.dumps({"ok": False, "error": "Linked Helper refused the search: " + str(r.get("error"))[:300], "how": how}))
        return 1

    # Read the chain back - the new action's id when LH did not echo it, and the order.
    import time
    time.sleep(2)
    with lhc.db(c) as con:
        d2, actions2 = chain(lhc, con, cid)
        ac = autocollect_action(actions2)
        if ac:
            action_id = ac["id"]
        head_ok = bool(actions2) and actions2[0].get("actionType") == "AutoCollectPeople"
    if not action_id:
        print(json.dumps({"ok": False, "error": "the auto-collect step did not appear in the campaign", "how": how}))
        return 1

    unpaused = False
    if paused_before:
        p = lhc.live_call(c, "campaigns.setCampaignPaused", [cid, False, li])
        unpaused = bool(p.get("ok"))
        time.sleep(2)
    with lhc.db(c) as con:
        d3 = lhc.campaign_detail(con, cid)
    out = {"ok": True, "how": how, "campaign_id": cid, "campaign_name": d["name"], "action_id": action_id,
           "head_ok": head_ok, "waiting_before": before, "since": since, "link": link,
           "paused_before": paused_before, "unpaused": unpaused, "paused_now": bool(d3["is_paused"]),
           "account": who}
    print(json.dumps(out))
    return 0 if not d3["is_paused"] else 1


def cmd_status(cid, action_id, since):
    lhc = load_campaigns_module()
    c = lhc.conf()
    with lhc.db(c) as con:
        d, actions = chain(lhc, con, cid)
        invite_ids = invite_action_ids(actions)
        waiting = waiting_on_invite(con, cid, invite_ids)
        collected = con.execute(
            "SELECT count(*), max(result_created_at) FROM person_in_campaigns_history "
            "WHERE campaign_id = ? AND action_id = ? AND result_status = 1 AND result_created_at > ?",
            (cid, action_id, since)).fetchone()
        skipped = con.execute(
            "SELECT count(*) FROM person_in_campaigns_history "
            "WHERE campaign_id = ? AND action_id = ? AND result_status = -1 AND result_created_at > ?",
            (cid, action_id, since)).fetchone()[0]
        degrees = {}
        for dist, n in con.execute(
                "SELECT COALESCE(m.distance, 'UNKNOWN'), count(*) FROM person_in_campaigns_history h "
                "LEFT JOIN person_member_distance m ON m.person_id = h.person_id "
                "WHERE h.campaign_id = ? AND h.action_id = ? AND h.result_status = 1 AND h.result_created_at > ? "
                "GROUP BY 1", (cid, action_id, since)):
            degrees[str(dist)] = int(n)
        row = con.execute("SELECT postpone_reason, postpone_reason_data, startAt FROM actions WHERE id = ?", (action_id,)).fetchone()
    last = collected[1]
    stalled_min = None
    if last:
        try:
            t = dt.datetime.strptime(last[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc)
            stalled_min = int((dt.datetime.now(dt.timezone.utc) - t).total_seconds() // 60)
        except ValueError:
            pass
    reason = row["postpone_reason"] if row else None
    next_run = row["startAt"] if row else None
    # "Waiter" with the next run in the future is Linked Helper saying "done, see you next interval" -
    # that is the normal end of a collect (campaign 48, 5 Nov 2026: 250 people, then Waiter, startAt +24h).
    # Any other reason (page credits, LinkedIn limits) is a real pause.
    future = False
    if next_run:
        try:
            future = dt.datetime.strptime(str(next_run)[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc) > dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
        except ValueError:
            pass
    out = {"ok": True, "campaign_id": cid, "campaign_name": d["name"], "action_id": action_id, "since": since,
           "collected": int(collected[0]), "skipped": int(skipped), "last_collect_at": last,
           "minutes_since_last": stalled_min, "degrees": degrees, "waiting_now": waiting,
           "paused": bool(d["is_paused"]), "collecting_now": collecting_now(lhc, c, action_id),
           "postpone_reason": reason, "postpone_data": (row["postpone_reason_data"] if row else None),
           "next_run_at": next_run, "finished_normally": bool(reason == "Waiter" and future and last)}
    print(json.dumps(out))
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("check"); s.add_argument("url")
    s = sub.add_parser("apply"); s.add_argument("campaign_id", type=int); s.add_argument("url")
    s.add_argument("--allow-no-invite", action="store_true", help="tests only: a campaign with no invite step")
    s = sub.add_parser("status"); s.add_argument("campaign_id", type=int); s.add_argument("action_id", type=int); s.add_argument("since")
    a = p.parse_args()
    try:
        if a.cmd == "check":
            return cmd_check(a.url)
        if a.cmd == "apply":
            return cmd_apply(a.campaign_id, a.url, a.allow_no_invite)
        if a.cmd == "status":
            return cmd_status(a.campaign_id, a.action_id, a.since)
    except Exception as e:  # one JSON line, always - the agent parses stdout
        print(json.dumps({"ok": False, "error": str(e)[:400]}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
