/**
 * Wingguy — seed a new client's rulebook from the TEMPLATE layer (run on prod/staging via a
 * Render one-off job; needs the store's DATABASE_URL).
 *
 *   node scripts/wingguy-seed-client.js --tenant Julian-Davis            # DRY RUN (default)
 *   node scripts/wingguy-seed-client.js --tenant Julian-Davis --commit   # actually seed
 *
 * Copies every active template rule into the tenant's own client layer as v1 (idempotent:
 * rules the client already has are skipped, never overwritten). Variables (global catalog) and
 * assets (client fills their own) are intentionally NOT seeded. Prints what was seeded/skipped.
 *
 * Refuses to seed the default owner tenant (that layer is live, not a fresh client).
 */

require('dotenv').config();
const store = require('../services/wingguyRulesStore');

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

(async () => {
  const tenantId = arg('tenant');
  const commit = arg('commit', false) === true;
  if (!tenantId || tenantId === true) {
    console.error('Usage: node scripts/wingguy-seed-client.js --tenant <clientId> [--commit]');
    process.exit(2);
  }
  const createdBy = arg('by', 'system:seed');
  const res = await store.seedClientFromTemplate({ tenantId, createdBy, dryRun: !commit });
  const mode = commit ? 'COMMITTED' : 'DRY RUN (no write — pass --commit to seed)';
  console.log(`SEED ${mode}  tenant=${res.tenantId}`);
  console.log(`  template rules: ${res.templateCount}`);
  console.log(`  would seed:     ${res.seeded.length}${res.seeded.length ? '  [' + res.seeded.join(', ') + ']' : ''}`);
  console.log(`  already have:   ${res.skipped.length}${res.skipped.length ? '  [' + res.skipped.join(', ') + ']' : ''}`);
  process.exit(0);
})().catch((e) => {
  console.error('SEED ERROR', e.stack || e.message);
  process.exit(1);
});
