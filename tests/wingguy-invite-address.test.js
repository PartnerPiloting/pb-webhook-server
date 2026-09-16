/**
 * Guard for THE INVITE ADDRESS IS PART OF THE OFFER (Guy's call, 2026-09-16, off the Marina Garbuio
 * draft).
 *
 * The problem Guy named: a booking often stalls because there is no email for the lead, or the one on
 * file is wrong. The old instructions sent Wingguy to GUY when the address was missing ("ask Guy to add
 * it before booking") — a dead end, because if the address were findable Guy would already have it. The
 * only person who has it is the lead, and Wingguy is already writing them a message.
 *
 * Timing is the whole point: the ask belongs on the OFFER-TIMES turn. Once the lead picks a slot the
 * invite goes out as the reply (invite-before-promise, 2026-07-27), so there is no turn left to go
 * hunting for an address without a second, awkward message in front of a prospect.
 *
 * This is instruction-only — no logic changed — so what a test can hold is the two things the model is
 * handed every turn: the per-turn context line, and the shared agent-instruction block. Both live in
 * code that every tenant reads (WINGGUY_AGENT_INSTRUCTIONS is passed in BOTH rules-source modes), so
 * these assertions are what stops the wording being quietly reverted to the dead end.
 *
 * Run: node tests/wingguy-invite-address.test.js
 */
const assert = require('assert');
const { buildContext } = require('../services/wingguyChat');
const { WINGGUY_AGENT_INSTRUCTIONS } = require('../config/wingguyTemplates');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const ctx = (leadEmail) => buildContext({
  profileBlock: 'Name: Marina Garbuio',
  convoBlock: '',
  leadEmail,
  coachName: 'Guy Wilson',
  prefs: {},
  campaignTemplate: null,
  voice: { greetWithFirstName: true, signoff: '(I know a) Guy', name: 'Guy' },
});

console.log('\nInvite address at the offer turn:');

check('no email on file → the context sends Wingguy to the LEAD, not to Guy', () => {
  const text = ctx('');
  assert.ok(/ask the LEAD/i.test(text), 'expected the not-on-file line to point at the lead');
  assert.ok(/do NOT ask Guy/i.test(text), 'expected the not-on-file line to rule Guy out explicitly');
  assert.ok(!/ask Guy to add it/i.test(text), 'the old dead-end wording is back');
});

check('no email on file → the context says what to do with the answer', () => {
  assert.ok(/update_lead_email/.test(ctx('')), 'expected the file-it-then-book step');
});

check('email on file → the address is carried AND flagged to be named in the message', () => {
  const text = ctx('marina@example.com');
  assert.ok(text.includes('marina@example.com'), 'expected the on-file address in context');
  assert.ok(/name this address in the message/i.test(text), 'expected the name-it instruction');
});

check('the shared agent instructions carry the offer-turn rule', () => {
  assert.ok(/THE INVITE ADDRESS IS PART OF THE OFFER/.test(WINGGUY_AGENT_INSTRUCTIONS),
    'the instruction block is missing the invite-address paragraph');
  assert.ok(/NOT ON FILE[\s\S]{0,400}ASK THE LEAD/.test(WINGGUY_AGENT_INSTRUCTIONS),
    'expected the not-on-file branch to say ask the lead');
  assert.ok(/ON FILE - NAME THE ADDRESS/.test(WINGGUY_AGENT_INSTRUCTIONS),
    'expected the on-file branch to say name the address');
});

check('BOOKING DETAILS no longer tells Wingguy to ask Guy for a missing address', () => {
  assert.ok(!/ask Guy to add it rather than guessing/.test(WINGGUY_AGENT_INSTRUCTIONS),
    'the old dead-end clause is still in BOOKING DETAILS and will fight the new rule');
});

check('the example wording uses house dashes, never an em dash', () => {
  const para = (WINGGUY_AGENT_INSTRUCTIONS.split('THE INVITE ADDRESS IS PART OF THE OFFER')[1] || '').split('\n\n')[0];
  assert.ok(para.length > 0, 'could not isolate the paragraph');
  assert.ok(!para.includes('—'), 'em dash in the invite-address wording - the model copies these examples');
});

console.log(failures ? `\n${failures} FAILED\n` : '\nAll passed\n');
process.exit(failures ? 1 : 0);
