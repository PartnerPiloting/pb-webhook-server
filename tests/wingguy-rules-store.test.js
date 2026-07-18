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

// ---------------------------------------------------------------------------
// In-memory fake pool — emulates just the SQL shapes the store issues.
// ---------------------------------------------------------------------------
class FakeDb {
  constructor() {
    this.rules = [];
    this.history = [];
    this.catalog = [];
    this.tenantVars = [];
    this.assets = [];
    this.nextId = 1;
  }
  connect() {
    return Promise.resolve({
      query: (sql, params) => this.query(sql, params || []),
      release() {},
    });
  }
  async query(sql, params) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s) || /^CREATE /i.test(s)) return { rows: [] };

    if (s.includes('FOR UPDATE')) {
      const rows = this.rules
        .filter((r) => r.layer === params[0] && (r.tenant_id || '') === params[1] && r.rule_key === params[2]
          && (r.campaign || '') === params[3] && r.status === 'active')
        .map((r) => ({ id: r.id, version: r.version }));
      return { rows };
    }
    if (s.includes("SET status = 'retired'")) {
      const row = this.rules.find((r) => r.id === params[0]);
      if (row) { row.status = 'retired'; row.retired_at = 'now'; }
      return { rows: [] };
    }
    if (s.includes('INSERT INTO wingguy_rules')) {
      const [rule_key, tenant_id, layer, context, rule_type, campaign, version, body, change_note, created_by] = params;
      const row = {
        id: this.nextId++, rule_key, tenant_id, layer, context, rule_type, campaign,
        version, body, change_note, created_by, status: 'active', created_at: 'now', retired_at: null,
      };
      this.rules.push(row);
      return { rows: [{ id: row.id, version: row.version }] };
    }
    if (s.includes('INSERT INTO wingguy_rule_history')) {
      this.history.push({ id: this.nextId++, params });
      return { rows: [] };
    }
    if (s.includes('FROM wingguy_rule_history')) {
      return { rows: this.history.slice().reverse().map((h) => ({ id: h.id, actor: h.params[0], action: h.params[1] })) };
    }
    if (s.includes('ORDER BY version DESC')) {
      const rows = this.rules
        .filter((r) => r.layer === params[0] && (r.tenant_id || '') === params[1] && r.rule_key === params[2]
          && (r.campaign || '') === params[3])
        .sort((a, b) => b.version - a.version);
      return { rows };
    }
    if (s.includes('FROM wingguy_rules') && s.includes("status = 'active'") && s.includes('GROUP BY')) {
      return { rows: [] };
    }
    if (s.includes('FROM wingguy_rules') && s.includes("status = 'active'")) {
      let idx = 0;
      let rows = this.rules.filter((r) => r.status === 'active');
      if (s.includes('layer = $1')) {
        const layer = params[idx++];
        rows = rows.filter((r) => r.layer === layer);
        if (layer === 'client') { const t = params[idx++]; rows = rows.filter((r) => r.tenant_id === t); }
      } else {
        const tenant = params[idx++];
        rows = rows.filter((r) => r.layer === 'foundation' || (r.layer === 'client' && r.tenant_id === tenant));
      }
      if (s.includes('context = ANY')) { const ctxs = params[idx++]; rows = rows.filter((r) => ctxs.includes(r.context)); }
      if (s.includes('campaign = $')) { const c = params[idx++]; rows = rows.filter((r) => r.campaign === c); }
      return { rows: rows.slice() };
    }
    if (s.includes('INSERT INTO wingguy_variable_catalog')) {
      const [var_key, description] = params;
      const existing = this.catalog.find((c) => c.var_key === var_key);
      if (existing) { if (description) existing.description = description; }
      else this.catalog.push({ var_key, description, required: false, example: null });
      return { rows: [] };
    }
    if (s.includes('SELECT value FROM wingguy_tenant_variables')) {
      const v = this.tenantVars.find((x) => x.tenant_id === params[0] && x.var_key === params[1]);
      return { rows: v ? [{ value: v.value }] : [] };
    }
    if (s.includes('INSERT INTO wingguy_tenant_variables')) {
      const [tenant_id, var_key, value] = params;
      const existing = this.tenantVars.find((x) => x.tenant_id === tenant_id && x.var_key === var_key);
      if (existing) existing.value = value;
      else this.tenantVars.push({ tenant_id, var_key, value });
      return { rows: [] };
    }
    if (s.includes('FROM wingguy_variable_catalog c')) {
      const tenant = params[0];
      return {
        rows: this.catalog.map((c) => ({
          ...c,
          value: this.tenantVars.find((x) => x.tenant_id === tenant && x.var_key === c.var_key)?.value ?? null,
        })),
      };
    }
    if (s.includes('INSERT INTO wingguy_assets')) {
      const [tenant_id, asset_key, kind, url, status] = params;
      const existing = this.assets.find((a) => a.tenant_id === tenant_id && a.asset_key === asset_key);
      if (existing) Object.assign(existing, { kind: kind || existing.kind, url: url || existing.url, status });
      else this.assets.push({ tenant_id, asset_key, kind, url, status });
      return { rows: [] };
    }
    if (s.includes('FROM wingguy_assets')) {
      return { rows: this.assets.filter((a) => a.tenant_id === params[0]) };
    }
    throw new Error(`FakeDb: unhandled SQL: ${s.slice(0, 120)}`);
  }
}

(async () => {
  // --- Pure core: taxonomy validation --------------------------------------
  console.log('validateRuleInput() — taxonomy + layer/tenant pairing:');
  await check('accepts a valid client rule', () =>
    store.validateRuleInput({ layer: 'client', tenantId: 'Test-Tenant', ruleKey: 'greeting-style', context: 'outreach', ruleType: 'voice' }));
  await check('rejects an unknown layer', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'shared', tenantId: '', ruleKey: 'x-rule', context: 'outreach', ruleType: 'voice' }), /invalid layer/));
  await check('rejects an unknown context', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'foundation', ruleKey: 'x-rule', context: 'linkedin', ruleType: 'voice' }), /invalid context/));
  await check('rejects an unknown rule_type', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'foundation', ruleKey: 'x-rule', context: 'outreach', ruleType: 'tone' }), /invalid rule_type/));
  await check('rejects a client rule without tenant_id', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'client', ruleKey: 'x-rule', context: 'outreach', ruleType: 'voice' }), /requires a tenant_id/));
  await check('rejects a foundation rule WITH tenant_id', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'foundation', tenantId: 'T', ruleKey: 'x-rule', context: 'outreach', ruleType: 'voice' }), /tenant-less/));
  await check('rejects a non-slug rule_key', () =>
    assert.throws(() => store.validateRuleInput({ layer: 'foundation', ruleKey: 'Not A Slug!', context: 'outreach', ruleType: 'voice' }), /rule_key/));

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
    layer: 'foundation', ruleKey: 'no-em-dash', context: 'global', ruleType: 'formatting',
    body: 'Use " - ", never an em dash. Synthetic.', createdBy: 'test', expectedVersion: 0,
  });
  await store.commitRule({
    layer: 'client', tenantId: 'Other-Tenant', ruleKey: 'other-greeting', context: 'outreach', ruleType: 'voice',
    body: 'Other tenant private rule.', createdBy: 'test', expectedVersion: 0,
  });
  await store.commitRule({
    layer: 'template', ruleKey: 'template-only-rule', context: 'outreach', ruleType: 'voice',
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
      layer: 'foundation', ruleKey: 'twin-key', context: 'outreach', ruleType: 'voice',
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
      layer: 'foundation', readerTenantId: 'Test-Tenant', ruleKey: 'brand-new-foundation-rule', context: 'outreach', ruleType: 'voice',
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

  store.__setTestPool(null);
  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all wingguy-rules-store tests passed');
  process.exit(failures ? 1 : 0);
})();
