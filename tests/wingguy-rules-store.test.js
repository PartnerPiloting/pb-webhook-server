/**
 * Tests for the Wingguy rules store + write-door (convergence roadmap step 1).
 *
 * Covers: taxonomy validation · append-only version bumping · expected-version (structural
 * conflict) rejection · {{variable}}/{{asset:key}} resolution · foundation ∪ client merge ·
 * revert-as-new-version · retire. Uses an injected in-memory fake pool — no real database.
 * ⚠ Synthetic rule content ONLY (public repo — real rules are the moat and never land here).
 *
 * Run: node tests/wingguy-rules-store.test.js
 */
const assert = require('assert');
const store = require('../services/wingguyRulesStore');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

// In-memory fake pool (shared with tests/wingguy-rules-door.test.js) — emulates just the
// SQL shapes the store issues.
const { FakeDb } = require('./helpers/wingguy-fake-db');

(async () => {
  // --- Pure core: taxonomy validation --------------------------------------
  console.log('validateRuleInput() — taxonomy + layer/tenant pairing:');
  await check('accepts a valid client rule', () =>
    store.validateRuleInput({ layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'greeting-style', context: 'outreach', ruleType: 'voice' }));
  await check('rejects an unknown layer', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'shared', tenantId: '', ruleKey: 'x-rule', context: 'outreach', ruleType: 'voice' }), /invalid layer/));
  await check('rejects an unknown context', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'foundation', via: 'internal', ruleKey: 'x-rule', context: 'linkedin', ruleType: 'voice' }), /invalid context/));
  await check('rejects an unknown rule_type', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'foundation', via: 'internal', ruleKey: 'x-rule', context: 'outreach', ruleType: 'tone' }), /invalid rule_type/));
  await check('rejects a client rule without tenant_id', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'client', ruleKey: 'x-rule', context: 'outreach', ruleType: 'voice' }), /requires a tenant_id/));
  await check('rejects a foundation rule WITH tenant_id', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'foundation', via: 'internal', tenantId: 'T', ruleKey: 'x-rule', context: 'outreach', ruleType: 'voice' }), /tenant-less/));
  await check('rejects a non-slug rule_key', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'foundation', via: 'internal', ruleKey: 'Not A Slug!', context: 'outreach', ruleType: 'voice' }), /rule_key/));

  // --- Pure core: variable/asset resolution --------------------------------
  console.log('resolveRuleBody() — {{variable}} and {{asset:key}}:');
  const vars = { coach_first_name: 'Alex', signoff: 'Cheers' };
  const assets = { 'intro-deck': { url: 'https://example.com/deck', status: 'active' } };
  await check('substitutes variables', () => {
    const { text } = store.resolveRuleBody('Greet as {{coach_first_name}}, sign "{{signoff}}"', vars, assets);
    assert.strictEqual(text, 'Greet as Alex, sign "Cheers"');
  });
  await check('substitutes asset URLs', () => {
    const { text } = store.resolveRuleBody('Link {{asset:intro-deck}} when asked', vars, assets);
    assert.strictEqual(text, 'Link https://example.com/deck when asked');
  });
  await check('reports unresolved placeholders without dropping them', () => {
    const { text, unresolved } = store.resolveRuleBody('Use {{missing_var}} and {{asset:missing-deck}}', vars, assets);
    assert.ok(text.includes('{{missing_var}}'));
    assert.deepStrictEqual(unresolved, ['missing_var', 'asset:missing-deck']);
  });
  await check('a retired asset counts as unresolved', () => {
    const { unresolved } = store.resolveRuleBody('{{asset:old-deck}}', {}, { 'old-deck': { url: 'x', status: 'retired' } });
    assert.deepStrictEqual(unresolved, ['asset:old-deck']);
  });
  await check('a syntax-documentation mention is literal, not an unresolved placeholder', () => {
    const { text, unresolved } = store.resolveRuleBody(
      'The ledger gates library LINKS ({{asset:key}} rows); {{variable}} is the generic form.', vars, assets);
    assert.ok(text.includes('{{asset:key}}'));
    assert.ok(text.includes('{{variable}}'));
    assert.deepStrictEqual(unresolved, []);
  });
  await check('a real asset next to a syntax mention still resolves', () => {
    const { text, unresolved } = store.resolveRuleBody('{{asset:key}} rows like {{asset:intro-deck}}', vars, assets);
    assert.strictEqual(text, '{{asset:key}} rows like https://example.com/deck');
    assert.deepStrictEqual(unresolved, []);
  });

  // --- Write-door on the fake pool ------------------------------------------
  const db = new FakeDb();
  store.__setTestPool(db);

  console.log('commitRule() — append-only versioning + structural conflict check:');
  await check('creates v1 for a new rule (expectedVersion 0)', async () => {
    const r = await store.commitRule({
      layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'greeting-style', context: 'outreach', ruleType: 'voice',
      body: 'Open with the first name. Synthetic test rule.', changeNote: 'initial', createdBy: 'test', expectedVersion: 0,
    });
    assert.strictEqual(r.version, 1);
  });
  await check('edit inserts v2 and retires v1 (no UPDATE of body, no DELETE)', async () => {
    const r = await store.commitRule({
      layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'greeting-style', context: 'outreach', ruleType: 'voice',
      body: 'Open with the first name, warmly. Synthetic v2.', changeNote: 'warmer', createdBy: 'test', expectedVersion: 1,
    });
    assert.strictEqual(r.version, 2);
    const all = db.rules.filter((x) => x.rule_key === 'greeting-style');
    assert.strictEqual(all.length, 2, 'both versions still exist');
    assert.strictEqual(all.find((x) => x.version === 1).status, 'retired');
    assert.strictEqual(all.find((x) => x.version === 2).status, 'active');
  });
  await check('stale expectedVersion is REJECTED (the conflict check)', async () => {
    await assert.rejects(
      store.commitRule({
        layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'greeting-style', context: 'outreach', ruleType: 'voice',
        body: 'Based on stale v1.', createdBy: 'test', expectedVersion: 1,
      }),
      /version conflict/,
    );
    assert.strictEqual(db.rules.filter((x) => x.rule_key === 'greeting-style').length, 2, 'nothing was inserted');
  });
  await check('missing expectedVersion is rejected (must propose first)', async () => {
    await assert.rejects(
      store.commitRule({
        layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'greeting-style', context: 'outreach', ruleType: 'voice',
        body: 'No expectation.', createdBy: 'test',
      }),
      /expectedVersion is required/,
    );
  });
  await check('history rows were written for each commit', () => {
    assert.ok(db.history.length >= 2);
  });

  console.log('foundation ∪ client merge:');
  await store.commitRule({
    layer: 'foundation', via: 'internal', ruleKey: 'no-em-dash', context: 'global', ruleType: 'formatting',
    body: 'Use " - ", never an em dash. Synthetic.', createdBy: 'test', expectedVersion: 0,
  });
  await store.commitRule({
    layer: 'client', tenantId: 'Other-Tenant', ruleKey: 'other-greeting', context: 'outreach', ruleType: 'voice',
    body: 'Other tenant private rule.', createdBy: 'test', expectedVersion: 0,
  });
  await store.commitRule({
    layer: 'template', via: 'internal', ruleKey: 'template-only-rule', context: 'outreach', ruleType: 'voice',
    body: 'Template seed rule — must NOT be runtime-read.', createdBy: 'test', expectedVersion: 0,
  });
  await check('getActiveRules = foundation + own client rules only', async () => {
    const rules = await store.getActiveRules({ tenantId: 'Test-Tenant' });
    const keys = rules.map((r) => r.rule_key).sort();
    assert.deepStrictEqual(keys, ['greeting-style', 'no-em-dash']);
  });
  await check('another tenant sees foundation + THEIR rules, not Test-Tenant\'s', async () => {
    const rules = await store.getActiveRules({ tenantId: 'Other-Tenant' });
    const keys = rules.map((r) => r.rule_key).sort();
    assert.deepStrictEqual(keys, ['no-em-dash', 'other-greeting']);
  });
  await check('template layer is NOT runtime-read (only via explicit layer filter)', async () => {
    const templ = await store.getActiveRules({ layer: 'template' });
    assert.deepStrictEqual(templ.map((r) => r.rule_key), ['template-only-rule']);
  });

  console.log('renderRulesBlock() — the step-2 seam:');
  await store.setVariable({ tenantId: 'Test-Tenant', varKey: 'coach_first_name', value: 'Alex', actor: 'test' });
  await store.commitRule({
    layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'signoff-line', context: 'outreach', ruleType: 'voice',
    body: 'Sign off as {{coach_first_name}}. Synthetic.', createdBy: 'test', expectedVersion: 0,
  });
  await check('renders grouped, variable-resolved text', async () => {
    const block = await store.renderRulesBlock({ tenantId: 'Test-Tenant', contexts: ['outreach'] });
    assert.ok(block.text.includes('## global'), 'global section present');
    assert.ok(block.text.includes('## outreach'), 'outreach section present');
    assert.ok(block.text.includes('Sign off as Alex.'), 'variable resolved');
    assert.ok(!block.text.includes('Template seed'), 'template layer not rendered');
    assert.deepStrictEqual(block.unresolved, []);
  });
  await check('campaign-tagged rules only render for their campaign', async () => {
    await store.commitRule({
      layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'tks-specific', context: 'outreach', ruleType: 'stage-logic',
      campaign: 'tks', body: 'Campaign-only synthetic rule.', createdBy: 'test', expectedVersion: 0,
    });
    const noCampaign = await store.renderRulesBlock({ tenantId: 'Test-Tenant', contexts: ['outreach'] });
    assert.ok(!noCampaign.text.includes('Campaign-only'), 'hidden without the campaign');
    const withCampaign = await store.renderRulesBlock({ tenantId: 'Test-Tenant', contexts: ['outreach'], campaign: 'tks' });
    assert.ok(withCampaign.text.includes('Campaign-only'), 'shown for its campaign');
  });

  console.log('campaign overlay — same rule_key, campaign version shadows the generic:');
  await check('a generic and a campaign version of the SAME rule_key coexist (separate chains)', async () => {
    await store.commitRule({
      layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'post-connect-message', context: 'outreach', ruleType: 'stage-logic',
      body: 'GENERIC synthetic post-connect message rule.', createdBy: 'test', expectedVersion: 0,
    });
    await store.commitRule({
      layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'post-connect-message', context: 'outreach', ruleType: 'stage-logic',
      campaign: 'frac', body: 'FRAC-OVERLAY synthetic post-connect message rule.', createdBy: 'test', expectedVersion: 0,
    });
    const generic = await store.getRule({ tenantId: 'Test-Tenant', layer: 'client', ruleKey: 'post-connect-message' });
    const overlay = await store.getRule({ tenantId: 'Test-Tenant', layer: 'client', ruleKey: 'post-connect-message', campaign: 'frac' });
    assert.ok(generic.active.body.includes('GENERIC'), 'generic chain intact');
    assert.ok(overlay.active.body.includes('FRAC-OVERLAY'), 'campaign chain intact');
    assert.strictEqual(generic.active.version, 1);
    assert.strictEqual(overlay.active.version, 1);
  });
  await check('render with the campaign: overlay SHADOWS the generic (not both)', async () => {
    const block = await store.renderRulesBlock({ tenantId: 'Test-Tenant', contexts: ['outreach'], campaign: 'frac' });
    assert.ok(block.text.includes('FRAC-OVERLAY'), 'campaign version rendered');
    assert.ok(!block.text.includes('GENERIC synthetic'), 'generic version shadowed');
  });
  await check('render without the campaign: falls through to the generic', async () => {
    const block = await store.renderRulesBlock({ tenantId: 'Test-Tenant', contexts: ['outreach'] });
    assert.ok(block.text.includes('GENERIC synthetic'), 'generic rendered');
    assert.ok(!block.text.includes('FRAC-OVERLAY'), 'overlay not rendered');
  });
  await check('render with a DIFFERENT campaign: also falls through to the generic', async () => {
    const block = await store.renderRulesBlock({ tenantId: 'Test-Tenant', contexts: ['outreach'], campaign: 'tks' });
    assert.ok(block.text.includes('GENERIC synthetic'), 'generic rendered for the other campaign');
    assert.ok(!block.text.includes('FRAC-OVERLAY'), 'frac overlay not rendered');
  });
  await check('the chains version independently (editing the overlay leaves the generic at v1)', async () => {
    await store.commitRule({
      layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'post-connect-message', context: 'outreach', ruleType: 'stage-logic',
      campaign: 'frac', body: 'FRAC-OVERLAY v2 synthetic.', createdBy: 'test', expectedVersion: 1,
    });
    const generic = await store.getRule({ tenantId: 'Test-Tenant', layer: 'client', ruleKey: 'post-connect-message' });
    const overlay = await store.getRule({ tenantId: 'Test-Tenant', layer: 'client', ruleKey: 'post-connect-message', campaign: 'frac' });
    assert.strictEqual(generic.active.version, 1, 'generic untouched');
    assert.strictEqual(overlay.active.version, 2, 'overlay bumped');
  });
  await check('proposing a campaign overlay surfaces the generic version as a neighbour', async () => {
    const prop = await store.proposeRule({
      layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'post-connect-message', context: 'outreach', ruleType: 'stage-logic',
      campaign: 'frac', body: 'FRAC-OVERLAY v3 proposal.',
    });
    assert.strictEqual(prop.expectedVersion, 2, 'expected_version is the OVERLAY chain\'s');
    assert.ok(
      prop.neighbours.some((n) => n.rule_key === 'post-connect-message' && !n.campaign),
      'the generic sibling shows up for the eyeball check',
    );
  });

  console.log('proposeRule() — pure read with neighbours:');
  await check('propose is a pure read (no rows added) and carries expected_version', async () => {
    const before = db.rules.length;
    const prop = await store.proposeRule({
      layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'greeting-style', context: 'outreach', ruleType: 'voice',
      body: 'Proposed v3 body.',
    });
    assert.strictEqual(db.rules.length, before, 'no insert happened');
    assert.strictEqual(prop.expectedVersion, 2);
    assert.strictEqual(prop.isNew, false);
    assert.ok(prop.neighbours.some((n) => n.rule_key === 'signoff-line'), 'same context+type neighbour surfaced');
  });

  // --- The conflict check's blind spots (all three found live, 2026-07-17) ----------------
  console.log('proposeRule() — the conflict check must not hide the conflicts it exists to catch:');
  await check('a foundation rule with the SAME key is NOT filtered out as "this chain"', async () => {
    // The bug: the exclusion matched rule_key+campaign but not layer, so the cross-layer twin -
    // the exact collision worth catching - was hidden. Identity = layer|tenant|key|campaign.
    // (Uses its own key: a same-key twin makes any layer-blind lookup ambiguous, including the
    // fixtures' own - which is the whole point of the finding.)
    await store.commitRule({
      layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'twin-key', context: 'outreach', ruleType: 'voice',
      body: 'CLIENT twin rule.', createdBy: 'test', expectedVersion: 0,
    });
    await store.commitRule({
      layer: 'foundation', via: 'internal', ruleKey: 'twin-key', context: 'outreach', ruleType: 'voice',
      body: 'FOUNDATION twin rule (platform-wide).', createdBy: 'test', expectedVersion: 0,
    });
    const prop = await store.proposeRule({
      layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'twin-key', context: 'outreach', ruleType: 'voice',
      body: 'Client twin v2.',
    });
    assert.strictEqual(prop.expectedVersion, 1, 'still versions its OWN (client) chain');
    const twin = [...prop.neighbours, ...prop.sameKeyElsewhere]
      .find((n) => n.rule_key === 'twin-key' && n.layer === 'foundation');
    assert.ok(twin, 'the foundation twin of the same key must surface');
  });
  await check('a foundation proposal SEES the caller tenant\'s client rules (they render together)', async () => {
    // Two bugs here: foundation proposals only queried the foundation layer, AND the caller's
    // tenant is blanked for a foundation rule - so the read must carry the CALLER's tenant.
    const prop = await store.proposeRule({
      layer: 'foundation', via: 'internal', readerTenantId: 'Test-Tenant', ruleKey: 'brand-new-foundation-rule', context: 'outreach', ruleType: 'voice',
      body: 'A new platform-wide voice rule.',
    });
    assert.ok(
      prop.neighbours.some((n) => n.layer === 'client'),
      'foundation proposals were blind to the client rules they render beside',
    );
  });
  await check('a rule filed in ANOTHER context surfaces via sameTypeElsewhere', async () => {
    // The live miss: a global/stage-logic rule overrode follow-up/stage-logic rules, and the
    // same-cell-only check reported "no neighbours" - true, and useless.
    const prop = await store.proposeRule({
      layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'no-repeat-set-pieces', context: 'global', ruleType: 'stage-logic',
      body: 'Never repeat a set piece already in the written record.',
    });
    assert.strictEqual(prop.neighbours.length, 0, 'nothing else in global/stage-logic (as before)');
    assert.ok(
      prop.sameTypeElsewhere.some((n) => n.rule_type === 'stage-logic' && n.context !== 'global'),
      'stage-logic rules filed in other contexts must still surface',
    );
  });

  console.log('revertRule() + retireRule():');
  await check('revert inserts a NEW version copying the old body', async () => {
    const r = await store.revertRule({ layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'greeting-style', toVersion: 1, createdBy: 'test' });
    assert.strictEqual(r.version, 3);
    const active = db.rules.find((x) => x.rule_key === 'greeting-style' && x.status === 'active');
    assert.ok(active.body.includes('Synthetic test rule'), 'v3 body = v1 body');
  });
  await check('retire flips status without deleting; stale version rejected', async () => {
    // tks-specific lives on the 'tks' campaign chain — retiring it must name the campaign
    // (identity = layer + tenant + rule_key + campaign).
    await assert.rejects(
      store.retireRule({ layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'tks-specific', campaign: 'tks', expectedVersion: 9, createdBy: 'test' }),
      /version conflict/,
    );
    const ok = await store.retireRule({ layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'tks-specific', campaign: 'tks', expectedVersion: 1, createdBy: 'test' });
    assert.strictEqual(ok.ok, true);
    const rows = db.rules.filter((x) => x.rule_key === 'tks-specific');
    assert.strictEqual(rows.length, 1, 'row not deleted');
    assert.strictEqual(rows[0].status, 'retired');
  });

  // -------------------------------------------------------------------------
  // Three tiers + per-client overrides ("standard vs yours", 2026-07-31)
  // -------------------------------------------------------------------------
  console.log('resolveRuleShadowing() — pure cross-layer + campaign resolution:');
  const F = (key, extra = {}) => ({ rule_key: key, layer: 'foundation', via: 'internal', tenant_id: null, context: 'global', rule_type: 'voice', campaign: null, version: 1, body: `FOUNDATION ${key}`, ...extra });
  const C = (key, extra = {}) => ({ rule_key: key, layer: 'client', tenant_id: 'T', context: 'global', rule_type: 'voice', campaign: null, version: 1, body: `CLIENT ${key}`, ...extra });

  await check('a client rule REPLACES a standard foundation rule (does not stack)', () => {
    const { rules, dropped } = store.resolveRuleShadowing([F('greeting', { tier: 'standard' }), C('greeting')]);
    assert.strictEqual(rules.length, 1, 'exactly one body survives');
    assert.strictEqual(rules[0].layer, 'client');
    assert.strictEqual(dropped[0].reason, 'override');
    assert.strictEqual(dropped[0].rule.layer, 'foundation');
  });
  await check('an UNSET tier behaves as standard (overridable)', () => {
    const { rules } = store.resolveRuleShadowing([F('greeting', { tier: null }), C('greeting')]);
    assert.strictEqual(rules[0].layer, 'client');
  });
  await check('a LOCKED foundation rule WINS — the client copy is suppressed', () => {
    const { rules, dropped } = store.resolveRuleShadowing([F('bcc-discipline', { tier: 'locked' }), C('bcc-discipline')]);
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].layer, 'foundation', 'the guardrail is what renders');
    assert.strictEqual(dropped[0].reason, 'locked');
    assert.strictEqual(dropped[0].rule.layer, 'client', 'the client copy is the one dropped');
  });
  await check('non-colliding rules from both layers all survive', () => {
    const { rules } = store.resolveRuleShadowing([F('a'), C('b'), F('c', { tier: 'locked' })]);
    assert.deepStrictEqual(rules.map((r) => r.rule_key).sort(), ['a', 'b', 'c']);
  });
  await check('campaign overlay resolves BEFORE cross-layer (client campaign beats standard)', () => {
    const { rules } = store.resolveRuleShadowing(
      [F('x', { tier: 'standard' }), C('x'), C('x', { campaign: 'frac', body: 'CLIENT x frac' })],
      { campaign: 'frac' },
    );
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].body, 'CLIENT x frac');
  });
  await check('a client rule tagged for ANOTHER campaign does not shadow the standard', () => {
    const { rules } = store.resolveRuleShadowing(
      [F('x', { tier: 'standard' }), C('x', { campaign: 'frac', body: 'CLIENT x frac' })],
      { campaign: 'tks' },
    );
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].layer, 'foundation', 'the standard shows through');
  });

  console.log('the write-door refuses to override a FIXED instruction:');
  const TT = 'Tier-Tenant';
  await store.commitRule({
    layer: 'foundation', via: 'internal', ruleKey: 'locked-guardrail', context: 'global', ruleType: 'formatting',
    body: 'Synthetic guardrail body.', tier: 'locked', createdBy: 'test', expectedVersion: 0,
  });
  await check('commitRule rejects a client version of a locked rule', async () => {
    await assert.rejects(
      store.commitRule({
        layer: 'client', tenantId: TT, ruleKey: 'locked-guardrail', context: 'global', ruleType: 'formatting',
        body: 'My own take on the guardrail.', createdBy: 'test', expectedVersion: 0,
      }),
      /LOCKED/,
    );
    assert.ok(!db.rules.some((r) => r.rule_key === 'locked-guardrail' && r.layer === 'client'), 'nothing was inserted');
  });
  await check('proposeRule reports it as blocked rather than walking the human into a refusal', async () => {
    const prop = await store.proposeRule({
      layer: 'client', tenantId: TT, ruleKey: 'locked-guardrail', context: 'global', ruleType: 'formatting',
      body: 'My own take on the guardrail.',
    });
    assert.strictEqual(prop.blocked?.reason, 'locked');
    assert.strictEqual(prop.isOverride, false);
    assert.ok(prop.standard.body.includes('Synthetic guardrail'), 'the fixed body comes back for display');
  });
  await check('tier is STICKY — editing a locked rule\'s wording does not unlock it', async () => {
    const r = await store.commitRule({
      layer: 'foundation', via: 'internal', ruleKey: 'locked-guardrail', context: 'global', ruleType: 'formatting',
      body: 'Synthetic guardrail body, reworded.', createdBy: 'test', expectedVersion: 1,
    });
    assert.strictEqual(r.tier, 'locked');
  });
  await check('tier is rejected on a non-foundation layer', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'client', tenantId: 'T', ruleKey: 'x-rule', context: 'global', ruleType: 'voice', tier: 'locked' }), /FOUNDATION property/));

  console.log('overriding a STANDARD instruction:');
  await store.commitRule({
    layer: 'foundation', via: 'internal', ruleKey: 'closing-question', context: 'reply', ruleType: 'voice',
    body: 'STANDARD closing question, synthetic v1.', createdBy: 'test', expectedVersion: 0,
  });
  await check('a client override records which standard version it branched from', async () => {
    const r = await store.commitRule({
      layer: 'client', tenantId: TT, ruleKey: 'closing-question', context: 'reply', ruleType: 'voice',
      body: 'MY closing question, synthetic.', createdBy: 'test', expectedVersion: 0,
    });
    assert.strictEqual(r.standardVersion, 1, 'baseline stamped at override time');
  });
  await check('renderRulesBlock sends ONE body — the client\'s, not both', async () => {
    const block = await store.renderRulesBlock({ tenantId: TT, contexts: ['reply'] });
    assert.ok(block.text.includes('MY closing question'), 'the override renders');
    assert.ok(!block.text.includes('STANDARD closing question'), 'the standard is shadowed, not stacked');
  });
  await check('renderRulesBlock still sends the FIXED body when a client copy exists', async () => {
    // Force the suppressed state the door now refuses to create (pre-existing rows can be in it).
    db.rules.push({
      id: db.nextId++, rule_key: 'locked-guardrail', tenant_id: TT, layer: 'client', context: 'global',
      rule_type: 'formatting', campaign: null, version: 1, body: 'SNEAKY client guardrail.',
      status: 'active', tier: null, standard_version: null, created_at: 'now', retired_at: null,
    });
    const block = await store.renderRulesBlock({ tenantId: TT });
    assert.ok(block.text.includes('reworded'), 'the guardrail renders');
    assert.ok(!block.text.includes('SNEAKY'), 'the client copy never reaches the model');
  });
  await check('another tenant is untouched by this tenant\'s override', async () => {
    const block = await store.renderRulesBlock({ tenantId: 'Other-Tenant', contexts: ['reply'] });
    assert.ok(block.text.includes('STANDARD closing question'), 'unoverridden tenants stay on the standard');
    assert.ok(!block.text.includes('MY closing question'));
  });

  console.log('divergence view — "what have I changed?" + standard drift:');
  await check('lists only the overrides, with both bodies side by side', async () => {
    const d = await store.getDivergence({ tenantId: TT });
    const entry = d.overrides.find((o) => o.ruleKey === 'closing-question');
    assert.ok(entry, 'the override is listed');
    assert.ok(entry.yourBody.includes('MY closing question'));
    assert.ok(entry.standardBody.includes('STANDARD closing question'));
    assert.strictEqual(entry.standardMoved, false, 'the standard has not moved yet');
    assert.strictEqual(entry.tier, 'standard');
    assert.strictEqual(entry.applies, true);
  });
  await check('a suppressed override is listed as NOT applying', async () => {
    const d = await store.getDivergence({ tenantId: TT });
    const inert = d.overrides.find((o) => o.ruleKey === 'locked-guardrail');
    assert.strictEqual(inert.applies, false, 'a copy of a fixed rule never applies');
    assert.strictEqual(inert.tier, 'locked');
  });
  await check('when the standard moves, the tenant sees it moved AND what it now says', async () => {
    await store.commitRule({
      layer: 'foundation', via: 'internal', ruleKey: 'closing-question', context: 'reply', ruleType: 'voice',
      body: 'STANDARD closing question, synthetic v2 — sharper.', changeNote: 'sharper ask',
      createdBy: 'test', expectedVersion: 1,
    });
    const d = await store.getDivergence({ tenantId: TT });
    const entry = d.overrides.find((o) => o.ruleKey === 'closing-question');
    assert.strictEqual(entry.standardMoved, true);
    assert.strictEqual(entry.basedOnStandardVersion, 1);
    assert.strictEqual(entry.standardVersion, 2);
    assert.ok(entry.standardBody.includes('sharper'), 'the CURRENT standard body comes back');
    assert.ok(entry.standardChanges.some((c) => c.version === 2 && c.changeNote === 'sharper ask'), 'what changed, and why');
  });
  await check('the tenant KEEPS their version while the standard moves under it', async () => {
    const block = await store.renderRulesBlock({ tenantId: TT, contexts: ['reply'] });
    assert.ok(block.text.includes('MY closing question'), 'their version still applies');
    assert.ok(!block.text.includes('sharper'), 'the new standard did not silently take over');
  });
  await check('re-committing the override clears the drift flag (new baseline)', async () => {
    await store.commitRule({
      layer: 'client', tenantId: TT, ruleKey: 'closing-question', context: 'reply', ruleType: 'voice',
      body: 'MY closing question, synthetic v2.', createdBy: 'test', expectedVersion: 1,
    });
    const d = await store.getDivergence({ tenantId: TT });
    const entry = d.overrides.find((o) => o.ruleKey === 'closing-question');
    assert.strictEqual(entry.basedOnStandardVersion, 2);
    assert.strictEqual(entry.standardMoved, false);
  });
  await check('rules that are the tenant\'s alone are not counted as divergence', async () => {
    const d = await store.getDivergence({ tenantId: 'Test-Tenant' });
    assert.ok(d.yoursOnly.some((y) => y.ruleKey === 'signoff-line'), 'own-only rules listed separately');
    assert.ok(!d.overrides.some((o) => o.ruleKey === 'signoff-line'), 'and not as an override');
  });

  console.log('reset to standard:');
  await check('reset retires the override and the standard shows through again', async () => {
    const r = await store.resetRuleToStandard({ tenantId: TT, ruleKey: 'closing-question', createdBy: 'test' });
    assert.strictEqual(r.standardVersion, 2);
    assert.ok(r.standardBody.includes('sharper'));
    const block = await store.renderRulesBlock({ tenantId: TT, contexts: ['reply'] });
    assert.ok(block.text.includes('sharper'), 'back on the shared version');
    assert.ok(!block.text.includes('MY closing question'), 'their version no longer applies');
    const rows = db.rules.filter((x) => x.rule_key === 'closing-question' && x.layer === 'client');
    assert.ok(rows.length >= 2 && rows.every((x) => x.status === 'retired'), 'append-only — archived, not deleted');
  });
  await check('reset REFUSES when there is no standard to fall back to', async () => {
    await assert.rejects(
      store.resetRuleToStandard({ tenantId: 'Test-Tenant', ruleKey: 'signoff-line', createdBy: 'test' }),
      /yours alone/,
    );
  });
  await check('reset REFUSES when the tenant has no version of their own', async () => {
    await assert.rejects(
      store.resetRuleToStandard({ tenantId: TT, ruleKey: 'closing-question', createdBy: 'test' }),
      /nothing to reset/,
    );
  });

  console.log('setRuleTier() — append-only tier changes:');
  await check('locking commits a NEW version carrying the same body', async () => {
    const before = await store.getRule({ layer: 'foundation', via: 'internal', ruleKey: 'closing-question' });
    const r = await store.setRuleTier({ via: 'internal', ruleKey: 'closing-question', tier: 'locked', createdBy: 'test' });
    assert.strictEqual(r.version, before.active.version + 1);
    const after = await store.getRule({ layer: 'foundation', via: 'internal', ruleKey: 'closing-question' });
    assert.strictEqual(after.active.body, before.active.body, 'wording untouched');
    assert.strictEqual(store.ruleTier(after.active), 'locked');
  });
  await check('locking reports whose overrides it just suppressed', async () => {
    await store.commitRule({
      layer: 'foundation', via: 'internal', ruleKey: 'soon-locked', context: 'global', ruleType: 'voice',
      body: 'Synthetic soon-to-be-locked.', createdBy: 'test', expectedVersion: 0,
    });
    await store.commitRule({
      layer: 'client', tenantId: TT, ruleKey: 'soon-locked', context: 'global', ruleType: 'voice',
      body: 'My own soon-locked.', createdBy: 'test', expectedVersion: 0,
    });
    const r = await store.setRuleTier({ via: 'internal', ruleKey: 'soon-locked', tier: 'locked', createdBy: 'test' });
    assert.deepStrictEqual(r.suppressedOverrides, [TT]);
  });
  await check('setRuleTier rejects an unknown tier', () =>
    assert.rejects(store.setRuleTier({ via: 'internal', ruleKey: 'closing-question', tier: 'sacred', createdBy: 'test' }), /invalid tier/));

  console.log('hygiene sweep — twins are re-read under shadowing:');
  await check('a client override of a STANDARD rule is NOT a finding (it is the feature)', () => {
    const findings = store.computeRulebookHygiene([F('greeting', { tier: 'standard' }), C('greeting')], [], []);
    assert.deepStrictEqual(findings, []);
  });
  await check('a client copy of a FIXED rule IS a finding (it never applies)', () => {
    const findings = store.computeRulebookHygiene([F('guard', { tier: 'locked' }), C('guard')], [], []);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].kind, 'inert-override');
    assert.strictEqual(findings[0].ruleKey, 'guard');
  });
  await check('placeholders are checked on the body that ACTUALLY renders', () => {
    // The standard has a hole; the tenant's own version does not. Reporting the standard's hole
    // against this tenant would be a phantom finding — their override is what renders.
    const findings = store.computeRulebookHygiene(
      [F('greeting', { tier: 'standard', body: 'Hello {{never_set}}' }), C('greeting', { body: 'Hello there' })], [], []);
    assert.deepStrictEqual(findings, []);
  });

  store.__setTestPool(null);
  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all wingguy-rules-store tests passed');
  process.exit(failures ? 1 : 0);
})();
