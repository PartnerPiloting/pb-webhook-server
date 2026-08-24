/**
 * Tests for the incremental full-list brief (services/wingguyFollowupBrief.js, 2026-08-24):
 * entrySig() fingerprinting + canReuseEntry() reuse decision + refreshEntry() carry-forward.
 * The invariant under test: a stored story is reused ONLY when nothing happened (same tier, same
 * last-message dates, same reconnect stamp) AND it is fresh enough AND its draft work finished.
 * Pure functions — no Airtable, no network, no LLM. ⚠ Synthetic content only.
 *
 * Run: node tests/wingguy-brief-incremental.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { entrySig, canReuseEntry, refreshEntry, REFRESH_DAYS } = require('../services/wingguyFollowupBrief');

const MS_DAY = 86400000;
const nowMs = Date.UTC(2026, 7, 24, 4, 0, 0); // 2026-08-24
const OUT = nowMs - 30 * MS_DAY;
const item = (over = {}) => ({
  tier: 'cadence',
  signals: { lastInboundMs: 0, lastOutboundMs: OUT },
  lead: { first: 'Sarah', last: 'Example', email: 'sarah@example.com', reconnectOn: null, linkedinUrl: 'https://linkedin.com/in/sarah' },
  why: 'you messaged last, 30d silent',
  gated: false,
  ...over,
});
const freshPrev = (over = {}) => ({
  sig: entrySig(item()),
  builtAt: new Date(nowMs - 2 * MS_DAY).toISOString(),
  name: 'Sarah Example', email: 'sarah@example.com', linkedin: 'https://linkedin.com/in/sarah',
  tier: 'cadence', engineWhy: 'you messaged last, 28d silent', gated: false,
  verdict: 'draft', whyLine: 'thread went quiet after her question', jog: 'runs a design studio',
  draftText: 'Hi Sarah…', draftHtml: '<p>Hi Sarah…</p>', draftError: null, draftPending: false,
  ...over,
});

(async () => {
  console.log('entrySig()');
  await check('same facts → same sig (deterministic)', () => {
    assert.strictEqual(entrySig(item()), entrySig(item()));
  });
  await check('a new outbound message → different sig', () => {
    const moved = item({ signals: { lastInboundMs: 0, lastOutboundMs: OUT + 5 * MS_DAY } });
    assert.notStrictEqual(entrySig(item()), entrySig(moved));
  });
  await check('tier change → different sig', () => {
    assert.notStrictEqual(entrySig(item()), entrySig(item({ tier: 'reply' })));
  });
  await check('reconnect stamp appearing → different sig', () => {
    const stamped = item(); stamped.lead = { ...stamped.lead, reconnectOn: '2026-09-15' };
    assert.notStrictEqual(entrySig(item()), entrySig(stamped));
  });

  console.log('canReuseEntry()');
  await check('unchanged + fresh + finished → reused', () => {
    assert.strictEqual(canReuseEntry(freshPrev(), entrySig(item()), nowMs), true);
  });
  await check('no previous entry → prep', () => {
    assert.strictEqual(canReuseEntry(undefined, entrySig(item()), nowMs), false);
  });
  await check('signature changed (something happened) → prep', () => {
    const moved = item({ signals: { lastInboundMs: nowMs - MS_DAY, lastOutboundMs: OUT } });
    assert.strictEqual(canReuseEntry(freshPrev(), entrySig(moved), nowMs), false);
  });
  await check(`older than REFRESH_DAYS (${REFRESH_DAYS}) → re-prep even when unchanged`, () => {
    const old = freshPrev({ builtAt: new Date(nowMs - (REFRESH_DAYS + 1) * MS_DAY).toISOString() });
    assert.strictEqual(canReuseEntry(old, entrySig(item()), nowMs), false);
  });
  await check('previous draft FAILED → retry, not reuse', () => {
    assert.strictEqual(canReuseEntry(freshPrev({ draftError: 'model kept writing times' }), entrySig(item()), nowMs), false);
  });
  await check('previous draft DEFERRED by the cap → retry, not reuse', () => {
    assert.strictEqual(canReuseEntry(freshPrev({ draftPending: true }), entrySig(item()), nowMs), false);
  });
  await check('missing builtAt (pre-incremental payload) → prep', () => {
    assert.strictEqual(canReuseEntry(freshPrev({ builtAt: null }), entrySig(item()), nowMs), false);
  });

  console.log('refreshEntry()');
  await check('mechanical fields refresh, expensive fields survive', () => {
    const tonight = item({ why: 'you messaged last, 30d silent' });
    const e = refreshEntry(freshPrev({ engineWhy: 'you messaged last, 28d silent' }), tonight);
    assert.strictEqual(e.engineWhy, 'you messaged last, 30d silent'); // days ticked
    assert.strictEqual(e.draftText, 'Hi Sarah…');                     // expensive work kept
    assert.strictEqual(e.jog, 'runs a design studio');
    assert.strictEqual(e.builtAt, freshPrev().builtAt);               // age keeps accruing toward REFRESH_DAYS
  });

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
  process.exit(failures ? 1 : 0);
})();
