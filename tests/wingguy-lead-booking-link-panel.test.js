/**
 * The panel guard for a lead's own booking link (2026-09-15, same afternoon the reader shipped).
 *
 * The instruction alone failed the live test: Candace sent her Calendly and said she was away 1.5
 * weeks; the panel offered three of Guy's times, two inside her trip, none on her page. So, in
 * code:
 *  - the link is found in the LEAD's messages (never the coach's) and read by check_availability
 *    whether or not the model passed leadBookingLink
 *  - propose_times REFUSES while a readable lead link exists (one slot, booked, not a list)
 *  - an unreadable link falls open: the normal list still works
 *  - the notBefore regex actually matches (its backslashes were lost on the way into main)
 *  - TidyCal links are found in the lead's messages too (Sam Trattles, 2026-10-09), and an
 *    unreadable link means Guy's OWN times in the draft: propose_message REFUSES any "I'll grab a
 *    slot through your link" promise (linkBookingPromise), whatever the read said
 *
 * Run: node tests/wingguy-lead-booking-link-panel.test.js
 */
const assert = require('assert');
const { DateTime } = require('luxon');
const { runWingguyChatTurn, detectLeadBookingLink, linkBookingPromise } = require('../services/wingguyChat');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const CANDACE = "Hi Guy,\n\nThank you for the outreach. I'm quite interested in what you're offering. A quick zoom call might be the best way forward.\n\nI'm away in the next 1.5 week but happy to connect when I return. Here's a link to my calendar; feel free to send me an invite separately if 30-mins doesn't work https://calendly.com/candacengok/intro\n\nCheers,\nCandace";
const LINK = 'https://calendly.com/candacengok/intro';
const convo = [
  { sender: 'Guy Wilson', text: 'Thanks for connecting, Candace. Keen to hear how you approach cost per lead - open to a quick call?' },
  { sender: 'Candace Ngok', text: CANDACE },
];

console.log('detectLeadBookingLink:');
check('finds the link in the lead\'s message', () => assert.strictEqual(detectLeadBookingLink(convo, 'Guy'), LINK));
check('ignores a link in the coach\'s own message', () => assert.strictEqual(detectLeadBookingLink([{ sender: 'Guy Wilson', text: 'book me here https://calendly.com/guy/intro' }], 'Guy'), null));
check('ignores "You"/"me" senders (the coach as LinkedIn renders him)', () => assert.strictEqual(detectLeadBookingLink([{ sender: 'You', text: 'https://calendly.com/guy/intro' }], 'Guy'), null));
check('no link, no crash', () => assert.strictEqual(detectLeadBookingLink([{ sender: 'Candace Ngok', text: 'see you Tuesday' }], 'Guy'), null));
// TidyCal (Sam Trattles, 2026-10-09): the scanner walked straight past this link while the reader
// said "Calendly only", so the panel never even tried.
const SAM = 'Hi Guy, happy to chat. Grab a time that suits here: https://tidycal.com/thepowertoask/consultation. Cheers, Sam';
const TIDY = 'https://tidycal.com/thepowertoask/consultation';
const samConvo = [{ sender: 'Guy Wilson', text: 'Thanks for connecting, Sam. Open to a quick call?' }, { sender: 'Sam Trattles', text: SAM }];
check('finds a TidyCal link in the lead\'s message', () => assert.strictEqual(detectLeadBookingLink(samConvo, 'Guy'), TIDY));

console.log('linkBookingPromise (a draft must never promise to book through THEIR link):');
check('catches "I\'ll grab a slot through your link now"', () => assert.strictEqual(linkBookingPromise("Hi Sam - Tuesday works for me. I'll grab a slot through your link now."), 'grab a slot through your link'));
check('catches "book via your Calendly", "find a time on your TidyCal page", "lock in a time through the link"', () => {
  assert.ok(linkBookingPromise("I'll book via your Calendly"));
  assert.ok(linkBookingPromise('Happy to find a time on your TidyCal page'));
  assert.ok(linkBookingPromise("I'll lock in a time through the link you sent"));
});
check('leaves the normal lines alone', () => {
  for (const s of ['Would any of the following times work for you?', "Invite's on its way - see you Tuesday.", 'Thanks for sending the link through.', "I've booked us in for Tuesday 2pm and put the invite in your calendar.", 'Let me know which suits and I will send the invite from my side.']) {
    assert.strictEqual(linkBookingPromise(s), null, s);
  }
});

// Fake model: one tool call per turn, in order, then end.
function fakeClient(calls) {
  let i = 0;
  return { messages: { create: async () => {
    const c = calls[i++];
    if (c) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${i}`, name: c.name, input: c.input || {} }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
  } } };
}
function toolResults(res) {
  return (res.messages || []).filter((m) => m.role === 'user' && Array.isArray(m.content) && m.content[0] && m.content[0].type === 'tool_result').map((m) => JSON.parse(m.content[0].content));
}

// Coach availability: three weekdays from 3 days out, 10:00 / 1:30 / 2:00 Brisbane.
const tz = 'Australia/Brisbane';
const days = [];
for (let i = 3; days.length < 12; i++) {
  const d = DateTime.now().setZone(tz).plus({ days: i });
  if (d.weekday >= 6) continue;
  const slot = (h, m) => { const t = d.set({ hour: h, minute: m, second: 0, millisecond: 0 }); return { time: t.toUTC().toISO(), display: t.toFormat('h:mm a').toLowerCase(), leadDisplay: t.toFormat('h:mm a').toLowerCase() }; };
  days.push({ date: d.toFormat('yyyy-MM-dd'), day: d.toFormat('ccc d'), meetingCount: 1, freeSlots: [slot(10, 0), slot(13, 30), slot(14, 0)] });
}
const getAvailabilityForCoach = async () => ({ yourTimezone: tz, leadTimezone: tz, leadLocation: 'Brisbane', leadTzDetected: true, days });
// The lead is free 1:15-2:15 on the 5th offerable day only.
const target = days[4];
const leadFree = (() => { const t = DateTime.fromISO(target.freeSlots[1].time).minus({ minutes: 15 }); return [t.toISO(), t.plus({ minutes: 30 }).toISO()]; })();
const readerOk = async (url, opts) => { assert.strictEqual(url, LINK); assert.strictEqual(opts.timezone, tz); return { ok: true, ownerName: 'Candace Ngok', eventName: 'Introductory Call', durationMins: 30, slots: leadFree }; };
const readerFail = async () => ({ ok: false, reason: 'Calendly lookup failed (HTTP 503)' });
// propose_times' calendar backstop (2026-09-17). These tests are about the LEAD's booking link, not
// the coach's diary, so the calendar reads clear — there's no real calendar behind a fake coach, and
// without this the guard correctly refuses and no list is built.
const noClashes = async () => new Map();
const base = { coach: { clientId: 'Guy-Wilson', clientName: 'Guy' }, profile: { name: 'Candace Ngok', location: 'Brisbane' }, conversation: convo, leadEmail: 'candace@example.com', messages: [{ role: 'user', content: 'find a time we are both free' }] };

(async () => {
  console.log('\ncheck_availability reads the thread link even when the model does not pass it:');
  {
    const res = await runWingguyChatTurn({ ...base, deps: { client: fakeClient([{ name: 'check_availability', input: {} }]), getAvailabilityForCoach, clashingSlots: noClashes, readBookingLink: readerOk } });
    const r = toolResults(res)[0];
    check('leadLink.read is true and the source is the thread', () => { assert.ok(r && r.leadLink && r.leadLink.read === true, JSON.stringify(r && r.leadLink)); assert.strictEqual(r.leadLink.source, 'thread'); assert.strictEqual(r.leadLink.url, LINK); });
    check('only the overlap survives: one day, one slot (the 1:30)', () => { assert.strictEqual(r.days.length, 1, JSON.stringify(r.days.map((d) => d.date))); assert.deepStrictEqual(r.days[0].freeSlots.map((s) => s.time), [target.freeSlots[1].time]); });
    check('the note says one slot, no list', () => assert.match(r.leadLink.note, /Do not offer a list/));
  }
  console.log('\nnotBefore actually filters (the stripped-backslash regression):');
  {
    const nb = days[6].date;
    const res = await runWingguyChatTurn({ ...base, conversation: [convo[0], { sender: 'Candace Ngok', text: 'back on the 26th, no calendar link sorry' }], deps: { client: fakeClient([{ name: 'check_availability', input: { notBefore: nb } }]), getAvailabilityForCoach, clashingSlots: noClashes } });
    const r = toolResults(res)[0];
    check('no day before notBefore comes back', () => { assert.ok(r.days.length > 0); assert.ok(r.days.every((d) => d.date >= nb), JSON.stringify(r.days.map((d) => d.date))); assert.strictEqual(r.notBefore, nb); });
    check('no fallbackWeek flags when notBefore is set', () => assert.ok(r.days.every((d) => !d.fallbackWeek)));
  }
  console.log('\npropose_times refuses while a readable lead link exists:');
  {
    const res = await runWingguyChatTurn({ ...base, deps: { client: fakeClient([{ name: 'check_availability', input: {} }, { name: 'propose_times', input: { intro: 'Hi Candace -', slotTimes: [days[0].freeSlots[0].time, days[1].freeSlots[0].time], outro: 'Let me know.' } }]), getAvailabilityForCoach, clashingSlots: noClashes, readBookingLink: readerOk } });
    const [, pt] = toolResults(res);
    check('propose_times came back STOPPED naming the link', () => { assert.ok(pt && pt.ok === false, JSON.stringify(pt)); assert.match(pt.error, /STOPPED/); assert.ok(pt.error.includes(LINK)); assert.match(pt.error, /book_meeting/); });
    check('no draft with a time list was produced', () => assert.ok(!res.draft || !/Would any of the following times/.test(res.draft), res.draft));
  }
  console.log('\npropose_times refuses BEFORE check_availability too (link in thread, nothing read yet):');
  {
    const res = await runWingguyChatTurn({ ...base, deps: { client: fakeClient([{ name: 'propose_times', input: { intro: 'Hi -', slotTimes: [days[0].freeSlots[0].time], outro: 'x' } }]), getAvailabilityForCoach, clashingSlots: noClashes, readBookingLink: readerOk } });
    const [pt] = toolResults(res);
    check('STOPPED, told to call check_availability first', () => { assert.strictEqual(pt.ok, false); assert.match(pt.error, /Call check_availability first/); });
  }
  console.log('\nan unreadable link falls open to the normal list:');
  {
    const res = await runWingguyChatTurn({ ...base, deps: { client: fakeClient([{ name: 'check_availability', input: {} }, { name: 'propose_times', input: { intro: 'Hi Candace -', slotTimes: [days[0].freeSlots[0].time, days[1].freeSlots[1].time], outro: 'Let me know.' } }]), getAvailabilityForCoach, clashingSlots: noClashes, readBookingLink: readerFail } });
    const [ca, pt] = toolResults(res);
    check('check_availability says the link could not be read and keeps Guy\'s slots', () => { assert.strictEqual(ca.leadLink.read, false); assert.match(ca.leadLink.reason, /503/); assert.ok(ca.days.length > 3); });
    check('propose_times still builds the list', () => { assert.ok(pt && pt.ok !== false, JSON.stringify(pt)); assert.strictEqual(pt.offered, 2); });
  }
  console.log('\nan unreadable TidyCal link: the draft offers Guy\'s own times and never promises to use their link (Sam Trattles, 2026-10-09):');
  {
    const tidyFail = async (url) => { assert.strictEqual(url, TIDY); return { ok: false, reason: 'TidyCal answered with a Cloudflare bot check instead of the page' }; };
    const res = await runWingguyChatTurn({ ...base, profile: { name: 'Sam Trattles', location: 'Brisbane' }, conversation: samConvo, leadEmail: 'sam@example.com', deps: { client: fakeClient([
      { name: 'check_availability', input: {} },
      { name: 'propose_message', input: { message: "Hi Sam - Tuesday works for me. I'll grab a slot through your link now." } },
      { name: 'propose_times', input: { intro: 'Hi Sam - thanks, keen to chat.', slotTimes: [days[0].freeSlots[0].time, days[1].freeSlots[1].time, days[2].freeSlots[2].time], outro: 'Let me know.' } },
    ]), getAvailabilityForCoach, clashingSlots: noClashes, readBookingLink: tidyFail } });
    const [ca, pm, pt] = toolResults(res);
    check('check_availability names TidyCal, keeps Guy\'s slots, steers to propose_times, no "by hand"', () => {
      assert.strictEqual(ca.leadLink.read, false); assert.strictEqual(ca.leadLink.provider, 'TidyCal');
      assert.match(ca.leadLink.note, /TidyCal link could not be read \(TidyCal answered with a Cloudflare bot check/);
      assert.match(ca.leadLink.note, /propose_times/); assert.match(ca.leadLink.note, /NEVER write into the draft/);
      assert.ok(!/by hand/.test(ca.leadLink.note), ca.leadLink.note); assert.ok(ca.days.length > 3);
    });
    check('the "through your link" draft is REJECTED, quoting the line, naming TidyCal and the way forward', () => {
      assert.strictEqual(pm.ok, false, JSON.stringify(pm));
      assert.match(pm.error, /It says "grab a slot through your link"/); assert.match(pm.error, /Sam Trattles's TidyCal link/);
      assert.match(pm.error, /could not be read/); assert.match(pm.error, /propose_times/);
    });
    check('propose_times then builds the list', () => { assert.ok(pt && pt.ok !== false, JSON.stringify(pt)); assert.strictEqual(pt.offered, 3); });
    check('the draft carries Guy\'s three times with the timezone line, and no promise to use their link', () => {
      assert.ok(res.draft, 'no draft was set');
      assert.match(res.draft, /Would any of the following times work for you\?/);
      assert.match(res.draft, /\(all times are Brisbane time\)/);
      assert.strictEqual((res.draft.match(/^- /gm) || []).length, 3, res.draft);
      assert.ok(!/through (your|the) link|grab a slot|your link|your page/i.test(res.draft), res.draft);
      assert.strictEqual(linkBookingPromise(res.draft), null, res.draft);
    });
  }
  console.log('\nthe promise guard holds whatever the read said, and stays out of the way with no link:');
  {
    const res = await runWingguyChatTurn({ ...base, deps: { client: fakeClient([{ name: 'check_availability', input: {} }, { name: 'propose_message', input: { message: "Hi Candace - I'll book via your Calendly for when you're back." } }]), getAvailabilityForCoach, clashingSlots: noClashes, readBookingLink: readerOk } });
    const [, pm] = toolResults(res);
    check('readable Calendly link + "book via your Calendly" → REJECTED, told to book ONE via book_meeting', () => { assert.strictEqual(pm.ok, false, JSON.stringify(pm)); assert.match(pm.error, /Calendly link was read/); assert.match(pm.error, /book_meeting/); assert.ok(!res.draft, res.draft); });
    const res2 = await runWingguyChatTurn({ ...base, deps: { client: fakeClient([{ name: 'propose_message', input: { message: "Hi Candace - I'll grab a slot through your link now." } }]), getAvailabilityForCoach, clashingSlots: noClashes, readBookingLink: readerOk } });
    const [pm2] = toolResults(res2);
    check('link in the thread, not read yet → REJECTED, told to call check_availability first', () => { assert.strictEqual(pm2.ok, false, JSON.stringify(pm2)); assert.match(pm2.error, /has not been read yet/); assert.match(pm2.error, /check_availability/); });
    const res3 = await runWingguyChatTurn({ ...base, conversation: [convo[0], { sender: 'Candace Ngok', text: 'Sure, what times suit?' }], deps: { client: fakeClient([{ name: 'propose_message', input: { message: "Hi Candace - great, I'll find a time on your calendar that suits." } }]), getAvailabilityForCoach, clashingSlots: noClashes } });
    const [pm3] = toolResults(res3);
    check('no lead link in the thread → the guard does not fire', () => assert.strictEqual(pm3.ok, true, JSON.stringify(pm3)));
  }
  console.log('\nno link in the thread: nothing changes:');
  {
    const res = await runWingguyChatTurn({ ...base, conversation: [convo[0], { sender: 'Candace Ngok', text: 'Sure, what times suit?' }], deps: { client: fakeClient([{ name: 'check_availability', input: {} }, { name: 'propose_times', input: { intro: 'Hi -', slotTimes: [days[0].freeSlots[0].time], outro: 'x' } }]), getAvailabilityForCoach, clashingSlots: noClashes, readBookingLink: async () => { throw new Error('must not be called'); } } });
    const [ca, pt] = toolResults(res);
    check('no leadLink on the availability result, list produced', () => { assert.ok(!ca.leadLink); assert.strictEqual(pt.offered, 1); });
  }
  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all lead-booking-link panel tests passed');
  process.exit(failures ? 1 : 0);
})();
