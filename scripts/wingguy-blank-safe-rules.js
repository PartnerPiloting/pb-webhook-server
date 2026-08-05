/**
 * Make the setup page's "you can skip these" promise TRUE at the instruction level, and give the
 * four inert boxes something that actually reads them (Guy's call 2026-08-06).
 *
 * Three moves:
 *   1. NEW foundation rule `never-say-words` - the banned-words list finally has an instruction.
 *      Written with {{?never_say_words}} so a client who leaves it blank gets no instruction at
 *      all, rather than "Never use these words:" with nothing after it.
 *   2. `profile-hook-craft` (foundation, standard) gains two OPTIONAL lines so "who you are for"
 *      and "where you are based" stop being boxes nothing reads.
 *   3. `booking-defaults` (template) - the phone reference becomes optional, so a client who
 *      leaves it blank does not ship {{owner_phone}} into every calendar invite.
 *
 * Everything here is additive and blank-safe: every new reference is {{?...}}, so an unanswered
 * box costs nothing. Append-only as always - old versions stay in history, revertible.
 *
 *   node scripts/wingguy-blank-safe-rules.js            # dry-run + render checks
 *   node scripts/wingguy-blank-safe-rules.js --commit
 */

const store = require('../services/wingguyRulesStore');

const ACTOR = 'script:blank-safe-rules-2026-08-06';
const COMMIT = process.argv.includes('--commit');

const NEVER_SAY = {
  ruleKey: 'never-say-words',
  context: 'global',
  ruleType: 'voice',
  body: `Words and phrases you never use. These are banned outright in anything written for you - no exceptions, no "but it fits here". If a draft reaches for one, find another way to say it.
Your list: {{?never_say_words}}

A banned phrase is not a preference to weigh against other things - it is the one instruction whose whole job is to be absolute. A single one slipping through is the fastest way for a draft to stop sounding like you.`,
};

const PROFILE_HOOK_ADDITION = `
Who you are looking for, once you have said - a profile that fits deserves the closer read, and the hook should land on whatever makes them a fit: {{?target_verticals}}
Where you are based, once you have said - a genuinely shared place is a real reason to talk, so use it when it is true and never force it: {{?region}}`;

(async () => {
  // --- render checks: every new reference must vanish cleanly when unanswered -------------------
  const nsBlank = store.resolveRuleBody(NEVER_SAY.body, {});
  const nsSet = store.resolveRuleBody(NEVER_SAY.body, { never_say_words: 'reach out, folks' });
  console.log('never-say-words | blank ->', JSON.stringify(nsBlank.text.slice(0, 60) + '…'));
  console.log('never-say-words | set   ->', nsSet.text.includes('reach out, folks') ? 'includes their list' : 'MISSING LIST');
  if (/\{\{/.test(nsBlank.text) || nsBlank.unresolved.length) { console.error('FAILED: blank leaks'); process.exit(1); }
  if (!nsBlank.text.trim()) { console.error('FAILED: blank drops the whole rule - the ban would vanish'); process.exit(1); }

  const foundation = await store.getActiveRules({ layer: 'foundation' });
  const template = await store.getActiveRules({ layer: 'template' });
  const phc = foundation.find((r) => r.rule_key === 'profile-hook-craft' && !r.campaign);
  const bd = template.find((r) => r.rule_key === 'booking-defaults' && !r.campaign);
  if (!phc) { console.error('FAILED: profile-hook-craft not found'); process.exit(1); }
  if (!bd) { console.error('FAILED: template booking-defaults not found'); process.exit(1); }

  const phcBody = `${phc.body.trimEnd()}\n${PROFILE_HOOK_ADDITION.trim()}`;
  const phcCheck = store.resolveRuleBody(phcBody, {});
  if (/\{\{\s*\?/.test(phcCheck.text)) { console.error('FAILED: profile-hook optional leaked'); process.exit(1); }
  console.log('profile-hook-craft | blank drops both added lines:', !phcCheck.text.includes('Who they are looking for'));

  const bdBody = bd.body.replace(/\{\{owner_phone\}\}/g, '{{?owner_phone}}');
  const changedPhone = bdBody !== bd.body;
  console.log('booking-defaults | phone reference made optional:', changedPhone);

  if (!COMMIT) { console.log('\nDry-run only. Re-run with --commit.'); process.exit(0); }

  const exists = foundation.some((r) => r.rule_key === NEVER_SAY.ruleKey);
  if (exists) {
    console.log('never-say-words already exists in foundation - skipping create');
  } else {
    await store.commitRule({
      layer: 'foundation', ruleKey: NEVER_SAY.ruleKey, context: NEVER_SAY.context,
      ruleType: NEVER_SAY.ruleType, body: NEVER_SAY.body, expectedVersion: 0, createdBy: ACTOR,
      via: 'internal',
      changeNote: 'The banned-words list finally has an instruction (Guy approved 2026-08-06). Optional slot so a blank list means no instruction at all, not a dangling sentence. Waited for the {{?}} engine to reach production.',
    });
    console.log('never-say-words: foundation v1 committed');
  }

  await store.commitRule({
    layer: 'foundation', ruleKey: 'profile-hook-craft', context: phc.context, ruleType: phc.rule_type,
    body: phcBody, expectedVersion: phc.version, createdBy: ACTOR, via: 'internal',
    changeNote: 'Wire the setup page\'s "who you are for" and "where you are based" answers into the instruction that reads profiles - they were boxes nothing read (Guy 2026-08-06). Both optional, so blank changes nothing.',
  });
  console.log(`profile-hook-craft: v${phc.version} -> v${phc.version + 1}`);

  if (changedPhone) {
    await store.commitRule({
      layer: 'template', ruleKey: 'booking-defaults', context: bd.context, ruleType: bd.rule_type,
      body: bdBody, expectedVersion: bd.version, createdBy: ACTOR, via: 'internal',
      changeNote: 'Phone number on calendar invites becomes optional - a client who leaves it blank was shipping {{owner_phone}} into every invite description (Guy 2026-08-06).',
    });
    console.log(`booking-defaults (template): v${bd.version} -> v${bd.version + 1}`);
  }

  console.log('\nDone.');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
