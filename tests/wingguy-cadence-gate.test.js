/**
 * Tests for the cadence "have they ever spoken?" gate (services/wingguyMailMcp.js) — the
 * 2026-08-01 tightening of Decision B: a connection-accept plus the coach's own unanswered
 * opener must NOT surface as "went quiet"; only people with at least one message of their own
 * (any channel, full LinkedIn depth) get cadence nudges.
 *
 * Covers: linkedInEverInbound() (full-depth sender scan) · classifyLead() cadence gate with/
 * without everInbound and with an in-window inbound. Pure functions — no Airtable, no network.
 * ⚠ Synthetic content only.
 *
 * Run: node tests/wingguy-cadence-gate.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { linkedInEverInbound, classifyLead } = require('../services/wingguyMailMcp');

const MS_DAY = 86400000;
const nowMs = Date.UTC(2026, 7, 1, 4, 0, 0); // 2026-08-01
const todayMidMs = Date.UTC(2026, 7, 1);

// Notes where ONLY the coach has spoken (the accept-then-silence pattern).
const NOTES_COACH_ONLY = [
  'Some profile stuff up here.',
  '=== LINKEDIN MESSAGES ===',
  '20-07-26 9:15 AM - Guy Wilson - Would you be up for a quick Zoom?',
].join('\n');

// Notes where the lead replied once, long ago, then the coach messaged last.
const NOTES_LEAD_SPOKE = [
  '=== LINKEDIN MESSAGES ===',
  '20-07-26 9:15 AM - Guy Wilson - Circling back on this.',
  '02-01-26 3:40 PM - Sarah Example - Thanks Guy, sounds interesting!',
].join('\n');

(async () => {
  console.log('linkedInEverInbound()');
  await check('coach-only thread → false', () => {
    assert.strictEqual(linkedInEverInbound(NOTES_COACH_ONLY, 'Sarah'), false);
  });
  await check('lead spoke anywhere in history → true (even below the newest line)', () => {
    assert.strictEqual(linkedInEverInbound(NOTES_LEAD_SPOKE, 'Sarah'), true);
  });
  await check('no LinkedIn block → false', () => {
    assert.strictEqual(linkedInEverInbound('just some notes', 'Sarah'), false);
  });
  await check('no first name → false (never guess)', () => {
    assert.strictEqual(linkedInEverInbound(NOTES_LEAD_SPOKE, ''), false);
  });

  console.log('classifyLead() cadence gate');
  const base = { recId: 'rec1', first: 'Sarah', last: 'Example', email: 'sarah@example.com', reconnectOn: null, cease: false, ceaseAtMs: null, onSeries: false, notes: '' };
  const quietSignals = { lastInboundMs: null, lastOutboundMs: nowMs - 20 * MS_DAY, nowMs, todayMidMs }; // 20d silent — inside the 14..45d cadence band

  await check('connected but NEVER spoke → dropped as coldCadence (the fix)', () => {
    const c = classifyLead({ ...base, connected: true }, { ...quietSignals, everInbound: false });
    assert.strictEqual(c.tier, null);
    assert.strictEqual(c.coldCadence, true);
  });
  await check('spoke once in deep LinkedIn history → still surfaces as cadence', () => {
    const c = classifyLead({ ...base, connected: true }, { ...quietSignals, everInbound: true });
    assert.strictEqual(c.tier, 'cadence');
  });
  await check('not connected but replied in-window then went quiet → still cadence', () => {
    const c = classifyLead({ ...base, connected: false }, { lastInboundMs: nowMs - 40 * MS_DAY, lastOutboundMs: nowMs - 20 * MS_DAY, everInbound: false, nowMs, todayMidMs });
    assert.strictEqual(c.tier, 'cadence');
  });
  await check('reply-owed tier untouched by the gate', () => {
    const c = classifyLead({ ...base, connected: false }, { lastInboundMs: nowMs - 2 * MS_DAY, lastOutboundMs: nowMs - 5 * MS_DAY, everInbound: false, nowMs, todayMidMs });
    assert.strictEqual(c.tier, 'reply');
  });

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
  process.exit(failures ? 1 : 0);
})();
