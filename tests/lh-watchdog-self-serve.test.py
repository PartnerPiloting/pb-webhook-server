"""The watchdog's "leave a person alone" and "learn the account" rules (scripts/linked-helper/lh-watchdog.py).

Found 29 Sep 2026 on Roland Illyes's machine: nobody had signed in, so there was never an
instance window, so Linked Helper was killed and restarted every cycle for two weeks.

Run: python tests/lh-watchdog-self-serve.test.py
"""
import importlib.util
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "lh_watchdog", os.path.join(HERE, "..", "scripts", "linked-helper", "lh-watchdog.py"))
wd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wd)

failures = 0


def check(name, fn):
    global failures
    try:
        fn()
        print("  ok  " + name)
    except AssertionError as e:
        failures += 1
        print("  FAIL " + name + "\n       " + str(e))


def machine(partitions):
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "Partitions"))
    for p in partitions:
        os.makedirs(os.path.join(d, "Partitions", p))
    return d


def never_signed_in():
    assert wd.known_accounts(machine(["linked-helper-launcher"])) == []
    assert wd.known_accounts(os.path.join(tempfile.mkdtemp(), "nothing-here")) == []


def signed_in():
    d = machine(["linked-helper-launcher", "linked-helper-account-571651-main", "linked-helper-account-571651-content"])
    assert wd.known_accounts(d) == ["571651"]


def placeholder_is_replaced():
    assert wd.account_to_adopt("000000", ["571651"]) == "571651"
    assert wd.account_to_adopt("1", ["585942"]) == "585942"
    assert wd.account_to_adopt("", ["585942"]) == "585942"


def a_right_config_is_left_alone():
    assert wd.account_to_adopt("16045", ["16045"]) is None
    assert wd.account_to_adopt("16045", ["16045", "99999"]) is None


def never_guesses():
    assert wd.account_to_adopt("000000", []) is None
    assert wd.account_to_adopt("000000", ["111", "222"]) is None


def adopting_writes_config_and_autostart():
    d = tempfile.mkdtemp()
    wd.CONF = os.path.join(d, "machine.conf")
    wd.AUTOSTART = os.path.join(d, "linked-helper.desktop")
    with open(wd.CONF, "w") as f:
        f.write("LH_ACCOUNT_ID=000000\nCLIENT_ID=Roland-Illyes\nREPORT_SECRET=keep-me\n")
    with open(wd.AUTOSTART, "w") as f:
        f.write("[Desktop Entry]\nExec=/usr/bin/linked-helper --start-account-id=000000\n")
    conf, actions = {"LH_ACCOUNT_ID": "000000"}, []
    wd.adopt_account(conf, "571651", actions)
    assert conf["LH_ACCOUNT_ID"] == "571651"
    assert actions == ["account-learned:571651"], actions
    text = open(wd.CONF).read()
    assert "LH_ACCOUNT_ID=571651" in text and "CLIENT_ID=Roland-Illyes" in text and "REPORT_SECRET=keep-me" in text, text
    assert "--start-account-id=571651" in open(wd.AUTOSTART).read()


def a_locked_config_still_fixes_this_run():
    d = tempfile.mkdtemp()
    wd.CONF = os.path.join(d, "missing", "machine.conf")     # cannot be opened
    wd.AUTOSTART = os.path.join(d, "linked-helper.desktop")
    with open(wd.AUTOSTART, "w") as f:
        f.write("Exec=/usr/bin/linked-helper --start-account-id=1\n")
    conf, actions = {"LH_ACCOUNT_ID": "1"}, []
    wd.adopt_account(conf, "585942", actions)
    assert conf["LH_ACCOUNT_ID"] == "585942"
    assert actions and "config locked" in actions[0], actions
    assert "--start-account-id=585942" in open(wd.AUTOSTART).read()


def holding_off_has_an_end():
    wd.HOLD_OFF_FILE = os.path.join(tempfile.mkdtemp(), "cache", "hold-off")
    t0 = time.time()
    assert wd.hold_off(t0) is True                                   # the clock starts
    assert wd.hold_off(t0 + wd.HOLD_OFF_S - 60) is True              # still inside it
    assert wd.hold_off(t0 + wd.HOLD_OFF_S + 60) is False             # a tab left open does not win
    wd.clear_hold_off()
    assert wd.hold_off(t0 + wd.HOLD_OFF_S + 120) is True             # a fresh visit gets a fresh clock


check("a machine nobody has signed in to has no accounts", never_signed_in)
check("a signed-in machine names its account", signed_in)
check("a placeholder account number is replaced by the real one", placeholder_is_replaced)
check("a config that is already right is left alone", a_right_config_is_left_alone)
check("it never guesses between accounts, or from nothing", never_guesses)
check("adopting writes the config and the autostart, and keeps everything else", adopting_writes_config_and_autostart)
check("a config it cannot write still gets this run and the autostart right", a_locked_config_still_fixes_this_run)
check("holding off for a person on the screen has an end", holding_off_has_an_end)

if failures:
    print("\n%d failed" % failures)
    sys.exit(1)
print("\nall passed")
