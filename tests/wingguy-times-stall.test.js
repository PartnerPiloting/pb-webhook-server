// Times offered, no answer (Anton Yuan, 2026-10-06): he said yes, Guy offered times, Anton went quiet -
// and three weeks later the panel drafted "Great, Anton - let's lock something in" as if he had just
// replied. Who spoke last is read from DATA, named in the context, and a reply-style opener is refused
// once when the coach spoke last. Run: node tests/wingguy-times-stall.test.js

const assert = require('assert');
const {
  coachSpokeLast, unansweredTimesOffer, replyStyleOpener, runWingguyChatTurn,
} = require('../services/wingguyChat');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failed++; console.log(`  ✗ ${label}: ${e.message}`); }
};

const COACH = 'Guy Wilson';
const LEAD = 'Anton Yuan';
const handshake = { sender: 'Guy Wilson', day: 'Sep 15', text: "Hi Anton, I'm building a network of Fractional Professionals who only recommend others they trust. (I know a) Guy" };
const yes = { sender: 'Anton Yuan', day: 'Sep 15', text: "Sure let's do it" };
const offer = { sender: 'Guy Wilson', day: 'Sep 15', text: 'Perfect, Anton.\n\nWould any of the following times work for you?\n\n- Tue 22 September, 11:30 am\n- Thu 24 September, 10:00 am\n\n(all times are Sydney time)\n\n(I know a) Guy' };
const anton = [handshake, yes, offer];

console.log('coachSpokeLast / unansweredTimesOffer');
check('Anton thread: times offered, unanswered', () => assert.deepStrictEqual(unansweredTimesOffer({ conversation: anton, coachName: COACH }), { day: 'Sep 15' }));
check('lead answered the offer → no stall', () => assert.strictEqual(unansweredTimesOffer({ conversation: [...anton, { sender: LEAD, text: 'Thursday works' }], coachName: COACH }), null));
check('lead just said yes (no offer yet) → no stall, lead spoke last', () => {
  assert.strictEqual(unansweredTimesOffer({ conversation: [handshake, yes], coachName: COACH }), null);
  assert.strictEqual(coachSpokeLast({ conversation: [handshake, yes], coachName: COACH }), false);
});
check('offer then a coach nudge, still unanswered → stall', () => assert.ok(unansweredTimesOffer({ conversation: [...anton, { sender: 'Guy Wilson', text: 'Hi Anton - any of those suit?' }], coachName: COACH })));
check('an offer from BEFORE the lead last spoke does not count', () => assert.strictEqual(unansweredTimesOffer({ conversation: [handshake, offer, yes, { sender: 'Guy', text: 'Great, see you then' }], coachName: COACH }), null));
check('handshake only → coach spoke last, but no times', () => {
  assert.strictEqual(coachSpokeLast({ conversation: [handshake], coachName: COACH }), true);
  assert.strictEqual(unansweredTimesOffer({ conversation: [handshake], coachName: COACH }), null);
});
check('unattributable last sender fails open', () => assert.strictEqual(coachSpokeLast({ conversation: [handshake, { sender: 'Unknown', text: 'x' }], coachName: COACH }), false));
check('group thread → off', () => assert.strictEqual(coachSpokeLast({ conversation: anton, coachName: COACH, group: { participants: [] } }), false));
check('empty thread → false', () => assert.strictEqual(coachSpokeLast({ conversation: [], coachName: COACH }), false));

console.log('replyStyleOpener');
const caught = ["Great, Anton - let's lock something in.", 'Perfect, Anton.', 'Thanks, Anton - appreciate it', 'Hi Anton,\nPerfect - here are a few times', 'Hi Anton, great - here they are'];
const passed = ['Hi Anton - I know how fast these slip down the inbox, so no stress at all.', 'Hi Anton,\nThanks for connecting.', 'Thanks for connecting, Anton.', 'Hi Anton,\nGreat to see your post on AI enablement.', ''];
for (const d of caught) check(`caught: ${JSON.stringify(d.split('\n').join(' / '))}`, () => assert.ok(replyStyleOpener(d, LEAD)));
for (const d of passed) check(`passes: ${JSON.stringify(d.split('\n').join(' / '))}`, () => assert.strictEqual(replyStyleOpener(d, LEAD), null));

const coach = { clientId: 'Guy-Wilson', clientName: COACH, timezone: 'Australia/Sydney' };
const nudge = 'Hi Anton - I know how fast these slip down the inbox, so no stress at all. Here are a few fresh times in case one suits.';

(async () => {
  console.log('wired through runWingguyChatTurn');
  // propose_times with the reply opener → refused, context carries the stall line.
  let sys = '';
  const seen = [];
  let call = 0;
  const timesClient = { messages: { create: async (req) => {
    sys = (req.system || []).map((b) => b.text).join('\n');
    seen.push(req.messages[req.messages.length - 1]);
    call++;
    if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_times', input: { intro: "Great, Anton - let's lock something in.", outro: '', slotTimes: [] } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
  } } };
  try {
    await runWingguyChatTurn({
      coach, profile: { name: LEAD }, conversation: anton, leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: timesClient, getVariables: async () => [] },
    });
    check('context names the unanswered offer', () => assert.ok(/TIMES ALREADY OFFERED, NO ANSWER/.test(sys) && /\(Sep 15\)/.test(sys)));
    check('the reply-style times intro was refused with the re-offer reason', () => {
      const tr = seen[1].content.find((b) => b.type === 'tool_result');
      assert.ok(/REJECTED/.test(tr.content) && /RE-OFFER/.test(tr.content), tr.content);
    });
  } catch (e) { failed++; console.log(`  ✗ times wired test threw: ${e.message}`); }

  // propose_message: refused once, the redraft lands.
  let call2 = 0;
  const msgClient = { messages: { create: async () => {
    call2++;
    if (call2 === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_message', input: { message: 'Perfect, Anton - shall we find a time?' } }] };
    if (call2 === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'propose_message', input: { message: nudge } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
  } } };
  try {
    const r = await runWingguyChatTurn({
      coach, profile: { name: LEAD }, conversation: anton, leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: msgClient, getVariables: async () => [] },
    });
    check('redraft became the draft', () => assert.strictEqual(r.draft, nudge));
  } catch (e) { failed++; console.log(`  ✗ message wired test threw: ${e.message}`); }

  // Lead spoke last: "Great, Anton" is exactly right and must pass untouched.
  let call3 = 0;
  const replyDraft = "Great, Anton - glad you're up for it.";
  let sys3 = '';
  const replyClient = { messages: { create: async (req) => {
    sys3 = (req.system || []).map((b) => b.text).join('\n');
    call3++;
    if (call3 === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_message', input: { message: replyDraft } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
  } } };
  try {
    const r = await runWingguyChatTurn({
      coach, profile: { name: LEAD }, conversation: [handshake, yes], leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: replyClient, getVariables: async () => [] },
    });
    check('lead spoke last → reply opener allowed', () => assert.strictEqual(r.draft, replyDraft));
    check('lead spoke last → no stall line in context', () => assert.ok(!/TIMES ALREADY OFFERED, NO ANSWER: the newest|NOTE: the newest message/.test(sys3)));
  } catch (e) { failed++; console.log(`  ✗ reply wired test threw: ${e.message}`); }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
