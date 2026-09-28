/**
 * Tests for the call run sheet line in wingguy_list_events (Guy 2026-09-28).
 * Contracts:
 *   1. A coach with an active `call_run_sheet` asset gets a CALL RUN SHEET line (with the URL)
 *      before the diary, so "prep me for today's meetings" opens with the link.
 *   2. No asset, a retired asset, or a store error -> no line, and the diary still comes back.
 *   3. An empty day carries no line (nothing to prep).
 *
 * Pure - the calendar and the asset store are stubbed. Synthetic content only.
 *
 * Run: node tests/wingguy-call-run-sheet.test.js
 */
const assert = require('assert');
const wingguyCalendar = require('../services/wingguyCalendar');
const { runListEvents } = require('../services/wingguyBookingMcp');

const URL = 'https://claude.ai/artifact/EXAMPLE123';
const oneEvent = {
  ok: true, provider: 'google', timezone: 'Australia/Brisbane', startDate: '2026-09-29', endDate: '2026-09-29',
  events: [{ summary: 'Test call', start: '2026-09-29T00:00:00Z', end: '2026-09-29T00:30:00Z', attendees: [] }],
};

async function run() {
  let failures = 0;
  const t = async (name, fn) => {
    try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`FAIL - ${name}\n  ${e.message}`); }
  };

  wingguyCalendar.listEventsForCoach = async () => oneEvent;

  await t('active asset -> line before the diary', async () => {
    const out = await runListEvents({}, 'T', { getAssets: async () => [{ asset_key: 'call_run_sheet', url: URL, status: 'active' }] });
    assert.ok(out.text.includes(`CALL RUN SHEET: ${URL}`));
    assert.ok(out.text.indexOf('CALL RUN SHEET') < out.text.indexOf("The coach's calendar"));
  });

  await t('no asset -> no line, diary intact', async () => {
    const out = await runListEvents({}, 'T', { getAssets: async () => [{ asset_key: 'teams_room', url: 'https://x', status: 'active' }] });
    assert.ok(!out.text.includes('CALL RUN SHEET'));
    assert.ok(out.text.includes('Test call'));
  });

  await t('retired asset -> no line', async () => {
    const out = await runListEvents({}, 'T', { getAssets: async () => [{ asset_key: 'call_run_sheet', url: URL, status: 'retired' }] });
    assert.ok(!out.text.includes('CALL RUN SHEET'));
  });

  await t('store error -> no line, diary intact', async () => {
    const out = await runListEvents({}, 'T', { getAssets: async () => { throw new Error('db down'); } });
    assert.ok(!out.text.includes('CALL RUN SHEET'));
    assert.ok(out.text.includes('Test call'));
  });

  await t('empty day -> no line', async () => {
    wingguyCalendar.listEventsForCoach = async () => ({ ...oneEvent, events: [] });
    const out = await runListEvents({}, 'T', { getAssets: async () => [{ asset_key: 'call_run_sheet', url: URL, status: 'active' }] });
    assert.ok(!out.text.includes('CALL RUN SHEET'));
  });

  if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
  console.log('\nall passing');
}

run();
