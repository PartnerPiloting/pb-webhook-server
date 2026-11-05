/**
 * Banned words are enforced in code, and "never use X again" lands on the list (6 Nov 2026).
 *
 * David Gould, 5 Nov 2026: a draft to Barrie East used "folks". His banned-words box was empty -
 * the ban had gone into the wording of a voice instruction - and nothing checked the draft.
 *
 * Contracts:
 *   1. Every client's REAL list text parses to plain words; descriptions and headings are left out.
 *   2. A list under headings (one per business) enforces only what is under every heading.
 *   3. Matching is whole-word, any capitalisation; a word in the lead's own name/company is allowed.
 *   4. Adding keeps what is there and never duplicates; removing takes out only that word.
 *   5. propose_message refuses a draft with a banned word, the model sees why, the redraft lands.
 *   6. propose_times refuses a banned word in its intro.
 *   7. At most two refusals a turn - a list that fights the client's own wording cannot loop.
 *   8. No list = no check, and the other guards behave as before.
 *   9. The wingguy_banned_words tool adds, removes and reports, and is offered in the /wg window.
 *
 * Run: node tests/wingguy-banned-words.test.js
 */
const assert = require('assert');
const { parseBannedList, findBannedWord, addToList, removeFromList } = require('../utils/bannedWords');
const { runWingguyChatTurn, AGENT_TOOLS } = require('../services/wingguyChat');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failed++; console.log(`  ✗ ${label}: ${e.message}`); }
};

console.log('parseBannedList - the real lists, as clients typed them');
check('a plain comma list, trailing comma and all', () => assert.deepStrictEqual(parseBannedList('folks, reach out,'), ['folks', 'reach out']));
check('one per line with bullets and quotes', () => assert.deepStrictEqual(parseBannedList('- "folks"\n- \'flick\'\n* reach out.'), ['folks', 'flick', 'reach out']));
check('Roland: descriptions and a sentence are left out, words kept', () => {
  const roland = 'no em dashes, banned list: \n- words like leverage, holistic, game-changer, empower, unlock, transformative \n- "In today\'s fast-paced environment..."\n- "At the end of the day" \n- Any sentence that could have been written by a LinkedIn ghostwriter who has never met Roland';
  assert.deepStrictEqual(parseBannedList(roland), ['holistic', 'game-changer', 'empower', 'unlock', 'transformative', "In today's fast-paced environment", 'At the end of the day']);
});
check('Matthew: a conditional ban ("secured" or "delivered" for modelled figures) is not enforced', () => {
  const m = 'visionary, 10x, "prompting wrong", "limited spots", and "secured" or "delivered" for modelled figures';
  assert.deepStrictEqual(parseBannedList(m), ['visionary', '10x', 'prompting wrong', 'limited spots']);
});
check('Sam: two businesses under headings - only the words under BOTH are enforced', () => {
  const sam = 'FindMe First:\nreach out, folks, solutions, robust\n\nBarclays:\nreach out, folks, collaborate, collaboration, partnership';
  assert.deepStrictEqual(parseBannedList(sam), ['reach out', 'folks']);
});
check('one heading only is just a list', () => assert.deepStrictEqual(parseBannedList('My list:\nfolks, flick'), ['folks', 'flick']));
check('empty, null and junk give an empty list', () => {
  assert.deepStrictEqual(parseBannedList(''), []);
  assert.deepStrictEqual(parseBannedList(null), []);
  assert.deepStrictEqual(parseBannedList(' , ; \n'), []);
});
check('duplicates collapse, first spelling kept', () => assert.deepStrictEqual(parseBannedList('Folks, folks, FOLKS'), ['Folks']));

console.log('findBannedWord');
const terms = ['folks', 'reach out', 'honest', "don’t hesitate"];
check('the Barrie East line is caught', () => {
  const hit = findBannedWord('Hi Barrie, good to see the folks at your end are still at it.', terms);
  assert.deepStrictEqual(hit, { term: 'folks', found: 'folks' });
});
check('any capitalisation, start of a sentence', () => assert.strictEqual(findBannedWord('Folks, quick one.', terms).found, 'Folks'));
check('a phrase across a line break', () => assert.strictEqual(findBannedWord('Happy to reach\nout next week.', terms).term, 'reach out'));
check('whole words only: folksy, honestly, outreach pass', () => {
  assert.strictEqual(findBannedWord('A folksy, honestly put note about outreach.', terms), null);
});
check('straight and curly apostrophes are the same word', () => assert.ok(findBannedWord("Please don't hesitate.", terms)));
check('a clean draft passes', () => assert.strictEqual(findBannedWord('Hi Barrie, I am sorry I let it slide after 2018.', terms), null));
check('a word in the lead\'s own company is allowed', () => {
  assert.strictEqual(findBannedWord('How are things at Honest Burgers?', terms, { exempt: 'Barrie East\nFounder at Honest Burgers' }), null);
  assert.ok(findBannedWord('To be honest, I let it slide.', terms, { exempt: 'Barrie East\nFounder at Acme' }));
});
check('no list, no text = no hit', () => {
  assert.strictEqual(findBannedWord('folks', []), null);
  assert.strictEqual(findBannedWord('', terms), null);
});

console.log('addToList / removeFromList');
check('adding to an empty list', () => assert.deepStrictEqual(addToList('', ['folks', 'flick']), { value: 'folks, flick', added: ['folks', 'flick'], already: [] }));
check('adding keeps what is there, trailing comma tidied', () => {
  const r = addToList('folks, reach out,', ['synergy']);
  assert.strictEqual(r.value, 'folks, reach out, synergy');
});
check('a word already there is not added twice', () => {
  const r = addToList('folks, reach out', ['Folks', '"flick"']);
  assert.strictEqual(r.value, 'folks, reach out, flick');
  assert.deepStrictEqual(r.already, ['Folks']);
  assert.deepStrictEqual(r.added, ['flick']);
});
check('adding to a headed list leaves the headings alone', () => {
  const r = addToList('FindMe First:\nreach out, folks\n\nBarclays:\nreach out', ['flick']);
  assert.ok(r.value.startsWith('FindMe First:\nreach out, folks\n\nBarclays:\nreach out'), r.value);
  assert.ok(r.value.endsWith(', flick'), r.value);
});
check('removing takes out only that word', () => {
  assert.strictEqual(removeFromList('folks, reach out, flick', ['reach out']).value, 'folks, flick');
  assert.strictEqual(removeFromList('folks, reach out, flick', ['folks']).value, 'reach out, flick');
  assert.strictEqual(removeFromList('folks, reach out, flick', ['FLICK']).value, 'folks, reach out');
  assert.strictEqual(removeFromList('folks', ['folks']).value, '');
});
check('removing a word that is not there says so and changes nothing', () => {
  const r = removeFromList('folks, flick', ['synergy']);
  assert.strictEqual(r.value, 'folks, flick');
  assert.deepStrictEqual(r.missing, ['synergy']);
});
check('removing "folk" does not eat "folks"', () => assert.strictEqual(removeFromList('folks, flick', ['folk']).value, 'folks, flick'));

console.log('the /wg window is offered the banned-words tool');
check('wingguy_banned_words is in the panel tool list', () => assert.ok(AGENT_TOOLS.some((t) => t.name === 'wingguy_banned_words')));

const COACH = { clientId: 'David-Gould', clientName: 'David Gould', timezone: 'Australia/Brisbane' };
const thread = [
  { sender: 'David Gould', text: 'Hi Barrie, would you be up for a coffee?', day: 'Jan 5, 2018' },
  { sender: 'Barrie East', text: 'Interstate on an assignment for a couple of months.', day: 'Jan 8, 2018' },
];
const withFolks = 'Hi Barrie,\n\nI am sorry I let it slide after your January 2018 note. I have been introducing a few folks to each other lately and thought of you.\n\nDavid';
const clean = 'Hi Barrie,\n\nI am sorry I let it slide after your January 2018 note. I have been introducing a few people to each other lately and thought of you.\n\nDavid';
const vars = (value) => async () => [{ var_key: 'never_say_words', value }];

(async () => {
  console.log('propose_message, wired through runWingguyChatTurn');
  try {
    const seen = [];
    let call = 0;
    const fake = { messages: { create: async (req) => {
      seen.push(req.messages[req.messages.length - 1]);
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_message', input: { message: withFolks } }] };
      if (call === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'propose_message', input: { message: clean } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is the reconnect.' }] };
    } } };
    const r = await runWingguyChatTurn({
      coach: COACH, profile: { name: 'Barrie East' }, conversation: thread, leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: fake, getVariables: vars('folks, flick') },
    });
    check('turn succeeds', () => assert.strictEqual(r.ok, true));
    check('the draft with "folks" was refused and the model saw why', () => {
      const tr = seen[1].content.find((b) => b.type === 'tool_result');
      assert.ok(/REJECTED/.test(tr.content) && /It uses .{1,2}folks/.test(tr.content) && /banned-words list/.test(tr.content), tr.content);
    });
    check('the clean redraft became the draft', () => assert.strictEqual(r.draft, clean));
    check('three model calls', () => assert.strictEqual(call, 3));
  } catch (e) { failed++; console.log(`  ✗ wired test threw: ${e.message}`); }

  console.log('a list that cannot be satisfied stops after two refusals');
  try {
    let call = 0;
    const stubborn = { messages: { create: async () => {
      call++;
      if (call <= 3) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${call}`, name: 'propose_message', input: { message: withFolks } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
    } } };
    const r = await runWingguyChatTurn({
      coach: COACH, profile: { name: 'Barrie East' }, conversation: thread, leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: stubborn, getVariables: vars('folks') },
    });
    check('third attempt is let through (two refusals, never a loop)', () => assert.strictEqual(r.draft, withFolks));
    check('four model calls', () => assert.strictEqual(call, 4));
  } catch (e) { failed++; console.log(`  ✗ cap test threw: ${e.message}`); }

  console.log('no list = no check');
  try {
    let call = 0;
    const once = { messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_message', input: { message: withFolks } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
    } } };
    const r = await runWingguyChatTurn({
      coach: COACH, profile: { name: 'Barrie East' }, conversation: thread, leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: once, getVariables: async () => [] },
    });
    check('an empty list lets the draft through untouched', () => assert.strictEqual(r.draft, withFolks));
    const r2 = await runWingguyChatTurn({
      coach: COACH, profile: { name: 'Barrie East' }, conversation: thread, leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: { messages: { create: (() => { let c = 0; return async () => (++c === 1 ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_message', input: { message: withFolks } }] } : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }); })() } }, getVariables: async () => { throw new Error('db down'); } },
    });
    check('a failed list read never blocks a draft', () => assert.strictEqual(r2.draft, withFolks));
  } catch (e) { failed++; console.log(`  ✗ no-list test threw: ${e.message}`); }

  console.log('a banned word in the lead\'s own company is allowed');
  try {
    let call = 0;
    const msg = 'Hi Barrie,\n\nI am sorry I let it slide after 2018. How are things at Good Folks Consulting?\n\nDavid';
    const one = { messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_message', input: { message: msg } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
    } } };
    const r = await runWingguyChatTurn({
      coach: COACH, profile: { name: 'Barrie East', headline: 'Director at Good Folks Consulting' }, conversation: thread, leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: one, getVariables: vars('folks') },
    });
    check('not refused', () => assert.strictEqual(r.draft, msg));
  } catch (e) { failed++; console.log(`  ✗ exempt test threw: ${e.message}`); }

  console.log('wingguy_banned_words tool');
  try {
    const store = require('../services/wingguyRulesStore');
    const rules = require('../services/wingguyRulesMcp');
    const saved = { value: 'reach out,' };
    const writes = [];
    const realGet = store.getVariables;
    const realSet = store.setVariable;
    store.getVariables = async () => [{ var_key: 'never_say_words', value: saved.value }];
    store.setVariable = async (a) => { writes.push(a); saved.value = a.value; return { ok: true }; };
    try {
      const def = rules.TOOL_DEFS.find((d) => d.name === 'wingguy_banned_words');
      check('the tool exists and its description claims "never use ... again"', () => {
        assert.ok(def);
        assert.ok(/never use folks again/i.test(def.description));
      });
      check('the instruction door points banned words here', () => {
        const propose = rules.TOOL_DEFS.find((d) => d.name === 'wingguy_rule_propose');
        assert.ok(/wingguy_banned_words/.test(propose.description));
      });
      const added = await def.run({ add: ['folks', 'Flick', 'reach out'] }, 'David-Gould');
      check('add appends and keeps what was there', () => assert.strictEqual(saved.value, 'reach out, folks, Flick'));
      check('add writes once, to this tenant, as never_say_words', () => {
        assert.strictEqual(writes.length, 1);
        assert.strictEqual(writes[0].tenantId, 'David-Gould');
        assert.strictEqual(writes[0].varKey, 'never_say_words');
      });
      check('the reply says what was added and what was already there', () => {
        assert.ok(/Added: "folks", "Flick"/.test(added.text), added.text);
        assert.ok(/Already on the list: "reach out"/.test(added.text), added.text);
        assert.ok(/checked in code: "reach out", "folks", "Flick"/.test(added.text), added.text);
      });
      const listed = await def.run({}, 'David-Gould');
      check('listing writes nothing', () => { assert.strictEqual(writes.length, 1); assert.ok(/"folks"/.test(listed.text)); });
      await def.run({ remove: ['reach out'] }, 'David-Gould');
      check('remove takes out only that word', () => assert.strictEqual(saved.value, 'folks, Flick'));
      await def.run({ add: ['folks'] }, 'David-Gould');
      check('adding a word already there writes nothing', () => assert.strictEqual(writes.length, 2));
      const viaString = await def.run({ add: 'synergy, leverage' }, 'David-Gould');
      check('a comma string is accepted as well as a list', () => { assert.strictEqual(saved.value, 'folks, Flick, synergy, leverage'); assert.ok(/Added/.test(viaString.text)); });
    } finally {
      store.getVariables = realGet;
      store.setVariable = realSet;
    }
  } catch (e) { failed++; console.log(`  ✗ tool test threw: ${e.message}`); }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
