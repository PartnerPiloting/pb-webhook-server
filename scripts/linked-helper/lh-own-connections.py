#!/usr/bin/env python3
"""My own connections - send Wingguy the connections that no campaign sent.

WHY THIS EXISTS (Guy, 23 Nov 2026): a lead only reached Wingguy when a Linked Helper campaign sent
it. Someone the client connected with by hand - met at an event, accepted an invitation from -
never arrived. Guy's rule: every LinkedIn connection reaches Wingguy through this machine, however
the person was met. So once a night, just after midnight:

  1. READ  - hold the other running campaigns, switch on the holding campaign (one step: collect
             from the My Connections page, newest first, each person with the date they
             connected), let it read the top of the list for a few minutes, then stop the runner,
             start it again and switch the other campaigns back on.
  2. PICK  - from the holding list: connected on or after the switch-on date AND in no other
             campaign's history. Anyone a campaign invited is in that campaign's history, so they
             are skipped here, before a profile visit is spent on them.
  3. PASS  - add at most OWN_CONNECTIONS_MAX (8) of them, oldest first, to the campaign
             "My own connections" (visit the profile, send to the webhook - no invite, no
             message). The rest wait in the holding list and go on later nights. Nobody is dropped:
             the pick is made from the WHOLE holding list every night, not from "tonight's new ones".

WHAT WAS PROVEN ON GUY'S MACHINE (23 Nov 2026, Linked Helper 2.140.13) - do not re-learn these:
  - Collecting costs no profile visits and no webhook sends (counters unchanged over 910 people).
  - The collect starts within seconds once the other campaigns are held, ~45 people a minute.
  - PAUSING THE CAMPAIGN DOES NOT STOP A COLLECT IN FLIGHT. Pressing "Stop campaigns runner"
    does, within ten seconds; "Start campaigns runner" brings it back.
  - The collect step has no "only new" and no cap, and a repeat never stops by itself: it skips
    people it already has and keeps scrolling. That is why this script stops it on the clock.
  - person_connect.connected_at (ms) is written for every collected person, to the day.

IT MUST ALWAYS LEAVE THE MACHINE RUNNING. The list of campaigns it paused is written to a note on
disk BEFORE anything is paused; the restore runs in a `finally`; and `--recover` (cron, every 20
minutes) puts things back if a run died half-way. The watchdog also presses Start on an idle runner.

  lh-own-connections.py                 the nightly run (cron as root, 00:05)
  lh-own-connections.py --dry-run       show who would be passed tonight; touch nothing
  lh-own-connections.py --no-read       skip the read, just pick and pass (after a read that failed)
  lh-own-connections.py --max 3         pass at most 3 this run
  lh-own-connections.py --recover       put back what a dead run left paused; otherwise nothing

Config, /etc/linked-helper-machine.conf:
  OWN_CONNECTIONS_SINCE=2026-11-23      the switch-on date (machine's local date). Absent = this
                                        script does nothing at all - it is off for that machine.
  OWN_CONNECTIONS_MAX=8                 most people passed in one night
"""
import asyncio
import datetime as dt
import fcntl
import importlib.util
import json
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
HOLDING_NAME = "My connections - holding list (collect only)"
OWN_NAME = "My own connections"       # the server knows this name: services/leadCampaign.js OWN_CONNECTIONS
RECIPES = {HOLDING_NAME: "05-my-connections-holding.json", OWN_NAME: "06-my-own-connections.json"}
RECIPE_DIRS = (os.path.join(HERE, "campaigns"), "/usr/local/share/linked-helper/campaigns", HERE)
HOLD_NOTE = "/var/lib/lh-own-connections-hold.json"
STATE = "/var/lib/lh-own-connections.json"
LOCK = "/run/lh-own-connections.lock"
TOPUP_HOLD = "/home/%s/.wingguy-topup-hold.json"

READ_MIN_S = 150        # read at least this long
QUIET_S = 60            # ...and until nothing new has been written for this long
READ_MAX_S = 1200       # never read longer than this in one night
BUSY_WAIT_S = 1200      # how long to wait for the runner to finish what it is doing
HOLD_STALE_S = 2700     # --recover acts on a hold note older than this


def say(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%S%z"), "own-connections:", *a, flush=True)


def load(name, filename):
    # /usr/local/bin first: update-lh-machine.sh keeps that copy current; the one beside the recipes can be months old
    for d in ("/usr/local/bin", HERE, "/usr/local/share/linked-helper/campaigns"):
        p = os.path.join(d, filename)
        if os.path.exists(p):
            spec = importlib.util.spec_from_file_location(name, p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise RuntimeError(filename + " not found beside this script")


def find_recipe(name):
    for d in RECIPE_DIRS:
        p = os.path.join(d, RECIPES[name])
        if os.path.exists(p):
            return p
    return None


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


def since_ms(text):
    """'2026-11-23' (the machine's local date) -> the ms timestamp of that local midnight."""
    d = dt.datetime.strptime(text.strip(), "%Y-%m-%d")
    return int(time.mktime(d.timetuple()) * 1000)


def day(ms):
    return time.strftime("%d %b %Y", time.localtime(ms / 1000)) if ms else "-"


class Machine:
    def __init__(self):
        self.b = load("lh_campaigns", "lh-campaigns.py")
        self.c = self.b.conf()
        with self.b.db(self.c) as con:
            self.li, self.who = self.b.li_account_db_id(con, self.c)

    def q(self, sql, args=()):
        with self.b.db(self.c) as con:
            return con.execute(sql, args).fetchall()

    def campaigns(self):
        with self.b.db(self.c) as con:
            return [dict(r) for r in self.b.campaign_rows(con) if not r["is_archived"]]

    def campaign(self, name):
        rows = [r for r in self.campaigns() if r["name"] == name]
        return rows[0] if rows else None

    def ensure(self, name):
        row = self.campaign(name)
        if row:
            return row
        recipe = find_recipe(name)
        if not recipe:
            raise RuntimeError("no campaign %r and no recipe %s on this machine" % (name, RECIPES[name]))
        say("building", repr(name), "from", recipe)
        if self.b.cmd_create(self.c, recipe) != 0:
            raise RuntimeError("could not build " + repr(name))
        row = self.campaign(name)
        if not row:
            raise RuntimeError(repr(name) + " was not there after building it")
        return row

    def action(self, cid, action_type):
        with self.b.db(self.c) as con:
            acts = [a for a in self.b.campaign_detail(con, cid)["actions"] if a.get("actionType") == action_type]
        if len(acts) != 1:
            raise RuntimeError("campaign %s has %d %s step(s) - expected one" % (cid, len(acts), action_type))
        return acts[0]

    def title(self):
        return self.b.instance_title(self.c) or ""

    def state_word(self):
        """What the runner is doing, from the window title: the 4th |-separated part."""
        parts = [p.strip() for p in self.title().split("|")]
        return parts[3] if len(parts) > 3 else ""

    def set_paused(self, cid, paused):
        r = self.b.live_call(self.c, "campaigns.setCampaignPaused", [int(cid), bool(paused), self.li])
        return bool(r.get("ok"))

    def start_now(self, action_id):
        """The UI's own 'start now' on a step. Needs a real JS Date, hence an expression."""
        topup = load("lh_topup", "lh-topup.py")
        return topup.live_call_js(self.b, self.c, "people.actions.postponeAction",
                                  "[%d, new Date(%d), %s, %d]" % (int(action_id), int(time.time() * 1000), json.dumps("Manually"), int(self.li)))

    def press(self, word):
        """Press Linked Helper's own 'Start/Stop campaigns runner' button. Exact text only - a looser
        match for 'start' finds 'Stop' (see lh-watchdog.py)."""
        js = ("(function(){var re=/^" + word + " campaigns runner$/i;"
              "var els=[].slice.call(document.querySelectorAll('button,[role=\"button\"],div,span'))"
              ".filter(function(e){var t=(e.innerText||'').trim();return re.test(t)&&e.offsetParent!==null;});"
              "if(!els.length)return 'NOT FOUND';els[els.length-1].click();return 'CLICKED';})()")

        async def go():
            import websockets
            ws_url = self.b.find_ui_page()
            if not ws_url:
                return "NO PAGE"
            async with websockets.connect(ws_url, max_size=2 ** 22, open_timeout=20) as ws:
                await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": js, "returnByValue": True}}))
                for _ in range(30):
                    r = json.loads(await asyncio.wait_for(ws.recv(), 20))
                    if r.get("id") == 1:
                        return r.get("result", {}).get("result", {}).get("value")
            return "NO RESPONSE"
        try:
            return asyncio.run(go())
        except Exception as e:
            return "FAILED: " + str(e)[:120]

    def runner_up(self):
        """Make sure the runner is going. Returns True once the title stops saying Idle."""
        for attempt in range(4):
            word = self.state_word()
            if word and not word.lower().startswith("idle"):
                return True
            say("runner is idle - pressing Start:", self.press("start"))
            time.sleep(8)
        word = self.state_word()
        return bool(word) and not word.lower().startswith("idle")


# ------------------------------------------------------------------ putting things back

def restore(m, note, holding_id):
    """Undo a hold: holding campaign paused, every campaign in the note running, runner going.
    Safe to call twice. Returns True when everything is back."""
    ok = True
    if holding_id is not None:
        if "AutoCollectPeople" in m.title() and ("#%d " % holding_id) in m.title():
            say("the read is still going - stopping the runner:", m.press("stop"))
            time.sleep(6)
        if not m.set_paused(holding_id, True):
            ok = False
            say("WARNING: could not pause the holding campaign")
    for cid in (note or {}).get("paused") or []:
        if not m.set_paused(cid, False):
            ok = False
            say("WARNING: could not switch campaign", cid, "back on")
    time.sleep(2)
    state = {int(r["id"]): bool(r["is_paused"]) for r in m.campaigns()}
    still = [int(c) for c in (note or {}).get("paused") or [] if state.get(int(c))]
    if still:
        ok = False
        say("WARNING: still paused:", still)
    if not m.runner_up():
        ok = False
        say("WARNING: the runner did not start - the watchdog presses Start within five minutes")
    if ok and os.path.exists(HOLD_NOTE):
        os.remove(HOLD_NOTE)
    return ok


def cmd_recover(m):
    note = read_json(HOLD_NOTE)
    if not note:
        return 0
    age = time.time() - float(note.get("at") or 0)
    if age < HOLD_STALE_S:
        return 0
    say("a run left campaigns paused %d minutes ago - putting them back: %s" % (age // 60, note.get("paused")))
    holding = m.campaign(HOLDING_NAME)
    return 0 if restore(m, note, int(holding["id"]) if holding else None) else 1


# ------------------------------------------------------------------ 1. read

def holding_rows(m, hid):
    """(count, newest connected_at) of the holding list."""
    r = m.q("SELECT count(*), max(pc.connected_at) FROM person_in_campaigns_history h "
            "LEFT JOIN person_connect pc ON pc.person_id = h.person_id WHERE h.campaign_id = ?", (hid,))[0]
    return int(r[0]), r[1]


def read_connections(m, holding):
    hid = int(holding["id"])
    step = m.action(hid, "AutoCollectPeople")
    user = m.c.get("LH_USER", "lh")
    if os.path.exists(TOPUP_HOLD % user):
        say("a campaign top-up is collecting right now - no read tonight")
        return False
    waited = 0
    while "Running campaign #" in m.title() or "ollecting" in m.title():
        if waited >= BUSY_WAIT_S:
            say("the runner was busy for %d minutes - no read tonight" % (BUSY_WAIT_S // 60))
            return False
        time.sleep(20)
        waited += 20
    if not m.title():
        say("no Linked Helper instance window - no read tonight")
        return False

    before, prev_newest = holding_rows(m, hid)
    state = read_json(STATE) or {}
    quiet_needed = 300 if state.get("gap") else QUIET_S
    others = [int(r["id"]) for r in m.campaigns() if not r["is_paused"] and int(r["id"]) != hid]
    note = {"paused": others, "at": time.time()}
    write_json(HOLD_NOTE, note)             # BEFORE anything is paused
    reached = True
    try:
        for cid in others:
            if not m.set_paused(cid, True):
                say("WARNING: could not hold campaign", cid)
        p = m.start_now(step["id"])
        if not p.get("ok"):
            raise RuntimeError("Linked Helper would not start the collect step: " + str(p.get("error"))[:200])
        if not m.set_paused(hid, False):
            raise RuntimeError("could not switch the holding campaign on")
        say("reading My Connections - %d in the holding list, newest %s; held campaigns %s" % (before, day(prev_newest), others))
        t0 = time.time()
        last_count, last_change, started = before, time.time(), False
        while True:
            time.sleep(10)
            n, _ = holding_rows(m, hid)
            if "AutoCollectPeople" in m.title():
                started = True
            if n != last_count:
                last_count, last_change, started = n, time.time(), True
            elapsed = time.time() - t0
            if not started and elapsed > 180:
                raise RuntimeError("the collect never started")
            if elapsed >= READ_MAX_S:
                reached = (time.time() - last_change) >= quiet_needed
                break
            if started and elapsed >= READ_MIN_S and (time.time() - last_change) >= quiet_needed:
                break
            if started and elapsed > 60 and "AutoCollectPeople" not in m.title() and n == last_count:
                break                        # it ended by itself (the whole list was read)
        say("stopping the read after %d s: %s" % (time.time() - t0, m.press("stop")))
        time.sleep(8)
        if "AutoCollectPeople" in m.title():
            say("still reading - pressing Stop again:", m.press("stop"))
            time.sleep(8)
    finally:
        back = restore(m, note, hid)
    after, newest = holding_rows(m, hid)
    added = after - before
    oldest_new = None
    if added:
        oldest_new = m.q("SELECT min(pc.connected_at) FROM (SELECT person_id FROM person_in_campaigns_history WHERE campaign_id = ? "
                         "ORDER BY id DESC LIMIT ?) h JOIN person_connect pc ON pc.person_id = h.person_id", (hid, added))[0][0]
    if reached:
        say("read done: %d new in the holding list (%d in all). Reached back past last night's newest (%s): yes%s"
            % (added, after, day(prev_newest), "" if not added else " - new ones run from %s to %s" % (day(oldest_new), day(newest))))
    else:
        say("WARNING: read done but it was STILL finding new people at the %d-minute limit (%d new, back to %s). "
            "Tomorrow's read runs longer. Nobody is dropped - the pick below uses the whole list." % (READ_MAX_S // 60, added, day(oldest_new)))
    state.update({"gap": not reached, "last_read_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "newest_connected_at": newest,
                  "holding_count": after, "last_added": added})
    write_json(STATE, state)
    say("machine back as it was:", "yes" if back else "NOT FULLY - see the warnings above")
    return True


# ------------------------------------------------------------------ 2. pick  3. pass

def pick(m, hid, since):
    """Everyone in the holding list who connected on or after the switch-on date and is in no other
    campaign's history (that includes 'My own connections' itself, so nobody is passed twice).
    Oldest first, so nobody waits behind newer arrivals for ever."""
    rows = m.q(
        "SELECT h.person_id, min(pc.connected_at) AS connected_at, "
        " (SELECT e.external_id FROM person_external_ids e WHERE e.person_id = h.person_id AND e.type_group = 'public' ORDER BY e.id DESC LIMIT 1) AS slug "
        "FROM person_in_campaigns_history h JOIN person_connect pc ON pc.person_id = h.person_id "
        "WHERE h.campaign_id = ? AND pc.connected_at >= ? "
        "AND NOT EXISTS (SELECT 1 FROM person_in_campaigns_history o WHERE o.person_id = h.person_id AND o.campaign_id <> ?) "
        "GROUP BY h.person_id ORDER BY connected_at, h.person_id", (hid, since, hid))
    return [{"person_id": r[0], "connected_at": r[1], "slug": r[2]} for r in rows]


def pass_on(m, own, people):
    links = ["https://www.linkedin.com/in/%s/" % p["slug"] for p in people]
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write("\n".join(links) + "\n")
        path = f.name
    try:
        if m.b.cmd_queue(m.c, int(own["id"]), path, "VisitAndExtract") != 0:
            say("FAILED: could not add them to", repr(OWN_NAME), "- they stay in the holding list for tomorrow")
            return False
    finally:
        os.unlink(path)
    if own["is_paused"]:
        m.set_paused(int(own["id"]), False)
    return True


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    m = Machine()
    if "--recover" in args:
        lock = open(LOCK, "w")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return 0                         # a run is in flight - it will put things back itself
        return cmd_recover(m)

    since_text = (m.c.get("OWN_CONNECTIONS_SINCE") or "").strip()
    if not since_text:
        say("OWN_CONNECTIONS_SINCE is not set in the machine config - this is switched off here")
        return 0
    since = since_ms(since_text)
    cap = int(m.c.get("OWN_CONNECTIONS_MAX") or 8)
    if "--max" in args:
        cap = int(args[args.index("--max") + 1])

    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        say("another run is in flight - leaving it to finish")
        return 0

    holding = m.campaign(HOLDING_NAME) if dry else m.ensure(HOLDING_NAME)
    if not holding:
        say("dry run: no holding campaign on this machine yet")
        return 0
    hid = int(holding["id"])
    stale = read_json(HOLD_NOTE)
    if stale and not dry:
        say("an earlier run left a hold note - putting those campaigns back first")
        restore(m, stale, hid)

    read_ok = True
    if not dry and "--no-read" not in args:
        try:
            read_ok = read_connections(m, holding)
        except Exception as e:
            read_ok = False
            say("FAILED during the read:", e, "- carrying on with the people already in the holding list")

    people = pick(m, hid, since)
    no_link = [p for p in people if not p["slug"]]
    ready = [p for p in people if p["slug"]]
    tonight, later = ready[:cap], ready[cap:]
    say("switch-on date %s: %d waiting who no campaign sent - %d tonight, %d on later nights%s"
        % (since_text, len(ready), len(tonight), len(later), (", %d with no profile link yet" % len(no_link)) if no_link else ""))
    for p in tonight:
        say("  %s %s  connected %s" % ("would pass" if dry else "passing", p["slug"], day(p["connected_at"])))
    if dry or not tonight:
        return 0 if read_ok else 1
    own = m.ensure(OWN_NAME)
    if not pass_on(m, own, tonight):
        return 1
    say("%d added to %r - it visits and sends them in its own hours" % (len(tonight), OWN_NAME))
    return 0 if read_ok else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never a traceback into cron mail - one plain line
        say("FAILED:", e)
        sys.exit(1)
