// One-off (2026-08-26): profile_activity_anchor has NEVER matched on the new sdui profile build —
// health table shows 13/13 misses since the posts read shipped (19 Aug, 0.3.11), every one of them
// "source: default". The built-in id anchors (#content_collections, #recent_activity) simply don't
// exist on the new markup; the read has been surviving on the heading-text fallback the whole time
// (profile_activity_items: 12/12 found inside the fallback-located section). This row gives the
// anchor layer a real hook again so the read no longer leans on a single fallback.
//
// The durable hook (validated live on a real profile in Guy's session, 2026-08-26): the Activity
// section's pill bar renders with id "<slug>activity_posts_pillContent" — slug-prefixed, so matched
// by pattern, not exact id. Its closest <section> is the Activity section, and the leaf-text post
// previews read cleanly inside it. Old ids kept for accounts still served the old markup.
//
// DELIBERATELY AVOIDED: [id$="Activity"] / the "com.linkedin.sdui.profile.card.ref<slug>Activity"
// div. It looks perfect but it's a decoy — its closest('section') is the TOP CARD, so anchoring on
// it would scope the post read to the name/headline area. Hashed class names avoided as ever: on
// this build they rotate day to day (health shape samples, 19–25 Aug, all differ).
//
// Rollback: retireSelector('profile_activity_anchor') — one call, extension falls back to defaults.
// Run on prod: node scripts/apply-selector-fix-20260826.js

const store = require('../services/wingguySelectorStore');

const ACTOR = 'claude-code (validated live in Guy session 2026-08-26)';

const FIX = {
  key: 'profile_activity_anchor',
  value: '#content_collections, #recent_activity, [id*="activity_"][id$="_pillContent"]',
  note: 'New sdui build has no id anchors; the Activity pill bar id "<slug>activity_..._pillContent" is the durable hook. Old ids kept first. The ref...Activity card id was rejected: its closest section is the top card.',
};

(async () => {
  const r = await store.setSelector({ key: FIX.key, value: FIX.value, note: FIX.note, actor: ACTOR });
  console.log(`${FIX.key} -> v${r && r.version !== undefined ? r.version : '?'}`);
  const current = await store.getSelectors({});
  console.log('VERIFY store now serves:', JSON.stringify(current));
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
