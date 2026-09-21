/**
 * Regression test: propose_times must take BOTH clocks from the record when check_availability did
 * not run in the same chat turn.
 *
 * Bug (2026-09-21, Dean Hobin / Reena Strehle): the panel called check_availability in one turn and
 * propose_times in the next. The remembered timezones (availTz) are per turn, so both sides fell
 * through to the hardcoded Australia/Brisbane default - a Sydney coach offered a "Greater Perth Area"
 * lead three times marked "(all times are Brisbane time)". Brisbane was nobody's clock. The numbers
 * happened to be right for him only because Sydney and Brisbane read the same until daylight saving
 * starts on 4 Oct; after that every offered time would have been an hour out.
 *
 * Fix: coach clock from his client record (coach.timezone), lead clock from their resolved
 * location. Brisbane is the last resort, never the first.
 *
 * Run: node tests/wingguy-tz-coach-record-fallback.test.js
 */
const assert = require('assert');
const { runWingguyChatTurn } = require('../services/wingguyChat');
const { DateTime } = require('luxon');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// Dates must be DYNAMIC (>=3 days out) - code hard-drops past and too-soon slots.
let day = DateTime.now().setZone('Australia/Sydney').plus({ days: 3 }).startOf('day');
while (day.weekday > 5) day = day.plus({ days: 1 }); // weekdays-only is code-enforced
const slotAt = (h, m) => day.set({ hour: h, minute: m }).toUTC().toISO();
const dTEN = slotAt(10, 0);   // 10:00 am Sydney
const dTWO = slotAt(14, 0);   // 2:00 pm Sydney
const perthLabel = (iso) => DateTime.fromISO(iso).setZone('Australia/Perth').toFormat('h:mm a').toLowerCase();

// The model goes STRAIGHT to propose_times - no check_availability in this turn, exactly what the
// panel did on the second turn. The availability stub must never be reached.
function makeRun({ coachTimezone, location }) {
  let availCalls = 0;
  const fakeAvail = async () => { availCalls++; throw new Error('check_availability must not be called in this test'); };
  let call = 0;
  let proposeResult = null;
  const fakeClient = { messages: { create: async (params) => {
    call++;
    for (const m of params.messages || []) {
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (b.type === 'tool_result' && b.tool_use_id === 't1') proposeResult = JSON.parse(typeof b.content === 'string' ? b.content : b.content[0].text);
      }
    }
    if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_times',
      input: { intro: 'A few times that suit:', slotTimes: [dTEN, dTWO], outro: 'Let me know.' } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
  } } };
  return (async () => {
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Dean-Hobin', clientName: 'Dean', timezone: coachTimezone },
      profile: { name: 'Reena', location },
      messages: [{ role: 'user', content: 'draft a reply offering some times' }],
      leadEmail: 'reena@example.com',
      deps: { client: fakeClient, getAvailabilityForCoach: fakeAvail, createBookingEvent: async () => ({ ok: true }), clashingSlots: async () => new Map() },
    });
    return { res, proposeResult, availCalls };
  })();
}

(async () => {
  console.log('Sydney coach, Perth lead, propose_times WITHOUT check_availability this turn:');
  const perth = await makeRun({ coachTimezone: 'Australia/Sydney', location: 'Greater Perth Area' });
  check('availability stub was never reached', () => assert.strictEqual(perth.availCalls, 0));
  check('a draft was produced', () => assert.ok(perth.res && perth.res.draft, `no draft: ${JSON.stringify(perth.res)}`));
  check('marker is the LEAD\'s city (Perth), not the Brisbane default', () => assert.ok(
    perth.res.draft.includes('(all times are Perth time)'), `draft:\n${perth.res.draft}`));
  check('no Brisbane anywhere in the draft', () => assert.ok(!/Brisbane/.test(perth.res.draft), perth.res.draft));
  check('slot times render on the Perth clock', () => assert.ok(
    perth.res.draft.includes(perthLabel(dTEN)), `expected ${perthLabel(dTEN)} in:\n${perth.res.draft}`));
  check('offeredTimes shows the coach side as Sydney, not Brisbane', () => assert.ok(
    perth.proposeResult && perth.proposeResult.offeredTimes.every((t) => t.includes('Perth') && t.includes('Sydney') && !t.includes('Brisbane')),
    `offeredTimes: ${JSON.stringify(perth.proposeResult && perth.proposeResult.offeredTimes)}`));

  console.log('\nSydney coach, Sydney lead, same shape - marker says Sydney, never Brisbane:');
  const syd = await makeRun({ coachTimezone: 'Australia/Sydney', location: 'Sydney, New South Wales' });
  check('a draft was produced', () => assert.ok(syd.res && syd.res.draft, `no draft: ${JSON.stringify(syd.res)}`));
  check('marker is Sydney', () => assert.ok(syd.res.draft.includes('(all times are Sydney time)'), syd.res.draft));
  check('slot times render on the Sydney clock (10:00 am)', () => assert.ok(/10:00\s*am/i.test(syd.res.draft), syd.res.draft));

  console.log('\nNo timezone on the coach record at all - Brisbane remains the last resort:');
  const none = await makeRun({ coachTimezone: undefined, location: 'Brisbane, Queensland' });
  check('a draft was produced', () => assert.ok(none.res && none.res.draft, `no draft: ${JSON.stringify(none.res)}`));
  check('marker is Brisbane', () => assert.ok(none.res.draft.includes('(all times are Brisbane time)'), none.res.draft));

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all coach-record-fallback tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
