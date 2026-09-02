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

  // ── 5. createLead: writes the Phone field when a phone is passed ──
  console.log('\ncreateLead — writes phone when given:');
  {
    const base = stubBase({ existing: [] });
    const orig = clientService.getClientBase;
    clientService.getClientBase = () => base.table;
    try {
      const r = await wingguyLeads.createLead('baseX', { firstName: 'Alonso', linkedinUrl: 'https://linkedin.com/in/alonso-reyes', phone: '0412 345 678' });
      await acheck('phone written to the Phone field', () => assert.strictEqual(r.fields['Phone'], '0412 345 678'));
    } finally { clientService.getClientBase = orig; }
  }

  // ── 5b. createLead: an INTRODUCED person — location lands in Location, introducer leads the Notes ──
  console.log('\ncreateLead — introduction files location + "Introduced by" provenance:');
  {
    const base = stubBase({ existing: [] });
    const orig = clientService.getClientBase;
    clientService.getClientBase = () => base.table;
    try {
      const r = await wingguyLeads.createLead('baseX', { firstName: 'Paul', lastName: 'Example', location: 'Melbourne, Victoria', introducedBy: 'Jane Smith', notes: 'wants to talk referrals' });
      await acheck('Location written', () => assert.strictEqual(r.fields['Location'], 'Melbourne, Victoria'));
      await acheck('Notes start with "Introduced by <name>"', () => assert.ok(/^Introduced by Jane Smith\n/.test(r.fields['Notes']), r.fields['Notes']));
      await acheck('caller notes kept after the provenance line', () => assert.ok(/wants to talk referrals$/.test(r.fields['Notes'])));
      const r2 = await wingguyLeads.createLead('baseX', { firstName: 'Paul', lastName: 'Example', introducedBy: 'Jane Smith' });
      await acheck('introducer alone still writes Notes', () => assert.strictEqual(r2.fields['Notes'], 'Introduced by Jane Smith'));
      await acheck('no Location written when none given', () => assert.ok(!r2.fields['Location']));
    } finally { clientService.getClientBase = orig; }
  }

  // ── 5c. GROUP thread guard (2026-09-02): creating a DIFFERENT participant must not inherit the
  //       person-in-view's URL/location (Dimitri in view; Guy says "add Ann") ──
  console.log('\nagent — create_lead for ANOTHER participant does not borrow the profile URL/location:');
  {
    let seen = null;
    let call = 0;
    const client = { messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'create_lead', input: { firstName: 'Ann', lastName: 'Luong', introducedBy: '' } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'added Ann' }] };
    } } };
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Dimitri Tsitsikas', profileUrl: 'https://www.linkedin.com/in/dimitri-t', location: 'Melbourne, Victoria',
        group: { title: 'Ann, Dimitri, and you', participants: [{ name: 'Ann Luong', profileUrl: '' }, { name: 'Dimitri Tsitsikas', profileUrl: 'https://www.linkedin.com/in/dimitri-t' }] } },
      messages: [{ role: 'user', content: 'add Ann to my leads' }],
      airtableBaseId: 'baseX',
      leadRecordId: 'recDimitri',
      deps: { client, createLead: async (_b, args) => { seen = args; return { ok: true, created: true, leadRecordId: 'recAnn', fields: { 'First Name': 'Ann' } }; } },
    });
    await acheck('turn completed', () => assert.ok(res.ok));
    await acheck('Ann is created under her own name', () => assert.strictEqual(seen && seen.firstName, 'Ann'));
    await acheck('Dimitri\'s URL is NOT stamped on Ann', () => assert.strictEqual(seen && seen.linkedinUrl, ''));
    await acheck('Dimitri\'s location is NOT stamped on Ann', () => assert.strictEqual(seen && seen.location, ''));
    await acheck('no enrich signal (no URL to read)', () => assert.ok(!res.enrichContact, JSON.stringify(res.enrichContact)));
  }

  // ── 6. updateLeadContact: LinkedIn contact enrich is NON-DESTRUCTIVE (thread email wins; phone fills) ──
  console.log('\nupdateLeadContact — fills phone always, email only when empty:');
  {
    // Record already has a thread-supplied email but no phone (the create → enrich moment).
    const updates = [];
    const table = () => ({
      find: async (id) => ({ id, fields: { 'Email': 'thread@company.com', 'Phone': '' } }),
      update: async (rows) => { updates.push(...rows); return rows; },
    });
    const orig = clientService.getClientBase;
    clientService.getClientBase = () => table;
    try {
      const r = await wingguyLeads.updateLeadContact('baseX', 'recX', { email: 'linkedin@personal.com', phone: '+61 400 111 222' });
      await acheck('ok + changed', () => assert.ok(r.ok && r.changed, JSON.stringify(r)));
      await acheck('phone added (record had none)', () => assert.strictEqual(r.added.phone, '+61 400 111 222'));
      await acheck('email NOT overwritten (thread address wins)', () => assert.ok(!r.added.email, JSON.stringify(r.added)));
      await acheck('only Phone written to Airtable', () => assert.deepStrictEqual(Object.keys(updates[0].fields), ['Phone']));
    } finally { clientService.getClientBase = orig; }
  }

  // ── 7. updateLeadContact: fills the email too when the record has none ──
  console.log('\nupdateLeadContact — fills email when record has none:');
  {
    const table = () => ({
      find: async (id) => ({ id, fields: { 'Email': '', 'Phone': '' } }),
      update: async (rows) => rows,
    });
    const orig = clientService.getClientBase;
    clientService.getClientBase = () => table;
    try {
      const r = await wingguyLeads.updateLeadContact('baseX', 'recX', { email: 'LinkedIn@Personal.com', phone: '0400 111 222' });
      await acheck('email filled + lowercased', () => assert.strictEqual(r.added.email, 'linkedin@personal.com'));
      await acheck('phone filled', () => assert.strictEqual(r.added.phone, '0400 111 222'));
    } finally { clientService.getClientBase = orig; }
  }

  // ── 8. Agent wiring: a FRESH create returns the createdLead enrich signal (with profileUrl) ──
  console.log('\nagent — fresh create returns createdLead signal for the extension to enrich:');
  {
    let call = 0;
    const client = { messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'create_lead', input: { firstName: 'Alonso', linkedinUrl: 'https://www.linkedin.com/in/alonso-reyes' } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'added Alonso — grabbing his contact details from LinkedIn' }] };
    } } };
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Alonso Reyes', profileUrl: 'https://www.linkedin.com/in/alonso-reyes' },
      messages: [{ role: 'user', content: 'add him as a lead' }],
      airtableBaseId: 'baseX',
      leadRecordId: null,
      deps: { client, createLead: async () => ({ ok: true, created: true, leadRecordId: 'recNewA', fields: { 'First Name': 'Alonso' } }) },
    });
    await acheck('enrichContact signal present', () => assert.ok(res.enrichContact && res.enrichContact.leadRecordId === 'recNewA', JSON.stringify(res.enrichContact)));
    await acheck('carries the profileUrl to scrape', () => assert.ok(/alonso-reyes/.test(res.enrichContact.profileUrl)));
    await acheck('flagged as an automatic (non-manual) enrich', () => assert.strictEqual(res.enrichContact.manual, false));
  }

  // ── 9. Agent wiring: matching an EXISTING lead does NOT trigger enrich (no wasted contact-info fetch) ──
  console.log('\nagent — existing-match create does NOT signal enrich:');
  {
    let call = 0;
    const client = { messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'create_lead', input: { firstName: 'Alonso', linkedinUrl: 'https://www.linkedin.com/in/alonso-reyes' } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'he is already in your CRM' }] };
    } } };
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Alonso Reyes', profileUrl: 'https://www.linkedin.com/in/alonso-reyes' },
      messages: [{ role: 'user', content: 'add him as a lead' }],
      airtableBaseId: 'baseX',
      leadRecordId: null,
      deps: { client, createLead: async () => ({ ok: true, exists: true, leadRecordId: 'recOld1', name: 'Alonso Reyes' }) },
    });
    await acheck('no enrichContact signal on an existing match', () => assert.ok(!res.enrichContact, JSON.stringify(res.enrichContact)));
  }

  // ── 10. refresh_contact_info: an on-file lead → manual enrich signal at their record ──
  console.log('\nagent — refresh_contact_info signals a manual enrich for an on-file lead:');
  {
    let call = 0;
    const client = { messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'r1', name: 'refresh_contact_info', input: {} }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'grabbing his details from LinkedIn' }] };
    } } };
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Alonso Reyes', profileUrl: 'https://www.linkedin.com/in/alonso-reyes' },
      messages: [{ role: 'user', content: 'grab his contact details from LinkedIn' }],
      airtableBaseId: 'baseX',
      leadRecordId: 'recExisting1',   // already on file
      deps: { client },
    });
    await acheck('enrichContact points at the existing record', () => assert.ok(res.enrichContact && res.enrichContact.leadRecordId === 'recExisting1', JSON.stringify(res.enrichContact)));
    await acheck('flagged manual (Guy asked)', () => assert.strictEqual(res.enrichContact.manual, true));
  }

  // ── 11. refresh_contact_info: lead NOT on file → clean error, no enrich signal ──
  console.log('\nagent — refresh_contact_info on a not-yet-saved lead errors instead of enriching:');
  {
    let call = 0;
    const client = { messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'r1', name: 'refresh_contact_info', input: {} }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'he is not in your CRM yet' }] };
    } } };
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Alonso Reyes', profileUrl: 'https://www.linkedin.com/in/alonso-reyes' },
      messages: [{ role: 'user', content: 'grab his contact details' }],
      airtableBaseId: 'baseX',
      leadRecordId: null,   // NOT on file
      deps: { client },
    });
    await acheck('no enrich signal when the lead has no record', () => assert.ok(!res.enrichContact, JSON.stringify(res.enrichContact)));
  }

  // ── Bognar/Byrne regression (2026-07-28): a slug that's a PREFIX of an existing slug is a DIFFERENT person ──
  // The old dedup was Airtable SEARCH() (containment), so /in/andrewdb matched /in/andrewdbyrne, the
  // create was refused, and the caller was handed Byrne's record. This stub is formula-aware: the
  // SEARCH prefilter legitimately RETURNS Byrne (his URL contains "andrewdb") — the fix must reject
  // him on exact canonical-slug verify, then fail the exact-name check too, and CREATE Bognar.
  console.log('\ncreateLead — prefix slug must NOT dedupe (Bognar vs Byrne):');
  {
    const byrne = { id: 'recByrne', fields: { 'First Name': 'Andrew', 'Last Name': 'Byrne', 'LinkedIn Profile URL': 'https://www.linkedin.com/in/andrewdbyrne' } };
    const created = [];
    const table = () => ({
      select: ({ filterByFormula = '' } = {}) => ({ firstPage: async () => {
        if (filterByFormula.includes('SEARCH(')) {
          return (filterByFormula.includes('"andrewdb"') || filterByFormula.includes('"andrewdbyrne"')) ? [byrne] : [];
        }
        if (filterByFormula.includes('{First Name}')) {
          return (filterByFormula.includes('"andrew"') && filterByFormula.includes('"byrne"')) ? [byrne] : [];
        }
        return [];
      } }),
      create: async (rows) => { const recs = rows.map((r, i) => ({ id: `recNew${created.length + i + 1}`, fields: { ...r.fields } })); created.push(...recs); return recs; },
    });
    const orig = clientService.getClientBase;
    clientService.getClientBase = () => table;
    try {
      // Call A from the bug brief: must now CREATE, not return Byrne.
      const r = await wingguyLeads.createLead('baseX', { firstName: 'Andrew', lastName: 'Bognar', email: 'andrew.bognar@gmail.com', linkedinUrl: 'https://www.linkedin.com/in/andrewdb/' });
      await acheck('creates a NEW record (no false dedup)', () => assert.ok(r.ok && r.created && !r.exists, JSON.stringify(r)));
      await acheck('does not hand back Byrne', () => assert.notStrictEqual(r.leadRecordId, 'recByrne'));

      // The SAME slug in any spelling IS Byrne — format variants must still dedupe to his record.
      const dup = await wingguyLeads.createLead('baseX', { firstName: 'Andrew', lastName: 'Byrne', linkedinUrl: ' HTTP://au.linkedin.com/in/AndrewDByrne?trk=x ' });
      await acheck('format variants still dedupe to the existing record', () => assert.ok(dup.ok && dup.exists && dup.leadRecordId === 'recByrne', JSON.stringify(dup)));

      // No URL at all → exact-name dedup still works as designed.
      const byName = await wingguyLeads.createLead('baseX', { firstName: 'Andrew', lastName: 'Byrne' });
      await acheck('URL omitted still dedupes on exact name', () => assert.ok(byName.ok && byName.exists && byName.leadRecordId === 'recByrne', JSON.stringify(byName)));
    } finally { clientService.getClientBase = orig; }
  }

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all create-lead tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
