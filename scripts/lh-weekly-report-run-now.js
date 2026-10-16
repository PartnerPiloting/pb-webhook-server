// Manual trigger for the Monday campaign numbers email (services/lhWeeklyCampaignReport.js) - builds
// it from the machines' latest numbers now, ignoring the clock, and does NOT claim the week, so the
// real Monday run still happens. Sends Guy his email AND every ticked client theirs - --dry-run first.
// Usage (Render one-off job): node scripts/lh-weekly-report-run-now.js [--dry-run]
//   --dry-run   print the email instead of sending it
const report = require('../services/lhWeeklyCampaignReport');

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const r = await report.runWeeklyReport({ force: true, dryRun });
  if (dryRun && r.text) console.log(`${r.subject}\n\n${r.text}\n`);
  console.log('LH-WEEKLY-REPORT run-now result:', JSON.stringify({ ...r, text: undefined, html: undefined }, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
