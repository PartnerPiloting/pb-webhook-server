/**
 * Tests for the client journey (content/client-journey.json + services/clientJourney.js).
 *
 * The file is THE written journey, so it is pinned here: eight stops, these keys in this order,
 * Reconnect second, every stop carrying all its parts, house dashes only. The status logic is
 * pinned too: "done" only from a real signal, exactly one "you are here", and a brand-new client
 * starts at stop 1 with nothing claimed.
 * Pure functions and fakes - no Airtable, no Postgres. ⚠ Synthetic content only.
 *
 * Run: node tests/client-journey.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const cj = require('../services/clientJourney');

(async () => {
  console.log('the written journey');
  const j = cj.loadJourney();

  await check('eight stops, in the agreed order, Reconnect second', () => {
    assert.deepStrictEqual(j.stops.map((s) => s.key), ['claude', 'reconnect', 'voice', 'linkedin', 'calendar', 'calls', 'rhythm', 'newpeople']);
    assert.strictEqual(j.stops[1].name, 'Reconnect');
    assert.strictEqual(j.stops[7].when, 'Last, on purpose');
  });
  await check('every stop carries all its parts', () => {
    for (const s of j.stops) for (const k of ['key', 'name', 'line', 'when', 'intro', 'happens', 'yourPart', 'walkAway']) assert.ok(String(s[k] || '').trim(), `${s.key} is missing ${k}`);
    assert.strictEqual(j.whyFirst.reasons.length, 4);
  });
  await check('house style: short spaced dashes only', () => {
    assert.ok(!/[—–]/.test(JSON.stringify(j)));
  });

  console.log('where a client is up to');
  const run = (facts) => cj.buildJourney(j, cj.statusFromFacts(facts));
  const state = (r) => r.stops.map((s) => `${s.status}${s.current ? '*' : ''}`);

  await check('a brand-new client: nothing claimed, and they are at stop 1', () => {
    const r = run({});
    assert.deepStrictEqual(state(r), ['todo*', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo']);
    assert.strictEqual(r.done, 0);
    assert.strictEqual(r.complete, false);
  });
  await check('after session one: Claude used, LinkedIn link clicked -> Reconnect started and is "you are here"', () => {
    const r = run({ usedClaude: true, linkedinConnected: true });
    assert.deepStrictEqual(state(r).slice(0, 3), ['done', 'started*', 'todo']);
  });
  await check('the key alone is only a start on stop 3; key and voice together finish it', () => {
    assert.strictEqual(cj.statusFromFacts({ hasKey: true }).voice, 'started');
    assert.strictEqual(cj.statusFromFacts({ voiceStarted: true }).voice, 'started');
    assert.strictEqual(cj.statusFromFacts({ hasKey: true, voiceDone: true }).voice, 'done');
    assert.strictEqual(cj.statusFromFacts({ voiceDone: true }).voice, 'todo');
  });
  await check('a machine that exists is a start on stop 8; one that is really running finishes it', () => {
    assert.strictEqual(cj.statusFromFacts({ machineSeen: true }).newpeople, 'started');
    assert.strictEqual(cj.statusFromFacts({ machineSeen: true, leadsArriving: true }).newpeople, 'done');
  });
  await check('exactly one "you are here", and it is the first stop not done - even out of order', () => {
    const r = run({ usedClaude: true, reconnectOn: true, calendarConnected: true, recorderConnected: true });
    assert.strictEqual(r.stops.filter((s) => s.current).length, 1);
    assert.strictEqual(r.stops.find((s) => s.current).key, 'voice');
    assert.strictEqual(r.done, 4);
  });
  await check('everything in place: complete, and nobody is "here"', () => {
    const r = run({ usedClaude: true, reconnectOn: true, linkedinConnected: true, hasKey: true, voiceDone: true, extensionSeen: true, calendarConnected: true, recorderConnected: true, followUpsOn: true, machineSeen: true, leadsArriving: true });
    assert.strictEqual(r.complete, true);
    assert.strictEqual(r.stops.filter((s) => s.current).length, 0);
  });

  console.log('reading the facts');
  await check('facts come from the record and the stores; a store that is down claims nothing', async () => {
    const db = { query: async (sql) => ({ rows: /extension_checkins|chat_metrics/.test(sql) ? [{}] : [] }) };
    const store = { getActiveRules: async () => { throw new Error('down'); }, getVariables: async () => [], getAssets: async () => [] };
    const f = await cj.gatherFacts({ clientId: 'T', anthropicApiKey: 'sk-x', followupBrief: 'Yes', machineLastSeen: '2026-10-05T00:00:00Z', lhAccountId: '123' }, { db, store, fields: { VARIABLE_FIELDS: [], ASSET_FIELDS: [], VOICE_FIELDS: [] } });
    assert.strictEqual(f.usedClaude, true);
    assert.strictEqual(f.extensionSeen, true);
    assert.strictEqual(f.hasKey, true);
    assert.strictEqual(f.voiceDone, undefined);
    assert.strictEqual(f.leadsArriving, true);
    assert.strictEqual(f.linkedinConnected, false);
  });
  await check('journeyFor returns the page-ready journey, or null for an unknown client', async () => {
    const db = { query: async () => ({ rows: [] }) };
    const deps = { db, store: { getActiveRules: async () => [], getVariables: async () => [], getAssets: async () => [] }, fields: { VARIABLE_FIELDS: [], ASSET_FIELDS: [], VOICE_FIELDS: [] } };
    const r = await cj.journeyFor('T', { ...deps, clientService: { getClientById: async () => ({ clientId: 'T' }) } });
    assert.strictEqual(r.total, 8);
    assert.strictEqual(r.stops[0].n, 1);
    assert.strictEqual(await cj.journeyFor('X', { ...deps, clientService: { getClientById: async () => null } }), null);
  });

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
