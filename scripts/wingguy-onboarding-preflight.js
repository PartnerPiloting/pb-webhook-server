// Onboarding journey preflight - read-only, any client. Runs on prod (Render one-off job) so it
// sees the live Master Clients Base, the rules/variables store, the transcript store and env.
//   node scripts/wingguy-onboarding-preflight.js <clientId>
//
// Prints the client's position on the onboarding journey (docs/wingguy-onboarding-checklist.md
// steps 0-14) as DONE / OWED / MANUAL, deriving every verdict from the live system rather than a
// stored checklist - a stored ledger drifts; the record + live probes cannot. Born 2026-08-20
// from the Ashley Knowles session, where the record LOOKED complete while the transcript pipe had
// been dead for nine days and the calendar was routed down the wrong provider path.
//
// 2026-09-09: the probes moved into services/onboardingPreflight.js so the client board's
// "Check live" button (routes/clientBoardRoutes.js) runs the SAME code. This file only prints.
require('dotenv').config();

const { runPreflight } = require('../services/onboardingPreflight');

const MARK = { done: '✅ DONE  ', owed: '👉 OWED  ', manual: '○ MANUAL' };

const clientId = process.argv[2];
if (!clientId) {
  console.error('Usage: node scripts/wingguy-onboarding-preflight.js <clientId>');
  process.exit(1);
}

(async () => {
  let result;
  try {
    result = await runPreflight(clientId);
  } catch (e) {
    if (e.code === 'NOT_FOUND') {
      console.error(`!! NOT FOUND - ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  console.log(`=== ONBOARDING JOURNEY - ${result.clientName} (${clientId}) - read-only, live probes ===\n`);
  console.log(result.steps
    .map((s) => `STEP ${String(s.n).padStart(2)} ${s.name.padEnd(20)} ${MARK[s.verdict] || s.verdict}  ${s.evidence}`)
    .join('\n'));
  if (result.warnings.length) console.log('\n' + result.warnings.map((w) => `⚠ ${w}`).join('\n'));
  console.log('\n=== DONE (read-only) ===');
  process.exit(0);
})().catch((e) => { console.error('PREFLIGHT ERROR:', e); process.exit(1); });
