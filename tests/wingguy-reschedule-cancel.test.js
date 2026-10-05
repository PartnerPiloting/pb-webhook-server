/**
 * Tests for moving / cancelling a booked meeting, and the daylight-saving guarantees under them
 * (Guy 2026-10-05, after Meenakshi asked to move her call to "next Tuesday 3pm").
 * Contracts:
 *   1. DAYLIGHT SAVING: a lead's wall-clock time converts to the coach's on the MEETING's date, never
 *      today's - checked across the October start and April end for Melbourne, Sydney, Adelaide,
 *      Hobart and Perth against Brisbane.
 *   2. Only an upcoming event with THIS lead as a (non-self) attendee is ever a candidate - never a
 *      HOLD, another lead's meeting, an all-day block or a past meeting.
 *   3. None or several matches -> stop, never guess. The confirmed call must name the event id.
 *   4. A preview changes nothing. A move UPDATES the event (same id, same length, notify on) - never
 *      delete-and-rebook. A cancel deletes with notify on.
 *   5. The new time gets the clash guard (minus the meeting's own slot and the lead's own HOLDs),
 *      refusing a clash unless confirm_double_book.
 *   6. The tool text states OLD and NEW times on both clocks, worked out in code.
 *
 * Pure - calendar, CRM and client record are stubbed. Synthetic people only.
 *
 * Run: node tests/wingguy-reschedule-cancel.test.js
 */
const assert = require('assert');
const wingguyCalendar = require('../services/wingguyCalendar');
const { runRescheduleMeeting, runCancelMeeting, clocksLine } = require('../services/wingguyBookingMcp');

const BNE = 'Australia/Brisbane';
const NOW = Date.parse('2026-10-05T00:00:00Z'); // Mon 5 Oct 2026, 10:00am Brisbane
const LEAD = 'pat@example.com';
const COACH = { clientId: 'Test-Coach', clientName: 'Test Coach', timezone: BNE, calendarProvider: 'unipile' };

// Coach-side events as the provider seam returns them (13 Oct 2pm Brisbane = 04:00Z).
function meeting(id, startISO, mins = 30, extra = {}) {
  return {
    id, calendarId: 'cal-1', summary: extra.summary || 'Pat Lead & Test Coach',
    start: startISO, end: new Date(Date.parse(startISO) + mins * 60000).toISOString(),
    attendees: extra.attendees || [{ email: 'coach@example.com', self: true }, { email: 'Pat@Example.com' }],
    ...(extra.allDay ? { allDay: true } : {}),
  };
}
const PAT_13 = meeting('ev-pat', '2026-10-13T04:00:00Z');

function stubDeps(events, over = {}) {
  const calls = { update: [], del: [], holds: [], reads: [] };
  const deps = {
    nowMs: NOW,
    getMeetingsInWindow: async (coach, from, to) => { calls.reads.push({ coach, from, to }); return { events, error: null }; },
    getClashesForISO: async () => [],
    updateCalendarEventTime: async (coach, id, d) => { calls.update.push({ coach, id, d }); return { ok: true, provider: 'unipile' }; },
    deleteCalendarEvent: async (coach, id, o) => { calls.del.push({ coach, id, o }); return { ok: true, provider: 'nylas', notified: true }; },
    deleteOfferHolds: async (coach, o) => { calls.holds.push(o); return { removed: 0 }; },
    getClientById: async () => COACH,
    lookupLeadContactByName: async (name) => ({ lead: { leadName: name, email: LEAD, location: 'Greater Melbourne Area' }, matches: [{ leadName: name, email: LEAD }] }),
    ...over,
  };
  return { deps, calls };
}

async function run() {
  let failures = 0;
  const t = async (name, fn) => {
    try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`FAIL - ${name}\n  ${e.message}`); }
  };

  // ── 1. Daylight saving, per meeting date ─────────────────────────────────────────────────────────
  // Expected minutes the lead's clock is AHEAD of Brisbane. 2026: AEDT/ACDT start Sun 4 Oct; the
  // previous season ended Sun 5 Apr 2026.
  const GAPS = [
    // zone,                 before Oct 4, after Oct 4, before Apr 5, after Apr 5
    ['Australia/Melbourne', 0, 60, 60, 0],
    ['Australia/Sydney', 0, 60, 60, 0],
    ['Australia/Hobart', 0, 60, 60, 0],
    ['Australia/Adelaide', -30, 30, 30, -30],
    ['Australia/Perth', -120, -120, -120, -120],
  ];
  const DATES = ['2026-10-02', '2026-10-06', '2026-04-03', '2026-04-07'];
  for (const [zone, ...gaps] of GAPS) {
    await t(`DST: ${zone} vs Brisbane across October start and April end`, () => {
      DATES.forEach((date, i) => {
        const iso = wingguyCalendar.wallClockToISO(date, '12:00', zone);
        assert.strictEqual(wingguyCalendar.clockGapMins(iso, BNE, zone), gaps[i], `${zone} ${date} gap`);
        // 12:00 lead-side lands on the coach's clock shifted by exactly that gap, for THAT date.
        const coachMin = wingguyCalendar.minutesInTz(iso, BNE);
        assert.strictEqual(coachMin, 12 * 60 - gaps[i], `${zone} ${date} coach minutes`);
      });
    });
  }

  await t('DST: 12:00pm Melbourne on Tue 6 Oct 2026 is 11:00am Brisbane (the Meenakshi date)', () => {
    const iso = wingguyCalendar.wallClockToISO('2026-10-06', '12:00', 'Australia/Melbourne');
    assert.strictEqual(iso, '2026-10-06T01:00:00.000Z');
    assert.ok(/11:00\s?am/i.test(wingguyCalendar.formatInTz(iso, BNE)), wingguyCalendar.formatInTz(iso, BNE));
  });

  await t('clocksLine: states both clocks for the date, and says UNKNOWN rather than guessing', () => {
    const line = clocksLine('2026-10-13T04:00:00Z', BNE, 'Australia/Melbourne');
    assert.ok(/2:00\s?pm Brisbane time/.test(line), line);
    assert.ok(/3:00\s?pm Melbourne time/.test(line), line);
    assert.ok(/Melbourne is 1h ahead of Brisbane/.test(line), line);
    const sameDay = clocksLine('2026-09-29T04:00:00Z', BNE, 'Australia/Melbourne');
    assert.ok(/same clock on this date/.test(sameDay), sameDay);
    assert.ok(/UNKNOWN/.test(clocksLine('2026-10-13T04:00:00Z', BNE, null)));
  });

  // ── 2. Which events can ever match ───────────────────────────────────────────────────────────────
  await t('match: only upcoming, timed, non-HOLD events with the lead as a guest', () => {
    const events = [
      PAT_13,
      meeting('hold-pat', '2026-10-14T00:00:00Z', 30, { summary: 'HOLD: Pat Lead (Wingguy offer - do not book over)', attendees: [{ email: 'coach@example.com', self: true }] }),
      meeting('hold-pat-guest', '2026-10-14T02:00:00Z', 30, { summary: 'HOLD: Pat Lead (Wingguy offer - do not book over)' }),
      meeting('other-lead', '2026-10-15T00:00:00Z', 30, { summary: 'Sam Other & Test Coach', attendees: [{ email: 'coach@example.com', self: true }, { email: 'sam@example.com' }] }),
      meeting('past', '2026-10-01T00:00:00Z'),
      meeting('allday', '2026-10-16T00:00:00Z', 1440, { allDay: true }),
      meeting('self-only', '2026-10-17T00:00:00Z', 30, { attendees: [{ email: LEAD, self: true }] }),
      { ...meeting('no-id', '2026-10-18T00:00:00Z'), id: null },
    ];
    const got = wingguyCalendar.matchLeadMeetings(events, { leadEmails: [LEAD], nowMs: NOW });
    assert.deepStrictEqual(got.map((e) => e.id), ['ev-pat']);
    assert.deepStrictEqual(wingguyCalendar.matchLeadMeetings(events, { leadEmails: [], nowMs: NOW }), []);
  });

  // ── 3/4/5. The guarded move ──────────────────────────────────────────────────────────────────────
  const NEW = '2026-10-20T04:00:00.000Z'; // Tue 20 Oct, 2pm Brisbane / 3pm Melbourne

  await t('move preview: finds the one meeting, changes nothing', async () => {
    const { deps, calls } = stubDeps([PAT_13]);
    const r = await wingguyCalendar.rescheduleMeetingGuarded(COACH, { leadEmails: [LEAD], leadName: 'Pat Lead', newStartISO: NEW, apply: false }, deps);
    assert.ok(r.ok && !r.applied && r.event.id === 'ev-pat');
    assert.strictEqual(r.newEnd, '2026-10-20T04:30:00.000Z');
    assert.strictEqual(calls.update.length, 0);
    assert.strictEqual(calls.holds.length, 0);
  });

  await t('move apply: UPDATES the same event id, keeps its length, notifies, reads/writes via the write provider', async () => {
    const long = meeting('ev-long', '2026-10-13T04:00:00Z', 60);
    const { deps, calls } = stubDeps([long]);
    const r = await wingguyCalendar.rescheduleMeetingGuarded(COACH, { leadEmails: [LEAD], leadName: 'Pat Lead', eventId: 'ev-long', newStartISO: NEW, apply: true }, deps);
    assert.ok(r.ok && r.applied, JSON.stringify(r));
    assert.strictEqual(calls.update.length, 1);
    assert.strictEqual(calls.update[0].id, 'ev-long');
    assert.deepStrictEqual(calls.update[0].d, { startISO: NEW, endISO: '2026-10-20T05:00:00.000Z', calendarId: 'cal-1', notifyParticipants: true });
    assert.strictEqual(calls.update[0].coach.calendarProvider, 'unipile');
    assert.strictEqual(calls.del.length, 0, 'a move must never delete');
    assert.deepStrictEqual(calls.holds, [{ leadName: 'Pat Lead' }]);
  });

  await t('move: no match / several matches / a stale event id all stop without acting', async () => {
    const none = stubDeps([]);
    const r0 = await wingguyCalendar.rescheduleMeetingGuarded(COACH, { leadEmails: [LEAD], newStartISO: NEW, apply: true, eventId: 'x' }, none.deps);
    assert.strictEqual(r0.reason, 'gone');
    const r1 = await wingguyCalendar.rescheduleMeetingGuarded(COACH, { leadEmails: [LEAD], newStartISO: NEW }, none.deps);
    assert.strictEqual(r1.reason, 'none');
    const two = stubDeps([PAT_13, meeting('ev-pat-2', '2026-10-27T04:00:00Z')]);
    const r2 = await wingguyCalendar.rescheduleMeetingGuarded(COACH, { leadEmails: [LEAD], newStartISO: NEW, apply: true }, two.deps);
    assert.strictEqual(r2.reason, 'many');
    assert.strictEqual(r2.matches.length, 2);
    assert.strictEqual(none.calls.update.length + two.calls.update.length, 0);
  });

  await t('move: current_date narrows the search to that day in the coach\'s timezone', async () => {
    const { deps, calls } = stubDeps([PAT_13]);
    await wingguyCalendar.rescheduleMeetingGuarded(COACH, { leadEmails: [LEAD], date: '2026-10-13', newStartISO: NEW }, deps);
    assert.strictEqual(calls.reads[0].from.toISOString(), '2026-10-12T14:00:00.000Z');
    assert.strictEqual(calls.reads[0].to.toISOString(), '2026-10-13T14:00:00.000Z');
  });

  await t('move: refuses a clash unless confirmed; ignores its own slot and the lead\'s own HOLD', async () => {
    const ownDisplay = wingguyCalendar.formatInTz(PAT_13.start, BNE);
    const clashes = [
      { summary: PAT_13.summary, display: ownDisplay },
      { summary: 'HOLD: Pat Lead (Wingguy offer - do not book over)', display: 'x' },
      { summary: 'Dentist', display: 'Tue, 20 Oct, 2:00 pm' },
    ];
    const { deps, calls } = stubDeps([PAT_13], { getClashesForISO: async () => clashes });
    const blocked = await wingguyCalendar.rescheduleMeetingGuarded(COACH, { leadEmails: [LEAD], leadName: 'Pat Lead', eventId: 'ev-pat', newStartISO: NEW, apply: true }, deps);
    assert.ok(!blocked.ok && blocked.clash);
    assert.deepStrictEqual(blocked.clashes.map((c) => c.summary), ['Dentist']);
    assert.strictEqual(calls.update.length, 0);
    const ok = await wingguyCalendar.rescheduleMeetingGuarded(COACH, { leadEmails: [LEAD], leadName: 'Pat Lead', eventId: 'ev-pat', newStartISO: NEW, apply: true, confirmDoubleBook: true }, deps);
    assert.ok(ok.ok && ok.applied);
    assert.strictEqual(calls.update.length, 1);
  });

  await t('move: rejects a past or unparseable new time, and a no-op move', async () => {
    const { deps } = stubDeps([PAT_13]);
    assert.ok(/past/.test((await wingguyCalendar.rescheduleMeetingGuarded(COACH, { leadEmails: [LEAD], newStartISO: '2026-10-01T00:00:00Z' }, deps)).error));
    assert.ok(/valid ISO/.test((await wingguyCalendar.rescheduleMeetingGuarded(COACH, { leadEmails: [LEAD], newStartISO: 'next tuesday' }, deps)).error));
    assert.ok(/already at that time/.test((await wingguyCalendar.rescheduleMeetingGuarded(COACH, { leadEmails: [LEAD], newStartISO: PAT_13.start }, deps)).error));
  });

  await t('move: a failed calendar update is reported, not claimed as done', async () => {
    const { deps } = stubDeps([PAT_13], { updateCalendarEventTime: async () => ({ ok: false, error: 'HTTP 500' }) });
    const r = await wingguyCalendar.rescheduleMeetingGuarded(COACH, { leadEmails: [LEAD], eventId: 'ev-pat', newStartISO: NEW, apply: true }, deps);
    assert.ok(!r.ok && /HTTP 500/.test(r.error));
  });

  // ── The guarded cancel ───────────────────────────────────────────────────────────────────────────
  await t('cancel: preview deletes nothing; apply deletes that event with notify on', async () => {
    const { deps, calls } = stubDeps([PAT_13]);
    const p = await wingguyCalendar.cancelMeetingGuarded(COACH, { leadEmails: [LEAD], leadName: 'Pat Lead' }, deps);
    assert.ok(p.ok && !p.applied);
    assert.strictEqual(calls.del.length, 0);
    const a = await wingguyCalendar.cancelMeetingGuarded(COACH, { leadEmails: [LEAD], leadName: 'Pat Lead', eventId: 'ev-pat', apply: true }, deps);
    assert.ok(a.ok && a.applied && a.notified);
    assert.deepStrictEqual(calls.del[0].o, { notify: true, calendarId: 'cal-1' });
    assert.strictEqual(calls.del[0].id, 'ev-pat');
  });

  // ── 6. The tool text ─────────────────────────────────────────────────────────────────────────────
  await t('reschedule tool: preview shows the match and OLD/NEW on both clocks, and asks for a yes', async () => {
    const { deps, calls } = stubDeps([PAT_13]);
    const out = await runRescheduleMeeting({ lead_name: 'Pat Lead', new_start_iso: NEW }, 'Test-Coach', deps);
    assert.ok(!out.isError, out.text);
    assert.ok(/PREVIEW — nothing has changed yet/.test(out.text));
    assert.ok(/event_id=ev-pat/.test(out.text));
    assert.ok(/WAS: Tue, 13 Oct, 2:00\s?pm Brisbane time = Tue, 13 Oct, 3:00\s?pm Melbourne time/.test(out.text), out.text);
    assert.ok(/NEW: Tue, 20 Oct, 2:00\s?pm Brisbane time = Tue, 20 Oct, 3:00\s?pm Melbourne time/.test(out.text), out.text);
    assert.strictEqual(calls.update.length, 0);
  });

  await t('reschedule tool: confirm without event_id is refused; confirmed call moves and restates', async () => {
    const { deps, calls } = stubDeps([PAT_13]);
    const bad = await runRescheduleMeeting({ lead_name: 'Pat Lead', new_start_iso: NEW, confirm: true }, 'Test-Coach', deps);
    assert.ok(bad.isError && /event_id/.test(bad.text));
    const done = await runRescheduleMeeting({ lead_name: 'Pat Lead', new_start_iso: NEW, confirm: true, event_id: 'ev-pat' }, 'Test-Coach', deps);
    assert.ok(!done.isError, done.text);
    assert.ok(/^MOVED/.test(done.text) && /WAS: /.test(done.text) && /NEW: /.test(done.text));
    assert.strictEqual(calls.update.length, 1);
  });

  await t('reschedule tool: a name matching two CRM leads stops and asks for the email', async () => {
    const { deps, calls } = stubDeps([PAT_13], {
      lookupLeadContactByName: async () => ({ lead: { email: LEAD }, matches: [{ email: LEAD }, { email: 'pat.other@example.com' }] }),
    });
    const out = await runRescheduleMeeting({ lead_name: 'Pat Lead', new_start_iso: NEW }, 'Test-Coach', deps);
    assert.ok(out.isError && /More than one CRM lead/.test(out.text));
    assert.strictEqual(calls.reads.length, 0);
  });

  await t('reschedule tool: several meetings are listed with ids, nothing is moved', async () => {
    const { deps, calls } = stubDeps([PAT_13, meeting('ev-pat-2', '2026-10-27T04:00:00Z')]);
    const out = await runRescheduleMeeting({ lead_name: 'Pat Lead', new_start_iso: NEW }, 'Test-Coach', deps);
    assert.ok(out.isError && /will not guess/.test(out.text) && /ev-pat-2/.test(out.text));
    assert.strictEqual(calls.update.length, 0);
  });

  await t('cancel tool: says when the lead was NOT told, so the coach can send a note', async () => {
    const { deps } = stubDeps([PAT_13], { deleteCalendarEvent: async () => ({ ok: true, provider: 'unipile', notified: false }) });
    const out = await runCancelMeeting({ lead_name: 'Pat Lead', confirm: true, event_id: 'ev-pat' }, 'Test-Coach', deps);
    assert.ok(/^CANCELLED/.test(out.text) && /does NOT reliably email/.test(out.text), out.text);
  });

  if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
  console.log('\nall passing');
}

run();
