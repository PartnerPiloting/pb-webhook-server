/**
 * The doubles tidy-up (services/wisprFeedService.removeSupersededCopies) - 13 Nov 2026.
 *
 * The check at filing time stops a Wispr copy when another recorder filed the call FIRST. This is
 * the other way round: Wispr filed first (the client asked Claude straight after the call) and
 * Fathom filed the same call a few minutes later. The Wispr copy must go, the other copy must stay,
 * and nothing the client did to the Wispr copy (naming it) may be lost.
 *
 * No network, no database. ⚠ Synthetic content only.
 *
 * Run: node tests/wispr-doubles.test.js
 */
process.env.WISPR_FEED_TENANTS = 'Test-Tenant';

const assert = require('assert');
const feed = require('../services/wisprFeedService');
const { createMemoryStore } = require('../services/wisprStore');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.stack || e.message}`); }
};

const T = 'Test-Tenant';
const NOW = Date.parse('2026-11-13T06:00:00Z');
const MIN = 60000;
const iso = (ms) => new Date(ms).toISOString();

/** A tiny transcript store: rows + lead links. */
function world(rows, links = []) {
  const store = createMemoryStore();
  const state = { rows: rows.map((r) => ({ ...r })), links: links.map((l) => ({ ...l })), logs: [] };
  const endOf = (r) => (r.meeting_end ? Date.parse(r.meeting_end) : Date.parse(r.meeting_start) + (r.duration_seconds || 3600) * 1000);
  const deps = {
    store, now: () => NOW, log: { info: (m) => state.logs.push(m), warn: (m) => state.logs.push(`WARN ${m}`), error() {} },
    listMeetingsBySource: async (tenant, source, since) => state.rows.filter((r) => r.tenant === tenant && r.source === source && Date.parse(r.meeting_start) >= Date.parse(since)),
    findOverlappingMeetings: async (tenant, s, e) => state.rows.filter((r) => r.tenant === tenant && Date.parse(r.meeting_start) < Date.parse(e) + 10 * MIN && endOf(r) > Date.parse(s) - 10 * MIN),
    listMeetingLeads: async (id) => state.links.filter((l) => String(l.meeting_id) === String(id)),
    addMeetingLead: async (meetingId, leadId) => { if (!state.links.some((l) => String(l.meeting_id) === String(meetingId) && l.airtable_lead_id === leadId)) state.links.push({ meeting_id: meetingId, airtable_lead_id: leadId }); return { ok: true }; },
    deleteMeeting: async (id, tenant) => {
      const i = state.rows.findIndex((r) => String(r.id) === String(id) && r.tenant === tenant);
      if (i < 0) return { ok: false, error: 'not found' };
      const [gone] = state.rows.splice(i, 1);
      state.links = state.links.filter((l) => String(l.meeting_id) !== String(id));
      return { ok: true, deleted: gone };
    },
  };
  return { store, deps, state };
}

const start = NOW - 2 * 60 * MIN;
const wisprRow = (over = {}) => ({ id: 900, tenant: T, source: 'wispr', title: 'Roland & Casey', meeting_start: iso(start), duration_seconds: 1800, provider_recording_id: 'w-1', ...over });
const fathomRow = (over = {}) => ({ id: 901, tenant: T, source: 'fathom-api', title: 'Roland Example & Casey Coach', meeting_start: iso(start + 2 * MIN), duration_seconds: 1900, ...over });

(async () => {
  await check('Wispr filed first, Fathom filed the same call after -> the Wispr copy is removed, Fathom\'s stays', async () => {
    const w = world([wisprRow(), fathomRow()], [{ meeting_id: 900, airtable_lead_id: 'recROLAND' }, { meeting_id: 901, airtable_lead_id: 'recROLAND' }]);
    await w.store.upsertRecording(T, 'w-1', { outcome: 'filed', meetingId: 900 });
    const removed = await feed.removeSupersededCopies(T, w.deps);
    assert.deepStrictEqual(removed, ['900']);
    assert.deepStrictEqual(w.state.rows.map((r) => r.id), [901]);
    assert.deepStrictEqual(w.state.links, [{ meeting_id: 901, airtable_lead_id: 'recROLAND' }]);
    const rec = await w.store.getRecording(T, 'w-1');
    assert.strictEqual(rec.outcome, 'duplicate');
    assert.strictEqual(rec.meetingId, '901');
    assert.ok(w.state.logs.some((l) => l.includes('removed doubled Wispr copy #900') && l.includes('#901')));
  });
  await check('running it again does nothing', async () => {
    const w = world([wisprRow(), fathomRow()]);
    await feed.removeSupersededCopies(T, w.deps);
    assert.deepStrictEqual(await feed.removeSupersededCopies(T, w.deps), []);
    assert.strictEqual(w.state.rows.length, 1);
  });
  await check('a call the client NAMED on the Wispr copy stays named: the lead is carried to the other copy first', async () => {
    const w = world([wisprRow(), fathomRow()], [{ meeting_id: 900, airtable_lead_id: 'recNIMAN' }]); // Fathom matched nobody
    await w.store.upsertRecording(T, 'w-1', { outcome: 'filed', meetingId: 900, needsName: false, namedLeadId: 'recNIMAN' });
    await feed.removeSupersededCopies(T, w.deps);
    assert.deepStrictEqual(w.state.links, [{ meeting_id: 901, airtable_lead_id: 'recNIMAN' }]);
  });
  await check('an unnamed Wispr copy that is doubled stops being asked about', async () => {
    const w = world([wisprRow({ title: 'Unnamed Wispr recording' }), fathomRow()]);
    await w.store.upsertRecording(T, 'w-1', { outcome: 'unnamed', meetingId: 900, needsName: true, startedAt: iso(start) });
    await feed.removeSupersededCopies(T, w.deps);
    assert.deepStrictEqual(await feed.listUnnamed(T, w.deps), []);
  });
  await check('no other recorder filed it -> the Wispr copy is kept', async () => {
    const w = world([wisprRow()]);
    assert.deepStrictEqual(await feed.removeSupersededCopies(T, w.deps), []);
    assert.strictEqual(w.state.rows.length, 1);
  });
  await check('another Wispr recording at the same time is not "another recorder"', async () => {
    const w = world([wisprRow(), wisprRow({ id: 902, provider_recording_id: 'w-2' })]);
    assert.deepStrictEqual(await feed.removeSupersededCopies(T, w.deps), []);
    assert.strictEqual(w.state.rows.length, 2);
  });
  await check('a different call that only brushes the same time is kept (less than half the Wispr recording overlaps)', async () => {
    const w = world([wisprRow(), fathomRow({ meeting_start: iso(start + 25 * MIN) })]);
    assert.deepStrictEqual(await feed.removeSupersededCopies(T, w.deps), []);
    assert.strictEqual(w.state.rows.length, 2);
  });
  await check('a much LONGER copy from the other recorder (an unsplit lump of several calls) is not treated as the same call', async () => {
    const w = world([wisprRow(), fathomRow({ meeting_start: iso(start - 30 * MIN), duration_seconds: 2 * 3600 })]);
    assert.deepStrictEqual(await feed.removeSupersededCopies(T, w.deps), []);
    assert.strictEqual(w.state.rows.length, 2);
  });
  await check('a long Wispr recording that merely contains a short call from the other recorder is kept', async () => {
    const w = world([wisprRow({ duration_seconds: 150 * 60 }), fathomRow({ duration_seconds: 1800 })]);
    assert.deepStrictEqual(await feed.removeSupersededCopies(T, w.deps), []);
  });
  await check('one part of a split Wispr recording is tidied on its own; the other part is left', async () => {
    const w = world([
      wisprRow({ id: 910, provider_recording_id: 'w-9#1', meeting_start: iso(start - 30 * MIN) }),
      wisprRow({ id: 911, provider_recording_id: 'w-9#2' }),
      fathomRow(),
    ]);
    const removed = await feed.removeSupersededCopies(T, w.deps);
    assert.deepStrictEqual(removed, ['911']);
    assert.deepStrictEqual(w.state.rows.map((r) => r.id).sort(), [901, 910]);
    assert.strictEqual((await w.store.getRecording(T, 'w-9#2')).outcome, 'duplicate');
  });
  await check('another tenant\'s calls are never touched', async () => {
    const w = world([wisprRow(), fathomRow({ tenant: 'Someone-Else' })]);
    assert.deepStrictEqual(await feed.removeSupersededCopies(T, w.deps), []);
    assert.strictEqual(w.state.rows.length, 2);
  });
  await check('if the lead cannot be carried across, BOTH copies are kept (never lose a link to save a duplicate)', async () => {
    const w = world([wisprRow(), fathomRow()], [{ meeting_id: 900, airtable_lead_id: 'recROLAND' }]);
    w.deps.addMeetingLead = async () => { throw new Error('database hiccup'); };
    assert.deepStrictEqual(await feed.removeSupersededCopies(T, w.deps), []);
    assert.strictEqual(w.state.rows.length, 2);
  });
  await check('a Wispr copy older than three days is left alone', async () => {
    const old = NOW - 5 * 24 * 60 * MIN;
    const w = world([wisprRow({ meeting_start: iso(old) }), fathomRow({ meeting_start: iso(old) })]);
    assert.deepStrictEqual(await feed.removeSupersededCopies(T, w.deps), []);
  });

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
