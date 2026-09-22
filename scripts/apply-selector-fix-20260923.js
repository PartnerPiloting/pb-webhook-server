// One-off (2026-09-23): profile_featured_anchor has NEVER matched on the new sdui profile build -
// 17/17 misses since the Featured read shipped (16 Sep, 0.3.24), across Guy, Julian and Roland.
// The monitor email of 23 Sep flagged it. Same story as profile_activity_anchor on 26 Aug: the
// built-in ids (#featured, #content_collections_featured) don't exist on the new markup, so the
// read has leaned entirely on the "Featured" heading fallback.
//
// The hook (validated live on Priti Ahuja's profile, 2026-09-23): the Featured card renders as
// div#com.linkedin.sdui.profile.card.ref<member-urn>Featured with the real Featured <section>
// INSIDE it. So the selector targets the section beneath that div, not the div itself - the
// matched element is already a <section>, and findFeaturedSection's closest('section') returns it
// unchanged. Checked live: heading "Featured", first text = her pinned post.
//
// DELIBERATELY AVOIDED: the bare [id$="Featured"] div. Same decoy as the Activity card id - its
// closest('section') climbs to the TOP CARD (checked live: that section's h2 is her name), which
// would scope the post read to the name/headline area. Hashed class names avoided as ever.
//
// Rollback: retireSelector('profile_featured_anchor') - one call, extension falls back to defaults.
// Run on prod: node scripts/apply-selector-fix-20260923.js

const store = require('../services/wingguySelectorStore');

const ACTOR = 'claude-code (validated live on a real profile 2026-09-23)';

const FIX = {
  key: 'profile_featured_anchor',
  value: '#featured, #content_collections_featured, [id^="com.linkedin.sdui.profile.card.ref"][id$="Featured"] section',
  note: 'New sdui build has no id anchors; the Featured section sits INSIDE div#com.linkedin.sdui.profile.card.ref<urn>Featured. Old ids kept first. The bare card div was rejected: its closest section is the top card.',
};

(async () => {
  const r = await store.setSelector({ key: FIX.key, value: FIX.value, note: FIX.note, actor: ACTOR });
  console.log(`${FIX.key} -> v${r && r.version !== undefined ? r.version : '?'}`);
  const current = await store.getSelectors({});
  console.log('VERIFY store now serves:', JSON.stringify(current));
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
