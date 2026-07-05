/**
 * One-time Notion→Postgres import for the Wingguy rules store (Phase C of the import sitting).
 *
 * Design: docs/wingguy.md → "Rules store (roadmap step 1) — detailed design" (Phase C).
 * Everything routes through the write-door (services/wingguyRulesStore.js) — this script
 * contains NO rule content. The seed JSON lives OUTSIDE the repo (public repo; the rules
 * are the moat) and is passed in via --seed.
 *
 * Seed shape (built during the Phase B sweep):
 *   {
 *     _meta: { tenant, campaigns, ... },
 *     variable_catalog: [{ var_key, description, required, example }],
 *     tenant_variables: { var_key: value, ... },
 *     assets: [{ asset_key, kind, url, status, note? }],
 *     rules: [{ rule_key, layers: ['template'|'client'...], campaign?, context, rule_type, body, source }]
 *   }
 *
 * Layer expansion: layers ['template','client'] writes a template row (tenant NULL) AND a
 * client row for the tenant with the SAME body ("one pass, two outputs"). Campaign rules
 * carry their campaign tag through.
 *
 * Idempotent by inspection, not by suppression: re-running skips any rule whose live active
 * body+taxonomy already match the seed (no version churn); a changed body commits version n+1
 * through the door exactly like an edit would.
 *
 * Run (locally against the Render EXTERNAL connection URL — .env.local pattern):
 *   DATABASE_URL="postgres://...render.com/..." node scripts/import-wingguy-rules.js --seed <path> [--dry-run]
 *
 * Guards: refuses to run while any asset URL / variable value still holds a PENDING
 * placeholder (pass --allow-pending to import anyway and fill the stragglers later).
 */

const fs = require('fs');
const path = require('path');
const store = require('../services/wingguyRulesStore');

const ACTOR = 'import';

function parseArgs(argv) {
  const args = { dryRun: false, allowPending: false, seed: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--allow-pending') args.allowPending = true;
    else if (a === '--seed') { args.seed = argv[i + 1]; i += 1; }
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  return args;
}

function loadSeed(seedPath) {
  if (!seedPath) {
    console.error('Usage: DATABASE_URL=... node scripts/import-wingguy-rules.js --seed <path-to-seed.json> [--dry-run]');
    process.exit(2);
  }
  const abs = path.resolve(seedPath);
  const raw = fs.readFileSync(abs, 'utf8');
  const seed = JSON.parse(raw);
  for (const k of ['variable_catalog', 'tenant_variables', 'assets', 'rules']) {
    if (!seed[k]) { console.error(`Seed missing "${k}"`); process.exit(2); }
  }
  return seed;
}

function findPending(seed) {
  const hits = [];
  for (const a of seed.assets) {
    if (/PENDING/i.test(String(a.url || ''))) hits.push(`asset ${a.asset_key}: ${a.url}`);
  }
  for (const [k, v] of Object.entries(seed.tenant_variables)) {
    if (/PENDING/i.test(String(v || ''))) hits.push(`variable ${k}: ${v}`);
  }
  return hits;
}

/** Expand seed rule entries into concrete (layer, tenant, key, campaign) rows. */
function expandRules(seed) {
  const tenant = seed._meta?.tenant || store.DEFAULT_TENANT;
  const rows = [];
  for (const r of seed.rules) {
    for (const layer of r.layers) {
      rows.push({
        layer,
        tenantId: layer === 'client' ? tenant : null,
        ruleKey: r.rule_key,
        context: r.context,
        ruleType: r.rule_type,
        campaign: r.campaign || null,
        body: r.body,
        changeNote: `import: ${r.source || 'Notion corpus'}`,
      });
    }
  }
  return rows;
}

async function importRules(rows, dryRun) {
  let committed = 0; let skipped = 0; let failed = 0;
  for (const row of rows) {
    const label = `${row.layer}${row.tenantId ? `/${row.tenantId}` : ''} ${row.ruleKey}${row.campaign ? ` [${row.campaign}]` : ''}`;
    try {
      const existing = await store.getRule({
        tenantId: row.tenantId || undefined,
        layer: row.layer,
        ruleKey: row.ruleKey,
        campaign: row.campaign,
      });
      const live = existing?.active || null;
      if (live && live.body === row.body && live.context === row.context && live.rule_type === row.ruleType) {
        skipped += 1;
        console.log(`  = unchanged  ${label} (v${live.version})`);
        continue;
      }
      if (dryRun) {
        committed += 1;
        console.log(`  ~ would ${live ? `update v${live.version}→v${live.version + 1}` : 'create v1'}  ${label}`);
        continue;
      }
      const res = await store.commitRule({
        tenantId: row.tenantId,
        layer: row.layer,
        ruleKey: row.ruleKey,
        context: row.context,
        ruleType: row.ruleType,
        campaign: row.campaign,
        body: row.body,
        changeNote: row.changeNote,
        createdBy: ACTOR,
        expectedVersion: live ? live.version : 0,
        action: 'import',
      });
      committed += 1;
      console.log(`  + v${res.version}  ${label}`);
    } catch (e) {
      failed += 1;
      console.error(`  ! FAILED  ${label}: ${e.message}`);
    }
  }
  return { committed, skipped, failed };
}

async function importVariables(seed, dryRun) {
  const tenant = seed._meta?.tenant || store.DEFAULT_TENANT;
  let n = 0;
  for (const v of seed.variable_catalog) {
    const value = Object.prototype.hasOwnProperty.call(seed.tenant_variables, v.var_key)
      ? seed.tenant_variables[v.var_key]
      : null;
    if (dryRun) { console.log(`  ~ would set variable ${v.var_key} = ${value === null ? '(catalog only)' : JSON.stringify(value)}`); n += 1; continue; }
    await store.setVariable({
      tenantId: tenant,
      varKey: v.var_key,
      value,
      description: v.description,
      required: !!v.required,
      example: v.example,
      actor: ACTOR,
    });
    n += 1;
    console.log(`  + variable ${v.var_key}`);
  }
  return n;
}

async function importAssets(seed, dryRun) {
  const tenant = seed._meta?.tenant || store.DEFAULT_TENANT;
  let n = 0;
  for (const a of seed.assets) {
    if (/PENDING/i.test(String(a.url || ''))) { console.log(`  - skipped pending asset ${a.asset_key}`); continue; }
    if (dryRun) { console.log(`  ~ would set asset ${a.asset_key} → ${a.url}`); n += 1; continue; }
    await store.setAsset({
      tenantId: tenant,
      assetKey: a.asset_key,
      kind: a.kind || 'url',
      url: a.url,
      status: a.status || 'active',
      actor: ACTOR,
    });
    n += 1;
    console.log(`  + asset ${a.asset_key}`);
  }
  return n;
}

async function main() {
  const args = parseArgs(process.argv);
  const seed = loadSeed(args.seed);

  if (!process.env.DATABASE_URL && !args.dryRun) {
    console.error('DATABASE_URL is not set. For the one-time import, run locally against the Render EXTERNAL connection URL.');
    process.exit(2);
  }

  const pending = findPending(seed);
  if (pending.length && !args.allowPending) {
    console.error('Seed still has PENDING placeholders — fill these first (or pass --allow-pending):');
    for (const p of pending) console.error(`  · ${p}`);
    process.exit(1);
  }

  const rows = expandRules(seed);
  console.log(`Seed: ${seed.rules.length} rule entries → ${rows.length} rows · ${seed.variable_catalog.length} variables · ${seed.assets.length} assets`);
  console.log(`Tenant: ${seed._meta?.tenant || store.DEFAULT_TENANT} · campaigns: ${(seed._meta?.campaigns || []).join(', ') || '(none)'} · ${args.dryRun ? 'DRY RUN' : 'LIVE IMPORT'}`);

  console.log('\nVariables:');
  const nVars = await importVariables(seed, args.dryRun);
  console.log('\nAssets:');
  const nAssets = await importAssets(seed, args.dryRun);
  console.log('\nRules:');
  const res = await importRules(rows, args.dryRun);

  console.log(`\nDone. rules committed=${res.committed} unchanged=${res.skipped} failed=${res.failed} · variables=${nVars} · assets=${nAssets}`);

  if (!args.dryRun) {
    const status = await store.getStoreStatus();
    console.log('\nStore status after import:');
    for (const r of status.rules || []) console.log(`  ${r.layer} ${r.tenant}: ${r.active} active / ${r.total_versions} versions`);
    console.log(`  history rows: ${status.history_rows}`);
  }
  process.exit(res.failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
