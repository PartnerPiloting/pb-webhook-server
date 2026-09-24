#!/usr/bin/env node
// Offboard a client - the "offboard <name>" door (services/clientOffboardService).
//
//   node scripts/offboard-client.js <Client-ID>        show what it would do (changes nothing)
//   node scripts/offboard-client.js <Client-ID> --go   do it, and email Guy the summary
//
// Runs on the server (a Render one-off job on prod) - it needs prod's Stripe,
// Unipile and Airtable keys. Always run it without --go first and show Guy.

const clientId = process.argv[2];
const go = process.argv.includes('--go');
const reasonArg = process.argv.find((a) => a.startsWith('--reason='));
const reason = reasonArg ? reasonArg.slice('--reason='.length) : 'Guy asked';

(async () => {
  const svc = require('../services/clientOffboardService');
  if (!clientId || clientId.startsWith('--')) {
    console.log('usage: node scripts/offboard-client.js <Client-ID> [--go] [--reason="..."]');
    process.exit(2);
  }
  if (!go) {
    const plan = await svc.planOffboard(clientId);
    console.log(svc.planText(plan));
    console.log('\n(dry run - nothing changed. Add --go to do it.)');
    process.exit(plan.ok ? 0 : 1);
  }
  const res = await svc.runOffboard(clientId, { reason });
  console.log(res.summary || `Can't offboard: ${res.error}`);
  process.exit(res.ok ? 0 : 1);
})().catch((e) => { console.error(`offboard failed: ${e.message}`); process.exit(1); });
