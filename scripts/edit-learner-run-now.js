// Manual trigger for the weekly learning-from-edits pass (services/wingguyEditLearner.js) - runs it
// now, ignoring the clock and the once-a-week claim. --dry-run first: both Claude calls happen, so you
// see the real patterns, the real new wording and the real cost, but nothing is committed, no edit is
// closed out, nothing is remembered and nobody is emailed.
// Usage (Render one-off job):
//   node scripts/edit-learner-run-now.js --tenant=Guy-Wilson --dry-run
//   node scripts/edit-learner-run-now.js --tenant=Guy-Wilson            (live, that client only)
//   node scripts/edit-learner-run-now.js                                 (live, whoever EDIT_LEARN covers)
//   --quiet   no summary email to Guy
const learner = require('../services/wingguyEditLearner');

(async () => {
  const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1];
  const dryRun = process.argv.includes('--dry-run');
  const tenant = arg('tenant');
  const r = await learner.runWeekly({ force: true, dryRun, tenant, quiet: process.argv.includes('--quiet') || dryRun });
  if (!r.ran) { console.log('EDIT-LEARN not run:', r.reason); process.exit(0); }
  for (const c of r.results) {
    console.log(`\n=== ${c.clientName} (${c.tenant}) - ${c.pending ?? '?'} pending edit(s) read${c.skipped ? ` - SKIPPED: ${c.skipped}` : ''}`);
    if (c.usage && c.usage.calls) console.log(`Claude: ${c.usage.calls} call(s), ${c.usage.inputTokens} in / ${c.usage.outputTokens} out, ~US$${c.usage.usd.toFixed(3)} (lane ${c.lane})`);
    if (c.patternsSeen != null) console.log(`Patterns the model suggested: ${c.patternsSeen}`);
    for (const ch of c.changes) {
      console.log(`\n--- WOULD CHANGE: ${ch.ruleKey}${ch.campaign ? ` (campaign ${ch.campaign})` : ''}${ch.isNew ? ' [NEW]' : ''}${ch.overStandard ? ' [own version of a shared one]' : ''} - ${ch.pairIds.length} edits to ${ch.people} people (#${ch.pairIds.join(', #')})`);
      console.log(`NOTICED: ${ch.noticed}`);
      console.log(`INSTRUCTION LINE: ${ch.instruction}`);
      console.log(`CURRENT:\n${ch.currentBody || '(none)'}\nNEW:\n${ch.newBody}`);
    }
    for (const x of c.rejected) console.log(`  not taken: ${x.noticed} - ${x.why}`);
  }
  console.log(`\n${r.digest.text}`);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
