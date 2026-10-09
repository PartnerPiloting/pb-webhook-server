/**
 * The coach's own clock on a chosen or booked slot is written by CODE (Sam Trattles, 2026-10-09).
 *
 * Brisbane coach, Sydney lead, NSW daylight saving on. check_availability said "Sydney is 1h ahead
 * of Brisbane" and the slot carried "(coach: 10:00 am)"; the booking used the right ISO; and the
 * panel's note to Guy still read "Fri 16 October, 11:00 am (Brisbane/Sydney same clock this time
 * of year)". So, in services/wingguyChat.js:
 *  - coachSlotLine builds "Fri 16 October, 11:00 am Sydney (10:00 am your time, Brisbane)" from the
 *    slot's ISO and the two zones, per date (same clock on that date says so; no lead zone = coach only)
 *  - book_meeting returns it as "when", and the reply the coach reads ends with "Booked: <line>"
 *    unless the model already quoted it word for word
 *  - a lead-link read puts "both" on every surviving slot, and a confirm question that names ONE
 *    of the tools' slots gets "On both clocks: <line>" when the lead's zone differs from the coach's
 *  - a model aside claiming the clocks match is dropped when the real offsets for that date disagree
 *    (scrubSameClockClaims); a true "same clock" claim stays
 *
 * Run: node tests/wingguy-coach-clock-line.test.js
 */
const assert = require('assert');
const { DateTime } = require('luxon');
const { runWingguyChatTurn, coachSlotLine, scrubSameClockClaims, chosenSlotFromReply, slotCandidates, coachClockReply } = require('../services/wingguyChat');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const BRIS = 'Australia/Brisbane';
const SYD = 'Australia/Sydney';

// A Friday in October during Sydney daylight saving (NSW goes forward the first Sunday of October,
// so the third Friday is always inside it), at least a week out so the offer filters keep it.
function thirdFridayOfOctober(year) {
  let d = DateTime.fromObject({ year, month: 10, day: 1, hour: 11 }, { zone: SYD });
  while (d.weekday !== 5) d = d.plus({ days: 1 });
  return d.plus({ weeks: 2 });
}
let fri = thirdFridayOfOctober(DateTime.now().year);
if (fri < DateTime.now().plus({ days: 7 })) fri = thirdFridayOfOctober(DateTime.now().year + 1);
const slot11Syd = fri.toUTC().toISO();                 // 11:00 am Sydney = 10:00 am Brisbane
const slot1330Syd = fri.set({ hour: 13, minute: 30 }).toUTC().toISO();
const LEAD_LABEL = `Fri ${fri.day} October, 11:00 am`;  // how the slot reads on the lead's clock
const LINE = `${LEAD_LABEL} Sydney (10:00 am your time, Brisbane)`;

console.log('coachSlotLine (the slot on the lead\'s clock, then the coach\'s own, from the real offsets for that date):');
check('Sydney lead in daylight saving: both clocks, an hour apart', () => assert.strictEqual(coachSlotLine(slot11Syd, BRIS, SYD), LINE));
check('Sydney lead in June: same clock on that date, and says so', () => {
  const june = DateTime.fromObject({ year: fri.year, month: 6, day: 12, hour: 10 }, { zone: SYD });
  assert.strictEqual(coachSlotLine(june.toUTC().toISO(), BRIS, SYD), `${june.toFormat('ccc')} 12 June, 10:00 am Sydney (10:00 am your time, Brisbane - same clock on this date)`);
});
check('same zone: the coach\'s time, and the lead is on the same clock', () => assert.strictEqual(coachSlotLine(slot11Syd, BRIS, BRIS), `Fri ${fri.day} October, 10:00 am Brisbane (your time - the lead is on the same clock)`));
check('no lead zone: the coach\'s time only, never a guessed lead-side time', () => assert.strictEqual(coachSlotLine(slot11Syd, BRIS, null), `Fri ${fri.day} October, 10:00 am Brisbane (your time - the lead's clock is not on file)`));
check('a US lead: the coach\'s side carries its own day when the date differs', () => {
  const ny = DateTime.fromObject({ year: fri.year, month: 10, day: fri.day, hour: 18 }, { zone: 'America/New_York' }).toUTC().toISO();
  assert.match(coachSlotLine(ny, BRIS, 'America/New_York'), new RegExp(`^Fri ${fri.day} October, 6:00 pm New York \\(Sat ${fri.day + 1} October, \\d{1,2}:00 am your time, Brisbane\\)$`));
});

console.log('\nscrubSameClockClaims (a model claim that the clocks agree goes; the rest stays):');
check('drops the Sam aside and a whole same-clock sentence, keeps the question and "same time as last week"', () => {
  const r = scrubSameClockClaims(`I'd go with ${LEAD_LABEL} (Brisbane/Sydney same clock this time of year) - want me to book it and send Sam's invite to sam@example.com? Sydney and Brisbane are on the same clock so that's 11 for you too. Same time as last week works.`);
  assert.strictEqual(r.text, `I'd go with ${LEAD_LABEL} - want me to book it and send Sam's invite to sam@example.com? Same time as last week works.`);
  assert.deepStrictEqual(r.dropped, ['(Brisbane/Sydney same clock this time of year)', "Sydney and Brisbane are on the same clock so that's 11 for you too."]);
});
check('catches "no time difference", "clocks match", "identical clocks", "same time zone"', () => {
  for (const s of ['There is no time difference between you.', 'Your clocks match on Friday.', 'Identical clocks this month.', "You're in the same time zone."]) {
    assert.strictEqual(scrubSameClockClaims(`Hello. ${s} Bye.`).text, 'Hello. Bye.', s);
  }
});
check('text with no claim comes back untouched', () => { const t = 'Booked for Friday - invite sent to sam@example.com.'; assert.deepStrictEqual(scrubSameClockClaims(t), { text: t, dropped: [] }); });

console.log('\nchosenSlotFromReply (the ONE slot a reply names, on either clock):');
check('finds the slot from the lead-clock label, "Friday 16 Oct at 11am", and the coach-clock time', () => {
  assert.strictEqual(chosenSlotFromReply(`Go with ${LEAD_LABEL}?`, [slot11Syd, slot1330Syd], BRIS, SYD), slot11Syd);
  assert.strictEqual(chosenSlotFromReply(`Friday ${fri.day} Oct at 11am works for both`, [slot11Syd, slot1330Syd], BRIS, SYD), slot11Syd);
  assert.strictEqual(chosenSlotFromReply(`Fri ${fri.day} October, 10:00 am your end`, [slot11Syd, slot1330Syd], BRIS, SYD), slot11Syd);
});
check('a list of several, or none, picks nothing', () => {
  assert.strictEqual(chosenSlotFromReply(`${LEAD_LABEL} or Fri ${fri.day} October, 1:30 pm`, [slot11Syd, slot1330Syd], BRIS, SYD), null);
  assert.strictEqual(chosenSlotFromReply('Here is a warm follow-up.', [slot11Syd], BRIS, SYD), null);
  assert.strictEqual(chosenSlotFromReply('', [slot11Syd], BRIS, SYD), null);
});
check('slotCandidates reads check_availability days and check_time results out of resent tool results', () => {
  const tr = (obj) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: JSON.stringify(obj) }] });
  const got = slotCandidates([{ role: 'user', content: 'yes' }, tr({ days: [{ freeSlots: [{ time: slot11Syd }, { time: slot1330Syd }] }] }), tr({ ok: true, startISO: 'x', clockRule: 'r' }), tr({ ok: true })]);
  assert.deepStrictEqual(got, [slot11Syd, slot1330Syd, 'x']);
});
check('coachClockReply: no slot named, zones differ all window → the claim still goes, no line', () => {
  const r = coachClockReply('They are on the same clock as you, so any time suits.', { candidates: [slot11Syd], coachTz: BRIS, leadTz: SYD });
  // Only when the gap holds across the next 35 days (no daylight-saving straddle); otherwise untouched.
  const gapNow = DateTime.now().setZone(SYD).offset - DateTime.now().setZone(BRIS).offset;
  const gapLater = DateTime.now().plus({ days: 35 }).setZone(SYD).offset - DateTime.now().plus({ days: 35 }).setZone(BRIS).offset;
  if (gapNow && gapLater) { assert.strictEqual(r.reply, ''); assert.strictEqual(r.dropped.length, 1); } else { assert.strictEqual(r.dropped.length, 0); }
  assert.strictEqual(r.line, null);
});

// ── The panel turns ───────────────────────────────────────────────────────────────────────────
function fakeClient(calls, finalText = 'done') {
  let i = 0;
  return { messages: { create: async () => {
    const c = calls[i++];
    if (c) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${i}`, name: c.name, input: c.input || {} }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: finalText }] };
  } } };
}
function toolResults(res) {
  return (res.messages || []).filter((m) => m.role === 'user' && Array.isArray(m.content) && m.content[0] && m.content[0].type === 'tool_result').map((m) => JSON.parse(m.content[0].content));
}
const mk = (iso) => { const b = DateTime.fromISO(iso).setZone(BRIS); const s = DateTime.fromISO(iso).setZone(SYD); return { time: iso, display: b.toFormat('h:mm a').toLowerCase(), leadDisplay: s.toFormat('h:mm a').toLowerCase() }; };
const day = { date: fri.setZone(BRIS).toFormat('yyyy-MM-dd'), day: fri.setZone(BRIS).toFormat('ccc d'), meetingCount: 1, freeSlots: [mk(slot11Syd), mk(slot1330Syd)] };
const availSyd = async () => ({ yourTimezone: BRIS, leadTimezone: SYD, leadLocation: 'Sydney, New South Wales', leadTzDetected: true, days: [day] });
const availBris = async () => ({ yourTimezone: BRIS, leadTimezone: BRIS, leadLocation: 'Brisbane', leadTzDetected: true, days: [day] });
const noClashes = async () => new Map();
const TIDY = 'https://tidycal.com/thepowertoask/consultation';
const samConvo = [{ sender: 'Guy Wilson', text: 'Thanks for connecting, Sam. Open to a quick call?' }, { sender: 'Sam Trattles', text: `Hi Guy, happy to chat. Grab a time that suits here: ${TIDY}. Cheers, Sam` }];
const tidyOk = async (url) => { assert.strictEqual(url, TIDY); return { ok: true, provider: 'tidycal', ownerName: 'Sam Trattles', eventName: 'Consultation', durationMins: 15, slots: [slot11Syd] }; };
const bookingDeps = {
  getClashesForISO: async () => [],
  createBookingEvent: async (coach, { startISO, durationMins }) => ({ ok: true, eventId: 'evt1', title: 'Sam Trattles & Guy', start: startISO, durationMins: durationMins || 30 }),
  deleteOfferHolds: async () => ({ ok: true }),
};
const base = { coach: { clientId: 'Guy-Wilson', clientName: 'Guy', timezone: BRIS }, profile: { name: 'Sam Trattles', location: 'Sydney, New South Wales' }, conversation: samConvo, leadEmail: 'sam@example.com', messages: [{ role: 'user', content: 'find a time we are both free' }] };

(async () => {
  console.log('\nTHE CONFIRM TURN - Brisbane coach, Sydney lead in daylight saving, one slot off the lead\'s TidyCal link:');
  {
    const aside = `I'd go with ${LEAD_LABEL} (Brisbane/Sydney same clock this time of year) - want me to book it and send Sam's invite to sam@example.com?`;
    const res = await runWingguyChatTurn({ ...base, deps: { client: fakeClient([{ name: 'check_availability', input: { includeFarWeeks: true } }], aside), getAvailabilityForCoach: availSyd, clashingSlots: noClashes, readBookingLink: tidyOk } });
    const [ca] = toolResults(res);
    check('the one surviving slot carries "both" with the coach\'s own clock, and the note says to quote it', () => {
      assert.strictEqual(ca.days.length, 1, JSON.stringify(ca.days)); assert.strictEqual(ca.days[0].freeSlots.length, 1);
      assert.strictEqual(ca.days[0].freeSlots[0].both, LINE); assert.strictEqual(ca.days[0].freeSlots[0].label, LEAD_LABEL);
      assert.match(ca.leadLink.note, /quote the slot's "both" value word for word/);
    });
    check('the reply Guy reads ends with "On both clocks:" and his own 10:00 am', () => assert.ok(res.reply.endsWith(`On both clocks: ${LINE}`), res.reply));
    check('the "same clock this time of year" aside did not survive; the question did', () => {
      assert.ok(!/same clock/i.test(res.reply), res.reply);
      assert.match(res.reply, /want me to book it and send Sam's invite to sam@example\.com\?/);
    });
    check('no booking this turn, no draft', () => { assert.ok(!res.booked); assert.ok(!res.draft); });
  }
  console.log('\nTHE BOOKED TURN - Guy said yes:');
  {
    const wrong = `Booked for ${LEAD_LABEL}. Brisbane and Sydney are on the same clock, so that's 11:00 am for you too - invite sent to sam@example.com.`;
    const res = await runWingguyChatTurn({ ...base, deps: { client: fakeClient([{ name: 'check_availability', input: { includeFarWeeks: true } }, { name: 'book_meeting', input: { startISO: slot11Syd } }], wrong), getAvailabilityForCoach: availSyd, clashingSlots: noClashes, readBookingLink: tidyOk, ...bookingDeps } });
    const [, bm] = toolResults(res);
    check('book_meeting returns WHEN on both clocks, from code', () => { assert.strictEqual(bm.ok, true, JSON.stringify(bm)); assert.strictEqual(bm.when, LINE); assert.match(bm.note, /word for word/); });
    check('the booked event handed to the panel carries the same line', () => { assert.strictEqual(res.booked.eventId, 'evt1'); assert.strictEqual(res.booked.when, LINE); });
    check('the reply ends with "Booked:" and Guy\'s own 10:00 am', () => assert.ok(res.reply.endsWith(`Booked: ${LINE}`), res.reply));
    check('the "same clock, 11:00 am for you too" sentence did not survive, and nothing of it was left behind', () => {
      assert.ok(!/same clock/i.test(res.reply), res.reply); assert.ok(!/11:00 am for you too/.test(res.reply), res.reply);
      assert.strictEqual(res.reply, `Booked for ${LEAD_LABEL}.\n\nBooked: ${LINE}`);
    });
  }
  console.log('\nthe model quoted WHEN word for word: not repeated:');
  {
    const good = `Booked: ${LINE} - invite sent to sam@example.com.`;
    const res = await runWingguyChatTurn({ ...base, deps: { client: fakeClient([{ name: 'book_meeting', input: { startISO: slot11Syd } }], good), getAvailabilityForCoach: availSyd, clashingSlots: noClashes, ...bookingDeps } });
    check('one copy of the line, reply otherwise untouched', () => { assert.strictEqual(res.reply, good); assert.strictEqual(res.reply.split(LINE).length - 1, 1); });
  }
  console.log('\nthe read on one turn, the booking on the next (no check_availability this turn): the lead\'s zone comes from the record:');
  {
    const turn1 = await runWingguyChatTurn({ ...base, deps: { client: fakeClient([{ name: 'check_availability', input: { includeFarWeeks: true } }], `Go with ${LEAD_LABEL}?`), getAvailabilityForCoach: availSyd, clashingSlots: noClashes, readBookingLink: tidyOk } });
    check('turn one: the confirm line is there', () => assert.ok(turn1.reply.endsWith(`On both clocks: ${LINE}`), turn1.reply));
    const turn2 = await runWingguyChatTurn({ ...base, messages: [...turn1.messages, { role: 'user', content: 'yes' }], deps: { client: fakeClient([{ name: 'book_meeting', input: { startISO: slot11Syd } }], 'Done - same clock as you, so 11 it is.'), getAvailabilityForCoach: availSyd, clashingSlots: noClashes, readBookingLink: async () => { throw new Error('must not re-read'); }, ...bookingDeps } });
    check('turn two: Booked line from the record\'s Sydney, the aside gone', () => { assert.ok(turn2.reply.endsWith(`Booked: ${LINE}`), turn2.reply); assert.ok(!/same clock/i.test(turn2.reply), turn2.reply); });
  }
  console.log('\nthe guard stays out of the way:');
  {
    // Same zone: a "same clock" aside is TRUE and stays; no confirm line is added; the booked line says same clock.
    const brisBase = { ...base, profile: { name: 'Sam Trattles', location: 'Brisbane' } };
    const r1 = await runWingguyChatTurn({ ...brisBase, deps: { client: fakeClient([{ name: 'check_availability', input: { includeFarWeeks: true } }], `Go with Fri ${fri.day} October, 10:00 am (same clock as you)?`), getAvailabilityForCoach: availBris, clashingSlots: noClashes, readBookingLink: tidyOk } });
    check('Brisbane lead, confirm turn: no line added, the true "same clock" aside stays', () => { assert.strictEqual(r1.reply, `Go with Fri ${fri.day} October, 10:00 am (same clock as you)?`); });
    const r2 = await runWingguyChatTurn({ ...brisBase, deps: { client: fakeClient([{ name: 'book_meeting', input: { startISO: slot11Syd } }], 'Booked.'), getAvailabilityForCoach: availBris, clashingSlots: noClashes, ...bookingDeps } });
    check('Brisbane lead, booked: the line says the lead is on the same clock', () => assert.strictEqual(r2.reply, `Booked.\n\nBooked: Fri ${fri.day} October, 10:00 am Brisbane (your time - the lead is on the same clock)`));
    // Lead's clock unknown: the coach's time only.
    const r3 = await runWingguyChatTurn({ ...base, profile: { name: 'Sam Trattles', location: '' }, deps: { client: fakeClient([{ name: 'book_meeting', input: { startISO: slot11Syd } }], 'Booked.'), getAvailabilityForCoach: availBris, clashingSlots: noClashes, ...bookingDeps } });
    check('no location on file, booked: coach time only, no guessed lead-side time', () => assert.strictEqual(r3.booked.when, `Fri ${fri.day} October, 10:00 am Brisbane (your time - the lead's clock is not on file)`));
    // A times draft turn: offeredTimes already shows both clocks, so no extra confirm line.
    const r4 = await runWingguyChatTurn({ ...base, conversation: [samConvo[0], { sender: 'Sam Trattles', text: 'Sure, what times suit?' }], deps: { client: fakeClient([{ name: 'check_availability', input: { includeFarWeeks: true } }, { name: 'propose_times', input: { intro: 'Hi Sam -', slotTimes: [slot11Syd], outro: '' } }], `Offered ${LEAD_LABEL} Sydney (10:00 am Brisbane). Sam's based in Sydney.`), getAvailabilityForCoach: availSyd, clashingSlots: noClashes } });
    check('a propose_times turn gets no "On both clocks" line (offeredTimes covers it)', () => { assert.ok(r4.draft, 'no draft'); assert.ok(!/On both clocks/.test(r4.reply), r4.reply); });
  }
  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all coach-clock-line tests passed');
  process.exit(failures ? 1 : 0);
})();
