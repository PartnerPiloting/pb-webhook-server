/**
 * Tests for filling a lead's blank Date Connected from the machine's nightly read of My Connections
 * (services/connectedDateFill.js, 2026-11-25).
 *
 * What must hold:
 *   - the lead is found by its LinkedIn address EXACTLY - a longer address that contains it is not it
 *   - Date Connected is written ONLY where it is blank; an existing date is never replaced
 *   - the status becomes 'Connected' only where it was blank; 'Candidate' is left alone
 *   - nothing else is written - never the campaign
 *   - the answer says per address what happened, so the machine stops re-reporting settled people
 *   - a client the nightly collection is not switched on for: nothing is read or written
 *   - a date that cannot be real (future, before LinkedIn existed, rubbish) is dropped
 * Fakes only. Made-up people. Run: node tests/connected-date-fill.test.js
 */
const assert = require('assert');
const { fillConnectedDates, cleanPeople, cleanDate } = require('../services/connectedDateFill');

let failures = 0;
const pending = [];
const check = (name, fn) => pending.push(async () => {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
});

const NOW = Date.parse('2026-11-25T14:10:00Z');
const MS = (iso) => Date.parse(iso);

function world() {
  const leads = [
    { id: 'recBLANK', fields: { 'LinkedIn Profile URL': 'https://www.linkedin.com/in/dean-blank/', Campaign: 'Visit only' } },
    { id: 'recCAND', fields: { 'LinkedIn Profile URL': 'https://au.linkedin.com/in/cara-candidate?trk=x', 'LinkedIn Connection Status': 'Candidate', Campaign: 'TOP SCORERS' } },
    { id: 'recDATED', fields: { 'LinkedIn Profile URL': 'https://www.linkedin.com/in/dana-dated', 'Date Connected': '2024-02-02T00:00:00.000Z', 'LinkedIn Connection Status': 'Candidate' } },
    // a LONGER address that contains "andrewdb" - a different person
    { id: 'recLONG', fields: { 'LinkedIn Profile URL': 'https://www.linkedin.com/in/andrewdbyrne/' } },
    // the same person filed twice: one dated, one blank
    { id: 'recTWIN1', fields: { 'LinkedIn Profile URL': 'https://www.linkedin.com/in/tess-twin/', 'Date Connected': '2025-05-05T00:00:00.000Z' } },
    { id: 'recTWIN2', fields: { 'LinkedIn Profile URL': 'https://www.linkedin.com/in/tess-twin' } },
  ];
  const writes = [];
  const reads = [];
  const base = () => ({
    select: ({ filterByFormula }) => ({
      all: async () => {
        reads.push(filterByFormula);
        const needles = [...filterByFormula.matchAll(/SEARCH\("([^"]+)"/g)].map((m) => m[1]);
        return leads.filter((l) => needles.some((n) => String(l.fields['LinkedIn Profile URL'] || '').toLowerCase().includes(n))).map((l) => ({ id: l.id, fields: { ...l.fields } }));
      },
    }),
    update: async (batch) => { for (const u of batch) { writes.push(u); Object.assign(leads.find((l) => l.id === u.id).fields, u.fields); } return batch; },
  });
  const deps = { clientService: { getClientBase: () => base }, leadCampaign: { ownConnectionsArrive: (id) => id === 'On-Client' } };
  return { leads, writes, reads, deps };
}
const ON = { clientId: 'On-Client', airtableBaseId: 'baseON' };

console.log('connected-date-fill tests');

check('a blank Date Connected is filled with the real date; a blank status becomes Connected; nothing else is written', async () => {
  const w = world();
  const r = await fillConnectedDates(ON, [{ slug: 'dean-blank', connected_at: MS('2022-09-19T14:00:00Z') }], { deps: w.deps, now: NOW });
  assert.deepStrictEqual({ filled: r.filled, dated: r.dated, noLead: r.noLead, results: r.results }, { filled: 1, dated: 0, noLead: 0, results: { 'dean-blank': 'filled' } });
  assert.deepStrictEqual(w.writes, [{ id: 'recBLANK', fields: { 'Date Connected': '2022-09-19T14:00:00.000Z', 'LinkedIn Connection Status': 'Connected' } }]);
  assert.strictEqual(w.leads[0].fields.Campaign, 'Visit only');           // the campaign is never touched
});

check('Candidate is left as it is (Top Scoring Leads selects on it) - only the date is written', async () => {
  const w = world();
  await fillConnectedDates(ON, [{ slug: 'cara-candidate', connected_at: MS('2025-07-01T14:00:00Z') }], { deps: w.deps, now: NOW });
  assert.deepStrictEqual(w.writes, [{ id: 'recCAND', fields: { 'Date Connected': '2025-07-01T14:00:00.000Z' } }]);
  assert.strictEqual(w.leads[1].fields['LinkedIn Connection Status'], 'Candidate');
});

check('an existing date is NEVER replaced - and the machine is told the person is settled', async () => {
  const w = world();
  const r = await fillConnectedDates(ON, [{ slug: 'dana-dated', connected_at: MS('2020-01-01T00:00:00Z') }], { deps: w.deps, now: NOW });
  assert.strictEqual(w.writes.length, 0);
  assert.deepStrictEqual(r.results, { 'dana-dated': 'dated' });
  assert.strictEqual(w.leads[2].fields['Date Connected'], '2024-02-02T00:00:00.000Z');
});

check('the address must match EXACTLY - never a longer one that contains it, never a name', async () => {
  const w = world();
  const r = await fillConnectedDates(ON, [{ slug: 'andrewdb', connected_at: MS('2025-01-01T00:00:00Z') }, { slug: 'nobody-here', connected_at: MS('2025-01-01T00:00:00Z') }], { deps: w.deps, now: NOW });
  assert.strictEqual(w.writes.length, 0);
  assert.deepStrictEqual(r.results, { andrewdb: 'no-lead', 'nobody-here': 'no-lead' });
  assert.strictEqual(r.noLead, 2);
});

check('the same person filed twice: the blank record is filled, the dated one is untouched', async () => {
  const w = world();
  const r = await fillConnectedDates(ON, [{ link: 'https://www.linkedin.com/in/Tess-Twin/', connected_at: MS('2025-05-04T14:00:00Z') }], { deps: w.deps, now: NOW });
  assert.deepStrictEqual(w.writes.map((x) => x.id), ['recTWIN2']);
  assert.strictEqual(w.leads[4].fields['Date Connected'], '2025-05-05T00:00:00.000Z');
  assert.deepStrictEqual(r.results, { 'tess-twin': 'filled' });
});

check('a client the collection is not switched on for: nothing is read, nothing is written', async () => {
  const w = world();
  const r = await fillConnectedDates({ clientId: 'Other-Client', airtableBaseId: 'baseX' }, [{ slug: 'dean-blank', connected_at: MS('2022-09-19T14:00:00Z') }], { deps: w.deps, now: NOW });
  assert.strictEqual(r.off, true);
  assert.strictEqual(w.reads.length + w.writes.length, 0);
});

check('running it again changes nothing', async () => {
  const w = world();
  const people = [{ slug: 'dean-blank', connected_at: MS('2022-09-19T14:00:00Z') }, { slug: 'cara-candidate', connected_at: MS('2025-07-01T14:00:00Z') }];
  await fillConnectedDates(ON, people, { deps: w.deps, now: NOW });
  const after = JSON.stringify(w.leads);
  const again = await fillConnectedDates(ON, people, { deps: w.deps, now: NOW });
  assert.strictEqual(JSON.stringify(w.leads), after);
  assert.deepStrictEqual({ filled: again.filled, dated: again.dated }, { filled: 0, dated: 2 });
});

check('dates that cannot be real are dropped; ms, seconds and ISO are all read; one entry per address', () => {
  assert.strictEqual(cleanDate(MS('2022-09-19T14:00:00Z'), NOW), '2022-09-19T14:00:00.000Z');
  assert.strictEqual(cleanDate(String(MS('2022-09-19T14:00:00Z')), NOW), '2022-09-19T14:00:00.000Z');
  assert.strictEqual(cleanDate(MS('2022-09-19T14:00:00Z') / 1000, NOW), '2022-09-19T14:00:00.000Z');
  assert.strictEqual(cleanDate('2022-09-19', NOW), '2022-09-19T00:00:00.000Z');
  assert.strictEqual(cleanDate(NOW + 20 * 3600 * 1000, NOW).slice(0, 10), '2026-11-26');   // the machine's local midnight can be "tomorrow" in UTC
  for (const bad of [NOW + 3 * 86400000, MS('1999-01-01T00:00:00Z'), 'not a date', '', null, undefined, 0]) assert.strictEqual(cleanDate(bad, NOW), '', String(bad));
  assert.deepStrictEqual(cleanPeople([
    { slug: 'A-B', connected_at: MS('2025-02-02T00:00:00Z') }, { link: 'https://www.linkedin.com/in/a-b/', connected_at: MS('2025-01-01T00:00:00Z') },
    { slug: '', connected_at: MS('2025-01-01T00:00:00Z') }, { slug: 'no-date' }, 'junk', null,
  ], NOW), [{ slug: 'a-b', iso: '2025-01-01T00:00:00.000Z' }]);
  assert.deepStrictEqual(cleanPeople('junk', NOW), []);
});

check('a leads base that cannot be read: nothing is written and nobody is called settled', async () => {
  const w = world();
  w.deps.clientService.getClientBase = () => () => ({ select: () => ({ all: async () => { throw new Error('Airtable is down'); } }) });
  const r = await fillConnectedDates(ON, [{ slug: 'dean-blank', connected_at: MS('2022-09-19T14:00:00Z') }], { deps: w.deps, now: NOW });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.results, {});          // no answer for them = the machine reports them again
});

(async () => {
  for (const run of pending) await run();
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nAll connected-date-fill tests passed');
  process.exit(0);
})();
