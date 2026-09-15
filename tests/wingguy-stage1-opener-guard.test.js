// Stage-1 opener guard: a lead who accepted and said nothing never gets "following on from my note".
// The stage is read from DATA (no lead message, no coach call-ask); the ban is enforced in
// propose_message, not asked for in prose. Run: node tests/wingguy-stage1-opener-guard.test.js

const assert = require('assert');
const {
  leadHasSpoken, coachHasAskedToMeet, bannedStage1Opener, isHandshakeOnly, runWingguyChatTurn,
} = require('../services/wingguyChat');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failed++; console.log(`  ✗ ${label}: ${e.message}`); }
};

const COACH = 'Guy Wilson';
const LEAD = 'Daniela Cavalletti';
const handshake = { sender: 'Guy Wilson', text: "Hi Daniela, I'm building a network of Fractional Professionals who only recommend others they trust. Looking at your profile - I think you'd be easy to recommend. (I know a) Guy", day: 'Sep 5' };
const realOpener = { sender: 'Guy Wilson', text: 'Hi Owen, Thanks for connecting. ... Worth a quick Zoom in the next couple of weeks? (I know a) Guy' };
const leadReply = { sender: 'Daniela Cavalletti', text: 'Thanks Guy, happy to chat.' };

console.log('leadHasSpoken');
check('handshake note only → lead has NOT spoken', () => assert.strictEqual(leadHasSpoken([handshake], COACH, LEAD), false));
check('empty thread → not spoken', () => assert.strictEqual(leadHasSpoken([], COACH, LEAD), false));
check('a reply from the lead → spoken', () => assert.strictEqual(leadHasSpoken([handshake, leadReply], COACH, LEAD), true));
check('first-name-only sender still matches the lead', () => assert.strictEqual(leadHasSpoken([{ sender: 'Daniela', text: 'hi' }], COACH, LEAD), true));
check('first-name-only sender still matches the coach', () => assert.strictEqual(leadHasSpoken([{ sender: 'Guy', text: 'hi' }], COACH, LEAD), false));
check('unattributable sender fails OPEN (counts as spoken)', () => assert.strictEqual(leadHasSpoken([{ sender: 'Unknown', text: 'hi' }], COACH, LEAD), true));
check('a named third party counts as spoken', () => assert.strictEqual(leadHasSpoken([{ sender: 'Paul Smith', text: 'meet Daniela' }], COACH, LEAD), true));

console.log('coachHasAskedToMeet');
check('handshake note has no call ask', () => assert.strictEqual(coachHasAskedToMeet([handshake], COACH), false));
check('the real opener has a Zoom ask', () => assert.strictEqual(coachHasAskedToMeet([realOpener], COACH), true));
check("the lead's own 'chat' is not the coach asking", () => assert.strictEqual(coachHasAskedToMeet([leadReply], COACH), false));

console.log('isHandshakeOnly (stage 1 by data)');
check('handshake only → stage 1', () => assert.strictEqual(isHandshakeOnly({ conversation: [handshake], coachName: COACH, leadName: LEAD }), true));
check('empty thread (profile-page /wg) → stage 1', () => assert.strictEqual(isHandshakeOnly({ conversation: [], coachName: COACH, leadName: LEAD }), true));
check('real opener sent, quiet → NOT stage 1 (a nudge is allowed)', () => assert.strictEqual(isHandshakeOnly({ conversation: [realOpener], coachName: COACH, leadName: 'Owen Blake' }), false));
check('lead replied → NOT stage 1', () => assert.strictEqual(isHandshakeOnly({ conversation: [handshake, leadReply], coachName: COACH, leadName: LEAD }), false));
check('group thread → guard off', () => assert.strictEqual(isHandshakeOnly({ conversation: [handshake], coachName: COACH, leadName: LEAD, group: { participants: [] } }), false));

console.log('bannedStage1Opener');
const daniela = 'Hi Daniela,\n\nFollowing on from my note - your background actually makes a lot of sense to me.\n\nWorth a quick Zoom in the next couple of weeks?\n\n(I know a) Guy';
const alix = 'Hi Alix,\n\nFollowing up properly on my note - building a 26-person org is easy to recommend.';
const dean = 'Hi Annette,Just floating this back in your feed in case it got buried - LinkedIn has a habit of doing that.';
const good = 'Hi Alix,\nThanks for connecting.\nBuilding a 26-person commercial org from scratch is easy to recommend because the result speaks before you have to.\nWorth a quick Zoom in the next couple of weeks?\n(I know a) Guy';
check('Daniela (15 Sep) is caught', () => assert.ok(/following on/i.test(bannedStage1Opener(daniela))));
check('Alix (21 Aug) is caught', () => assert.ok(/following up/i.test(bannedStage1Opener(alix))));
check("Dean's Annette send (9 Sep) is caught", () => assert.ok(/floating this|got buried/i.test(bannedStage1Opener(dean))));
check('"Thanks for connecting" opener passes', () => assert.strictEqual(bannedStage1Opener(good), null));
check('only the OPENING is judged - a late mention is not an opener', () => {
  const late = `${good}\n${'x '.repeat(200)}\nI mentioned this in my note.`;
  assert.strictEqual(bannedStage1Opener(late), null);
});
check('empty draft → null', () => assert.strictEqual(bannedStage1Opener(''), null));

// Wiring: a fake Claude that first proposes the banned opener, then - after reading the refusal -
// the good one. The turn must end with the GOOD draft, and the refusal must have reached the model.
console.log('propose_message guard, wired through runWingguyChatTurn');
(async () => {
  const seen = [];
  let call = 0;
  const fakeClient = { messages: { create: async (req) => {
    seen.push(req.messages[req.messages.length - 1]);
    call++;
    if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_message', input: { message: daniela } }] };
    if (call === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'propose_message', input: { message: good } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is the opener.' }] };
  } } };
  const coach = { clientId: 'Guy-Wilson', clientName: COACH, timezone: 'Australia/Brisbane' };
  try {
    const r = await runWingguyChatTurn({
      coach, profile: { name: LEAD }, conversation: [handshake], leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: fakeClient, getVariables: async () => [] },
    });
    check('turn succeeds', () => assert.strictEqual(r.ok, true));
    check('the banned draft was refused and the model saw why', () => {
      const tr = seen[1].content.find((b) => b.type === 'tool_result');
      assert.ok(/REJECTED/.test(tr.content) && /Following on/i.test(tr.content), tr.content);
    });
    check('the redraft became the draft', () => assert.strictEqual(r.draft, good));
    check('three model calls (propose, refused, redraft, done)', () => assert.strictEqual(call, 3));
  } catch (e) {
    failed++;
    console.log(`  ✗ wired test threw: ${e.message}`);
  }
  // Same thread but the lead HAS replied: the guard must stay out of the way.
  let call2 = 0;
  const nudgeClient = { messages: { create: async () => {
    call2++;
    if (call2 === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_message', input: { message: dean } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
  } } };
  try {
    const r2 = await runWingguyChatTurn({
      coach, profile: { name: 'Annette Eriksen' }, conversation: [realOpener], leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: nudgeClient, getVariables: async () => [] },
    });
    check('after the real opener went out, a buried-note nudge is allowed through', () => assert.strictEqual(r2.draft, dean));
  } catch (e) {
    failed++;
    console.log(`  ✗ stage-2 wired test threw: ${e.message}`);
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
