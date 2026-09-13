/**
 * Tests for the contacts warehouse - step 1 of the lookup (2026-09-13).
 *
 * Covers the pure pieces (normalise, rank, lead -> contacts, ingest shaping) and the two MCP
 * runners against a stubbed store. No network, no database.
 *
 * Run: node tests/wingguy-contacts.test.js
 */
const assert = require('assert');
const { normaliseContact, rankMatches, cleanEmail } = require('../services/contactsStore');
const { leadToContacts } = require('../services/contactsSweep');
const { shapeContact } = require('../routes/contactsIngestRoutes');
const { runFindPerson, runContactsStatus, TOOL_DEFS, groupByPerson } = require('../services/wingguyContactsMcp');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };
const acheck = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

(async () => {
  console.log('normaliseContact():');
  check('lowercases + keys on the email', () => {
    const c = normaliseContact({ email: ' Bob.Carter@Acme.com ', first_name: 'Bob', last_name: 'Carter', source: 'lead' });
    assert.strictEqual(c.email, 'bob.carter@acme.com');
    assert.strictEqual(c.contactKey, 'bob.carter@acme.com');
    assert.strictEqual(c.name, 'Bob Carter');
    assert.deepStrictEqual(c.sources, ['lead']);
  });
  check('a lead with no email keys on the record id', () => {
    const c = normaliseContact({ lead_record_id: 'rec123', name: 'No Mail' });
    assert.strictEqual(c.email, null);
    assert.strictEqual(c.contactKey, 'lead:rec123');
  });
  check('a name alone is not a contact', () => assert.strictEqual(normaliseContact({ name: 'Nobody' }), null));
  check('a junk email with no lead id is not a contact', () => assert.strictEqual(normaliseContact({ email: 'not an email' }), null));
  check('linkedin url becomes the canonical slug', () => {
    const c = normaliseContact({ email: 'a@b.co', linkedin_url: 'https://www.linkedin.com/in/Bob-Carter-123/' });
    assert.strictEqual(c.linkedinSlug, 'bob-carter-123');
  });
  check('source slugs are cleaned, deduped, keep the ingest: prefix', () => {
    const c = normaliseContact({ email: 'a@b.co', sources: ['ingest:Google Contacts', 'lead', 'lead'] });
    assert.deepStrictEqual(c.sources, ['ingest:googlecontacts', 'lead']);
  });
  check('bad last_seen_at is dropped, good one parsed', () => {
    assert.strictEqual(normaliseContact({ email: 'a@b.co', last_seen_at: 'nope' }).lastSeenAt, null);
    assert.ok(normaliseContact({ email: 'a@b.co', last_seen_at: '2026-09-01T00:00:00Z' }).lastSeenAt instanceof Date);
  });

  console.log('\nrankMatches():');
  const rows = [
    { email: 'robert@x.com', name: 'Robert Bobbins', last_seen_at: '2026-09-01' },
    { email: 'bob.carter@acme.com', name: 'Bob Carter', last_seen_at: '2026-08-01' },
    { email: 'bob@old.com', name: 'Bob Carter', last_seen_at: '2026-09-10' },
    { email: null, name: 'Bobby Tables', last_seen_at: null },
  ];
  check('exact email wins outright', () => {
    assert.strictEqual(rankMatches(rows, 'bob.carter@acme.com')[0].email, 'bob.carter@acme.com');
  });
  check('exact name ties broken by freshest evidence', () => {
    const r = rankMatches(rows, 'bob carter');
    assert.strictEqual(r[0].email, 'bob@old.com');
    assert.strictEqual(r[1].email, 'bob.carter@acme.com');
  });
  check('name-starts-with beats a mid-name hit', () => {
    const r = rankMatches(rows, 'bob');
    assert.ok(['bob@old.com', 'bob.carter@acme.com', null].includes(r[0].email));
    assert.strictEqual(r[r.length - 1].email, 'robert@x.com');
  });

  console.log('\nleadToContacts():');
  check('primary + each alt, shared identity, alt tagged', () => {
    const cs = leadToContacts({ id: 'recA', fields: {
      'First Name': 'Alix', 'Last Name': 'Simpson', Email: 'alix@gmail.com', 'Alt Emails': 'alix.simpson@absorb.com\nALIX@GMAIL.COM',
      'Company Name': 'Absorb', 'LinkedIn Profile URL': 'https://linkedin.com/in/alix-simpson', 'Date Connected': '2026-08-20',
    } });
    assert.strictEqual(cs.length, 2);
    assert.strictEqual(cs[0].email, 'alix@gmail.com'); assert.strictEqual(cs[0].source, 'lead');
    assert.strictEqual(cs[1].email, 'alix.simpson@absorb.com'); assert.strictEqual(cs[1].source, 'lead-alt');
    assert.strictEqual(cs[1].company, 'Absorb'); assert.strictEqual(cs[1].lead_record_id, 'recA');
    assert.strictEqual(cs[0].linkedin_slug, 'alix-simpson');
    assert.strictEqual(cs[0].evidence, 'connected 20 Aug 2026');
  });
  check('no connection date = no evidence text (the source label already says "lead record")', () => {
    assert.strictEqual(leadToContacts({ id: 'recC', fields: { Email: 'c@d.co' } })[0].evidence, '');
  });

  console.log('\ngroupByPerson():');
  check('primary + alt rows of one lead fold into one person, primary first', () => {
    const g = groupByPerson([
      { email: 'alix.n@gmail.com', name: 'Alix Simpson', lead_record_id: 'recA', sources: ['lead-alt'] },
      { email: 'alix@absorb.com', name: 'Alix Simpson', lead_record_id: 'recA', sources: ['lead'] },
      { email: 'other@x.com', name: 'Other Person', lead_record_id: 'recB', sources: ['lead'] },
    ]);
    assert.strictEqual(g.length, 2);
    assert.deepStrictEqual(g[0].emails, ['alix@absorb.com', 'alix.n@gmail.com']);
    assert.deepStrictEqual(g[0].sources.sort(), ['lead', 'lead-alt']);
  });
  check('rows without a lead id never fold together', () => {
    const g = groupByPerson([
      { email: 'a@x.com', name: 'Same Name', sources: ['comms-log'] },
      { email: 'b@x.com', name: 'Same Name', sources: ['comms-log'] },
    ]);
    assert.strictEqual(g.length, 2);
  });
  check('no email at all still yields one lead-keyed row', () => {
    const cs = leadToContacts({ id: 'recB', fields: { 'First Name': 'No', 'Last Name': 'Mail' } });
    assert.strictEqual(cs.length, 1);
    assert.strictEqual(normaliseContact(cs[0]).contactKey, 'lead:recB');
  });

  console.log('\nshapeContact() (ingest door):');
  check('Make/Google-style keys map across and the source is tagged', () => {
    const c = shapeContact({ email: 'X@Y.com', given_name: 'Guy', surname: 'Wilson', company_name: 'IKAG', job_title: 'Founder', source: 'Google Contacts' }, 'feed');
    assert.strictEqual(c.first_name, 'Guy'); assert.strictEqual(c.last_name, 'Wilson');
    assert.strictEqual(c.company, 'IKAG'); assert.strictEqual(c.headline, 'Founder');
    assert.strictEqual(c.source, 'ingest:googlecontacts');
  });
  check('missing source falls back to the batch default', () => {
    assert.strictEqual(shapeContact({ email: 'a@b.co' }, 'zapier').source, 'ingest:zapier');
  });
  check('non-object is ignored', () => assert.strictEqual(shapeContact('junk', 'feed'), null));

  console.log('\nrunFindPerson() against a stubbed store:');
  const stub = (rowsOut, status) => ({
    findPeople: async (tenant, q) => { stub.lastTenant = tenant; stub.lastQuery = q; return rowsOut; },
    tenantStatus: async () => status,
  });
  await acheck('empty query is an error', async () => {
    const r = await runFindPerson({ query: '  ' }, 'T1', { store: stub([]) });
    assert.ok(r.isError);
  });
  await acheck('tenant is passed through untouched (never from args)', async () => {
    const s = stub([]);
    await runFindPerson({ query: 'bob', tenant: 'Evil' }, 'Rick-Wong', { store: s });
    assert.strictEqual(stub.lastTenant, 'Rick-Wong');
  });
  await acheck('one match reads as "use this address"', async () => {
    const r = await runFindPerson({ query: 'bob' }, 'T1', { store: stub([
      { email: 'bob@acme.com', name: 'Bob Carter', company: 'Acme', sources: ['lead'], evidence: 'lead record - connected 3 Sep 2026', lead_record_id: 'rec1' },
    ]) });
    assert.ok(/Found one match/.test(r.text), r.text);
    assert.ok(/Use bob@acme.com/.test(r.text), r.text);
    assert.ok(/lead record/.test(r.text) && /rec1/.test(r.text), r.text);
  });
  await acheck('one person with two addresses is ONE match, primary used, alt shown as "also"', async () => {
    const r = await runFindPerson({ query: 'alix' }, 'T1', { store: stub([
      { email: 'alix@absorb.com', name: 'Alix Simpson', lead_record_id: 'recA', sources: ['lead'] },
      { email: 'alix.n@gmail.com', name: 'Alix Simpson', lead_record_id: 'recA', sources: ['lead-alt'] },
    ]) });
    assert.ok(/Found one match/.test(r.text), r.text);
    assert.ok(/<alix@absorb.com> \(also alix.n@gmail.com\)/.test(r.text), r.text);
    assert.ok(/Use alix@absorb.com\./.test(r.text), r.text);
  });
  await acheck('several matches ask the human to pick', async () => {
    const r = await runFindPerson({ query: 'bob' }, 'T1', { store: stub([
      { email: 'bob@acme.com', name: 'Bob Carter', sources: ['lead'] },
      { email: 'bob@zed.com', name: 'Bob Zed', sources: ['comms-log'] },
    ]) });
    assert.ok(/2 people match/.test(r.text), r.text);
    assert.ok(/Confirm which/.test(r.text), r.text);
  });
  await acheck('a lead with no email says so instead of inventing one', async () => {
    const r = await runFindPerson({ query: 'no mail' }, 'T1', { store: stub([
      { email: null, name: 'No Mail', sources: ['lead'], lead_record_id: 'recB' },
    ]) });
    assert.ok(/NO EMAIL on file/.test(r.text), r.text);
    assert.ok(/wingguy_update_lead/.test(r.text), r.text);
  });
  await acheck('no match points at create_lead and status', async () => {
    const r = await runFindPerson({ query: 'ghost' }, 'T1', { store: stub([]) });
    assert.ok(/wingguy_create_lead/.test(r.text) && /wingguy_contacts_status/.test(r.text), r.text);
  });

  console.log('\nrunContactsStatus():');
  await acheck('empty warehouse is explained, not an error', async () => {
    const r = await runContactsStatus({}, 'T1', { store: stub([], { total: 0, withEmail: 0, bySource: {}, sweeps: [] }) });
    assert.ok(!r.isError && /empty/.test(r.text), r.text);
  });
  await acheck('stocked warehouse lists counts + sweeps', async () => {
    const r = await runContactsStatus({}, 'T1', { store: stub([], {
      total: 120, withEmail: 100, bySource: { lead: 90, 'comms-log': 30 },
      sweeps: [{ source: 'lead', last_run_at: '2026-09-13T02:00:00Z', rows_seen: 90, note: 'full' }],
    }) });
    assert.ok(/120 people/.test(r.text) && /100 with an email/.test(r.text), r.text);
    assert.ok(/lead record: 90/.test(r.text), r.text);
    assert.ok(/2026-09-13 02:00Z/.test(r.text), r.text);
  });

  console.log('\nTOOL_DEFS shape:');
  check('both transports get the same two tools', () => {
    assert.deepStrictEqual(TOOL_DEFS.map((d) => d.name), ['wingguy_find_person', 'wingguy_contacts_status']);
    for (const d of TOOL_DEFS) { assert.ok(d.jsonSchema && d.zodSchema && typeof d.run === 'function', d.name); }
  });
  check('cleanEmail rejects shapes that are not addresses', () => {
    assert.strictEqual(cleanEmail('Bob Carter'), '');
    assert.strictEqual(cleanEmail(' A@B.CO '), 'a@b.co');
  });

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
