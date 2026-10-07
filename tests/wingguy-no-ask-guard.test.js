/**
 * Two fixes from the Andrew Wheater draft (Guy, 2026-10-07).
 *
 * 1. NO TIME LIST BEFORE ANYONE HAS RAISED A CALL. Guy's handshake note asked for nothing; Andrew
 *    replied "would love to be involved, anything I can do to help" - a yes to the network, not a
 *    meeting - and the panel went straight to three times. propose_times now refuses until a call
 *    has been mentioned in the thread (either side), or Guy asks for times in the panel chat.
 *
 * 2. CODE-OWNED INVITE LINE. The rulebook's on-file example was a fragment ("...and I'll send a
 *    calendar invite ... to jane@company.com"); the model copied it and the draft read
 *    "(all times are Sydney time)" then "and I'll send ...". Code now writes the full sentence.
 *
 * Run: node tests/wingguy-no-ask-guard.test.js
 */
const assert = require('assert');
const { DateTime } = require('luxon');
const { runWingguyChatTurn, meetingRaisedInThread, coachAskedForTimes, withInviteLine } = require('../services/wingguyChat');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failed++; console.log(`  ✗ ${label}: ${e.message}`); }
};

const handshake = { sender: 'Guy Wilson', text: "Hi Andrew, I'm building a network of Fractional Professionals who only recommend others they trust. Looking at your profile - I think you'd be easy to recommend. (I know a) Guy" };
const andrewYes = { sender: 'Andrew Wheater', text: 'Sounds great would love to be involved. Anything I can do to help\nA' };
const zoomAsk = { sender: 'Guy Wilson', text: 'Would you be up for a quick Zoom in the next couple of weeks to talk about potential two-way collaboration?' };
const oldOffer = { sender: 'Guy Wilson', text: 'Would any of the following times work for you?\n\n- Tue 22 September, 11:30 am\n\n(all times are Sydney time)' };

console.log('meetingRaisedInThread');
check('handshake + warm yes (Andrew) → no call raised', () => assert.strictEqual(meetingRaisedInThread([handshake, andrewYes]), false));
check('coach asked for a Zoom → raised', () => assert.strictEqual(meetingRaisedInThread([handshake, zoomAsk]), true));
check('lead asked for a chat → raised', () => assert.strictEqual(meetingRaisedInThread([handshake, { sender: 'Andrew Wheater', text: 'Happy to have a chat' }]), true));
check('an earlier time offer counts (no call word in it)', () => assert.strictEqual(meetingRaisedInThread([handshake, oldOffer]), true));
check('empty thread → not raised', () => assert.strictEqual(meetingRaisedInThread([]), false));

console.log('coachAskedForTimes');
check('hidden kickoff never counts', () => assert.strictEqual(coachAskedForTimes([{ role: 'user', content: "(Opened from the LinkedIn conversation above. ... if it's time to offer a meeting, suggest some times.)" }]), false));
check('"offer him some times" counts', () => assert.strictEqual(coachAskedForTimes([{ role: 'user', content: 'offer him some times' }]), true));
check('"she said tomorrow is fine" counts', () => assert.strictEqual(coachAskedForTimes([{ role: 'user', content: 'she said tomorrow is fine' }]), true));
check('"make it warmer" does not', () => assert.strictEqual(coachAskedForTimes([{ role: 'user', content: 'make it warmer' }]), false));

console.log('withInviteLine');
const onFile = withInviteLine("and I'll send a calendar invite with the Zoom link to amfwheater@gmail.com - just say if there's a better address.", 'amfwheater@gmail.com');
check('the fragment is replaced by the full sentence', () => assert.strictEqual(onFile, "Let me know which suits and I'll send a calendar invite with the Zoom link to amfwheater@gmail.com - just say if there's a better address."));
check('no email → asks for one', () => assert.ok(/what's the best email to send it to\?$/.test(withInviteLine('', ''))));
check('other closing words stay, above the invite line', () => {
  const r = withInviteLine('Looking forward to it.\nJust let me know what suits.', 'a@b.com');
  assert.ok(r.startsWith('Looking forward to it.\n\nLet me know which suits'), r);
  assert.strictEqual((r.match(/which suits|what suits/g) || []).length, 1, r);
});

// Wired through the panel turn.
let day = DateTime.now().setZone('Australia/Sydney').plus({ days: 3 }).startOf('day');
while (day.weekday > 5) day = day.plus({ days: 1 });
const slot = day.set({ hour: 11, minute: 30 }).toUTC().toISO();
const fakeAvail = async () => ({
  yourTimezone: 'Australia/Brisbane', leadTimezone: 'Australia/Sydney', leadLocation: 'The Rocks, Sydney', leadTzDetected: true,
  days: [{ date: day.toFormat('yyyy-MM-dd'), day: day.toFormat('ccc'), freeSlots: [{ time: slot, display: '', leadDisplay: '' }] }],
});
const coach = { clientId: 'Guy-Wilson', clientName: 'Guy Wilson', timezone: 'Australia/Brisbane' };
const deps = (client) => ({ client, getVariables: async () => [], getAvailabilityForCoach: fakeAvail, clashingSlots: async () => new Map() });
const ask = 'Hi Andrew,\n\nAppreciate the enthusiasm - and the offer to help.\n\nWould you be up for a quick Zoom in the next couple of weeks to talk about potential two-way collaboration?\n\n(I know a) Guy';

(async () => {
  console.log('propose_times on the Andrew thread');
  try {
    const seen = [];
    let call = 0;
    const client = { messages: { create: async (req) => {
      seen.push(req.messages[req.messages.length - 1]);
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_times', input: { intro: 'Hi Andrew,\n\nGlad to have you involved.', slotTimes: [slot] } }] };
      if (call === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'propose_message', input: { message: ask } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Asked first.' }] };
    } } };
    const r = await runWingguyChatTurn({
      coach, profile: { name: 'Andrew Wheater', location: 'The Rocks, Sydney' }, conversation: [handshake, andrewYes],
      leadEmail: 'amfwheater@gmail.com', messages: [{ role: 'user', content: '(Opened from the LinkedIn conversation above. Read where things stand and give me the best next message to send.)' }],
      deps: deps(client),
    });
    check('the time list was refused and the model saw why', () => {
      const tr = seen[1].content.find((b) => b.type === 'tool_result');
      assert.ok(/nobody has raised a call/.test(tr.content), tr.content);
    });
    check('the draft is the ask, not a time list', () => assert.strictEqual(r.draft, ask));
  } catch (e) { failed++; console.log(`  ✗ refusal wired test threw: ${e.message}`); }

  try {
    let call = 0;
    const client = { messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_times', input: { intro: 'Hi Andrew,\n\nGreat - looking forward to it.', slotTimes: [slot], outro: "and I'll send a calendar invite with the Zoom link to amfwheater@gmail.com - just say if there's a better address." } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
    } } };
    const r = await runWingguyChatTurn({
      coach, profile: { name: 'Andrew Wheater', location: 'The Rocks, Sydney' }, conversation: [handshake, andrewYes, zoomAsk, { sender: 'Andrew Wheater', text: 'Yes keen' }],
      leadEmail: 'amfwheater@gmail.com', messages: [{ role: 'user', content: '(kickoff)' }],
      deps: deps(client),
    });
    check('after a Zoom ask, times go through', () => assert.ok(r.draft && /all times are Sydney time/.test(r.draft), String(r.draft)));
    check('no line starts with "and I\'ll send"', () => assert.ok(!/^and I'll send/m.test(r.draft), r.draft));
    check('the invite line follows the timezone line, once', () => {
      assert.ok(/\(all times are Sydney time\)\n\nLet me know which suits and I'll send a calendar invite with the Zoom link to amfwheater@gmail\.com/.test(r.draft), r.draft);
      assert.strictEqual((r.draft.match(/calendar invite/g) || []).length, 1, r.draft);
    });
  } catch (e) { failed++; console.log(`  ✗ invite-line wired test threw: ${e.message}`); }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
