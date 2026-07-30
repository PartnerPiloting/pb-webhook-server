/**
 * Wingguy rules store — LIVE smoke test (run on prod via a Render one-off job).
 *
 *   node scripts/wingguy-rules-smoke.js
 *
 * Exercises the real Postgres path end-to-end against a throwaway 'smoke-test' tenant:
 * commit v1 → propose+commit v2 (conflict check both ways) → variable set + render →
 * revert → history read-back → retire (leaves the tenant tidy), then the three-tier half:
 * standard-vs-locked, client override shadowing, divergence + drift, reset to standard.
 * Prints PASS/FAIL per step and exits non-zero on any failure. Synthetic content only.
 *
 * Mostly safe by construction: everything is scoped to tenant 'smoke-test' (layer=client), which
 * no runtime read uses. ⚠ The tier half is the ONE exception — it has to create real FOUNDATION
 * rows, which every tenant reads live. They use throwaway 'smoke-'-prefixed keys that collide with
 * nothing, and are retired in a finally (plus swept at the start of the next run). If you ever see
 * an active foundation rule named smoke-* , a run died mid-way: retire it.
 */

const store = require('../services/wingguyRulesStore');

const TENANT = 'smoke-test';
const KEY = 'smoke-throwaway-rule';
const scope = { layer: 'client', tenantId: TENANT, ruleKey: KEY };

let failures = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
};

(async () => {
  console.log(`Wingguy rules smoke — tenant '${TENANT}' on ${process.env.RENDER ? 'Render' : 'local env'}\n`);

  const status0 = await store.getStoreStatus();
  if (!status0.database_configured) {
    console.error('FAIL  DATABASE_URL not set — cannot smoke test');
    process.exit(1);
  }
  console.log(`Store status: ${JSON.stringify(status0.rules)} history_rows=${status0.history_rows}\n`);

  // Start clean if a previous smoke run left an active rule behind.
  const leftover = await store.getRule(scope);
  if (leftover?.active) {
    await store.retireRule({ ...scope, expectedVersion: leftover.active.version, createdBy: 'smoke', changeNote: 'pre-run cleanup' });
    console.log(`(cleaned up leftover active v${leftover.active.version} from a previous run)\n`);
  }
  const priorVersions = leftover ? leftover.versions.length : 0;

  await step('commit v-next (new active) via the write-door', async () => {
    const r = await store.commitRule({
      ...scope, context: 'booking', ruleType: 'scheduling',
      body: 'Smoke: never offer a slot before {{smoke_floor}}.', changeNote: 'smoke v1',
      createdBy: 'smoke', expectedVersion: 0,
    });
    if (!r.ok) throw new Error('commit did not return ok');
  });

  let live;
  await step('read it back as the active version', async () => {
    const got = await store.getRule(scope);
    live = got?.active;
    if (!live) throw new Error('no active rule after commit');
    if (!live.body.includes('smoke_floor')) throw new Error('body mismatch');
  });

  await step('stale expected_version is rejected', async () => {
    let rejected = false;
    try {
      await store.commitRule({
        ...scope, context: 'booking', ruleType: 'scheduling',
        body: 'Smoke: stale write.', createdBy: 'smoke', expectedVersion: live.version + 7,
      });
    } catch (e) {
      rejected = /version conflict/.test(e.message);
    }
    if (!rejected) throw new Error('stale commit was NOT rejected');
  });

  await step('propose shows diff + expected_version, writes nothing', async () => {
    const prop = await store.proposeRule({
      ...scope, context: 'booking', ruleType: 'scheduling',
      body: 'Smoke: never offer a slot before {{smoke_floor}} (v2 wording).',
    });
    if (prop.expectedVersion !== live.version) throw new Error(`expectedVersion ${prop.expectedVersion} ≠ live ${live.version}`);
    const after = await store.getRule(scope);
    if (after.versions.length !== priorVersions + 1) throw new Error('propose inserted a row (it must be a pure read)');
  });

  await step('commit v-next+1 with the correct expected_version', async () => {
    const r = await store.commitRule({
      ...scope, context: 'booking', ruleType: 'scheduling',
      body: 'Smoke: never offer a slot before {{smoke_floor}} (v2 wording).', changeNote: 'smoke v2',
      createdBy: 'smoke', expectedVersion: live.version,
    });
    if (r.version !== live.version + 1) throw new Error(`expected v${live.version + 1}, got v${r.version}`);
  });

  await step('variable set + renderRulesBlock resolves it', async () => {
    await store.setVariable({ tenantId: TENANT, varKey: 'smoke_floor', value: '9:30am AEST', actor: 'smoke' });
    const block = await store.renderRulesBlock({ tenantId: TENANT, contexts: ['booking'] });
    if (!block.text.includes('9:30am AEST')) throw new Error(`variable not resolved: ${block.text.slice(0, 200)}`);
    if (block.unresolved.length) throw new Error(`unresolved placeholders: ${block.unresolved.join(', ')}`);
  });

  await step('revert to the previous body (as a NEW version)', async () => {
    const got = await store.getRule(scope);
    const r = await store.revertRule({ ...scope, toVersion: got.active.version - 1, createdBy: 'smoke' });
    const after = await store.getRule(scope);
    if (after.active.version !== r.version) throw new Error('revert did not become active');
  });

  await step('history shows the full trail', async () => {
    const h = await store.getHistory({ ruleKey: KEY, limit: 20 });
    const actions = h.map((x) => x.action);
    for (const need of ['commit', 'revert']) {
      if (!actions.includes(need)) throw new Error(`history missing "${need}" (got: ${actions.join(', ')})`);
    }
  });

  await step('retire (leave the smoke tenant tidy)', async () => {
    const got = await store.getRule(scope);
    await store.retireRule({ ...scope, expectedVersion: got.active.version, createdBy: 'smoke', changeNote: 'smoke cleanup' });
    const after = await store.getRule(scope);
    if (after.active) throw new Error('rule still active after retire');
  });

  // -------------------------------------------------------------------------
  // Three tiers + per-client overrides (2026-07-31). These touch the FOUNDATION layer, which
  // every tenant reads live — so they use their own throwaway keys, never a real rule_key, and
  // clean up after themselves in a finally. If a run dies mid-way, the leftovers are two keys
  // prefixed 'smoke-' that nothing else references; the pre-run cleanup below sweeps them.
  // -------------------------------------------------------------------------
  const STD_KEY = 'smoke-standard-rule';
  const LOCK_KEY = 'smoke-locked-rule';
  // via:'internal' — this script runs the DEPLOYED code on the server, which is a higher trust
  // level than a chat session; the platform-owner check only gates door (chat/MCP) callers.
  const fnd = (ruleKey) => ({ layer: 'foundation', ruleKey, via: 'internal' });
  const own = (ruleKey) => ({ layer: 'client', tenantId: TENANT, ruleKey });

  // Sweep anything a previous crashed run left behind, in both layers.
  for (const k of [STD_KEY, LOCK_KEY]) {
    for (const sc of [own(k), fnd(k)]) {
      const l = await store.getRule(sc);
      if (l?.active) await store.retireRule({ ...sc, expectedVersion: l.active.version, createdBy: 'smoke', changeNote: 'pre-run cleanup' });
    }
  }

  try {
    await step('foundation rule defaults to tier=standard', async () => {
      const r = await store.commitRule({
        ...fnd(STD_KEY), context: 'booking', ruleType: 'scheduling',
        body: 'Smoke STANDARD body.', createdBy: 'smoke', expectedVersion: 0,
      });
      if (r.tier !== 'standard') throw new Error(`expected tier=standard, got ${r.tier}`);
    });

    await step('a client override REPLACES the standard (one body renders, not two)', async () => {
      const r = await store.commitRule({
        ...own(STD_KEY), context: 'booking', ruleType: 'scheduling',
        body: 'Smoke MY OWN body.', createdBy: 'smoke', expectedVersion: 0,
      });
      if (r.standardVersion !== 1) throw new Error(`baseline not stamped: standardVersion=${r.standardVersion}`);
      const block = await store.renderRulesBlock({ tenantId: TENANT, contexts: ['booking'] });
      if (!block.text.includes('MY OWN body')) throw new Error('the override did not render');
      if (block.text.includes('STANDARD body')) throw new Error('the standard STACKED instead of being shadowed');
    });

    await step('divergence view shows yours + the current standard side by side', async () => {
      const d = await store.getDivergence({ tenantId: TENANT });
      const e = d.overrides.find((o) => o.ruleKey === STD_KEY);
      if (!e) throw new Error('the override is not in the divergence view');
      if (!e.yourBody.includes('MY OWN') || !e.standardBody.includes('STANDARD body')) throw new Error('both bodies must come back');
      if (e.standardMoved) throw new Error('standard has not moved yet, but was reported as moved');
    });

    await step('moving the standard raises the drift flag WITHOUT touching the override', async () => {
      await store.commitRule({
        ...fnd(STD_KEY), context: 'booking', ruleType: 'scheduling',
        body: 'Smoke STANDARD body v2.', changeNote: 'smoke drift', createdBy: 'smoke', expectedVersion: 1,
      });
      const d = await store.getDivergence({ tenantId: TENANT });
      const e = d.overrides.find((o) => o.ruleKey === STD_KEY);
      if (!e.standardMoved) throw new Error('drift not detected');
      if (e.basedOnStandardVersion !== 1 || e.standardVersion !== 2) throw new Error(`bad drift versions: ${e.basedOnStandardVersion} → ${e.standardVersion}`);
      if (!e.standardChanges.some((c) => c.changeNote === 'smoke drift')) throw new Error('the change note behind the drift is missing');
      const block = await store.renderRulesBlock({ tenantId: TENANT, contexts: ['booking'] });
      if (!block.text.includes('MY OWN body')) throw new Error('the tenant lost their version when the standard moved');
    });

    await step('reset to standard puts the tenant back on the shared version', async () => {
      const r = await store.resetRuleToStandard({ tenantId: TENANT, ruleKey: STD_KEY, createdBy: 'smoke' });
      if (r.standardVersion !== 2) throw new Error(`expected to land on standard v2, got v${r.standardVersion}`);
      const block = await store.renderRulesBlock({ tenantId: TENANT, contexts: ['booking'] });
      if (!block.text.includes('STANDARD body v2')) throw new Error('the standard did not show through after reset');
      if (block.text.includes('MY OWN body')) throw new Error('the override still renders after reset');
    });

    await step('a LOCKED standard cannot be overridden, and wins at render', async () => {
      await store.commitRule({
        ...fnd(LOCK_KEY), context: 'booking', ruleType: 'scheduling',
        body: 'Smoke LOCKED guardrail body.', tier: 'locked', createdBy: 'smoke', expectedVersion: 0,
      });
      let rejected = false;
      try {
        await store.commitRule({
          ...own(LOCK_KEY), context: 'booking', ruleType: 'scheduling',
          body: 'Smoke attempt to override a guardrail.', createdBy: 'smoke', expectedVersion: 0,
        });
      } catch (e) {
        rejected = /LOCKED/.test(e.message);
      }
      if (!rejected) throw new Error('the write-door allowed an override of a locked rule');
      const block = await store.renderRulesBlock({ tenantId: TENANT, contexts: ['booking'] });
      if (!block.text.includes('LOCKED guardrail body')) throw new Error('the guardrail did not render');
    });

    await step('tier survives a wording edit (locking is not undone by an edit)', async () => {
      const r = await store.commitRule({
        ...fnd(LOCK_KEY), context: 'booking', ruleType: 'scheduling',
        body: 'Smoke LOCKED guardrail body, reworded.', createdBy: 'smoke', expectedVersion: 1,
      });
      if (r.tier !== 'locked') throw new Error(`tier lost on edit: ${r.tier}`);
    });
  } finally {
    // Always tidy the foundation layer — a stray active foundation rule would render for EVERY
    // tenant, so this cleanup is not optional even when a step above failed.
    for (const k of [STD_KEY, LOCK_KEY]) {
      for (const sc of [own(k), fnd(k)]) {
        try {
          const l = await store.getRule(sc);
          if (l?.active) await store.retireRule({ ...sc, expectedVersion: l.active.version, createdBy: 'smoke', changeNote: 'smoke cleanup' });
        } catch (e) { console.error(`CLEANUP FAILED for ${sc.layer}/${k}: ${e.message} — retire it by hand.`); failures++; }
      }
    }
    console.log('(tier/override fixtures cleaned up from both layers)');
  }

  const status1 = await store.getStoreStatus();
  console.log(`\nFinal store status: ${JSON.stringify(status1.rules)} history_rows=${status1.history_rows}`);
  console.log(failures ? `\nSMOKE FAILED — ${failures} step(s)` : '\nSMOKE GREEN — the write-door works on this database');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(`SMOKE CRASHED: ${e.stack || e.message}`);
  process.exit(1);
});
