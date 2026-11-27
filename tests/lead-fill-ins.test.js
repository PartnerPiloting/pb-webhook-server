/**
 * Tests for the overnight fill-in of a contact made into a lead (services/leadFillIns.js,
 * services/leadSearchContacts.js addContactAsLead, services/leadService.js, 2026-11-27).
 *
 * What must hold:
 *   - "Make this contact a lead" notes the new lead for a profile visit when it has a LinkedIn address
 *   - the note is kept for ANY client, but `fillIn` is true only when that client's machine collects
 *   - no LinkedIn address = nothing noted; an already-existing lead = nothing noted
 *   - a failing note never fails the add
 *   - the machine is handed only its own client's notes, only when the nightly collection is on,
 *     and never one it has already confirmed
 *   - a never-profiled lead is queued for scoring when its first profile arrives - and a lead that
 *     has a status or a profile already is left exactly as it is
 * Fakes only. Made-up people. Run: node tests/lead-fill-ins.test.js
 */
const assert = require('assert');
const fillIns = require('../services/leadFillIns');
const lsc = require('../services/leadSearchContacts');
const { neverProfiledWantsScoring } = require('../services/leadService');

let failures = 0;
const pending = [];
const check = (name, fn) => pending.push(async () => {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
});

/** A pool that behaves like the one table. */
function fakePool() {
  const rows = [];
  let tick = 0;
  return {
    rows,
    query: async (sql, args = []) => {
      if (/^\s*INSERT INTO lead_fill_ins/i.test(sql)) {
        const [tenant, slug, rec] = args;
        if (!rows.some((r) => r.tenant_id === tenant && r.slug === slug)) rows.push({ tenant_id: tenant, slug, lead_rec_id: rec, requested_at: ++tick, queued_at: null });
        return { rowCount: 1, rows: [] };
      }
      if (/^\s*SELECT slug FROM lead_fill_ins/i.test(sql)) {
        return { rows: rows.filter((r) => r.tenant_id === args[0] && !r.queued_at).sort((a, b) => a.requested_at - b.requested_at).map((r) => ({ slug: r.slug })) };
      }
      if (/^\s*UPDATE lead_fill_ins/i.test(sql)) {
        const hit = rows.filter((r) => r.tenant_id === args[0] && args[1].includes(r.slug) && !r.queued_at);
        hit.forEach((r) => { r.queued_at = ++tick; });
        return { rowCount: hit.length };
      }
      if (/^\s*DELETE FROM lead_fill_ins/i.test(sql)) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].tenant_id === args[0]) rows.splice(i, 1);
        return { rowCount: before - rows.length };
      }
      throw new Error('unexpected sql: ' + sql);
    },
  };
}
const on = (...ids) => ({ ownConnectionsArrive: (id) => ids.includes(id) });

console.log('lead-fill-ins tests');

check('a note is kept for any client; willFill only where the machine collects', async () => {
  const pool = fakePool();
  const a = await fillIns.request('ON', 'https://www.linkedin.com/in/Pat-Lee/?trk=x', 'rec1', { deps: { pool, leadCampaign: on('ON') } });
  const b = await fillIns.request('OFF', 'pat-lee', 'rec2', { deps: { pool, leadCampaign: on('ON') } });
  assert.deepStrictEqual([a.noted, a.willFill], [true, true]);
  assert.deepStrictEqual([b.noted, b.willFill], [true, false]);
  assert.deepStrictEqual(pool.rows.map((r) => `${r.tenant_id}:${r.slug}`), ['ON:pat-lee', 'OFF:pat-lee']);
});

check('no LinkedIn address = nothing noted; asking twice keeps one note', async () => {
  const pool = fakePool();
  const deps = { pool, leadCampaign: on('ON') };
  assert.strictEqual((await fillIns.request('ON', '', 'rec1', { deps })).noted, false);
  await fillIns.request('ON', 'pat-lee', 'rec1', { deps });
  await fillIns.request('ON', 'https://linkedin.com/in/pat-lee', 'rec1', { deps });
  assert.strictEqual(pool.rows.length, 1);
});

check('the machine gets its own client\'s notes, oldest first, and never a confirmed one', async () => {
  const pool = fakePool();
  const deps = { pool, leadCampaign: on('ON', 'OTHER') };
  await fillIns.request('ON', 'first-one', 'r1', { deps });
  await fillIns.request('OTHER', 'not-mine', 'r2', { deps });
  await fillIns.request('ON', 'second-one', 'r3', { deps });
  const got = await fillIns.pendingForMachine({ clientId: 'ON' }, { deps });
  assert.deepStrictEqual(got, [
    { slug: 'first-one', link: 'https://www.linkedin.com/in/first-one/' },
    { slug: 'second-one', link: 'https://www.linkedin.com/in/second-one/' },
  ]);
  const done = await fillIns.markQueued('ON', ['https://www.linkedin.com/in/First-One/', 'not-mine'], { deps });
  assert.strictEqual(done.count, 1, 'another client\'s note is never confirmed from here');
  assert.deepStrictEqual((await fillIns.pendingForMachine({ clientId: 'ON' }, { deps })).map((p) => p.slug), ['second-one']);
  assert.deepStrictEqual((await fillIns.pendingForMachine({ clientId: 'OTHER' }, { deps })).map((p) => p.slug), ['not-mine']);
});

check('a client the nightly collection is off for is handed nothing - but the note waits', async () => {
  const pool = fakePool();
  await fillIns.request('OFF', 'waits-here', 'r1', { deps: { pool, leadCampaign: on() } });
  assert.deepStrictEqual(await fillIns.pendingForMachine({ clientId: 'OFF' }, { deps: { pool, leadCampaign: on() } }), []);
  // switched on later: the backlog is there
  assert.deepStrictEqual((await fillIns.pendingForMachine({ clientId: 'OFF' }, { deps: { pool, leadCampaign: on('OFF') } })).map((p) => p.slug), ['waits-here']);
});

check('no store = a clean "not noted", never a throw; a leaving client\'s notes are deleted', async () => {
  const none = await fillIns.request('ON', 'pat-lee', 'r1', { deps: { pool: null, leadCampaign: on('ON') } });
  assert.deepStrictEqual([none.ok, none.noted, none.willFill], [false, false, false]);
  const pool = fakePool();
  const deps = { pool, leadCampaign: on('ON') };
  await fillIns.request('ON', 'a-b', 'r1', { deps });
  await fillIns.request('KEEP', 'c-d', 'r2', { deps });
  assert.strictEqual((await fillIns.forgetClient('ON', { deps })).count, 1);
  assert.deepStrictEqual(pool.rows.map((r) => r.tenant_id), ['KEEP']);
});

// ---- "Make this contact a lead" ------------------------------------------------------------
const ROWS = [
  { id: 1, coach: 'A', email: 'pat@acme.example', name: 'Pat Lee', linkedin_slug: 'pat-lee', lead_record_id: null, sources: ['linkedin'] },
  { id: 2, coach: 'A', email: 'jo@nolinkedin.example', name: 'Jo Okoro', lead_record_id: null, sources: ['mail-from'] },
  { id: 3, coach: 'A', email: 'sam@lead.example', name: 'Sam Lead', linkedin_slug: 'sam-lead', lead_record_id: 'recLEAD1', sources: ['lead'] },
];
function addDeps(leadFillIns) {
  const asked = [];
  return {
    asked,
    store: {
      getContact: async (coach, id) => ROWS.find((r) => r.coach === coach && String(r.id) === String(id)) || null,
      markAsLead: async () => true,
    },
    clientService: { getClientBase: () => () => ({ select: () => ({ firstPage: async () => [] }) }) },
    wingguyLeads: { createLead: async () => ({ ok: true, created: true, leadRecordId: 'recNEW', fields: {} }) },
    recallDb: { resolvePendingLeadByEmail: async () => null },
    leadFillIns: leadFillIns || { request: async (...a) => { asked.push(a); return { ok: true, noted: true, willFill: true }; } },
  };
}

check('making a contact with a LinkedIn address a lead notes it for a visit, and says so', async () => {
  const deps = addDeps();
  const r = await lsc.addContactAsLead('A', 'baseA', 1, { deps });
  assert.strictEqual(r.created, true);
  assert.strictEqual(r.fillIn, true);
  assert.deepStrictEqual(deps.asked, [['A', 'pat-lee', 'recNEW']]);
});

check('no LinkedIn address, or already a lead = nothing noted', async () => {
  const deps = addDeps();
  const noLink = await lsc.addContactAsLead('A', 'baseA', 2, { deps });
  assert.deepStrictEqual([noLink.created, noLink.fillIn], [true, false]);
  const already = await lsc.addContactAsLead('A', 'baseA', 3, { deps });
  assert.strictEqual(already.exists, true);
  assert.ok(!already.fillIn);
  assert.deepStrictEqual(deps.asked, []);
});

check('a note that fails, or a machine that will not collect, never fails the add', async () => {
  const boom = await lsc.addContactAsLead('A', 'baseA', 1, { deps: addDeps({ request: async () => { throw new Error('db down'); } }) });
  assert.deepStrictEqual([boom.ok, boom.created, boom.fillIn], [true, true, false]);
  const off = await lsc.addContactAsLead('A', 'baseA', 1, { deps: addDeps({ request: async () => ({ ok: true, noted: true, willFill: false }) }) });
  assert.deepStrictEqual([off.ok, off.created, off.fillIn], [true, true, false]);
});

// ---- the scoring queue ---------------------------------------------------------------------
check('a never-profiled lead is queued for scoring when its first profile arrives', async () => {
  const profile = { 'Profile Full JSON': '{"about":"Twenty years in mining safety"}' };
  assert.strictEqual(neverProfiledWantsScoring({}, profile), true);
  assert.strictEqual(neverProfiledWantsScoring({ 'Profile Full JSON': '  ', 'Scoring Status': '' }, profile), true);
});

check('a lead with a status or a profile already, or an arrival with no profile, is left alone', async () => {
  const profile = { 'Profile Full JSON': '{"about":"x"}' };
  assert.strictEqual(neverProfiledWantsScoring({ 'Scoring Status': 'Scored' }, profile), false);
  assert.strictEqual(neverProfiledWantsScoring({ 'Scoring Status': 'Manually Excluded' }, profile), false);
  assert.strictEqual(neverProfiledWantsScoring({ 'Profile Full JSON': '{"about":"old"}' }, profile), false);
  assert.strictEqual(neverProfiledWantsScoring({}, {}), false);
  // the webhook already said what the status should be - never second-guessed
  assert.strictEqual(neverProfiledWantsScoring({}, { ...profile, 'Scoring Status': 'To Be Scored' }), false);
});

(async () => {
  for (const run of pending) await run();
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
