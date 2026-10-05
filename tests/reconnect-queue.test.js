/**
 * Tests for the daily Reconnect list (services/reconnectQueue.js) - Reconnect, brick 4.
 *
 * Covers: eligible() (cut-off, declined/pitch never shown, done/never/disconnect/skip, ceased,
 * parked, clients, written-to-since) · rank() order · pickPortion() (a portion never padded,
 * yesterday's unworked first, no reshuffle within the day, show more) · splitOwnership() (the
 * 90-day hand-over from the live queue: nobody shows twice, nobody vanishes) · buildReconnect()
 * is a no-op when the switch is off · reconnectNote().
 * Pure functions and fakes - no Airtable, no Postgres. ⚠ Synthetic content only.
 *
 * Run: node tests/reconnect-queue.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const rq = require('../services/reconnectQueue');

const nowMs = Date.UTC(2026, 9, 6, 2, 0, 0);
const TODAY = '2026-10-06';
const person = (key, extra = {}) => ({
  person_key: key, lead_rec_id: `rec${key}`, name: `First${key} Last${key}`, headline: 'Director', profile_url: `https://www.linkedin.com/in/${key}`,
  last_msg_at: '2025-01-10T00:00:00.000Z', ending: 'not_now', warmth: 4, why: 'Said try me later.', pick_up_on: 'the trip',
  status: null, until: null, shown_on: null, ...extra,
});
const leadOf = (key, extra = {}) => [`rec${key}`, { 'First Name': `First${key}`, 'Last Name': `Last${key}`, 'LinkedIn Profile URL': `https://www.linkedin.com/in/${key}`, ...extra }];
const leads = (...entries) => new Map(entries);
const keys = (list) => list.map((p) => p.person_key || p.key);
const el = (people, leadsById, opts = {}) => rq.eligible(people, leadsById, { todayIso: TODAY, nowMs, ...opts });

(async () => {
  console.log('eligible');

  await check('a scored, connected, long-quiet lead is on the list', () => {
    const out = el([person('a')], leads(leadOf('a')));
    assert.deepStrictEqual(keys(out), ['a']);
    assert.ok(out[0].quietDays > 600);
  });
  await check('below the cut-off, declined and pitches are never shown', () => {
    const out = el([person('a', { warmth: 2 }), person('b', { ending: 'declined', warmth: 4 }), person('c', { ending: 'their_pitch', warmth: 3 })], leads(leadOf('a'), leadOf('b'), leadOf('c')));
    assert.strictEqual(out.length, 0);
  });
  await check('done, never and potential-disconnect people are gone; a skip comes back after its date', () => {
    const people = [
      person('a', { status: 'done' }), person('b', { status: 'never' }), person('c', { status: 'disconnect' }),
      person('d', { status: 'skipped', until: '2026-12-01' }), person('e', { status: 'skipped', until: '2026-10-01' }),
    ];
    const out = el(people, leads(leadOf('a'), leadOf('b'), leadOf('c'), leadOf('d'), leadOf('e')));
    assert.deepStrictEqual(keys(out), ['e']);
  });
  await check('a ceased lead, a lead parked for a future date, and a person with no lead are left off', () => {
    const out = el(
      [person('a'), person('b'), person('c'), person('d'), person('e')],
      leads(leadOf('a', { 'Cease FUP': 'Yes' }), leadOf('b', { 'Cease FUP At': '2026-08-01T00:00:00.000Z' }), leadOf('c', { 'Reconnect On': '2026-11-15' }), leadOf('d', { 'Reconnect On': '2026-09-01' })),
    );
    assert.deepStrictEqual(keys(out), ['d']);
  });
  await check('clients, current or former, never appear - matched by email or by name', () => {
    const out = el(
      [person('a'), person('b'), person('c')],
      leads(leadOf('a', { Email: 'Client@Example.com' }), leadOf('b'), leadOf('c')),
      { clientEmails: new Set(['client@example.com']), clientNames: new Set(['firstb lastb']) },
    );
    assert.deepStrictEqual(keys(out), ['c']);
  });
  await check('someone written to since (a newer line in their notes) is off the list', () => {
    const notes = ['=== LINKEDIN MESSAGES ===', '20-09-26 9:15 AM - Guy Wilson - Good to be back in touch.', '10-01-25 3:40 PM - Firsta Lasta - Try me later.'].join('\n');
    const oldNotes = ['=== LINKEDIN MESSAGES ===', '10-01-25 3:40 PM - Firsta Lasta - Try me later.'].join('\n');
    const out = el([person('a'), person('b')], leads(leadOf('a', { Notes: notes }), leadOf('b', { Notes: oldNotes })));
    assert.deepStrictEqual(keys(out), ['b']);
  });

  console.log('rank');
  await check('conversation score, then how it ended, then shortest silence, then profile score', () => {
    const mk = (key, p, lead = {}) => ({ ...person(key, p), lead, quietDays: p.quietDays ?? 200 });
    const list = [
      mk('stalled4', { warmth: 4, ending: 'stalled_after_interest' }),
      mk('open4', { warmth: 4, ending: 'open_question_or_offer' }),
      mk('met5', { warmth: 5, ending: 'moved_to_call_or_email' }),
      mk('open4old', { warmth: 4, ending: 'open_question_or_offer', quietDays: 900 }),
      mk('open4scored', { warmth: 4, ending: 'open_question_or_offer', quietDays: 900 }, { 'AI Score': 80 }),
    ].sort(rq.rank);
    assert.deepStrictEqual(keys(list), ['met5', 'open4', 'open4scored', 'open4old', 'stalled4']);
  });

  console.log('pickPortion');
  const pool = (n, extra = () => ({})) => Array.from({ length: n }, (_, i) => ({ ...person(`p${String(i).padStart(2, '0')}`, extra(i)), lead: {}, quietDays: 200 + i }));

  await check('a new day takes the daily number, best first, and stamps exactly those', () => {
    const r = rq.pickPortion(pool(30), { todayIso: TODAY, number: 20 });
    assert.strictEqual(r.portion.length, 20);
    assert.strictEqual(r.stamp.length, 20);
    assert.strictEqual(r.waiting, 10);
    assert.strictEqual(r.portion[0].person_key, 'p00');
  });
  await check('never padded: fewer people than the number is just fewer', () => {
    const r = rq.pickPortion(pool(7), { todayIso: TODAY, number: 20 });
    assert.strictEqual(r.portion.length, 7);
    assert.strictEqual(r.waiting, 0);
  });
  await check('yesterday\'s unworked people come first, ahead of better-scored new ones', () => {
    const list = pool(25, (i) => (i >= 22 ? { shown_on: '2026-10-05', warmth: 3 } : { warmth: 5 }));
    const r = rq.pickPortion(list, { todayIso: TODAY, number: 5 });
    assert.deepStrictEqual(keys(r.portion), ['p22', 'p23', 'p24', 'p00', 'p01']);
  });
  await check('no reshuffle through the day: once stamped, the portion only shrinks', () => {
    const list = pool(30, (i) => (i < 20 ? { shown_on: TODAY } : {}));
    const worked = list.filter((p) => !['p03', 'p07'].includes(p.person_key)); // two actioned, so no longer eligible
    const r = rq.pickPortion(worked, { todayIso: TODAY, number: 20 });
    assert.strictEqual(r.portion.length, 18);
    assert.strictEqual(r.stamp.length, 0);
    assert.strictEqual(r.waiting, 10);
  });
  await check('show more adds ten on top of today\'s portion', () => {
    const list = pool(40, (i) => (i < 20 ? { shown_on: TODAY } : {}));
    const r = rq.pickPortion(list, { todayIso: TODAY, number: 20, more: 10 });
    assert.strictEqual(r.portion.length, 30);
    assert.deepStrictEqual(r.stamp.length, 10);
    assert.strictEqual(r.waiting, 10);
  });

  console.log('splitOwnership');
  const everyone = [person('a'), person('b'), person('c'), person('d')];
  const liveRow = (key, extra = {}) => ({ name: `First${key} Last${key}`, recId: `rec${key}`, kind: 'draft', quietDays: 200, ...extra });

  await check('in the pool and quiet past 90 days -> leaves the live list', () => {
    const r = rq.splitOwnership([liveRow('a'), liveRow('zz')], everyone);
    assert.deepStrictEqual(r.handedOver.map((i) => i.recId), ['reca']);
    assert.deepStrictEqual(r.live.map((i) => i.recId), ['reczz']);
    assert.strictEqual(r.liveKeys.size, 0);
  });
  await check('still live (recent, or quiet days unknown) -> stays live and is kept OFF the Reconnect list', () => {
    const r = rq.splitOwnership([liveRow('a', { quietDays: 30 }), liveRow('b', { quietDays: null })], everyone);
    assert.strictEqual(r.handedOver.length, 0);
    assert.strictEqual(r.live.length, 2);
    assert.deepStrictEqual([...r.liveKeys].sort(), ['a', 'b']);
  });
  await check('a due park and an accepted-but-unbooked time are promises - they stay live', () => {
    const r = rq.splitOwnership([liveRow('a', { kind: 'park' }), liveRow('b', { unbooked: { slot: 'Tue 2pm' } })], everyone);
    assert.strictEqual(r.handedOver.length, 0);
    assert.deepStrictEqual([...r.liveKeys].sort(), ['a', 'b']);
  });
  await check('a live row is matched by name when it carries no record id', () => {
    const r = rq.splitOwnership([{ name: 'firstc LASTc', kind: 'drop', quietDays: 400 }], everyone);
    assert.strictEqual(r.handedOver.length, 1);
  });
  await check('nobody is in both lists and nobody is lost', () => {
    const live = [liveRow('a'), liveRow('b', { quietDays: 20 }), liveRow('zz', { quietDays: 500 })];
    const r = rq.splitOwnership(live, everyone);
    const reconnectKeys = everyone.map((p) => p.person_key).filter((k) => !r.liveKeys.has(k));
    assert.deepStrictEqual(r.live.map((i) => i.recId).sort(), ['recb', 'reczz']);
    assert.ok(reconnectKeys.includes('a') && !reconnectKeys.includes('b'));
    assert.strictEqual(r.live.length + r.handedOver.length, live.length);
  });

  console.log('serving');
  await check('the row carries the chip, the reason, the angle and the carried-over flag', () => {
    const it = rq.toItem({ ...person('a', { ending: 'moved_to_call_or_email', shown_on: '2026-10-05' }), lead: leadOf('a', { 'AI Score': 77 })[1], quietDays: 300 }, TODAY);
    assert.strictEqual(it.chip, 'Met, not since');
    assert.strictEqual(it.pickUpOn, 'the trip');
    assert.strictEqual(it.profileScore, 77);
    assert.strictEqual(it.carried, true);
    assert.strictEqual(rq.toItem({ ...person('b'), lead: {}, quietDays: 300 }, TODAY).profileScore, null);
  });
  await check('the day is the client\'s own day, not the server\'s', () => {
    assert.strictEqual(rq.todayIn('Australia/Brisbane', Date.UTC(2026, 9, 5, 20, 0, 0)), '2026-10-06');
    assert.strictEqual(rq.todayIn('America/New_York', Date.UTC(2026, 9, 5, 20, 0, 0)), '2026-10-05');
  });
  await check('chat gets a note only when there is a list', () => {
    assert.strictEqual(rq.reconnectNote(null), '');
    assert.strictEqual(rq.reconnectNote({ enabled: true, items: [] }), '');
    const note = rq.reconnectNote({ enabled: true, waiting: 5, items: [{ name: 'Pat Person', chip: 'Not now', warmth: 4, quietDays: 200, why: 'Said later.', pickUpOn: 'the trip' }] });
    assert.ok(note.includes('RECONNECT (1 today, 5 more waiting)') && note.includes('Pat Person') && note.includes('/wg'));
  });
  await check('switch off -> the live list comes back untouched and nothing is read', async () => {
    const path = require.resolve('../services/clientService');
    const saved = require.cache[path];
    require.cache[path] = { id: path, filename: path, loaded: true, exports: { getClientById: async () => ({ clientId: 'T', reconnect: null }) } };
    try {
      const live = [liveRow('a')];
      const r = await rq.buildReconnect('T', live);
      assert.strictEqual(r.enabled, false);
      assert.strictEqual(r.live, live);
    } finally { if (saved) require.cache[path] = saved; else delete require.cache[path]; }
  });

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
