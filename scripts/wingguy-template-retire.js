/**
 * Retire the starter-kit (template-layer) rules the 2026-08-04 audit found to be Guy's BUSINESS
 * rather than a starting point — they assume the seeded client is selling ASH memberships
 * (member-potential scoring, sign-up-link handling, join-decision pressure), which describes a
 * business a new client does not have.
 *
 *   node scripts/wingguy-template-retire.js            # dry-run: list what would be retired
 *   node scripts/wingguy-template-retire.js --commit   # retire them
 *
 * Append-only like everything at the store: retire flips status and writes history; nothing is
 * deleted, and wingguy_rule_revert can bring any of them back. Template-layer only — Guy's own
 * client-layer copies of these rules are HIS and are not touched.
 *
 * Context: no client has ever been seeded (verified 2026-08-04 — zero client-layer rows for any
 * tenant but Guy-Wilson), so this is stocking the shelf correctly before first use, not a
 * migration. The companion latch (WINGGUY_SEED_FROM_TEMPLATE, default off) keeps the seeding door
 * shut while the remaining method/wording splits land.
 */

const store = require('../services/wingguyRulesStore');

const ACTOR = 'script:template-audit-2026-08-04';
const COMMIT = process.argv.includes('--commit');

// The nine, with the audit's one-line reason (recorded in each rule's history).
const RETIRE = [
  ['pre-meeting-email', 'positions people by whether they have "formally joined" and seen costs/join link - ASH membership flow'],
  ['lead-evaluation', 'scores every lead 0-10 on "member potential" / "member conversion"'],
  ['red-flags', 'every flag framed as reducing "member potential"'],
  ['signup-link-usage', 'when to send the ASH sign-up link and run a live onboarding session'],
  ['closing-stage-followup', '631-word pattern for prospects "considering joining" the network'],
  ['call3-decision', 'prices ASH membership against BNI, advertising and an MBA'],
  ['inversion-strengthening-clause', 'worked example is about "members" recommending each other'],
  ['leader-overlay', 'ASH-internal taxonomy: leaders primary, clients acceptable, spectators not worth the time'],
  ['two-way-landing-signals', 'names "corporate captives" as a target audience segment'],
];

(async () => {
  const rows = await store.getActiveRules({ layer: 'template' });
  const byKey = new Map(rows.filter((r) => !r.campaign).map((r) => [r.rule_key, r]));

  let missing = 0;
  for (const [key, reason] of RETIRE) {
    const live = byKey.get(key);
    if (!live) {
      console.log(`- ${key}: NOT ACTIVE in template (already retired?) — skipping`);
      missing++;
      continue;
    }
    console.log(`- ${key} v${live.version}: ${reason}`);
    if (COMMIT) {
      await store.retireRule({
        layer: 'template',
        ruleKey: key,
        createdBy: ACTOR,
        expectedVersion: live.version,
        changeNote: `Template audit 2026-08-04: ${reason}. Retired from the starter kit - this is Guy's business, not a starting point. Revert via wingguy_rule_revert if needed.`,
        via: 'internal',
      });
    }
  }

  const after = COMMIT ? await store.getActiveRules({ layer: 'template' }) : null;
  console.log(
    COMMIT
      ? `\nDone. Template layer now has ${after.length} active rules (was ${rows.length}).`
      : `\nDry-run only — ${RETIRE.length - missing} would be retired, leaving ${rows.length - (RETIRE.length - missing)} of ${rows.length}. Re-run with --commit.`,
  );
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
