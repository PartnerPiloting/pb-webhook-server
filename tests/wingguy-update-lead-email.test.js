/**
 * Tests for update_lead_email (2026-07-02).
 *
 * Fixes the two problems in the Mila Sedivy thread:
 *  (1) Wingguy falsely claimed it "has no access to Airtable" — it reads the CRM every turn and now
 *      also has ONE write (email). This proves the write tool is wired through the agent loop.
 *  (2) The invite must go to the email the lead actually gave — so setting a new primary re-points
 *      the address book_meeting uses, WITHIN the same turn.
 *
 * Pure logic (buildAltEmails / updateLeadEmails) is tested against a stubbed Airtable base; the
 * agent wiring is tested via the deps seam with a faked model. No network.
 *
 * Run: node tests/wingguy-update-lead-email.test.js
 */
const assert = require('assert');
const { runWingguyChatTurn } = require('../services/wingguyChat');
const wingguyLeads = require('../services/wingguyLeads');
const clientService = require('../services/clientService');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };
const acheck = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// A minimal in-memory Airtable base stub matching the .find()/.update() surface wingguyLeads uses.
function stubBase(initialFields) {
  const store = { fields: { ...initialFields } };
  const table = () => ({
    find: async () => ({ id: 'recLead1', fields: { ...store.fields } }),
    update: async (rows) => { Object.assign(store.fields, rows[0].fields); return rows; },
  });
  return { table, _store: store };
}

(async () => {
  // ── 1. buildAltEmails: dedupe, strip primary, drop junk, lowercase ──────────────────────────────
  console.log('buildAltEmails — cleans and de-dupes:');
  {
    const out = wingguyLeads.buildAltEmails(['old@a.com\nOLD@a.com', 'new@b.com', 'not-an-email', ''], 'new@b.com');
    check('drops the primary', () => assert.ok(!out.includes('new@b.com')));
    check('keeps the old address once', () => assert.strictEqual((out.match(/old@a.com/g) || []).length, 1));
    check('drops the junk token', () => assert.ok(!out.includes('not-an-email')));
  }

  // ── 2. updateLeadEmails: new primary, old primary preserved as an alternate ─────────────────────
  console.log('\nupdateLeadEmails — swaps primary, keeps the old one as an alternate:');
  {
    const base = stubBase({ 'Email': 'mila.sedivy@gmail.com', 'Alt Emails': '' });
    const orig = clientService.getClientBase;
    clientService.getClientBase = () => base.table;
    try {
      const r = await wingguyLeads.updateLeadEmails('baseX', 'recLead1', { setPrimary: 'mila@mavenconsultingasia.com' });
      await acheck('ok + changed', () => assert.ok(r.ok && r.changed, JSON.stringify(r)));
      await acheck('primary is the new work address', () => assert.strictEqual(base._store.fields['Email'], 'mila@mavenconsultingasia.com'));
      await acheck('old gmail moved into Alt Emails', () => assert.ok(String(base._store.fields['Alt Emails']).includes('mila.sedivy@gmail.com')));
    } finally { clientService.getClientBase = orig; }
  }

  // ── 3. updateLeadEmails: missing record id → clean error, no throw ──────────────────────────────
  console.log('\nupdateLeadEmails — no CRM match reports cleanly:');
  {
    const r = await wingguyLeads.updateLeadEmails('baseX', null, { setPrimary: 'x@y.com' });
    await acheck('ok:false with a Portal hint', () => assert.ok(!r.ok && /Portal/.test(r.error), JSON.stringify(r)));
  }

  // ── 4. Agent wiring: update_lead_email then book → invite goes to the NEW primary, same turn ─────
  console.log('\nagent — a new primary re-points the invite within the turn:');
  {
    let bookedEmail = null;
    let call = 0;
    const client = { messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u1', name: 'update_lead_email', input: { primaryEmail: 'mila@mavenconsultingasia.com' } }] };
      if (call === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'b1', name: 'book_meeting', input: { startISO: '2026-07-07T14:30:00+10:00' } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'updated her email and booked — invite is on its way' }] };
    } } };
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Mila', location: 'Sydney' },
      messages: [{ role: 'user', content: 'use the maven email and book Tuesday' }],
      leadEmail: 'mila.sedivy@gmail.com',
      airtableBaseId: 'baseX',
      leadRecordId: 'recLead1',
      deps: {
        client,
        getClashesForISO: async () => [],
        updateLeadEmails: async (_baseId, _recId, { setPrimary }) => ({ ok: true, changed: true, primaryEmail: setPrimary, altEmails: 'mila.sedivy@gmail.com' }),
        createBookingEvent: async (_coach, { leadEmail }) => { bookedEmail = leadEmail; return { ok: true, eventId: 'evt_1', start: '2026-07-07T14:30:00+10:00' }; },
      },
    });
    await acheck('turn completed', () => assert.ok(res.ok));
    await acheck('invite went to the NEW work email, not the old gmail', () => assert.strictEqual(bookedEmail, 'mila@mavenconsultingasia.com'));
    await acheck('booking recorded on the result', () => assert.ok(res.booked && res.booked.ok));
  }

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all update-lead-email tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
