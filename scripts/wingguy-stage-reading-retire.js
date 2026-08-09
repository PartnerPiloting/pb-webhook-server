/**
 * Retire the two stale copies of "stage-reading" left behind by its 2026-08-09 promotion to
 * foundation (global/stage-logic, tier=standard):
 *
 *   1. the TEMPLATE-layer copy (reply/stage-logic) - foundation reaches every tenant live, so
 *      seeding this at client setup would only recreate a stale shadow per new client;
 *   2. Julian-Davis's CLIENT-layer copy (seeded 2026-08-06 from that template) - a client copy
 *      shadows the foundation standard, so until retired Julian keeps the old reply-context
 *      filing, which the extension's draft-thanks lane (outreach+global) never loads - the
 *      exact hole behind the Luke Watson "following up on my note" regression.
 *
 *   node scripts/wingguy-stage-reading-retire.js            # dry-run: show what would be retired
 *   node scripts/wingguy-stage-reading-retire.js --commit   # retire both
 *
 * Append-only: retire flips status and writes history; wingguy_rule_revert brings either back.
 * Guy-Wilson's own copy is not touched here - it was reset to standard through the door.
 */

const store = require('../services/wingguyRulesStore');

const ACTOR = 'script:stage-reading-promotion-2026-08-09';
const COMMIT = process.argv.includes('--commit');

(async () => {
  const tmpl = (await store.getActiveRules({ layer: 'template' }))
    .find((r) => r.rule_key === 'stage-reading' && !r.campaign);
  const julian = (await store.getActiveRules({ layer: 'client', tenantId: 'Julian-Davis' }))
    .find((r) => r.rule_key === 'stage-reading' && !r.campaign);

  console.log('template stage-reading:', tmpl ? `ACTIVE v${tmpl.version} (${tmpl.context}/${tmpl.rule_type})` : 'not active - nothing to do');
  console.log('Julian-Davis client stage-reading:', julian ? `ACTIVE v${julian.version} (${julian.context}/${julian.rule_type})` : 'not active - nothing to do');

  if (COMMIT) {
    if (tmpl) {
      await store.retireRule({
        layer: 'template',
        ruleKey: 'stage-reading',
        createdBy: ACTOR,
        expectedVersion: tmpl.version,
        changeNote: 'stage-reading promoted to foundation (global/stage-logic, standard) 2026-08-09; foundation reaches every tenant live, so the starter-kit copy would only seed a stale shadow. Revert via wingguy_rule_revert if needed.',
        via: 'internal',
      });
    }
    if (julian) {
      await store.retireRule({
        layer: 'client',
        tenantId: 'Julian-Davis',
        ruleKey: 'stage-reading',
        createdBy: ACTOR,
        expectedVersion: julian.version,
        changeNote: 'Seeded 2026-08-06 copy of the old reply-context stage-reading; retired so the promoted foundation standard (global) applies. The old filing was invisible to the extension draft lane - the Luke Watson regression 2026-08-09. Revert via wingguy_rule_revert if needed.',
        via: 'internal',
      });
    }
    console.log('COMMITTED.');
  } else {
    console.log('\nDry-run only - re-run with --commit to retire.');
  }

  // What Julian's global render now resolves for this key (the proof the shadow is gone).
  const effective = (await store.getActiveRules({ tenantId: 'Julian-Davis', contexts: ['global'], shadowed: true }))
    .find((r) => r.rule_key === 'stage-reading');
  console.log('Julian effective stage-reading (global render):', effective ? `layer=${effective.layer} v${effective.version} (${effective.context})` : 'NONE');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
