"""The machine finishing its own setup (scripts/linked-helper/lh-first-run.py).

What is tested is the DECISION and what it reads from disk - the part that decides whether a
client's machine gets overwritten. The doing (stop Linked Helper, import, start it) can only be
proven on a real machine.

Run: python tests/lh-first-run.test.py
"""
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "lh_first_run", os.path.join(HERE, "..", "scripts", "linked-helper", "lh-first-run.py"))
fr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fr)

failures = 0


def check(name, fn):
    global failures
    try:
        fn()
        print("  ok  " + name)
    except AssertionError as e:
        failures += 1
        print("  FAIL " + name + "\n       " + str(e))


ACCT = "571651"
READY = "Linked Helper 2 | Instance #571651 | 2.130.47 | Idle | LinkedIn logged in"
NOT_YET = "Linked Helper 2 | Instance #571651 | 2.130.47 | Idle | LinkedIn login page"
EXPORT = "/home/lh/roland-illyes-571651.lhd2"


def action(state, accounts, title, campaigns, export):
    return fr.decide(state, accounts, title, campaigns, export)[0]


def waits_for_the_person():
    assert action({}, [], "", None, None) == "wait"
    assert action({}, [ACCT], "", None, EXPORT) == "wait"            # no instance window yet
    assert action({}, [ACCT], NOT_YET, 0, EXPORT) == "wait"          # still signing in to LinkedIn
    other = READY.replace("571651", "999999")
    assert action({}, [ACCT], other, 0, EXPORT) == "wait"            # somebody else's instance


def imports_onto_an_empty_machine():
    assert fr.decide({}, [ACCT], READY, 0, EXPORT) == ("import", EXPORT)


def never_overwrites_a_machine_with_work_on_it():
    a, why = fr.decide({}, [ACCT], READY, 3, EXPORT)
    assert a == "skip-import" and "not being overwritten" in why, (a, why)


def never_overwrites_a_machine_it_cannot_read():
    a, why = fr.decide({}, [ACCT], READY, None, EXPORT)
    assert a == "skip-import" and "not being overwritten" in why, (a, why)


def no_export_is_not_a_problem():
    assert action({}, [ACCT], READY, 0, None) == "skip-import"


def gives_up_importing_after_two_goes():
    assert action({"import_tries": 1}, [ACCT], READY, 0, EXPORT) == "import"
    a, why = fr.decide({"import_tries": 2}, [ACCT], READY, 0, EXPORT)
    assert a == "skip-import" and "FAILED" in why, (a, why)


def then_builds_then_finishes():
    assert action({"import": "ok"}, [ACCT], READY, 5, EXPORT) == "build"
    assert action({"import": "skipped: x"}, [ACCT], READY, 0, None) == "build"
    assert action({"import": "ok", "campaign": "ok"}, [ACCT], READY, 6, EXPORT) == "finish"
    assert action({"import": "ok", "build_tries": 3}, [ACCT], READY, 5, EXPORT) == "stop"


def never_runs_twice():
    assert action({"done": "2026-09-30 09:00"}, [ACCT], READY, 0, EXPORT) == "done"


def two_accounts_is_for_a_person():
    assert action({}, ["111", "222"], READY, 0, EXPORT) == "stop"


def export_file(folder, name, account):
    hdr = json.dumps({"linkedInAccountId": account, "version": "2.130.47", "size": 10}).encode()
    p = os.path.join(folder, name)
    with open(p, "wb") as f:
        f.write(len(hdr).to_bytes(4, "little") + hdr + b"PK-not-a-real-zip")
    return p


def picks_only_an_export_for_this_account():
    home = tempfile.mkdtemp()
    os.makedirs(os.path.join(home, "Downloads"))
    export_file(home, "someone-else.lhd2", 999999)
    export_file(home, "lh.db.backup.2.130.45.archived.lhd2", int(ACCT))      # LH's own parked copy
    with open(os.path.join(home, "not-an-export.lhd2"), "wb") as f:
        f.write(b"hello")
    assert fr.waiting_export(home, ACCT) is None
    mine = export_file(os.path.join(home, "Downloads"), "roland.lhd2", int(ACCT))
    assert fr.waiting_export(home, ACCT) == mine


def counts_campaigns_and_admits_when_it_cannot():
    data = tempfile.mkdtemp()
    part = os.path.join(data, "Partitions", "linked-helper-account-%s-main" % ACCT)
    os.makedirs(part)
    assert fr.campaign_count(data, ACCT) is None                     # no database yet
    con = sqlite3.connect(os.path.join(part, "lh.db"))
    con.execute("CREATE TABLE campaigns (id INTEGER PRIMARY KEY, name TEXT)")
    con.commit()
    assert fr.campaign_count(data, ACCT) == 0
    con.execute("INSERT INTO campaigns (name) VALUES ('June')")
    con.commit()
    con.close()
    assert fr.campaign_count(data, ACCT) == 1
    assert fr.known_accounts(data) == [ACCT]


def says_it_plainly():
    assert fr.summary({"waiting": "nobody has signed in to Linked Helper yet"}).startswith("waiting - nobody")
    assert fr.summary({"done": "x", "import": "ok 2026", "campaign": "ok 2026"}) == "done - history imported, campaign built"
    assert fr.summary({"done": "x", "import": "skipped: no export", "campaign": "ok"}) == "done - no history imported, campaign built"
    assert fr.summary({"stopped": "campaign build FAILED 3 times"}).startswith("STOPPED - campaign build FAILED")


check("it waits until the person has signed in to both", waits_for_the_person)
check("an empty machine gets the import", imports_onto_an_empty_machine)
check("a machine with campaigns on it is never overwritten", never_overwrites_a_machine_with_work_on_it)
check("a machine it cannot read is never overwritten", never_overwrites_a_machine_it_cannot_read)
check("no export waiting is not a problem", no_export_is_not_a_problem)
check("it gives up importing after two goes, and says so", gives_up_importing_after_two_goes)
check("then it builds the campaign, then it finishes", then_builds_then_finishes)
check("it never runs twice", never_runs_twice)
check("two accounts on one machine is a question for a person", two_accounts_is_for_a_person)
check("only an export for this account is picked up", picks_only_an_export_for_this_account)
check("it counts campaigns, and admits when it cannot", counts_campaigns_and_admits_when_it_cannot)
check("the status line says it plainly", says_it_plainly)

if failures:
    print("\n%d failed" % failures)
    sys.exit(1)
print("\nall passed")
