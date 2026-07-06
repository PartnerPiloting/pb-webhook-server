/**
 * Tests for create_lead (2026-07-07).
 *
 * The "I just accepted a connection who isn't in my CRM yet" moment (Guy): Wingguy could only UPDATE an
 * existing lead's email, never create the record. create_lead is the narrow, SHAPED companion to
 * update_lead_email — it files a new lead the way inbound leads land (Connected + Date Connected set),
 * dedupes on the LinkedIn URL so it never doubles a person, and lets the SAME turn then set the email /
 * book the meeting against the freshly-made record.
 *
 * Pure logic (createLead) is tested against a stubbed Airtable base; the agent wiring is tested via the
 * deps seam with a faked model. No network.
 *
 * Run: node tests/wingguy-create-lead.test.js
 */
const assert = require('assert');
const { runWingguyChatTurn } = require('../services/wingguyChat');
const wingguyLeads = require('../services/wingguyLeads');
const clientService = require('../services/clientService');

let failures = 0;
const acheck = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// A minimal in-memory Airtable base stub covering the surface createLead/findLeadRecord use:
// base('Leads').select({...}).firstPage(), .create([...]), .find(), .update([...]).
// `existing` seeds records that select() will "match" (any non-empty query returns them).
function stubBase({ existing = [] } = {}) {
  const created = [];
  const table = () => ({
    select: () => ({ firstPage: async () => existing }),
    create: async (rows) => {
      const recs = rows.map((r, i) => ({ id: `recNew${created.length + i + 1}`, fields: { ...r.fields } }));
      created.push(...recs);
      return recs;
    },
    find: async (id) => ({ id, fields: { ...(created.find((c) => c.id === id) || {}).fields } }),
    update: async (rows) => rows,
  });
  return { table, _created: created };
}

(async () => {
  // ── 1. createLead: no existing record → creates, shaped like inbound (Connected + Date Connected) ──
  console.log('createLead — files a brand-new lead:');
  {
    const base = stubBase({ existing: [] });
    const orig = clientService.getClientBase;
    clientService.getClientBase = () => base.table;
    try {
      const r = await wingguyLeads.createLead('baseX', { firstName: 'Alonso', lastName: 'Reyes', linkedinUrl: 'https://linkedin.com/in/alonso-reyes' });
      await acheck('ok + created', () => assert.ok(r.ok && r.created, JSON.stringify(r)));
      await acheck('got a new record id', () => assert.ok(r.leadRecordId, JSON.stringify(r)));
      await acheck('name + LinkedIn URL written', () => assert.ok(r.fields['First Name'] === 'Alonso' && /alonso-reyes/.test(r.fields['LinkedIn Profile URL'])));
      await acheck('filed as Connected', () => assert.strictEqual(r.fields['LinkedIn Connection Status'], 'Connected'));
      await acheck('Date Connected stamped (so it counts as connected)', () => assert.ok(r.fields['Date Connected']));
      await acheck('no email written when none given', () => assert.ok(!r.fields['Email']));
    } finally { clientService.getClientBase = orig; }
  }

  // ── 2. createLead: person already in the base → dedupes, no duplicate, hands back the record id ──
  console.log('\ncreateLead — dedupes an existing lead:');
  {
    const base = stubBase({ existing: [{ id: 'recOld1', fields: { 'First Name': 'Alonso', 'Last Name': 'Reyes' } }] });
    const orig = clientService.getClientBase;
    clientService.getClientBase = () => base.table;
    try {
      const r = await wingguyLeads.createLead('baseX', { firstName: 'Alonso', lastName: 'Reyes', linkedinUrl: 'https://linkedin.com/in/alonso-reyes' });
      await acheck('ok + exists (not created)', () => assert.ok(r.ok && r.exists && !r.created, JSON.stringify(r)));
      await acheck('points at the EXISTING record', () => assert.strictEqual(r.leadRecordId, 'recOld1'));
      await acheck('nothing new created', () => assert.strictEqual(base._created.length, 0));
    } finally { clientService.getClientBase = orig; }
  }

  // ── 3. createLead: nothing to identify the person → clean error, no throw ──
  console.log('\ncreateLead — refuses an empty create:');
  {
    const r = await wingguyLeads.createLead('baseX', {});
    await acheck('ok:false with a helpful error', () => assert.ok(!r.ok && /name or LinkedIn/.test(r.error), JSON.stringify(r)));
  }

  // ── 4. Agent wiring: create_lead then update_lead_email → the email lands on the NEW record, same turn ──
  console.log('\nagent — create_lead then set email hits the freshly-created record:');
  {
    let emailedRecordId = null;
    let call = 0;
    const client = { messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'create_lead', input: { firstName: 'Alonso', lastName: 'Reyes', linkedinUrl: 'https://linkedin.com/in/alonso-reyes' } }] };
      if (call === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'e1', name: 'update_lead_email', input: { primaryEmail: 'alonso@company.com' } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'added Alonso and filed his email' }] };
    } } };
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Alonso Reyes', profileUrl: 'https://linkedin.com/in/alonso-reyes' },
      messages: [{ role: 'user', content: 'save him to my leads and file alonso@company.com' }],
      airtableBaseId: 'baseX',
      leadRecordId: null, // not on file — this is the whole point
      deps: {
        client,
        createLead: async () => ({ ok: true, created: true, leadRecordId: 'recNewA', fields: { 'First Name': 'Alonso' } }),
        updateLeadEmails: async (_baseId, recId, { setPrimary }) => { emailedRecordId = recId; return { ok: true, changed: true, primaryEmail: setPrimary, altEmails: '' }; },
      },
    });
    await acheck('turn completed', () => assert.ok(res.ok));
    await acheck('email was filed against the NEWLY created record id', () => assert.strictEqual(emailedRecordId, 'recNewA'));
  }

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all create-lead tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
