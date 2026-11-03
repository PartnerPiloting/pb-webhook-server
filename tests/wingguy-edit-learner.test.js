/**
 * Tests for the weekly learning-from-edits pass (services/wingguyEditLearner.js).
 *
 * Covers: whose key pays (own key, owner only on the platform key, never a managed client) · the
 * no-call gates (switched off, nothing new since last week, fewer than 3, no key) · the code checks
 * on what the model claims (3+ edits, 3+ people, any counter-edit kills it, locked / unknown /
 * hand-edited targets refused, at most two a week, no edit used twice) · the wording guard · the
 * client email · the whole pass with a fake store and fake Claude (dry run writes nothing; a live
 * run commits through propose -> commit, resolves the pairs, and the call count stays at two).
 * No database, no network. ⚠ Synthetic message content ONLY (public repo).
 *
 * Run: node tests/wingguy-edit-learner.test.js
 */
delete process.env.DATABASE_URL;
const assert = require('assert');
const L = require('../services/wingguyEditLearner');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const pair = (id, lead, generated = 'Hi Sam, great to connect. Kind regards, Pat', sent = 'Hi Sam, great to connect. Pat') => ({
  id, lead_name: lead, lead_url: `https://www.linkedin.com/in/${lead.toLowerCase()}`, surface: 'linkedin',
  generated, sent, created_at: new Date().toISOString(),
});
const fivePairs = [pair(5, 'Ava'), pair(4, 'Ben'), pair(3, 'Cy'), pair(2, 'Dee'), pair(1, 'Eve')];
const rules = [
  { rule_key: 'sign-off', layer: 'client', context: 'global', rule_type: 'voice', campaign: null, body: 'Sign off warmly.', version: 2 },
  { rule_key: 'no-pitch', layer: 'foundation', tier: 'locked', context: 'outreach', rule_type: 'stage-logic', campaign: null, body: 'Never pitch.', version: 1 },
  { rule_key: 'greeting', layer: 'foundation', tier: 'standard', context: 'global', rule_type: 'voice', campaign: null, body: 'Open with Hi and first name.', version: 3 },
];

(async () => {
  console.log('keys and scope');
  await check('own stored key is used', () => {
    assert.strictEqual(L.keyLane({ clientId: 'Some-Client', anthropicApiKey: 'sk-ant-x' }).lane, 'client-stored-key');
  });
  await check('owner falls back to the platform key', () => {
    assert.strictEqual(L.keyLane({ clientId: 'Guy-Wilson' }).lane, 'owner-platform');
  });
  await check('a managed client with no key of their own is NOT billed to the platform', () => {
    assert.strictEqual(L.keyLane({ clientId: 'Managed-One', managedClaudeKey: true }).lane, null);
  });
  await check('EDIT_LEARN=owner runs only the owner', () => {
    assert.strictEqual(L.inScope({ clientId: 'Guy-Wilson' }, 'owner'), true);
    assert.strictEqual(L.inScope({ clientId: 'Other' }, 'owner'), false);
    assert.strictEqual(L.inScope({ clientId: 'Other' }, 'on'), true);
    assert.strictEqual(L.inScope({ clientId: 'Guy-Wilson' }, 'off'), false);
  });

  console.log('no-call gates');
  const keyed = { clientId: 'C1', anthropicApiKey: 'sk-ant-x' };
  await check('switched off', () => assert.match(L.skipBeforeCall({ client: { ...keyed, stopLearningFromEdits: true }, pairs: fivePairs, lastPairId: 0 }), /switched off/));
  await check('nothing new since last week = no call', () => assert.match(L.skipBeforeCall({ client: keyed, pairs: fivePairs, lastPairId: 5 }), /no new edits/));
  await check('fewer than 3 waiting = no call', () => assert.match(L.skipBeforeCall({ client: keyed, pairs: fivePairs.slice(0, 2), lastPairId: 0 }), /only 2/));
  await check('no key of their own = no call', () => assert.match(L.skipBeforeCall({ client: { clientId: 'C1' }, pairs: fivePairs, lastPairId: 0 }), /no Claude key/));
  await check('one new edit among old ones is enough to look again', () => assert.strictEqual(L.skipBeforeCall({ client: keyed, pairs: fivePairs, lastPairId: 4 }), null));
  await check('old edits outside the window are not read', () => {
    const old = { ...pair(9, 'Old'), created_at: new Date(Date.now() - 90 * 86400000).toISOString() };
    assert.deepStrictEqual(L.selectPairs([old, ...fivePairs]).map((p) => p.id), [5, 4, 3, 2, 1]);
  });

  console.log('pattern checks');
  const pat = (o) => ({ noticed: 'You kept cutting "Kind regards".', pair_ids: [5, 4, 3], counter_pair_ids: [], target: { rule_key: 'sign-off', campaign: null }, ...o });
  await check('3 edits to 3 people, same direction, existing client rule -> accepted as an amend', () => {
    const r = L.checkPatterns([pat()], { pairs: fivePairs, rules });
    assert.strictEqual(r.accepted.length, 1);
    assert.strictEqual(r.accepted[0].target.ruleKey, 'sign-off');
    assert.strictEqual(r.accepted[0].target.isNew, false);
    assert.strictEqual(r.accepted[0].target.overStandard, false);
  });
  await check('only 2 edits -> refused', () => assert.strictEqual(L.checkPatterns([pat({ pair_ids: [5, 4] })], { pairs: fivePairs, rules }).accepted.length, 0));
  await check('made-up ids do not count', () => assert.strictEqual(L.checkPatterns([pat({ pair_ids: [5, 4, 99] })], { pairs: fivePairs, rules }).accepted.length, 0));
  await check('3 edits but all to the same person -> refused', () => {
    const same = [pair(3, 'Ava'), pair(2, 'Ava'), pair(1, 'Ava')];
    const r = L.checkPatterns([pat({ pair_ids: [3, 2, 1] })], { pairs: same, rules });
    assert.strictEqual(r.accepted.length, 0);
    assert.match(r.rejected[0].why, /different people/);
  });
  await check('one edit the other way kills the pattern', () => {
    const r = L.checkPatterns([pat({ counter_pair_ids: [2] })], { pairs: fivePairs, rules });
    assert.strictEqual(r.accepted.length, 0);
    assert.match(r.rejected[0].why, /other way/);
  });
  await check('a locked guardrail is never targeted', () => {
    const r = L.checkPatterns([pat({ target: { rule_key: 'no-pitch' } })], { pairs: fivePairs, rules });
    assert.match(r.rejected[0].why, /locked/);
  });
  await check('a standard shared instruction becomes the client\'s own version (override)', () => {
    const r = L.checkPatterns([pat({ target: { rule_key: 'greeting' } })], { pairs: fivePairs, rules });
    assert.strictEqual(r.accepted[0].target.overStandard, true);
  });
  await check('an instruction the client changed by hand this week is left alone', () => {
    const r = L.checkPatterns([pat()], { pairs: fivePairs, rules, recentHumanKeys: new Set(['sign-off']) });
    assert.match(r.rejected[0].why, /by hand/);
  });
  await check('a new instruction whose key already exists is refused (should have amended)', () => {
    const r = L.checkPatterns([pat({ target: null, new_rule: { rule_key: 'sign-off', context: 'global', rule_type: 'voice' } })], { pairs: fivePairs, rules });
    assert.match(r.rejected[0].why, /amended/);
  });
  await check('at most two changes a week, and no edit used twice', () => {
    const six = [...fivePairs, pair(6, 'Fay'), pair(7, 'Gus'), pair(8, 'Hal'), pair(9, 'Ivy')];
    const r = L.checkPatterns([
      pat(),
      pat({ pair_ids: [3, 2, 1], target: { rule_key: 'greeting' } }),
      pat({ pair_ids: [6, 7, 8], target: { rule_key: 'greeting' } }),
      pat({ pair_ids: [6, 7, 9], target: null, new_rule: { rule_key: 'questions', context: 'outreach', rule_type: 'formatting' } }),
    ], { pairs: six, rules });
    assert.strictEqual(r.accepted.length, 2);
    assert.match(r.rejected[0].why, /shares edits/);
  });

  console.log('wording and email');
  await check('an em dash in the new wording is refused', () => {
    assert.match(L.badWording({ body: 'Sign off — first name only.', instruction: 'x' }), /dash/);
    assert.strictEqual(L.badWording({ body: 'Sign off with first name only.', instruction: 'Sign off with just your first name.' }), null);
  });
  await check('the client email names the change and carries the undo link', () => {
    const m = L.clientEmail({ firstName: 'Pat', changes: [{ noticed: 'You kept cutting "Kind regards".', instruction: 'Sign off with just your first name.', undoToken: 'tok_abcdefghijklmnop' }] });
    assert.match(m.subject, /picked up something/);
    assert.match(m.text, /Hi Pat/);
    assert.match(m.text, /Sign off with just your first name/);
    assert.match(m.text, /undo-learned\?t=tok_abcdefghijklmnop/);
    assert.ok(!/[–—]/.test(m.text + m.html));
  });

  console.log('the whole pass (fake store, fake Claude)');
  const fakeLlm = (patterns, items) => {
    const calls = [];
    return {
      calls,
      messages: {
        create: async (req) => {
          calls.push(req);
          const json = calls.length === 1 ? { patterns } : { items };
          return { content: [{ type: 'text', text: JSON.stringify(json) }], usage: { input_tokens: 1000, output_tokens: 100 } };
        },
      },
    };
  };
  const fakeStore = () => {
    const log = [];
    return {
      log,
      getEditPairs: async () => fivePairs,
      getActiveRules: async () => rules,
      getHistory: async () => [],
      proposeRule: async (a) => { log.push(['propose', a.ruleKey, a.layer]); return { expectedVersion: 2, blocked: null }; },
      commitRule: async (a) => { log.push(['commit', a.ruleKey, a.createdBy, a.expectedVersion]); return { ruleKey: a.ruleKey, version: 3 }; },
      resolveEditPairs: async (a) => { log.push(['resolve', a.ids.join(',')]); return { resolved: a.ids.length }; },
    };
  };
  const goodItems = [{ index: 0, body: 'Sign off with just the first name.', instruction: 'Sign off with just your first name.', change_note: 'sign-off shortened' }];

  await check('dry run: both calls happen, nothing is written', async () => {
    const store = fakeStore();
    const llm = fakeLlm([pat()], goodItems);
    const r = await L.learnForClient(keyed, { dryRun: true, deps: { store, llm, skipSettle: true, lastPairId: 0 } });
    assert.strictEqual(llm.calls.length, 2);
    assert.strictEqual(r.changes.length, 1);
    assert.strictEqual(r.changes[0].dryRun, true);
    assert.strictEqual(r.changes[0].newBody, 'Sign off with just the first name.');
    assert.deepStrictEqual(store.log, []);
    assert.ok(r.usage.usd > 0);
  });
  await check('live: propose -> commit as auto-learn, pairs resolved', async () => {
    const store = fakeStore();
    const r = await L.learnForClient(keyed, { deps: { store, llm: fakeLlm([pat()], goodItems), skipSettle: true, lastPairId: 0 } });
    assert.strictEqual(r.changes.length, 1);
    assert.deepStrictEqual(store.log[0], ['propose', 'sign-off', 'client']);
    assert.deepStrictEqual(store.log[1], ['commit', 'sign-off', 'auto-learn:C1', 2]);
    assert.deepStrictEqual(store.log[2], ['resolve', '5,4,3']);
  });
  await check('no pattern = one call only, nothing written', async () => {
    const store = fakeStore();
    const llm = fakeLlm([], []);
    const r = await L.learnForClient(keyed, { deps: { store, llm, skipSettle: true, lastPairId: 0 } });
    assert.strictEqual(llm.calls.length, 1);
    assert.strictEqual(r.changes.length, 0);
    assert.deepStrictEqual(store.log, []);
  });
  await check('quiet week = zero calls', async () => {
    const llm = fakeLlm([pat()], goodItems);
    const r = await L.learnForClient(keyed, { deps: { store: fakeStore(), llm, skipSettle: true, lastPairId: 5 } });
    assert.strictEqual(llm.calls.length, 0);
    assert.match(r.skipped, /no new edits/);
  });
  await check('bad wording from the second call is not committed', async () => {
    const store = fakeStore();
    const r = await L.learnForClient(keyed, { deps: { store, llm: fakeLlm([pat()], [{ index: 0, body: '', instruction: '' }]), skipSettle: true, lastPairId: 0 } });
    assert.strictEqual(r.changes.length, 0);
    assert.ok(!store.log.some((x) => x[0] === 'commit'));
  });
  await check('the digest says who changed, who was skipped, and the cost', () => {
    const d = L.buildDigest([
      { clientName: 'Pat Client', changes: [{ ruleKey: 'sign-off', instruction: 'Sign off with just your first name.', pairIds: [1, 2, 3], people: 3 }], usage: { calls: 2, usd: 0.03 } },
      { clientName: 'Quiet One', changes: [], skipped: 'no new edits since last week', usage: { calls: 0, usd: 0 } },
    ], { date: '2026-11-08' });
    assert.match(d.text, /Pat Client/);
    assert.match(d.text, /Quiet One - no new edits/);
    assert.match(d.text, /Claude calls: 2, about US\$0\.03/);
  });

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
