/**
 * Tests for wingguy_update_lead (2026-08-20).
 *
 * The "Dean Hobin is in Sydney" moment (Guy): the connector could CREATE a lead and swap their
 * email, but had no way to correct a contact fact on an existing record — location especially,
 * which drives the lead-timezone maths when offering times. updateLeadFacts is the narrow, shaped
 * write (Location / Email / Phone only, overwrite-with-stated-values, old primary email preserved
 * into Alt Emails, no blanking); runUpdateLead wraps it with the lookup + old → new reporting.
 *
 * Pure logic tested against a stubbed Airtable base; the MCP runner via stubbed clientService.
 * No network.
 *
 * Run: node tests/wingguy-update-lead.test.js
 */
const assert = require('assert');
const wingguyLeads = require('../services/wingguyLeads');
const clientService = require('../services/clientService');
const { runUpdateLead } = require('../services/wingguyLeadsMcp');

let failures = 0;
const acheck = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// In-memory Airtable stub covering what updateLeadFacts/runUpdateLead touch:
// base('Leads').find(id), .update([{id, fields}]), .select({...}).all()/.firstPage().
function stubBase({ record = null, matches = [] } = {}) {
  const updates = [];
  const table = () => ({
    find: async () => record,
    update: async (rows) => { updates.push(...rows); return rows; },
    select: () => ({ all: async () => matches, firstPage: async () => matches }),
  });
  return { table, _updates: updates };
}

(async () => {
  // ── 1. Location: filled onto an empty field, reported old → new ──
  console.log('updateLeadFacts — location:');
  {
    const base = stubBase({ record: { id: 'rec1', fields: { 'First Name': 'Dean', 'Last Name': 'Hobin' } } });
    const orig = clientService.getClientBase;
    clientService.getClientBase = () => base.table;
    try {
      const r = await wingguyLeads.updateLeadFacts('baseX', 'rec1', { location: 'Sydney, New South Wales' });
      await acheck('ok + changed', () => assert.ok(r.ok && r.changed, JSON.stringify(r)));
      await acheck('one change: Location, from empty', () => {
        assert.strictEqual(r.changes.length, 1);
        assert.deepStrictEqual(r.changes[0], { field: 'Location', from: '', to: 'Sydney, New South Wales' });
      });
      await acheck('write touches ONLY Location', () => {
        assert.strictEqual(base._updates.length, 1);
        assert.deepStrictEqual(Object.keys(base._updates[0].fields), ['Location']);
      });
    } finally { clientService.getClientBase = orig; }
  }

  // ── 2. Email: primary swapped, old primary preserved into Alt Emails ──
  console.log('updateLeadFacts — email preserves the old primary:');
  {
    const base = stubBase({ record: { id: 'rec1', fields: { 'Email': 'old@personal.com', 'Alt Emails': 'spare@x.com' } } });
    const orig = clientService.getClientBase;
    clientService.getClientBase = () => base.table;
    try {
      const r = await wingguyLeads.updateLeadFacts('baseX', 'rec1', { email: 'New@Work.com' });
      await acheck('ok + changed, email lowercased', () => {
        assert.ok(r.ok && r.changed);
        assert.deepStrictEqual(r.changes[0], { field: 'Email', from: 'old@personal.com', to: 'new@work.com' });
      });
      await acheck('old primary lands in Alt Emails alongside existing alts', () => {
        const alts = base._updates[0].fields['Alt Emails'].split('\n');
        assert.ok(alts.includes('old@personal.com'), alts.join(','));
        assert.ok(alts.includes('spare@x.com'), alts.join(','));
      });
      await acheck('preservation is noted for the assistant to relay', () => assert.ok(r.notes[0].includes('old@personal.com')));
    } finally { clientService.getClientBase = orig; }
  }

  // ── 3. No-ops and guards ──
  console.log('updateLeadFacts — guards:');
  {
    const base = stubBase({ record: { id: 'rec1', fields: { 'Location': 'Brisbane', 'Phone': '0400 000 000' } } });
    const orig = clientService.getClientBase;
    clientService.getClientBase = () => base.table;
    try {
      const same = await wingguyLeads.updateLeadFacts('baseX', 'rec1', { location: 'Brisbane' });
      await acheck('same value = no write, changed:false', () => {
        assert.ok(same.ok && !same.changed);
        assert.strictEqual(base._updates.length, 0);
      });
      const none = await wingguyLeads.updateLeadFacts('baseX', 'rec1', {});
      await acheck('nothing passed = error, never a blank write', () => assert.ok(!none.ok && /nothing to update/.test(none.error)));
      const bad = await wingguyLeads.updateLeadFacts('baseX', 'rec1', { email: 'not-an-email' });
      await acheck('malformed email refused', () => assert.ok(!bad.ok && /valid email/.test(bad.error)));
    } finally { clientService.getClientBase = orig; }
  }

  // ── 4. runUpdateLead: ambiguous name = list back, no write ──
  console.log('runUpdateLead — lookup:');
  {
    const two = [
      { id: 'recA', fields: { 'First Name': 'Dean', 'Last Name': 'Hobin', 'Email': 'dean@x.com' } },
      { id: 'recB', fields: { 'First Name': 'Dean', 'Last Name': 'Harris' } },
    ];
    const base = stubBase({ matches: two });
    const origBase = clientService.getClientBase;
    const origById = clientService.getClientById;
    clientService.getClientBase = () => base.table;
    clientService.getClientById = async () => ({ clientId: 'Guy-Wilson', airtableBaseId: 'baseX' });
    try {
      const r = await runUpdateLead({ lead_name: 'Dean', location: 'Sydney' });
      await acheck('two Deans = disambiguation list, nothing written', () => {
        assert.ok(/More than one lead/.test(r.text), r.text);
        assert.strictEqual(base._updates.length, 0);
      });
      const none = await runUpdateLead({ lead_name: 'Dean' });
      await acheck('no fields passed = error before any lookup write', () => assert.ok(none.isError && /nothing to update/.test(none.text)));
    } finally { clientService.getClientBase = origBase; clientService.getClientById = origById; }
  }

  // ── 5. runUpdateLead: unique match = write + old → new report ──
  {
    const rec = { id: 'recA', fields: { 'First Name': 'Dean', 'Last Name': 'Hobin' } };
    const base = stubBase({ record: rec, matches: [rec] });
    const origBase = clientService.getClientBase;
    const origById = clientService.getClientById;
    clientService.getClientBase = () => base.table;
    clientService.getClientById = async () => ({ clientId: 'Guy-Wilson', airtableBaseId: 'baseX' });
    try {
      const r = await runUpdateLead({ lead_name: 'Dean Hobin', location: 'Sydney, New South Wales' });
      await acheck('unique match writes and reports old → new', () => {
        assert.ok(!r.isError, r.text);
        assert.ok(/Updated Dean Hobin/.test(r.text), r.text);
        assert.ok(/\(was empty\) → "Sydney, New South Wales"/.test(r.text), r.text);
        assert.strictEqual(base._updates.length, 1);
      });
    } finally { clientService.getClientBase = origBase; clientService.getClientById = origById; }
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
