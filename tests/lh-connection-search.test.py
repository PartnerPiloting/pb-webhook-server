"""Connections from your searches - the machine script's own decisions
(scripts/linked-helper/lh-connection-search.py, 28 Nov 2026, step 2 of docs/CONNECTIONS-SEARCH-BUILD-PLAN.md).

When is a collect over, how is the daily number written into the recipe, which refusals are final,
and who is reported against which search. Nothing here touches Linked Helper or the server.

Run: python tests/lh-connection-search.test.py
"""
import datetime as dt
import importlib.util
import json
import os
import sys
import types

sys.modules.setdefault("fcntl", types.ModuleType("fcntl"))

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "lh_cs", os.path.join(HERE, "..", "scripts", "linked-helper", "lh-connection-search.py"))
cs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cs)

failures = 0


def assert_eq(a, b):
    assert a == b, "%r != %r" % (a, b)


def check(name, fn):
    global failures
    try:
        fn()
        print("  ok  " + name)
    except AssertionError as e:
        failures += 1
        print("  FAIL " + name + ": " + str(e))


NOW = 1_800_000_000.0
iso = lambda t: dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
over = lambda st, started=NOW - 600: cs.collect_finished(st, started, NOW)[0]

print("when is a collect over")
check("Linked Helper finished it = over", lambda: assert_eq(over({"finished_normally": True}), True))
check("parked by Linked Helper with NOBODY new collected = over (review: it used to wait 20 hours)",
      lambda: assert_eq(over({"collected": 0, "postpone_reason": "Waiter", "next_run_at": iso(NOW + 365 * 86400), "collecting_now": False}), True))
check("still collecting, recent activity = not over",
      lambda: assert_eq(over({"collected": 30, "minutes_since_last": 2, "collecting_now": True}), False))
check("quiet an hour, not on the step, not held = over",
      lambda: assert_eq(over({"collected": 30, "minutes_since_last": 60, "collecting_now": False, "postpone_reason": "Manually"}, NOW - 7200), True))
check("quiet but HELD BACK by a Linked Helper limit = not over (it carries on later)",
      lambda: assert_eq(over({"collected": 30, "minutes_since_last": 300, "collecting_now": False, "postpone_reason": "LHLimit"}, NOW - 7200), False))
check("quiet only 20 minutes = not over yet",
      lambda: assert_eq(over({"collected": 30, "minutes_since_last": 20, "collecting_now": False}), False))
check("quiet but still ON the step = not over",
      lambda: assert_eq(over({"collected": 30, "minutes_since_last": 90, "collecting_now": True}), False))
check("nothing collected and not parked (Linked Helper has not reached it) = not over",
      lambda: assert_eq(over({"collected": 0, "minutes_since_last": None, "collecting_now": False, "postpone_reason": "Manually"}, NOW - 3 * 3600), False))
check("20 hours = stop waiting", lambda: assert_eq(over({"collected": 0}, NOW - 21 * 3600), True))

print("the daily number in the recipe")
recipe = json.load(open(os.path.join(HERE, "..", "scripts", "linked-helper", "campaigns", "07-connections-from-search.json"), encoding="utf-8"))


def no_invite_no_message():
    types_ = [a["actionType"] for a in recipe["actions"]]
    assert types_ == ["VisitAndExtract", "SendPersonToWebhook"], types_
    assert recipe["name"] == cs.CAMPAIGN_NAME


check("recipe 07 visits and sends - no invite, no message, and its name matches the script", no_invite_no_message)
check("a Pro machine's 25 is written into both steps",
      lambda: assert_eq([a["maxActionResultsPerIteration"] for a in cs.recipe_for(recipe, "25")["actions"]], [25, 25]))
check("unset or rubbish = the safe 5 (a Standard licence is never starved)",
      lambda: assert_eq(cs.recipe_for(recipe, "lots")["actions"][0]["maxActionResultsPerIteration"], cs.SAFE_PER_DAY))
check("a silly number is kept within 1-100",
      lambda: assert_eq(cs.recipe_for(recipe, 5000)["actions"][0]["maxActionResultsPerIteration"], 100))

print("which refusals are final")
check("a link Linked Helper cannot use = final",
      lambda: assert_eq(cs.final_refusal({"ok": False, "error": "that is not a LinkedIn link", "link": {"ok": False}}), True))
check("Linked Helper restarting = tried again (review: it used to fail the search for good)",
      lambda: assert_eq(cs.final_refusal({"ok": False, "error": "no Linked Helper instance window"}), False))
check("a DevTools time-out = tried again", lambda: assert_eq(cs.final_refusal({"ok": False, "error": "timed out"}), False))

print("who belongs to which search")


def windows_close():
    ws = [{"searchId": "A", "since": "t1", "until": None, "at": NOW - 100}]
    cs.close_window(ws, "t2")
    assert ws[0]["until"] == "t2", ws


check("a new search closes the last one's window where it starts - later arrivals are the new search's", windows_close)
check("windows past the keep time are let go",
      lambda: assert_eq([w["searchId"] for w in cs.live_windows([{"searchId": "old", "at": NOW - 130 * 86400}, {"searchId": "new", "at": NOW - 86400}], NOW)], ["new"]))
check("people with an address and not yet reported go now; the rest wait for their visit",
      lambda: assert_eq(cs.new_people([1, 2, 3, 4], [1], {1: "a", 2: "priya-p", 4: "sam-k"}), [(2, "priya-p"), (4, "sam-k")]))

print("\n%s" % ("all passed" if not failures else "%d FAILED" % failures))
sys.exit(1 if failures else 0)
