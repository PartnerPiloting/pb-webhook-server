/**
 * Tests for the Wingguy rules MCP door (services/wingguyRulesMcp.js) — the TEXT the human and the
 * model actually read, not just the store underneath it.
 *
 * Focus: the three-kind model (fixed / standard / yours) and the per-client override build
 * (2026-07-31) — the listing's grouping, the "standard vs yours" divergence view, the refusal to
 * override a fixed instruction, and reset-to-standard. Uses the shared in-memory fake pool.
 * ⚠ Synthetic rule content ONLY (public repo — real rules are the moat and never land here).
 *
 * Run: node tests/wingguy-rules-door.test.js
 */
const assert = require('assert');
const store = require('../services/wingguyRulesStore');
const { FakeDb } = require('./helpers/wingguy-fake-db');
const { TOOL_DEFS, legacyToolCall } = require('../services/wingguyRulesMcp');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.stack || e.message}`); }
};

const TENANT = 'Door-Tenant';
const call = (tool, args = {}) => legacyToolCall(tool, args, TENANT);
const textOf = async (tool, args) => {
  const r = await call(tool, args);
  assert.ok(r, `tool "${tool}" is not registered on the door`);
  return r.content[0].text;
};

(async () => {
  const db = new FakeDb();
  store.__setTestPool(db);

  // --- Fixtures: one of each kind -------------------------------------------
  // FIXED shared guardrail.
  await store.commitRule({
    layer: 'foundation', ruleKey: 'always-draft-first', context: 'global', ruleType: 'stage-logic',
    body: 'Synthetic guardrail: never send, always draft.', tier: 'locked', createdBy: 'test', expectedVersion: 0,
  });
  // STANDARD shared instruction, left un-overridden.
  await store.commitRule({
    layer: 'foundation', ruleKey: 'no-em-dash', context: 'global', ruleType: 'formatting',
    body: 'Synthetic: use " - ", never an em dash.', createdBy: 'test', expectedVersion: 0,
  });
  // STANDARD shared instruction that this tenant overrides.
  await store.commitRule({
    layer: 'foundation', ruleKey: 'closing-question', context: 'reply', ruleType: 'voice',
    body: 'SHARED closing question, synthetic v1.', createdBy: 'test', expectedVersion: 0,
  });
  await store.commitRule({
    layer: 'client', tenantId: TENANT, ruleKey: 'closing-question', context: 'reply', ruleType: 'voice',
    body: 'MY closing question, synthetic.', createdBy: 'test', expectedVersion: 0,
  });
  // Theirs alone.
  await store.commitRule({
    layer: 'client', tenantId: TENANT, ruleKey: 'my-signoff', context: 'global', ruleType: 'voice',
    body: 'Synthetic: sign off warmly.', createdBy: 'test', expectedVersion: 0,
  });

  console.log('the door exposes the new tools:');
  await check('wingguy_rule_reset_to_standard is registered on both transports', () => {
    const def = TOOL_DEFS.find((d) => d.name === 'wingguy_rule_reset_to_standard');
    assert.ok(def, 'tool missing from TOOL_DEFS');
    assert.ok(def.zodSchema && def.jsonSchema, 'both transports need a schema');
    assert.deepStrictEqual(def.jsonSchema.required, ['rule_key']);
  });
  await check('wingguy_rules_list accepts the divergence view on both transports', () => {
    const def = TOOL_DEFS.find((d) => d.name === 'wingguy_rules_list');
    assert.deepStrictEqual(def.jsonSchema.properties.view.enum, ['active', 'divergence']);
    assert.ok(def.zodSchema.view, 'zod schema needs the view param too');
  });
  await check('propose and commit both accept a tier', () => {
    for (const name of ['wingguy_rule_propose', 'wingguy_rule_commit']) {
      const def = TOOL_DEFS.find((d) => d.name === name);
      assert.deepStrictEqual(def.jsonSchema.properties.tier.enum, store.TIERS, `${name} tier enum`);
    }
  });

  console.log('wingguy_rules_list — grouped by the three kinds, showing what actually applies:');
  await check('groups instructions as FIXED / STANDARD / YOURS', async () => {
    const t = await textOf('wingguy_rules_list');
    assert.ok(t.includes('FIXED (1)'), 'the guardrail is grouped as FIXED');
    assert.ok(t.includes('STANDARD (1)'), 'only the UN-overridden standard is still standard');
    assert.ok(t.includes('YOURS (replaces the standard) (1)'), 'the override is called out as replacing');
    assert.ok(t.includes('YOURS (1)'), 'their own-alone rule is plain YOURS');
  });
  await check('the overridden standard is NOT listed as still applying', async () => {
    const t = await textOf('wingguy_rules_list');
    // 'closing-question' must appear exactly once — as theirs, not twice as both.
    assert.strictEqual((t.match(/closing-question/g) || []).length, 1, 'the shadowed standard must not be listed too');
    assert.ok(t.includes('layer=client'), 'and the surviving copy is theirs');
  });
  await check('points at the divergence view when there are overrides', async () => {
    const t = await textOf('wingguy_rules_list');
    assert.ok(/1 standard instruction has a version of your own/.test(t), t.slice(-400));
    assert.ok(t.includes('view=divergence'));
  });
  await check('an explicit layer filter still shows that drawer raw', async () => {
    const t = await textOf('wingguy_rules_list', { layer: 'foundation' });
    assert.ok(t.includes('raw - no shadowing applied'));
    assert.ok(t.includes('closing-question'), 'the shared version is visible when inspecting the layer');
  });

  console.log('wingguy_rules_list view=divergence — "what have I changed?":');
  await check('lists the override with BOTH bodies, and nothing else', async () => {
    const t = await textOf('wingguy_rules_list', { view: 'divergence' });
    assert.ok(t.includes('MY closing question'), 'their version');
    assert.ok(t.includes('SHARED closing question'), 'the current standard');
    // Theirs-alone rules get a one-line footer mention, never a side-by-side entry (there is no
    // standard to put beside them).
    assert.ok(!t.includes('━━ my-signoff'), 'a rule that is theirs alone is not a divergence entry');
    assert.ok(t.includes('Also yours alone'), 'but it is still accounted for');
    assert.ok(!t.includes('no-em-dash'), 'an un-overridden standard is not a divergence');
  });
  await check('says the standard has NOT moved when it has not', async () => {
    const t = await textOf('wingguy_rules_list', { view: 'divergence' });
    assert.ok(t.includes('has not changed since you took your own version'));
  });
  await check('flags drift, names the change, and offers the reset', async () => {
    await store.commitRule({
      layer: 'foundation', ruleKey: 'closing-question', context: 'reply', ruleType: 'voice',
      body: 'SHARED closing question, synthetic v2.', changeNote: 'sharper ask',
      createdBy: 'test', expectedVersion: 1,
    });
    const t = await textOf('wingguy_rules_list', { view: 'divergence' });
    assert.ok(t.includes('THE STANDARD HAS MOVED'), 'drift is surfaced');
    assert.ok(t.includes('sharper ask'), 'with the reason it moved');
    assert.ok(t.includes('synthetic v2'), 'and what it now says');
    assert.ok(t.includes('Your version is untouched'), 'reassures nothing was lost');
    assert.ok(t.includes('wingguy_rule_reset_to_standard'), 'offers the way back');
  });

  console.log('overriding a FIXED instruction is refused at the door:');
  await check('propose refuses, explains, and shows the fixed body', async () => {
    const r = await call('wingguy_rule_propose', {
      rule_key: 'always-draft-first', layer: 'client', context: 'global', rule_type: 'stage-logic',
      body: 'My own take on the guardrail.',
    });
    assert.strictEqual(r.isError, true, 'must come back as an error');
    assert.ok(r.content[0].text.includes('CANNOT CHANGE THIS ONE'));
    assert.ok(r.content[0].text.includes('never send, always draft'), 'shows what the guardrail says');
    assert.ok(r.content[0].text.includes('Do NOT try wingguy_rule_commit'));
  });
  await check('commit refuses too — the guard is at the write-door, not just the prompt', async () => {
    const r = await call('wingguy_rule_commit', {
      rule_key: 'always-draft-first', layer: 'client', context: 'global', rule_type: 'stage-logic',
      body: 'My own take on the guardrail.', expected_version: 0,
    });
    assert.strictEqual(r.isError, true);
    assert.ok(/LOCKED/.test(r.content[0].text));
  });

  console.log('proposing an override of a STANDARD instruction:');
  await check('names it as an override and prints the standard being replaced', async () => {
    const t = await textOf('wingguy_rule_propose', {
      rule_key: 'no-em-dash', layer: 'client', context: 'global', rule_type: 'formatting',
      body: 'Synthetic: I actually want em dashes.',
    });
    assert.ok(t.includes('THIS IS AN OVERRIDE'));
    assert.ok(t.includes('never an em dash'), 'the standard body is shown for comparison');
    assert.ok(t.includes('should be improved instead'), 'nudges toward improving the shared one');
    assert.ok(!t.includes('two bodies will reach the model'), 'the old stacking warning is gone');
  });
  await check('a foundation change warns about tenants who will not receive it', async () => {
    const t = await textOf('wingguy_rule_propose', {
      rule_key: 'closing-question', layer: 'foundation', context: 'reply', rule_type: 'voice',
      body: 'SHARED closing question, synthetic v3.',
    });
    assert.ok(t.includes('will NOT receive this change'), t.slice(0, 600));
    assert.ok(t.includes(TENANT), 'names who');
  });

  console.log('wingguy_rule_get — says which kind an instruction is:');
  await check('a fixed instruction says so', async () => {
    const t = await textOf('wingguy_rule_get', { rule_key: 'always-draft-first', layer: 'foundation' });
    assert.ok(t.includes('foundation/locked'));
    assert.ok(t.includes('This is a FIXED instruction'));
  });
  await check('the client\'s own version names the standard behind it', async () => {
    const t = await textOf('wingguy_rule_get', { rule_key: 'closing-question', layer: 'client' });
    assert.ok(t.includes('This is YOUR version of a STANDARD instruction'));
    assert.ok(t.includes('you branched from v1'), 'and the baseline it diverged at');
  });

  console.log('wingguy_rule_reset_to_standard:');
  await check('resets, shows what now applies, and says nothing was deleted', async () => {
    const t = await textOf('wingguy_rule_reset_to_standard', { rule_key: 'closing-question' });
    assert.ok(t.includes('is archived, and the shared standard applies again'));
    assert.ok(t.includes('synthetic v2'), 'prints the standard that now applies');
    assert.ok(t.includes('Nothing was deleted'));
    const block = await store.renderRulesBlock({ tenantId: TENANT, contexts: ['reply'] });
    assert.ok(block.text.includes('synthetic v2'), 'and it really took effect');
    assert.ok(!block.text.includes('MY closing question'));
  });
  await check('divergence is empty once the only override is reset', async () => {
    const t = await textOf('wingguy_rules_list', { view: 'divergence' });
    assert.ok(t.includes('has not changed any of the standard instructions'));
    assert.ok(t.includes('my-signoff'), 'but still mentions what is theirs alone');
  });
  await check('resetting something that is theirs alone is refused', async () => {
    const r = await call('wingguy_rule_reset_to_standard', { rule_key: 'my-signoff' });
    assert.strictEqual(r.isError, true);
    assert.ok(/yours alone/.test(r.content[0].text));
  });

  store.__setTestPool(null);
  console.log(failures ? `\n❌ ${failures} door test(s) failed` : '\n✅ all wingguy-rules-door tests passed');
  process.exit(failures ? 1 : 0);
})();
