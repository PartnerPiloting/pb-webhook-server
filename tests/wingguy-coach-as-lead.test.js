// A client drafting to a lead who is NOT them - even when that lead is Guy (Matthew Bulat, 2026-09-28).
// Two failures on his first /wg run, on Guy Wilson's profile:
//   1. the capture saved Matthew's OWN email onto Guy's record (it sat inside one of Guy's messages), and
//   2. the draft came out "Hi Matthew" in Guy's voice - the rulebook calls the coach "Guy" throughout.
// Fixes under test: the own-email guard (utils/coachOwnEmails + wingguyLeads) and the WHO IS WHO line +
// wrong-way greeting guard (wingguyChat). Run: node tests/wingguy-coach-as-lead.test.js

const assert = require('assert');
const { coachOwnEmails, isCoachOwnEmail } = require('../utils/coachOwnEmails');
const { updateLeadEmails } = require('../services/wingguyLeads');
const { whoIsWhoBlock, wrongWayGreeting, buildContext, runWingguyChatTurn } = require('../services/wingguyChat');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failed++; console.log(`  ✗ ${label}: ${e.message}`); }
};

const MATTHEW = {
  clientId: 'Matthew-Bulat', clientName: 'Matthew Bulat', timezone: 'Australia/Brisbane',
  clientEmailAddress: 'matthew@expertaiprompts.com', googleCalendarEmail: 'Matthew.Bulat@gmail.com',
  rawRecord: { get: (f) => (f === 'Alternative Email Addresses' ? 'm.bulat@consultancydd.com; ' : '') },
};

(async () => {
  console.log('coachOwnEmails');
  check('collects every self address, lower-cased', () => assert.deepStrictEqual(
    [...coachOwnEmails(MATTHEW)].sort(),
    ['m.bulat@consultancydd.com', 'matthew.bulat@gmail.com', 'matthew@expertaiprompts.com']));
  check('matches regardless of case and spaces', () => assert.ok(isCoachOwnEmail(MATTHEW, '  MATTHEW.BULAT@gmail.com ')));
  check("a lead's address is not self", () => assert.strictEqual(isCoachOwnEmail(MATTHEW, 'guyralphwilson@gmail.com'), false));
  check('no rawRecord still works', () => assert.ok(isCoachOwnEmail({ clientEmailAddress: 'a@b.com' }, 'a@b.com')));
  check('no coach is an empty set, never a throw', () => assert.strictEqual(coachOwnEmails(null).size, 0));

  console.log('updateLeadEmails refuses the coach\'s own address');
  const own = coachOwnEmails(MATTHEW);
  // The refusal happens before any Airtable read, so a fake base id is enough here.
  const r = await updateLeadEmails('appFAKEFAKEFAKE12', 'recFAKEFAKEFAKE12', { setPrimary: 'matthew.bulat@gmail.com', ownEmails: own });
  check('own primary -> ok:false, nothing written', () => assert.strictEqual(r.ok, false));
  check('the reason names it as the coach\'s own', () => assert.ok(/OWN email/.test(r.error), r.error));

  console.log('WHO IS WHO line');
  const w = whoIsWhoBlock('Matthew Bulat', 'Guy Wilson');
  check('names the sender and the recipient', () => assert.ok(/AS Matthew Bulat/.test(w) && /the lead, Guy Wilson/.test(w), w));
  check('maps "Guy" in the rulebook onto the coach', () => assert.ok(/they mean the coach, Matthew/.test(w), w));
  check('warns when the lead is ALSO called Guy', () => assert.ok(/called Guy as well/.test(w) && /never open "Hi Matthew"/.test(w), w));
  check('no Guy-lead warning for an ordinary lead', () => assert.ok(!/as well/.test(whoIsWhoBlock('Matthew Bulat', 'Raymond Lee'))));
  check('Guy as coach: no remapping line at all', () => assert.ok(!/they mean the coach/.test(whoIsWhoBlock('Guy Wilson', 'Guy Smith'))));
  check('buildContext leads with it', () => {
    const ctx = buildContext({ coachName: 'Matthew Bulat', leadName: 'Guy Wilson', prefs: {} });
    assert.ok(/helping Matthew with this lead/.test(ctx), 'header still says Guy');
    assert.ok(ctx.indexOf('WHO IS WHO') < ctx.indexOf('COACH NAME'), 'WHO IS WHO must come first');
  });

  console.log('wrongWayGreeting');
  check('"Hi Matthew," from Matthew to Guy is caught', () => assert.strictEqual(wrongWayGreeting('Hi Matthew,\n\nThanks for...', 'Matthew Bulat', 'Guy Wilson'), 'Hi Matthew,'));
  check('"Great, Matthew -" is caught', () => assert.ok(wrongWayGreeting('Great, Matthew - thanks', 'Matthew Bulat', 'Guy Wilson')));
  check('"Hi Guy," passes', () => assert.strictEqual(wrongWayGreeting('Hi Guy,\n\nThanks for...', 'Matthew Bulat', 'Guy Wilson'), null));
  check('the coach\'s name lower down passes', () => assert.strictEqual(wrongWayGreeting('Hi Guy,\nMatthew here again - quick one.', 'Matthew Bulat', 'Guy Wilson'), null));
  check('a lead who shares the coach\'s first name passes', () => assert.strictEqual(wrongWayGreeting('Hi Matthew,', 'Matthew Bulat', 'Matthew Armour'), null));
  check('"Hi Guy, Matthew here" passes (lead named in the greeting)', () => assert.strictEqual(wrongWayGreeting('Hi Guy, Matthew here', 'Matthew Bulat', 'Guy Wilson'), null));
  check('no greeting at all passes', () => assert.strictEqual(wrongWayGreeting('Thanks for connecting.', 'Matthew Bulat', 'Guy Wilson'), null));

  console.log('propose_message refuses a wrong-way draft, wired through runWingguyChatTurn');
  const backwards = 'Hi Matthew,\n\nGood to see Council-Light coming together.\n\n(I know a) Guy';
  const right = 'Hi Guy,\n\nThanks for today - the machine is on its way.\n\nRegards, Matthew';
  const seen = [];
  let call = 0;
  const fakeClient = { messages: { create: async (req) => {
    seen.push({ system: req.system, last: req.messages[req.messages.length - 1] });
    call++;
    if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_message', input: { message: backwards } }] };
    if (call === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'propose_message', input: { message: right } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] };
  } } };
  try {
    const t = await runWingguyChatTurn({
      coach: MATTHEW,
      profile: { name: 'Guy Wilson' },
      conversation: [
        { sender: 'Guy Wilson', text: 'Great to meet you Matthew. Send it to matthew@expertaiprompts.com?' },
        { sender: 'Matthew Bulat', text: 'Yes please Guy.' },
      ],
      leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: fakeClient, getVariables: async () => [] },
    });
    check('the model was told who is who', () => {
      const sys = seen[0].system.map((b) => b.text).join('\n');
      assert.ok(/WHO IS WHO: every draft is written AS Matthew Bulat/.test(sys));
    });
    check('the backwards draft was refused and the model saw why', () => {
      const tr = seen[1].last.content.find((b) => b.type === 'tool_result');
      assert.ok(/REJECTED/.test(tr.content) && /SENDER/.test(tr.content), tr.content);
    });
    check('the redraft became the draft', () => assert.strictEqual(t.draft, right));
  } catch (e) {
    failed++;
    console.log(`  ✗ wired test threw: ${e.message}`);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
