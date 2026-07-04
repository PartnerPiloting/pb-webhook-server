/**
 * Wingguy rules store — LIVE smoke test (run on prod via a Render one-off job).
 *
 *   node scripts/wingguy-rules-smoke.js
 *
 * Exercises the real Postgres path end-to-end against a throwaway 'smoke-test' tenant:
 * commit v1 → propose+commit v2 (conflict check both ways) → variable set + render →
 * revert → history read-back → retire (leaves the tenant tidy). Prints PASS/FAIL per step
 * and exits non-zero on any failure. Synthetic content only — no real rules involved.
 *
 * Safe by construction: everything is scoped to tenant 'smoke-test' (layer=client), which
 * no runtime read uses; foundation/template layers are never touched.
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

  const status1 = await store.getStoreStatus();
  console.log(`\nFinal store status: ${JSON.stringify(status1.rules)} history_rows=${status1.history_rows}`);
  console.log(failures ? `\nSMOKE FAILED — ${failures} step(s)` : '\nSMOKE GREEN — the write-door works on this database');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(`SMOKE CRASHED: ${e.stack || e.message}`);
  process.exit(1);
});
