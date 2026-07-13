/**
 * Regression test for the timezone marker on offered times.
 *
 * Bug (2026-07-13): Marianne (Perth) was offered times correctly CONVERTED to Perth time, but the
 * draft carried no timezone marker — so she read "12:00 pm" as Brisbane time and asked which it was.
 * Silently-converted times are worse than unconverted ones: the lead's natural guess ("the sender's
 * timezone") becomes wrong. Fix: when lead tz differs from coach tz, propose_times appends ONE
 * "(all times are Perth time)" line under the list (Guy's call: one line, not a tag per slot), and
 * offeredTimes echoes BOTH sides so Guy's summary shows his own clock too.
 *
 * Run: node tests/wingguy-tz-marker.test.js
 */
const assert = require('assert');
const { runWingguyChatTurn } = require('../services/wingguyChat');
const { DateTime } = require('luxon');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// Dates must be DYNAMIC (≥3 days out) — code hard-drops past and too-soon slots.
let day = DateTime.now().setZone('Australia/Brisbane').plus({ days: 3 }).startOf('day');
while (day.weekday > 5) day = day.plus({ days: 1 }); // weekdays-only is code-enforced
const slotAt = (h, m) => day.set({ hour: h, minute: m }).toUTC().toISO();
const dTENHALF = slotAt(10, 30); // 10:30 Brisbane = 8:30 Perth (July, no DST)
const dTWO = slotAt(14, 0);      // 2:00 pm Brisbane = 12:00 pm Perth

// One fake conversation: check availability, propose both slots, finish. lastToolResults captures
// what the model saw so we can assert on propose_times' offeredTimes echo.
function makeRun({ leadTimezone, location, detected = true }) {
  const fakeAvail = async () => ({
    yourTimezone: 'Australia/Brisbane',
    leadTimezone,
    leadLocation: location || '',
    leadTzDetected: detected,
    days: [{ date: day.toFormat('yyyy-MM-dd'), day: day.toFormat('ccc'), freeSlots: [
      { time: dTENHALF, display: '10:30 am', leadDisplay: '8:30 am' },
      { time: dTWO, display: '2:00 pm', leadDisplay: '12:00 pm' },
    ] }],
  });
  let call = 0;
  let proposeResult = null;
  const fakeClient = { messages: { create: async (params) => {
    call++;
    // Capture the tool_result the model receives for propose_times (call 3's request carries it).
    for (const m of params.messages || []) {
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (b.type === 'tool_result' && b.tool_use_id === 't2') proposeResult = JSON.parse(typeof b.content === 'string' ? b.content : b.content[0].text);
      }
    }
    if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'check_availability', input: {} }] };
    if (call === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'propose_times',
      input: { intro: 'A few times that suit:', slotTimes: [dTENHALF, dTWO], outro: 'Let me know.' } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
  } } };
  return (async () => {
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Marianne', location },
      messages: [{ role: 'user', content: 'draft a reply offering some times' }],
      leadEmail: 'marianne@example.com',
      deps: { client: fakeClient, getAvailabilityForCoach: fakeAvail, createBookingEvent: async () => ({ ok: true }) },
    });
    return { res, proposeResult };
  })();
}

(async () => {
  console.log('Perth lead (tz differs) — draft carries ONE marker line, offeredTimes shows both sides:');
  const perth = await makeRun({ leadTimezone: 'Australia/Perth', location: 'Perth, Western Australia' });
  check('a draft was produced', () => assert.ok(perth.res && perth.res.draft, `no draft: ${JSON.stringify(perth.res)}`));
  check('draft renders times in the LEAD\'s (Perth) clock', () => assert.ok(/8:30\s*am/i.test(perth.res.draft), `missing Perth 8:30:\n${perth.res.draft}`));
  check('draft carries the single marker line', () => assert.ok(perth.res.draft.includes('(all times are Perth time)'), `no marker line:\n${perth.res.draft}`));
  check('marker appears exactly once (not per slot)', () => assert.strictEqual((perth.res.draft.match(/all times are/g) || []).length, 1, perth.res.draft));
  check('offeredTimes echo shows BOTH sides', () => assert.ok(
    perth.proposeResult && perth.proposeResult.offeredTimes.every((t) => t.includes('Perth') && t.includes('Brisbane')),
    `offeredTimes: ${JSON.stringify(perth.proposeResult && perth.proposeResult.offeredTimes)}`));
  check('leadBase says where the lead is based', () => assert.ok(
    perth.proposeResult && /based in Perth, Western Australia/.test(perth.proposeResult.leadBase),
    `leadBase: ${perth.proposeResult && perth.proposeResult.leadBase}`));

  console.log('\nSame-timezone lead — plain times, no marker:');
  const bris = await makeRun({ leadTimezone: 'Australia/Brisbane', location: 'Brisbane, Queensland' });
  check('a draft was produced', () => assert.ok(bris.res && bris.res.draft, `no draft: ${JSON.stringify(bris.res)}`));
  check('draft has NO marker line', () => assert.ok(!bris.res.draft.includes('all times are'), bris.res.draft));
  check('offeredTimes stays single-sided', () => assert.ok(
    bris.proposeResult && bris.proposeResult.offeredTimes.every((t) => !t.includes('(')),
    `offeredTimes: ${JSON.stringify(bris.proposeResult && bris.proposeResult.offeredTimes)}`));
  check('leadBase still says where the lead is based', () => assert.ok(
    bris.proposeResult && /based in Brisbane, Queensland/.test(bris.proposeResult.leadBase),
    `leadBase: ${bris.proposeResult && bris.proposeResult.leadBase}`));

  console.log('\nMissing/unrecognised location — leadBase is a warning, not a guess dressed as a fact:');
  const noloc = await makeRun({ leadTimezone: 'Australia/Brisbane', location: '', detected: false });
  check('a draft was produced', () => assert.ok(noloc.res && noloc.res.draft, `no draft: ${JSON.stringify(noloc.res)}`));
  check('draft has NO marker line (assumed same tz)', () => assert.ok(!noloc.res.draft.includes('all times are'), noloc.res.draft));
  check('leadBase warns the location is missing and tz is ASSUMED', () => assert.ok(
    noloc.proposeResult && /⚠/.test(noloc.proposeResult.leadBase) && /missing/.test(noloc.proposeResult.leadBase) && /ASSUMES/.test(noloc.proposeResult.leadBase),
    `leadBase: ${noloc.proposeResult && noloc.proposeResult.leadBase}`));

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all tz-marker tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
