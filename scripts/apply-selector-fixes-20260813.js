// One-off (2026-08-13): the selector store's FIRST real fix. LinkedIn's new profile markup has no
// <h1> and no .text-body-* classes, so profile_name / profile_headline / profile_location were
// missing 100% of the time for BOTH tenants (health table proof; drafts survived on deep fallbacks).
// New values keep every OLD selector first — accounts still A/B-served the old markup keep matching
// exactly as before — and append structure-anchored new-format selectors (validated live on two real
// profiles from Guy's session, 2026-08-13): the top-card h2 for the name, the first <p> after the
// name block for the headline, and the <p> beside the contact-info link for the location. Hashed
// class names deliberately avoided — tags + the contact-info href are the durable anchors.
// Run on prod: node scripts/apply-selector-fixes-20260813.js

const store = require('../services/wingguySelectorStore');

const ACTOR = 'claude-code (validated live on 2 profiles, Guy session 2026-08-13)';

const FIXES = [
  {
    key: 'profile_name',
    value: 'main h1, h1.text-heading-xlarge, .pv-top-card h1, section.artdeco-card h1, main section h1, h1, main section h2',
    note: 'New sdui profile pages have no h1 — the name is the top-card h2. Old selectors kept first for old-markup accounts.',
  },
  {
    key: 'profile_headline',
    value: 'div.text-body-medium.break-words, .pv-text-details__left-panel .text-body-medium, div.text-body-medium, main section div:has(> p + p) > p:first-of-type',
    note: 'New pages: headline = first p directly after the name block (the div with two consecutive p children). Old selectors kept first.',
  },
  {
    key: 'profile_location',
    value: 'span.text-body-small.inline.t-black--light.break-words, .pv-text-details__left-panel .text-body-small, main section div:has(> p a[href*="contact-info"]) > p:first-child',
    note: 'New pages: location = the p beside the Contact info link (durable href anchor). Old selectors kept first.',
  },
];

(async () => {
  for (const f of FIXES) {
    const r = await store.setSelector({ key: f.key, value: f.value, note: f.note, actor: ACTOR });
    console.log(`${f.key} → v${r && r.version !== undefined ? r.version : '?'}`);
  }
  const current = await store.getSelectors({});
  console.log('VERIFY store now serves:', JSON.stringify(Object.keys(current.selectors || current || {})));
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
