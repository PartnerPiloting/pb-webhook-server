/**
 * Wire the three "your material" boxes into instructions that actually read them, so none of them
 * is a box that saves nothing (Guy's call 2026-08-06 - the three a client CAN answer on day one;
 * the other five scaffolds stay prompts, because they need conversations nobody has had yet).
 *
 *   default_explainer  -> foundation default-explainer-asset  (the fallback link finally resolves)
 *   ideal_fit_traits   -> foundation profile-hook-craft        (weighed when reading a profile)
 *   your_links         -> template  asset-library-scaffold     (the links they already send)
 *
 * Every reference is OPTIONAL ({{?...}}), so a client who answers none of them is exactly where
 * they were - no dangling sentences, no literal braces.
 *
 *   node scripts/wingguy-wire-material-boxes.js            # dry-run + render checks
 *   node scripts/wingguy-wire-material-boxes.js --commit
 */

const store = require('../services/wingguyRulesStore');

const ACTOR = 'script:wire-material-boxes-2026-08-06';
const COMMIT = process.argv.includes('--commit');

const ADDITIONS = [
  {
    layer: 'foundation',
    ruleKey: 'default-explainer-asset',
    note: 'Wire the setup page\'s "the one link you would send someone who asked what you do" into the fallback it describes - the rule named a default explainer but nothing ever set one (Guy 2026-08-06). Optional, so a client without a link is unchanged.',
    append: `
Their nominated default explainer, once set - this is the fallback the section above describes, and it is used exactly as stored: {{?asset:default_explainer}}`,
  },
  {
    layer: 'foundation',
    ruleKey: 'profile-hook-craft',
    note: 'Wire the setup page\'s "what makes someone a genuinely good fit" into the profile read, so the traits they named are weighed against what the profile actually shows (Guy 2026-08-06). Optional.',
    append: `
What makes someone a genuinely good fit for them, once they have said - weigh the profile against these rather than against a job title, and let the hook land on whatever makes this person a fit: {{?ideal_fit_traits}}`,
  },
  {
    layer: 'template',
    ruleKey: 'asset-library-scaffold',
    note: 'Wire the setup page\'s plain list of links they already send, so day one has something to reach for while the full library (a usage gate per asset) is still a conversation (Guy 2026-08-06). Optional.',
    append: `
The links they have already told us about, as they gave them - copy one of these exactly when a link belongs, and never invent or reconstruct a URL: {{?your_links}}`,
  },
];

(async () => {
  const foundation = await store.getActiveRules({ layer: 'foundation' });
  const template = await store.getActiveRules({ layer: 'template' });
  const pick = (layer, key) => (layer === 'foundation' ? foundation : template).find((r) => r.rule_key === key && !r.campaign);

  const planned = [];
  for (const a of ADDITIONS) {
    const cur = pick(a.layer, a.ruleKey);
    if (!cur) { console.error(`FAILED: ${a.layer}/${a.ruleKey} not found`); process.exit(1); }
    const body = `${cur.body.trimEnd()}\n${a.append.trim()}`;

    // Blank client: the added line must vanish entirely, leaving the rule exactly as it was.
    const blank = store.resolveRuleBody(body, {}, {});
    const before = store.resolveRuleBody(cur.body, {}, {});
    if (blank.text.trim() !== before.text.trim()) {
      console.error(`FAILED ${a.ruleKey}: a blank client's render CHANGED - the addition is not optional`);
      process.exit(1);
    }
    // Answered: the value must actually appear.
    const filled = store.resolveRuleBody(body, {
      ideal_fit_traits: 'THEY-REFER', your_links: 'THEIR-LINKS',
    }, { default_explainer: { url: 'https://example.com/explainer', status: 'active' } });
    const marker = { 'default-explainer-asset': 'example.com/explainer', 'profile-hook-craft': 'THEY-REFER', 'asset-library-scaffold': 'THEIR-LINKS' }[a.ruleKey];
    if (!filled.text.includes(marker)) {
      console.error(`FAILED ${a.ruleKey}: an answered value does NOT reach the rule`);
      process.exit(1);
    }
    console.log(`ok ${a.layer}/${a.ruleKey} v${cur.version} - blank: unchanged, answered: reaches the rule`);
    planned.push({ ...a, cur, body });
  }

  if (!COMMIT) { console.log('\nDry-run only. Re-run with --commit.'); process.exit(0); }

  for (const p of planned) {
    await store.commitRule({
      layer: p.layer, ruleKey: p.ruleKey, context: p.cur.context, ruleType: p.cur.rule_type,
      body: p.body, expectedVersion: p.cur.version, createdBy: ACTOR, via: 'internal',
      changeNote: p.note,
    });
    console.log(`${p.layer}/${p.ruleKey}: v${p.cur.version} -> v${p.cur.version + 1}`);
  }
  console.log('\nDone.');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
