/**
 * Tests for park rendering in the brief (services/wingguyFollowupBrief.formatBrief).
 * HISTORY: the 2026-08-03 stamp-and-tell auto-park was RETIRED on 2026-08-29 (Guy: "nothing
 * automatic") — nothing is stamped at preparation time any more. These tests now pin the legacy
 * contract: payloads stamped under the old rule (parked=true) still render as done deeds with the
 * un-park escape, and everything else — unclear dates, passed windows, old failed stamps,
 * pre-change payloads — renders as a RECOMMENDED PARK the human confirms.
 *
 * Pure formatting — no network, no stores. ⚠ Synthetic content only.
 *
 * Run: node tests/wingguy-brief-autopark.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { formatBrief } = require('../services/wingguyFollowupBrief');

const row = {
  payload: {
    preparedAt: new Date().toISOString(),
    totalSurfaced: 4,
    counts: {},
    items: [
      { name: 'Dana Stamped', verdict: 'park', whyLine: 'said timing is not right until October',
        parkDate: '2099-10-05', parked: true, parkError: null, jog: 'Brisbane broker, warm.' },
      { name: 'Ursula Unclear', verdict: 'park', whyLine: 'said "maybe later in the year"',
        parkDate: null, parked: false, parkError: null },
      { name: 'Pete Passed', verdict: 'park', whyLine: 'said to try again in July',
        parkDate: '2001-07-10', parked: false, parkError: null },
      { name: 'Fiona Failed', verdict: 'park', whyLine: 'said next quarter suits',
        parkDate: '2099-11-01', parked: false, parkError: 'the Reconnect On field is missing on this base (scripts/add-reconnect-on-field.js)' },
    ],
  },
};

// A payload stored BEFORE this change: park items with no parked/parkError fields at all.
const legacyRow = {
  payload: {
    preparedAt: new Date().toISOString(),
    totalSurfaced: 1,
    counts: {},
    items: [
      { name: 'Olive Oldpayload', verdict: 'park', whyLine: 'she said September sounds good', parkDate: '2099-09-15' },
    ],
  },
};

(async () => {
  const text = formatBrief(row);
  const legacy = formatBrief(legacyRow);

  console.log('formatBrief() stamp-and-tell auto-park');
  await check('stamped person renders as a done deed with the un-park escape', () => {
    assert.ok(text.includes('PARKED FOR YOU (1)'));
    assert.ok(text.includes('Dana Stamped — said timing is not right until October → parked till 2099-10-05'));
    assert.ok(text.includes('un-park NAME'));
    assert.ok(text.includes('jog: Brisbane broker, warm.'));
  });
  await check('stamped person does NOT also appear in the ask pile', () => {
    assert.ok(!text.includes('Dana Stamped — said timing is not right until October → park until'));
  });
  await check('unclear date still asks', () => {
    assert.ok(text.includes('RECOMMENDED PARKS (3)'));
    assert.ok(text.includes('Ursula Unclear — said "maybe later in the year" → park until (date unclear — ask)'));
  });
  await check('a passed window reads "reach out now", never a stamp', () => {
    assert.ok(text.includes('Pete Passed — said to try again in July → their own window (2001-07-10) has PASSED — reach out now'));
  });
  await check('a failed stamp falls back to the ask line and names the failure', () => {
    assert.ok(text.includes('Fiona Failed — said next quarter suits → park until 2099-11-01 [auto-park failed: the Reconnect On field is missing'));
  });
  await check('pre-change stored payload (no parked flag) renders as an ask, never as stamped', () => {
    assert.ok(!legacy.includes('PARKED FOR YOU'));
    assert.ok(legacy.includes('RECOMMENDED PARKS (1)'));
    assert.ok(legacy.includes('Olive Oldpayload — she said September sounds good → park until 2099-09-15'));
  });

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
  process.exit(failures ? 1 : 0);
})();
