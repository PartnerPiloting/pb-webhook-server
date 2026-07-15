/**
 * Regression test for the timezone marker + connecting line on offered times.
 *
 * Bug (2026-07-13): Marianne (Perth) was offered times correctly CONVERTED to Perth time, but the
 * draft carried no timezone marker — so she read "12:00 pm" as Brisbane time and asked which it was.
 * Silently-converted times are worse than unconverted ones: the lead's natural guess ("the sender's
 * timezone") becomes wrong. Fix: propose_times appends ONE "(all times are Perth time)" line under
 * the list (Guy's call: one line, not a tag per slot), and offeredTimes echoes BOTH sides so Guy's
 * summary shows his own clock too.
 *
 * Upgraded 2026-07-15 (the Sam Brennan drafts): the marker line is now ALWAYS present — even when
 * the clocks match, the lead doesn't know the coach's timezone — and code also owns the mandatory
 * "Would any of the following times work for you?" connecting line above the list (rulebook prose
 * alone couldn't stop drafts jumping from the intro straight into bare dates, because the model
 * never writes the list). A model intro ending in its own "do these work"-style question is
 * stripped so the draft doesn't ask twice.
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
function makeRun({ leadTimezone, location, detected = true, intro = 'A few times that suit:' }) {
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
      input: { intro, slotTimes: [dTENHALF, dTWO], outro: 'Let me know.' } }] };
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
  check('draft carries the connecting line directly above the list', () => assert.ok(
    /Would any of the following times work for you\?\n\n- /.test(perth.res.draft), `no connecting line above slots:\n${perth.res.draft}`));
  check('offeredTimes echo shows BOTH sides', () => assert.ok(
    perth.proposeResult && perth.proposeResult.offeredTimes.every((t) => t.includes('Perth') && t.includes('Brisbane')),
    `offeredTimes: ${JSON.stringify(perth.proposeResult && perth.proposeResult.offeredTimes)}`));
  check('leadBase says where the lead is based', () => assert.ok(
    perth.proposeResult && /based in Perth, Western Australia/.test(perth.proposeResult.leadBase),
    `leadBase: ${perth.proposeResult && perth.proposeResult.leadBase}`));

  console.log('\nSame-timezone lead — marker STILL present (lead doesn\'t know Guy\'s tz), single-sided echo:');
  const bris = await makeRun({ leadTimezone: 'Australia/Brisbane', location: 'Brisbane, Queensland' });
  check('a draft was produced', () => assert.ok(bris.res && bris.res.draft, `no draft: ${JSON.stringify(bris.res)}`));
  check('draft carries the marker line even same-tz', () => assert.ok(bris.res.draft.includes('(all times are Brisbane time)'), `no marker line:\n${bris.res.draft}`));
  check('draft carries the connecting line', () => assert.ok(bris.res.draft.includes('Would any of the following times work for you?'), bris.res.draft));
  check('offeredTimes stays single-sided', () => assert.ok(
    bris.proposeResult && bris.proposeResult.offeredTimes.every((t) => !t.includes('(')),
    `offeredTimes: ${JSON.stringify(bris.proposeResult && bris.proposeResult.offeredTimes)}`));
  check('leadBase still says where the lead is based', () => assert.ok(
    bris.proposeResult && /based in Brisbane, Queensland/.test(bris.proposeResult.leadBase),
    `leadBase: ${bris.proposeResult && bris.proposeResult.leadBase}`));

  console.log('\nMissing/unrecognised location — leadBase is a warning, not a guess dressed as a fact:');
  const noloc = await makeRun({ leadTimezone: 'Australia/Brisbane', location: '', detected: false });
  check('a draft was produced', () => assert.ok(noloc.res && noloc.res.draft, `no draft: ${JSON.stringify(noloc.res)}`));
  check('draft marker falls back to GUY\'s clock (Brisbane)', () => assert.ok(noloc.res.draft.includes('(all times are Brisbane time)'), noloc.res.draft));
  check('leadBase warns the location is missing and tz is ASSUMED', () => assert.ok(
    noloc.proposeResult && /⚠/.test(noloc.proposeResult.leadBase) && /missing/.test(noloc.proposeResult.leadBase) && /ASSUMES/.test(noloc.proposeResult.leadBase),
    `leadBase: ${noloc.proposeResult && noloc.proposeResult.leadBase}`));

  console.log('\nModel intro already ends with its own "do these work" question — stripped, no double ask:');
  const dup = await makeRun({ leadTimezone: 'Australia/Brisbane', location: 'Brisbane, Queensland',
    intro: 'Great to hear back from you.\nWould any of these times work for you?' });
  check('a draft was produced', () => assert.ok(dup.res && dup.res.draft, `no draft: ${JSON.stringify(dup.res)}`));
  check('the question appears exactly once', () => assert.strictEqual((dup.res.draft.match(/work for you\?/g) || []).length, 1, dup.res.draft));
  check('the intro\'s real content survives the strip', () => assert.ok(dup.res.draft.includes('Great to hear back from you.'), dup.res.draft));

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all tz-marker tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
