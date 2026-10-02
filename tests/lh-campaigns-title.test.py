"""Finding the Linked Helper window (scripts/linked-helper/lh-campaigns.py, instance_title).

The builder is run two ways: by root (a person, over ssh) and by the desktop user (the machine's
own first-run job). The desktop user cannot sudo, so asking it to "sudo -u lh" fails silently and
the build says Linked Helper is not open when it is. What is tested is the command that gets
built for each caller; reading a real window can only be proven on a real machine.

Run: python tests/lh-campaigns-title.test.py
"""
import importlib.util
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "lh_campaigns", os.path.join(HERE, "..", "scripts", "linked-helper", "lh-campaigns.py"))
lc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lc)

failures = 0


def check(name, fn):
    global failures
    try:
        fn()
        print("  ok  " + name)
    except AssertionError as e:
        failures += 1
        print("  FAIL " + name + "\n       " + str(e))


def command_built_when_running_as(name):
    """The shell command instance_title sends, with the caller's user name faked."""
    sent = []
    fake_pwd = types.ModuleType("pwd")
    fake_pwd.getpwuid = lambda uid: types.SimpleNamespace(pw_name=name)
    real_pwd, real_sh = sys.modules.get("pwd"), lc.sh
    had_geteuid = hasattr(os, "geteuid")
    real_geteuid = getattr(os, "geteuid", None)
    sys.modules["pwd"] = fake_pwd
    os.geteuid = lambda: 0
    lc.sh = lambda cmd: sent.append(cmd) or ""
    try:
        lc.instance_title({"LH_USER": "lh"})
    finally:
        lc.sh = real_sh
        if had_geteuid:
            os.geteuid = real_geteuid
        else:
            del os.geteuid
        if real_pwd is None:
            del sys.modules["pwd"]
        else:
            sys.modules["pwd"] = real_pwd
    return sent[0]


def desktop_user_does_not_sudo():
    cmd = command_built_when_running_as("lh")
    assert "sudo" not in cmd, cmd
    assert cmd.startswith("env DISPLAY=:0 xdotool "), cmd


def root_switches_to_the_desktop_user():
    cmd = command_built_when_running_as("root")
    assert cmd.startswith("sudo -u lh env DISPLAY=:0 xdotool "), cmd


print("lh-campaigns: finding the Linked Helper window")
check("the desktop user reads the screen directly, no sudo", desktop_user_does_not_sudo)
check("root switches to the desktop user", root_switches_to_the_desktop_user)

if failures:
    print("\n%d FAILED" % failures)
    sys.exit(1)
print("\nall passed")
