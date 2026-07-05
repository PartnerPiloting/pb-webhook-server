/**
 * Tests for the Wingguy rules SOURCE seam (convergence roadmap step 2).
 *
 * Covers: config mode is BYTE-IDENTICAL to the pre-step-2 prompt assembly (the flip-safety
 * guarantee) · store-mode system assembly per surface (harness + rendered rulebook, campaign
 * shadowing, variable resolution) · campaign-marker parsing + detection (shared/ambiguous
 * sections excluded) · template listing/aliasing · empty-store guard · shadow-compare never
 * throws into a live request. Uses an injected in-memory fake pool — no real database.
 * ⚠ Synthetic rule content ONLY (public repo — real rules are the moat and never land here).
 *
 * Run: node tests/wingguy-rules-source.test.js
 */
const assert = require('assert');
const store = require('../services/wingguyRulesStore');
const source = require('../services/wingguyRulesSource');
const config = require('../config/wingguyTemplates');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

// ---------------------------------------------------------------------------
// Fake pool — emulates just the READ queries the seam's store path issues.
// ---------------------------------------------------------------------------
class FakeReadPool {
  constructor({ rules = [], variables = [], assets = [], failAll = false } = {}) {
    this.rules = rules;
    this.variables = variables;
    this.assets = assets;
    this.failAll = failAll;
  }
  connect() {
    if (this.failAll) return Promise.reject(new Error('synthetic connection failure'));
    return Promise.resolve({ query: (sql, params) => this.query(sql, params || []), release() {} });
  }
  async query(sql, params) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK|CREATE|DROP)/i.test(s)) return { rows: [] };
    if (s.includes('FROM wingguy_variable_catalog')) return { rows: this.variables };
    if (s.includes('FROM wingguy_assets')) return { rows: this.assets };
    if (s.includes('FROM wingguy_rules')) {
      const contexts = params.find((p) => Array.isArray(p));
      const rows = this.rules.filter((r) =>
        r.status === 'active' && (!contexts || contexts.includes(r.context)));
      return { rows };
    }
    return { rows: [] };
  }
}

// Synthetic rulebook (NO real rule content).
const SYNTH_RULES = [
  { rule_key: 'voice-basics', tenant_id: 'Guy-Wilson', layer: 'client', context: 'global', rule_type: 'voice', campaign: null, version: 1, body: 'Use {{spelling}} spelling everywhere.', status: 'active' },
  { rule_key: 'campaign-markers', tenant_id: 'Guy-Wilson', layer: 'client', context: 'global', rule_type: 'stage-logic', campaign: null, version: 1, body: 'Detection registry.\n\n**blue** markers:\n- "blue skies ahead"\n- "true blue" / "deep blue"\n\n**red** markers:\n- "seeing red"\n\nShared markers (blue AND red):\n- "shared phrase"', status: 'active' },
  { rule_key: 'first-message', tenant_id: 'Guy-Wilson', layer: 'client', context: 'outreach', rule_type: 'voice', campaign: null, version: 1, body: 'Generic first message shape.', status: 'active' },
  { rule_key: 'first-message', tenant_id: 'Guy-Wilson', layer: 'client', context: 'outreach', rule_type: 'voice', campaign: 'blue', version: 1, body: 'Blue campaign message shape.', status: 'active' },
  { rule_key: 'reply-shape', tenant_id: 'Guy-Wilson', layer: 'client', context: 'reply', rule_type: 'stage-logic', campaign: null, version: 1, body: 'How to shape a reply.', status: 'active' },
  { rule_key: 'booking-shape', tenant_id: 'Guy-Wilson', layer: 'client', context: 'booking', rule_type: 'scheduling', campaign: null, version: 1, body: 'How to book a meeting.', status: 'active' },
];
const SYNTH_VARS = [{ var_key: 'spelling', value: 'Australian' }];

(async () => {
  console.log('wingguy-rules-source tests');
  const envBefore = { source: process.env.WINGGUY_RULES_SOURCE, shadow: process.env.WINGGUY_RULES_SHADOW, db: process.env.DATABASE_URL };

  // -------------------------------------------------------------------------
  console.log(' config mode (the default) — byte-identical to pre-step-2');
  delete process.env.WINGGUY_RULES_SOURCE;

  await check('source defaults to config', () => {
    assert.strictEqual(source.getSource(), 'config');
  });

  await check('draftSystem = [VOICE (cached), template.instructions] exactly', async () => {
    const blocks = await source.draftSystem('tks');
    assert.deepStrictEqual(blocks, [
      { type: 'text', text: config.WINGGUY_VOICE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: config.getTemplate('tks').instructions },
    ]);
  });

  await check('replySystem = [VOICE (cached), REPLY_INSTRUCTIONS] exactly', async () => {
    const blocks = await source.replySystem();
    assert.deepStrictEqual(blocks, [
      { type: 'text', text: config.WINGGUY_VOICE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: config.WINGGUY_REPLY_INSTRUCTIONS },
    ]);
  });

  await check('agentSystem = [VOICE, AGENT (cached)] + the config campaign template', async () => {
    const { blocks, campaignTemplate } = await source.agentSystem('frac');
    assert.deepStrictEqual(blocks, [
      { type: 'text', text: config.WINGGUY_VOICE },
      { type: 'text', text: config.WINGGUY_AGENT_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
    ]);
    assert.strictEqual(campaignTemplate, config.getTemplate('frac'));
  });

  await check('listTemplates / detectTemplate / getTemplate delegate to the config', async () => {
    assert.deepStrictEqual(await source.listTemplates(), config.listTemplates());
    const profile = { headline: 'Fractional CFO' };
    assert.strictEqual(await source.detectTemplate(profile, []), config.detectTemplate(profile, []));
    assert.strictEqual(await source.getTemplate('tks'), config.getTemplate('tks'));
  });

  // -------------------------------------------------------------------------
  console.log(' campaign-marker parsing');

  await check('parses sections, splits "a" / "b" variants, drops the shared/prose section', () => {
    const parsed = source.parseCampaignMarkers(SYNTH_RULES[1].body);
    assert.deepStrictEqual(parsed, {
      blue: ['blue skies ahead', 'true blue', 'deep blue'],
      red: ['seeing red'],
    });
  });

  // -------------------------------------------------------------------------
  console.log(' store mode');
  process.env.WINGGUY_RULES_SOURCE = 'store';
  store.__setTestPool(new FakeReadPool({ rules: SYNTH_RULES, variables: SYNTH_VARS }));

  await check('source flips via the env var (read at call time)', () => {
    assert.strictEqual(source.getSource(), 'store');
    assert.strictEqual(source.isShadowEnabled(), false); // shadow only runs while on config
  });

  await check('listTemplates = generic (default) + the registry campaigns', async () => {
    const list = await source.listTemplates();
    assert.deepStrictEqual(list.map((t) => t.id), ['generic', 'blue', 'red']);
    assert.strictEqual(list[0].isDefault, true);
    assert.strictEqual(list[1].label, 'Blue');
  });

  await check('detectTemplate: marker hit → campaign; no signal → generic; ambiguous tie → generic', async () => {
    assert.strictEqual(await source.detectTemplate({ about: 'Blue skies ahead for us' }, []), 'blue');
    assert.strictEqual(await source.detectTemplate({ about: 'nothing relevant' }, []), 'generic');
    assert.strictEqual(await source.detectTemplate({ about: 'blue skies ahead but also seeing red' }, []), 'generic');
    // the first thread message counts as a signal source (the connection-request note)
    assert.strictEqual(await source.detectTemplate({}, [{ sender: 'Guy', text: 'true blue collaboration' }]), 'blue');
  });

  await check('getTemplate: valid slug → descriptor; tks aliases to generic; unknown → null', async () => {
    const blue = await source.getTemplate('blue');
    assert.strictEqual(blue.id, 'blue');
    assert.strictEqual(blue.signoff, null);
    const aliased = await source.getTemplate('tks');
    assert.strictEqual(aliased.id, 'generic');
    assert.strictEqual(await source.getTemplate('nope'), null);
  });

  await check('draftSystem(blue) = [harness, rulebook (cached)]; campaign SHADOWS generic; vars resolve', async () => {
    const blocks = await source.draftSystem('blue');
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].text, source.STORE_DRAFT_HARNESS);
    assert.deepStrictEqual(blocks[1].cache_control, { type: 'ephemeral' });
    assert.ok(blocks[1].text.includes('Blue campaign message shape.'), 'campaign body missing');
    assert.ok(!blocks[1].text.includes('Generic first message shape.'), 'generic body should be shadowed');
    assert.ok(blocks[1].text.includes('Use Australian spelling everywhere.'), 'variable not resolved');
    assert.ok(!blocks[1].text.includes('How to shape a reply.'), 'reply context leaked into draft-thanks');
  });

  await check('draftSystem(generic) falls through to the generic campaign body', async () => {
    const blocks = await source.draftSystem('generic');
    assert.ok(blocks[1].text.includes('Generic first message shape.'));
    assert.ok(!blocks[1].text.includes('Blue campaign message shape.'));
  });

  await check('replySystem = [REPLY harness (code), reply rulebook (cached)]', async () => {
    const blocks = await source.replySystem();
    assert.strictEqual(blocks[0].text, config.WINGGUY_REPLY_INSTRUCTIONS);
    assert.ok(blocks[1].text.includes('How to shape a reply.'));
    assert.ok(!blocks[1].text.includes('first message shape'), 'outreach leaked into reply');
  });

  await check('agentSystem = [rulebook, AGENT harness (cached)] and NO campaignTemplate', async () => {
    const { blocks, campaignTemplate } = await source.agentSystem('blue');
    assert.strictEqual(campaignTemplate, null);
    assert.ok(blocks[0].text.includes('Blue campaign message shape.'));
    assert.ok(blocks[0].text.includes('How to shape a reply.'));
    assert.ok(blocks[0].text.includes('How to book a meeting.'));
    assert.strictEqual(blocks[1].text, config.WINGGUY_AGENT_INSTRUCTIONS);
    assert.deepStrictEqual(blocks[1].cache_control, { type: 'ephemeral' });
  });

  await check('an EMPTY store render throws (never silently drafts ruleless)', async () => {
    store.__setTestPool(new FakeReadPool({ rules: [], variables: [], assets: [] }));
    await assert.rejects(() => source.draftSystem('generic'), /rendered EMPTY/);
    store.__setTestPool(new FakeReadPool({ rules: SYNTH_RULES, variables: SYNTH_VARS }));
  });

  // -------------------------------------------------------------------------
  console.log(' shadow-compare (config mode, fire-and-forget)');
  process.env.WINGGUY_RULES_SOURCE = 'config';
  process.env.DATABASE_URL = 'postgres://synthetic-test';

  await check('logs a line and never throws on a healthy store', async () => {
    store.__setTestPool(new FakeReadPool({ rules: SYNTH_RULES, variables: SYNTH_VARS }));
    source.shadowCompare({ surface: 'draft-thanks', profile: { about: 'blue skies ahead' }, conversation: [], configTemplateId: 'tks' });
    await new Promise((r) => setTimeout(r, 50)); // let the async body finish; a rejection would fail the run
  });

  await check('a store FAILURE is swallowed (logged, never thrown into the request)', async () => {
    store.__setTestPool(new FakeReadPool({ failAll: true }));
    source.shadowCompare({ surface: 'chat', profile: {}, conversation: [], configTemplateId: 'frac' });
    await new Promise((r) => setTimeout(r, 50));
  });

  await check('shadow respects the kill flag', () => {
    process.env.WINGGUY_RULES_SHADOW = 'false';
    assert.strictEqual(source.isShadowEnabled(), false);
    delete process.env.WINGGUY_RULES_SHADOW;
    assert.strictEqual(source.isShadowEnabled(), true);
  });

  // -------------------------------------------------------------------------
  store.__setTestPool(null);
  if (envBefore.source === undefined) delete process.env.WINGGUY_RULES_SOURCE; else process.env.WINGGUY_RULES_SOURCE = envBefore.source;
  if (envBefore.shadow === undefined) delete process.env.WINGGUY_RULES_SHADOW; else process.env.WINGGUY_RULES_SHADOW = envBefore.shadow;
  if (envBefore.db === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = envBefore.db;

  console.log(failures ? `\n${failures} FAILING` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
