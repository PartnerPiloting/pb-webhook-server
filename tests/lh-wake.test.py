"""Opening the web link wakes a closed Linked Helper (scripts/linked-helper/lh-wake.py).

Found 1 Oct 2026 on Rick Wong's machine: Linked Helper closed itself to update, Rick opened his
link, and the watchdog held off restarting it BECAUSE he was looking - so he saw an empty screen.

Run: python tests/lh-wake.test.py
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "lh_wake", os.path.join(HERE, "..", "scripts", "linked-helper", "lh-wake.py"))
wk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wk)

failures = 0


def check(name, fn):
    global failures
    try:
        fn()
        print("  ok  " + name)
    except AssertionError as e:
        failures += 1
        print("  FAIL " + name + "\n       " + str(e))


def d(instance_open=False, has_account=True, watchdog_on=True, watching=True, closed_for_s=600, last_wake_ago_s=None):
    return wk.decide(instance_open, has_account, watchdog_on, watching, closed_for_s, last_wake_ago_s)


def rick_1_oct():
    # Closed ~3 minutes before he arrived: wake at once, and tell him.
    assert d(closed_for_s=180) == ("starting", True), d(closed_for_s=180)


def open_means_nothing_to_say():
    assert d(instance_open=True) == ("ready", False)
    assert d(instance_open=True, watching=False) == ("ready", False)


def never_signed_in_is_left_alone():
    # The Launcher IS what they should be looking at - signing in. Never wake, never banner.
    assert d(has_account=False) == ("sign-in", False)


def a_stopped_watchdog_means_hands_off():
    # lh-first-run.py stops the timer for an import; Guy stops it to work on the machine.
    assert d(watchdog_on=False) == ("paused", False)
    assert d(watchdog_on=False, closed_for_s=3600) == ("paused", False)


def nobody_looking_is_the_watchdogs_job():
    assert d(watching=False) == ("closed", False)


def give_a_self_restart_its_chance():
    # Linked Helper may be reopening itself after an update - do not race it.
    assert d(closed_for_s=10) == ("starting", False)
    assert d(closed_for_s=wk.GRACE_S) == ("starting", True)


def one_wake_then_let_the_start_finish():
    assert d(last_wake_ago_s=30) == ("starting", False)
    assert d(last_wake_ago_s=wk.REWAKE_S) == ("starting", True)


check("Rick's evening: closed, someone looking -> wake now", rick_1_oct)
check("open -> no banner, nothing to do", open_means_nothing_to_say)
check("nobody has signed in -> leave the Launcher alone", never_signed_in_is_left_alone)
check("watchdog timer stopped -> paused, hands off", a_stopped_watchdog_means_hands_off)
check("nobody looking -> the watchdog's 5-minute round covers it", nobody_looking_is_the_watchdogs_job)
check("just closed -> give Linked Helper its own restart first", give_a_self_restart_its_chance)
check("one wake, then wait for the start to finish", one_wake_then_let_the_start_finish)

print("\n%s" % ("all passed" if not failures else "%d FAILED" % failures))
sys.exit(1 if failures else 0)
