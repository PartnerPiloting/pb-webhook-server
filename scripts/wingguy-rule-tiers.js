/**
 * Wingguy foundation TIERS — list, audit and set (run on prod via a Render one-off job).
 *
 *   node scripts/wingguy-rule-tiers.js                          # list every foundation rule + tier
 *   node scripts/wingguy-rule-tiers.js --audit                  # who overrides what, per tenant
 *   node scripts/wingguy-rule-tiers.js --lock <key> [<key>...]  # mark as FIXED (not overridable)
 *   node scripts/wingguy-rule-tiers.js --standard <key> [...]   # mark as STANDARD (overridable)
 *   node scripts/wingguy-rule-tiers.js --lock <key> --dry-run   # show what would change
 *
 * ⚠ RUN --audit FIRST, RIGHT AFTER DEPLOYING cross-layer shadowing. Every rule_key a tenant holds
 * in BOTH layers changes behaviour at that deploy: it used to render TWICE (foundation body AND
 * client body, contradictions and all) and now renders ONCE (the client's). That is the point of
 * the build, but if a client copy is a STALE leftover from the promotion pass, the tenant silently
 * drops back to the old wording. The audit lists exactly those keys so they can be eyeballed —
 * anything stale gets reset with wingguy_rule_reset_to_standard (or retired at the store).
 *
 * Why this exists: tier is a foundation-only property and every existing foundation rule predates
 * the column, so they all read as STANDARD (the safe default: shared, improvable, overridable).
 * The GUARDRAILS have to be locked deliberately — that is this script. Append-only like the rest of
 * the door: setting a tier commits a NEW version carrying the same body, so the change is in
 * history with a reason rather than being an invisible UPDATE.
 *
 * Locking a rule some tenant already overrides is allowed but LOUD: their copy stops applying
 * immediately (the guardrail wins), and the script prints exactly whose.
 */

const store = require('../services/wingguyRulesStore');

const ACTOR = 'script:rule-tiers';

function parseArgs(argv) {
  const out = { mode: 'list', keys: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { out.dryRun = true; continue; }
    if (a === '--audit') { out.mode = 'audit'; continue; }
    if (a === '--lock') { out.mode = 'locked'; continue; }
    if (a === '--standard') { out.mode = 'standard'; continue; }
    if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    out.keys.push(a);
  }
  if (['locked', 'standard'].includes(out.mode) && !out.keys.length) {
    throw new Error(`--${out.mode === 'locked' ? 'lock' : 'standard'} needs at least one rule_key`);
  }
  return out;
}

/**
 * Read-only blast-radius report: every tenant that holds their own version of a shared rule, and
 * whether the shared one has moved since. This is the "what changed at the shadowing deploy?" list.
 */
async function audit() {
  const status = await store.getStoreStatus();
  const tenants = (status.rules || [])
    .filter((r) => r.layer === 'client' && r.tenant !== '(none)')
    .map((r) => r.tenant);
  if (!tenants.length) { console.log('No tenant has any client-layer instructions — nothing overrides anything.'); return 0; }

  let total = 0;
  let stale = 0;
  for (const t of tenants) {
    const d = await store.getDivergence({ tenantId: t });
    if (!d.overrides.length) {
      console.log(`${t}: no overrides (running entirely on the shared instructions${d.yoursOnly.length ? ` + ${d.yoursOnly.length} of their own` : ''}).`);
      continue;
    }
    console.log(`\n${t}: ${d.overrides.length} override(s) — these now REPLACE the shared version instead of stacking with it:`);
    for (const o of d.overrides) {
      total++;
      const flags = [];
      if (!o.applies) flags.push('INERT (shared one is FIXED — theirs never applies)');
      if (o.standardMoved) { flags.push(`STANDARD MOVED v${o.basedOnStandardVersion} → v${o.standardVersion}`); stale++; }
      if (o.basedOnStandardVersion == null) flags.push('baseline unknown (pre-dates drift tracking) — EYEBALL THIS ONE');
      console.log(`  - ${o.ruleKey}${o.campaign ? ` [campaign:${o.campaign}]` : ''}  their v${o.yourVersion} vs shared v${o.standardVersion}${flags.length ? `  ⚠ ${flags.join(' · ')}` : ''}`);
    }
  }
  console.log(`\n${total} override(s) across ${tenants.length} tenant(s); ${stale} where the shared version has moved on.`);
  console.log('Anything that looks like a stale leftover from the promotion pass should be reset to the standard.');
  return 0;
}

async function listAll() {
  const rules = await store.getActiveRules({ layer: 'foundation' });
  if (!rules.length) { console.log('No active foundation rules.'); return rules; }
  const width = Math.max(...rules.map((r) => r.rule_key.length));
  console.log(`${rules.length} active foundation rule(s):\n`);
  for (const r of rules.sort((a, b) => a.rule_key.localeCompare(b.rule_key))) {
    const tier = store.ruleTier(r);
    const flag = tier === 'locked' ? 'FIXED   ' : 'standard';
    const unset = r.tier ? '' : '  (tier never set - defaulting to standard)';
    const camp = r.campaign ? ` [campaign:${r.campaign}]` : '';
    console.log(`  ${flag}  ${r.rule_key.padEnd(width)}  v${r.version}  ${r.context}/${r.rule_type}${camp}${unset}`);
  }
  return rules;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));

  const status = await store.getStoreStatus();
  if (!status.database_configured) { console.error('DATABASE_URL not set — nothing to do.'); process.exit(1); }

  if (args.mode === 'audit') { process.exit(await audit()); }

  if (args.mode === 'list') {
    const rules = await listAll();
    const locked = rules.filter((r) => store.ruleTier(r) === 'locked');
    console.log(`\n${locked.length} FIXED, ${rules.length - locked.length} standard (overridable per client).`);
    console.log('Lock the guardrails with:  node scripts/wingguy-rule-tiers.js --lock <key> [<key>...]');
    console.log('See who overrides what with: node scripts/wingguy-rule-tiers.js --audit');
    process.exit(0);
  }

  let failures = 0;
  for (const key of args.keys) {
    try {
      const found = await store.getRule({ layer: 'foundation', ruleKey: key });
      if (!found?.active) throw new Error('no active foundation rule with that key');
      const was = store.ruleTier(found.active);
      if (was === args.mode) { console.log(`SKIP  ${key} — already ${args.mode}`); continue; }

      const overrides = await store.getOverrideTenants({ ruleKey: key });
      if (args.mode === 'locked' && overrides.length) {
        console.log(`⚠     ${key} — ${overrides.length} tenant(s) currently run their own version: ${overrides.map((o) => `${o.tenant_id} (v${o.version})`).join(', ')}`);
        console.log(`      Locking it means those copies STOP APPLYING immediately (the guardrail wins) and show up as dead weight in their housekeeping sweep.`);
      }
      if (args.dryRun) { console.log(`DRY   ${key} — would go ${was} → ${args.mode} (v${found.active.version} → v${found.active.version + 1})`); continue; }

      // via:'internal' — server-side ops. The platform-owner check gates chat/MCP callers, not
      // a script that already required deploy access to run.
      const r = await store.setRuleTier({ ruleKey: key, tier: args.mode, createdBy: ACTOR, via: 'internal' });
      console.log(`OK    ${key} — ${was} → ${args.mode} (now v${r.version})`);
    } catch (e) {
      failures++;
      console.error(`FAIL  ${key} — ${e.message}`);
    }
  }

  console.log('');
  await listAll();
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(`CRASHED: ${e.stack || e.message}`);
  process.exit(1);
});
