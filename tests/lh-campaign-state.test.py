#!/usr/bin/env python3
"""lh-watchdog.py campaign_state() against a tiny synthetic Linked Helper database (8 Oct 2026).

The real schema's relevant corner, cut down: actions -> action_versions -> action_configs (the
actionType lives here), action_results (what was done, result 1 = done), person_in_campaigns_history
(one row per person per step, result_id set once done - Linked Helper's own "Profiles to process" is
the rows with no result), action_target_people (kept here only to prove it is NOT counted: its state
stays 1 after a person has been invited, 16 Oct 2026), campaigns (is_paused, is_archived). Checks:
first action, last SUCCESSFUL invitation only, waiting split by running vs paused, archived and
non-invite queues ignored, and {} for a placeholder account or a missing database.

Run: python3 tests/lh-campaign-state.test.py
"""
import datetime
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
RECENT = {}


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
      CREATE TABLE person_in_campaigns_history (id INTEGER PRIMARY KEY, person_id INT, campaign_id INT, action_id INT, result_id INT);
      INSERT INTO campaigns VALUES (1,'running',0,0),(2,'paused',1,0),(3,'archived',0,1);
      INSERT INTO action_configs VALUES (1,'InvitePerson'),(2,'VisitAndExtract'),(3,'InvitePerson'),(4,'InvitePerson');
      INSERT INTO actions VALUES (10,1),(11,1),(20,2),(30,3);
      INSERT INTO action_versions VALUES (100,10,1),(101,11,2),(200,20,3),(300,30,4);
      INSERT INTO action_results VALUES
        (1,101,1,'2020-09-29T06:59:40.165Z'),
        (2,100,1,'2020-10-06T02:00:00.000Z'),
        (3,100,-1,'2020-10-07T02:00:00.000Z'),
        (4,101,1,'2020-10-07T05:00:00.000Z'),
        (5,200,1,'2020-10-05T01:00:00.000Z');
    """)
    # The raw queue over-counts on purpose: 9 people at state 1 on the running invite step, of whom
    # 2 were invited already (history has a result) and 2 are stale rows with no history row at all
    # - exactly the two things that made campaign #40 read 4735 when Linked Helper said 1114.
    rows = [(10, 1)] * 9 + [(10, -1)] * 7 + [(10, 2)] * 2 + [(20, 1)] * 3 + [(30, 1)] * 9 + [(11, 1)] * 4
    con.executemany("INSERT INTO action_target_people (action_id, state) VALUES (?, ?)", rows)
    hist = ([(1, 10, None)] * 5 + [(1, 10, 7)] * 2          # running: 5 waiting, 2 done
            + [(1, 11, None)] * 4                          # running, but a visit step - not counted
            + [(2, 20, None)] * 3 + [(2, 20, 9)]           # paused: 3 waiting, 1 done
            + [(3, 30, None)] * 9)                         # archived - ignored
    con.executemany("INSERT INTO person_in_campaigns_history (person_id, campaign_id, action_id, result_id) VALUES (?, ?, ?, ?)",
                    [(i + 1, c, a, r) for i, (c, a, r) in enumerate(hist)])
    # Recent invitation ATTEMPTS, relative to now so the test never goes stale: two failed (one in
    # a paused campaign - an attempt is an attempt), one failed a week ago (outside the 3 days).
    now = datetime.datetime.now(datetime.timezone.utc)
    ts = lambda h: (now - datetime.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    con.executemany("INSERT INTO action_results (action_version_id, result, created_at) VALUES (?, ?, ?)",
                    [(100, -1, ts(1)), (200, -1, ts(5)), (100, -1, ts(24 * 7))])
    RECENT["attempt"] = ts(1)
    con.commit()
    con.close()


with tempfile.TemporaryDirectory() as root:
    build(root, "585942")
    s = lhw.campaign_state("585942", data_dir=root)
    check("first action is the earliest result of any kind", s.get("first_action_at") == "2020-09-29T06:59:40.165Z")
    check("last invite = newest SUCCESSFUL invitation of any campaign (failed ones later are ignored)", s.get("last_invite_at") == "2020-10-06T02:00:00.000Z")
    check("waiting in running campaigns = Linked Helper's own 'Profiles to process': history rows with no result, "
          "not action_target_people state 1 (which would say 9)", s.get("waiting_running") == 5)
    check("waiting in paused campaigns counted separately, the same way", s.get("waiting_paused") == 3)
    check("newest invitation attempt, failed or not", s.get("last_invite_attempt_at") == RECENT["attempt"])
    check("failed attempts in the last 3 days only", s.get("failed_invites_recent") == 2)
    pc = s.get("paused_campaigns")
    check("paused campaigns with people waiting are named, with their own queue and newest invitation",
          pc == [{"id": 2, "name": "paused", "waiting": 3, "last_invite_at": "2020-10-05T01:00:00.000Z"}])
    check("weekly numbers that cannot be read (this cut-down history has no result_status) cost only that list",
          s.get("campaigns") == [] and s.get("waiting_running") == 5)
    check("placeholder accounts and unknown accounts give {}",
          lhw.campaign_state("1", data_dir=root) == {} and lhw.campaign_state("000000", data_dir=root) == {}
          and lhw.campaign_state("999", data_dir=root) == {} and lhw.campaign_state(None, data_dir=root) == {})

def build_numbers(root, acct):
    """The weekly numbers (campaign_numbers): one connect campaign with an accepted step, one paused
    campaign with no accepted step, one with nothing waiting and nothing sent in 28 days (left out)."""
    d = os.path.join(root, "Partitions", f"linked-helper-account-{acct}-main")
    os.makedirs(d)
    con = sqlite3.connect(os.path.join(d, "lh.db"))
    con.executescript("""
      CREATE TABLE campaigns (id INTEGER PRIMARY KEY, name TEXT, is_paused INT, is_archived INT);
      CREATE TABLE actions (id INTEGER PRIMARY KEY, campaign_id INT);
      CREATE TABLE action_configs (id INTEGER PRIMARY KEY, actionType TEXT);
      CREATE TABLE action_versions (id INTEGER PRIMARY KEY, action_id INT, config_id INT);
      CREATE TABLE action_results (id INTEGER PRIMARY KEY, action_version_id INT, result INT, created_at TEXT);
      CREATE TABLE person_in_campaigns_history (id INTEGER PRIMARY KEY, person_id INT, campaign_id INT, action_id INT,
        result_id INT, result_status INT, result_created_at TEXT);
      INSERT INTO campaigns VALUES (1,'Connect',0,0),(2,'Old paused',1,0),(3,'Finished',0,0),(4,'Archived',0,1);
      INSERT INTO action_configs VALUES (1,'InvitePerson'),(2,'FilterContactsOutOfMyNetwork'),(3,'InvitePerson'),
        (4,'InvitePerson'),(5,'InvitePerson');
      INSERT INTO actions VALUES (10,1),(11,1),(20,2),(30,3),(40,4);
      INSERT INTO action_versions VALUES (100,10,1),(101,11,2),(200,20,3),(300,30,4),(400,40,5);
    """)
    now = datetime.datetime.now(datetime.timezone.utc)
    ago = lambda d: (now - datetime.timedelta(days=d)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    rows, pid = [], [0]

    def person(c, steps):
        pid[0] += 1
        for action, status, days in steps:
            rows.append((pid[0], c, action, None if status == -999 else 1, status, None if days is None else ago(days)))
    for _ in range(6):
        person(1, [(10, -999, None)])                          # waiting to be invited
    for _ in range(3):
        person(1, [(10, 1, 2), (11, -999, None)])              # invited this week, not yet accepted
    person(1, [(10, 1, 20), (11, 1, 3)])                       # invited 20 days ago, accepted this week
    person(1, [(10, 1, 21), (11, -1, 1)])                      # invited 21 days ago, withdrawn unaccepted
    person(1, [(10, 1, 25), (11, 1, 15)])                      # invited 25 days ago, accepted earlier
    person(1, [(10, 1, 60), (11, 1, 50)])                      # long ago - outside every window
    for _ in range(4):
        person(2, [(20, -999, None)])                          # paused campaign, 4 waiting, no accepted step
    person(3, [(30, 1, 40)])                                   # finished: nobody waiting, nothing in 28 days
    person(4, [(40, -999, None)])                              # archived
    con.executemany("INSERT INTO person_in_campaigns_history (person_id, campaign_id, action_id, result_id, "
                    "result_status, result_created_at) VALUES (?, ?, ?, ?, ?, ?)", rows)
    con.commit()
    con.close()


with tempfile.TemporaryDirectory() as root:
    build_numbers(root, "777")
    nums = lhw.campaign_state("777", data_dir=root).get("campaigns")
    by = {c["name"]: c for c in (nums or [])}
    check("weekly numbers: finished and archived campaigns are left out", sorted(by) == ["Connect", "Old paused"])
    c = by.get("Connect", {})
    check("weekly numbers: waiting = invite step with no result", c.get("waiting") == 6)
    check("weekly numbers: invitations in 7 and 28 days", c.get("invited_7d") == 3 and c.get("invited_28d") == 6)
    check("weekly numbers: acceptances picked up in the last 7 days", c.get("accepted_7d") == 1)
    check("weekly numbers: the 14-35 day cohort and how many of them accepted",
          c.get("cohort_invited") == 3 and c.get("cohort_accepted") == 2)
    p = by.get("Old paused", {})
    check("weekly numbers: a campaign without an accepted step reports null acceptances, and says it is paused",
          p.get("paused") is True and p.get("waiting") == 4 and p.get("accepted_7d") is None and p.get("cohort_accepted") is None)
    every = lhw.campaign_state("777", data_dir=root).get("all_campaigns")
    check("all campaigns: every unarchived campaign, finished ones included, archived left out (the scoring picker)",
          every == [{"id": 1, "name": "Connect", "paused": False}, {"id": 2, "name": "Old paused", "paused": True},
                    {"id": 3, "name": "Finished", "paused": False}])

with tempfile.TemporaryDirectory() as root:
    # A campaign created a minute ago: no steps, nobody loaded. It must still be in the list.
    d = os.path.join(root, "Partitions", "linked-helper-account-778-main")
    os.makedirs(d)
    con = sqlite3.connect(os.path.join(d, "lh.db"))
    con.executescript("CREATE TABLE campaigns (id INTEGER PRIMARY KEY, name TEXT, is_paused INT, is_archived INT);"
                      "INSERT INTO campaigns VALUES (7,'Brand new',0,0);")
    con.commit()
    con.close()
    con = sqlite3.connect(os.path.join(d, "lh.db"))
    got = lhw.all_campaigns(con)
    con.close()
    check("all campaigns: lists a brand-new empty campaign straight away", got == [{"id": 7, "name": "Brand new", "paused": False}])

with tempfile.TemporaryDirectory() as root:
    d = os.path.join(root, "Partitions", "linked-helper-account-42-main")
    os.makedirs(d)
    sqlite3.connect(os.path.join(d, "lh.db")).execute("CREATE TABLE unrelated (x)").connection.close()
    check("a database without the tables gives {} and never raises", lhw.campaign_state("42", data_dir=root) == {})

print("\nall passing" if not failures else f"\n{failures} failing")
sys.exit(1 if failures else 0)
