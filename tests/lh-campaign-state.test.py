#!/usr/bin/env python3
"""lh-watchdog.py campaign_state() against a tiny synthetic Linked Helper database (8 Oct 2026).

The real schema's relevant corner, cut down: actions -> action_versions -> action_configs (the
actionType lives here), action_results (what was done, result 1 = done), action_target_people
(the queue; state 1 = waiting), campaigns (is_paused, is_archived). Checks: first action, last
SUCCESSFUL invitation only, waiting split by running vs paused, archived and non-invite queues
ignored, and {} for a placeholder account or a missing database.

Run: python3 tests/lh-campaign-state.test.py
"""
import importlib.util
import os
import sqlite3
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("lhw", os.path.join(HERE, "..", "scripts", "linked-helper", "lh-watchdog.py"))
lhw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lhw)

failures = 0


def check(name, cond):
    global failures
    print(("  ok  " if cond else "  FAIL ") + name)
    if not cond:
        failures += 1


def build(root, acct):
    d = os.path.join(root, "Partitions", f"linked-helper-account-{acct}-main")
    os.makedirs(d)
    con = sqlite3.connect(os.path.join(d, "lh.db"))
    con.executescript("""
      CREATE TABLE campaigns (id INTEGER PRIMARY KEY, name TEXT, is_paused INT, is_archived INT);
      CREATE TABLE actions (id INTEGER PRIMARY KEY, campaign_id INT);
      CREATE TABLE action_configs (id INTEGER PRIMARY KEY, actionType TEXT);
      CREATE TABLE action_versions (id INTEGER PRIMARY KEY, action_id INT, config_id INT);
      CREATE TABLE action_results (id INTEGER PRIMARY KEY, action_version_id INT, result INT, created_at TEXT);
      CREATE TABLE action_target_people (id INTEGER PRIMARY KEY, action_id INT, state INT);
      INSERT INTO campaigns VALUES (1,'running',0,0),(2,'paused',1,0),(3,'archived',0,1);
      INSERT INTO action_configs VALUES (1,'InvitePerson'),(2,'VisitAndExtract'),(3,'InvitePerson'),(4,'InvitePerson');
      INSERT INTO actions VALUES (10,1),(11,1),(20,2),(30,3);
      INSERT INTO action_versions VALUES (100,10,1),(101,11,2),(200,20,3),(300,30,4);
      INSERT INTO action_results VALUES
        (1,101,1,'2026-09-29T06:59:40.165Z'),
        (2,100,1,'2026-10-06T02:00:00.000Z'),
        (3,100,-1,'2026-10-07T02:00:00.000Z'),
        (4,101,1,'2026-10-07T05:00:00.000Z');
    """)
    rows = [(10, 1)] * 5 + [(10, -1)] * 7 + [(10, 2)] * 2 + [(20, 1)] * 3 + [(30, 1)] * 9 + [(11, 1)] * 4
    con.executemany("INSERT INTO action_target_people (action_id, state) VALUES (?, ?)", rows)
    con.commit()
    con.close()


with tempfile.TemporaryDirectory() as root:
    build(root, "585942")
    s = lhw.campaign_state("585942", data_dir=root)
    check("first action is the earliest result of any kind", s.get("first_action_at") == "2026-09-29T06:59:40.165Z")
    check("last invite = newest SUCCESSFUL invitation (a failed one later is ignored)", s.get("last_invite_at") == "2026-10-06T02:00:00.000Z")
    check("waiting in running campaigns: invite queue, state 1 only", s.get("waiting_running") == 5)
    check("waiting in paused campaigns counted separately", s.get("waiting_paused") == 3)
    check("placeholder accounts and unknown accounts give {}",
          lhw.campaign_state("1", data_dir=root) == {} and lhw.campaign_state("000000", data_dir=root) == {}
          and lhw.campaign_state("999", data_dir=root) == {} and lhw.campaign_state(None, data_dir=root) == {})

with tempfile.TemporaryDirectory() as root:
    d = os.path.join(root, "Partitions", "linked-helper-account-42-main")
    os.makedirs(d)
    sqlite3.connect(os.path.join(d, "lh.db")).execute("CREATE TABLE unrelated (x)").connection.close()
    check("a database without the tables gives {} and never raises", lhw.campaign_state("42", data_dir=root) == {})

print("\nall passing" if not failures else f"\n{failures} failing")
sys.exit(1 if failures else 0)
