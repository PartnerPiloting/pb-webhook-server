// Accepted, then pulled by the coach (Meagan Smith, 2026-10-19). Guy offered Wed 7, Thu 8 and Fri 9 Oct;
// Meagan took Wed 7 Oct 12pm; Guy withdrew it. The panel summed it up as "offered three times, no reply"
// and drafted "these things slip down the inbox, no stress" - the ball was Guy's, not hers. Also covers
// the panel's new list_events tool ("have I already met her?" used to get "I can't see past diary
// entries"). Run: node tests/wingguy-withdrawn-acceptance.test.js

const assert = require('assert');
const {
  withdrawnAcceptance, leadBlamingLine, summariseEventsForPanel, runWingguyChatTurn, AGENT_TOOLS,
} = require('../services/wingguyChat');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failed++; console.log(`  ✗ ${label}: ${e.message}`); }
};

const COACH = 'Guy Wilson';
const LEAD = 'Meagan Smith';
const offer = { sender: 'Guy Wilson', day: 'Oct 2', text: 'Great, Meagan.\n\nWould any of the following times work for you?\n\n- Wed 7 October, 12:00 pm\n- Thu 8 October, 10:00 am\n- Fri 9 October, 2:00 pm\n\n(all times are Brisbane time)\n\n(I know a) Guy' };
const accept = { sender: 'Meagan Smith', day: 'Oct 3', text: 'Wed 7th at 12pm works for me!' };
const pulled = { sender: 'Guy Wilson', day: 'Oct 5', text: "Hi Meagan, so sorry - something's come up on Wednesday and I need to move our time. I'll come back to you with a couple of new options shortly.\n\nGuy" };
const pulledWithTimes = { sender: 'Guy Wilson', day: 'Oct 5', text: "Hi Meagan, apologies - I have to reschedule Wednesday. Would any of the following times work for you?\n\n- Tue 13 October, 11:00 am\n- Wed 14 October, 10:00 am\n\nGuy" };
const confirmed = { sender: 'Guy Wilson', day: 'Oct 3', text: "Perfect, Meagan - invite's on its way to meagan@example.com. If you need to move it, just say.\n\nGuy" };
const meagan = [offer, accept, pulled];

console.log('withdrawnAcceptance');
check('Meagan thread: accepted, then pulled', () => {
  const w = withdrawnAcceptance({ conversation: meagan, coachName: COACH });
  assert.ok(w, 'expected a hit');
  assert.ok(/Wed 7th at 12pm/.test(w.accepted));
  assert.strictEqual(w.acceptedDay, 'Oct 3');
  assert.strictEqual(w.withdrawnDay, 'Oct 5');
});
check('pulled with fresh times in the same message still counts', () => assert.ok(withdrawnAcceptance({ conversation: [offer, accept, pulledWithTimes], coachName: COACH })));
check('pulled, then a coach nudge, still unanswered → still counts', () => assert.ok(withdrawnAcceptance({ conversation: [...meagan, { sender: 'Guy Wilson', text: 'Hi Meagan - here are a couple of new times.' }], coachName: COACH })));
check('a confirmation that offers the lead the door is not a pull-back', () => assert.strictEqual(withdrawnAcceptance({ conversation: [offer, accept, confirmed], coachName: COACH }), null));
check('lead answered after the pull-back → off (lead spoke last)', () => assert.strictEqual(withdrawnAcceptance({ conversation: [...meagan, { sender: LEAD, text: 'No worries!' }], coachName: COACH }), null));
check('lead never accepted a time (just a warm yes) → off', () => assert.strictEqual(withdrawnAcceptance({ conversation: [offer, { sender: LEAD, text: 'Thanks Guy, appreciate it' }, pulled], coachName: COACH }), null));
check('plain unanswered offer → off (that is stage 6b)', () => assert.strictEqual(withdrawnAcceptance({ conversation: [offer], coachName: COACH }), null));
check('group thread → off', () => assert.strictEqual(withdrawnAcceptance({ conversation: meagan, coachName: COACH, group: { participants: [] } }), null));
check('unattributable sender fails open', () => assert.strictEqual(withdrawnAcceptance({ conversation: [offer, { sender: 'Unknown', text: 'Wed 12pm works' }, pulled], coachName: COACH }), null));

console.log('leadBlamingLine');
for (const d of ['Hi Meagan - I know these things slip down the inbox, no stress.', 'Hi Meagan, just checking you saw my last note', "Hi Meagan - haven't heard back so here are some times"]) {
  check(`caught: ${JSON.stringify(d)}`, () => assert.ok(leadBlamingLine(d)));
}
for (const d of ["Hi Meagan - sorry again for moving our Wednesday. Here are a couple of fresh times.", '']) {
  check(`passes: ${JSON.stringify(d)}`, () => assert.strictEqual(leadBlamingLine(d), null));
}

console.log('summariseEventsForPanel');
const listResult = {
  ok: true, provider: 'google', timezone: 'Australia/Brisbane', startDate: '2026-08-20', endDate: '2026-10-19',
  events: [
    { start: '2026-09-10T00:00:00Z', end: '2026-09-10T00:30:00Z', summary: 'Guy / Meagan', attendees: [{ self: true, email: 'guy@x.com' }, { displayName: 'Meagan Smith', email: 'meagan@example.com' }] },
    { start: '2026-09-11T00:00:00Z', end: '2026-09-11T00:30:00Z', summary: 'Catch-up', attendees: [{ displayName: 'Meagan Jones', email: 'mj@other.com' }] },
    { start: '2026-09-12T00:00:00Z', end: '2026-09-12T00:30:00Z', summary: 'Chat', attendees: [{ email: 'meagan@example.com' }] },
  ],
};
check('matches this lead by name and by invite email, not a namesake', () => {
  const s = summariseEventsForPanel(listResult, { leadName: LEAD, leadEmail: 'meagan@example.com', now: Date.parse('2026-10-19T00:00:00Z') });
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.matches.length, 2, JSON.stringify(s.matches));
  assert.ok(s.matches.every((m) => m.past));
  assert.strictEqual(s.eventCount, 3);
});
check('nothing found → says which window was checked', () => {
  const s = summariseEventsForPanel({ ...listResult, events: [] }, { leadName: LEAD });
  assert.strictEqual(s.matches.length, 0);
  assert.ok(/2026-08-20 to 2026-10-19/.test(s.note));
});
check('provider error is passed through, not swallowed', () => assert.strictEqual(summariseEventsForPanel({ ok: false, error: 'boom' }).ok, false));
check('list_events is in the panel tool list', () => assert.ok(AGENT_TOOLS.some((t) => t.name === 'list_events')));

const coach = { clientId: 'Guy-Wilson', clientName: COACH, timezone: 'Australia/Brisbane' };
const owned = "Hi Meagan - sorry again for moving our Wednesday after you'd said yes. I'll send through a couple of fresh times shortly.\n\n(I know a) Guy";

(async () => {
  console.log('wired through runWingguyChatTurn');
  // The inbox-slip nudge is refused once with the owning-the-bump reason; the redraft lands.
  let sys = '';
  const seen = [];
  let call = 0;
  const client = { messages: { create: async (req) => {
    sys = (req.system || []).map((b) => b.text).join('\n');
    seen.push(req.messages[req.messages.length - 1]);
    call++;
    if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_message', input: { message: 'Hi Meagan - these things slip down the inbox, no stress. Here are a few times.' } }] };
    if (call === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'propose_message', input: { message: owned } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
  } } };
  try {
    const r = await runWingguyChatTurn({
      coach, profile: { name: LEAD }, conversation: meagan, leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client, getVariables: async () => [] },
    });
    check('context says she accepted and Guy pulled it', () => assert.ok(/ACCEPTED A TIME AND THE COACH PULLED IT/.test(sys) && /Wed 7th at 12pm/.test(sys)));
    check('context does not call it an unanswered offer', () => assert.ok(!/TIMES ALREADY OFFERED, NO ANSWER: the newest/.test(sys)));
    check('the inbox-slip nudge was refused with the reason', () => {
      const tr = seen[1].content.find((b) => b.type === 'tool_result');
      assert.ok(/REJECTED/.test(tr.content) && /ACCEPTED a time/.test(tr.content), tr.content);
    });
    check('the owning-the-bump redraft became the draft', () => assert.strictEqual(r.draft, owned));
  } catch (e) { failed++; console.log(`  ✗ withdrawn wired test threw: ${e.message}`); }

  // Times intro with the same wording is refused too (pull-back that carried fresh times).
  const seen2 = [];
  let call2 = 0;
  const timesClient = { messages: { create: async (req) => {
    seen2.push(req.messages[req.messages.length - 1]);
    call2++;
    if (call2 === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_times', input: { intro: 'Hi Meagan - no stress, in case one of these suits.', slotTimes: [] } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
  } } };
  try {
    await runWingguyChatTurn({
      coach, profile: { name: LEAD }, conversation: [offer, accept, pulledWithTimes], leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: timesClient, getVariables: async () => [] },
    });
    check('times intro that blames the lead was refused', () => {
      const tr = seen2[1].content.find((b) => b.type === 'tool_result');
      assert.ok(/REJECTED/.test(tr.content) && /ball is with the coach/.test(tr.content), tr.content);
    });
  } catch (e) { failed++; console.log(`  ✗ times wired test threw: ${e.message}`); }

  // list_events: "have I already met her?" reads the diary and returns the match.
  const seen3 = [];
  let call3 = 0;
  let listArgs = null;
  const listClient = { messages: { create: async (req) => {
    seen3.push(req.messages[req.messages.length - 1]);
    call3++;
    if (call3 === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'list_events', input: { date: '2026-08-20', end_date: '2026-10-19' } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Yes - 10 Sep.' }] };
  } } };
  try {
    await runWingguyChatTurn({
      coach, profile: { name: LEAD }, conversation: meagan, leadEmail: 'meagan@example.com',
      messages: [{ role: 'user', content: 'have I already met her?' }],
      deps: { client: listClient, getVariables: async () => [], listEventsForCoach: async (id, args) => { listArgs = { id, ...args }; return listResult; } },
    });
    check('list_events passed the window through to the calendar', () => assert.deepStrictEqual(listArgs, { id: 'Guy-Wilson', range: undefined, date: '2026-08-20', endDate: '2026-10-19' }));
    check('list_events result carries this lead\'s matches', () => {
      const tr = seen3[1].content.find((b) => b.type === 'tool_result');
      const r = JSON.parse(tr.content);
      assert.strictEqual(r.matches.length, 2, tr.content);
    });
  } catch (e) { failed++; console.log(`  ✗ list_events wired test threw: ${e.message}`); }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
