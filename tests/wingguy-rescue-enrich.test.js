/**
 * Tests for the capture-rescue enrichment path (2026-09-02).
 *
 * The gap: a rescue create is made from a MESSAGE THREAD, so the turn has no profile scrape and the
 * record lands with a name, a URL and nothing else — invisible to the nightly scorer (it reads only
 * 'To Be Scored') and unreachable by Linked Helper unless the client runs campaigns. Julian had 14
 * such leads. The extension now does a hidden-tab profile read and posts it to
 * POST /api/wingguy/enrich-lead, which runs enrichLeadFromScrape + scoreLeadInstant.
 *
 * These tests pin the behaviour that makes that safe to run against a live CRM:
 *   - a profile-surface scrape fills the blanks and queues the lead for scoring
 *   - a MESSAGING-surface scrape must NOT be trusted for the headline (it is a thread snippet)
 *   - existing values (Linked Helper material, human edits) are never overwritten
 *   - an empty scrape writes nothing rather than blanking a record
 *   - a short About does not fire an instant score (it would just stamp them Skipped)
 *
 * Pure logic against a stubbed Airtable base. No network.
 *
 * Run: node tests/wingguy-rescue-enrich.test.js
 */
const assert = require('assert');
const wingguyLeads = require('../services/wingguyLeads');
const clientService = require('../services/clientService');

let failures = 0;
const acheck = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

function stubBase({ record = null } = {}) {
  const updates = [];
  const table = () => ({
    find: async () => record,
    update: async (rows) => { updates.push(...rows); return rows; },
    select: () => ({ all: async () => [], firstPage: async () => [] }),
  });
  return { table, _updates: updates };
}

// What the hidden-tab read hands back for a real profile page. Long enough About to clear the
// 40-char instant-score gate.
const PROFILE_SCRAPE = {
  _wgSurface: 'profile',
  headline: 'Quality Manager at Skills Institute',
  about: 'Fifteen years in vocational education, focused on assessment validation and compliance.',
  location: 'Brisbane, Queensland, Australia',
  profileUrl: 'https://www.linkedin.com/in/someone/',
};

// The stub a rescue create leaves behind: name + URL + the saved thread, nothing else.
const STUB_FIELDS = {
  'First Name': 'Sam',
  'Last Name': 'Taylor',
  'LinkedIn Profile URL': 'https://www.linkedin.com/in/someone/',
  'Notes': '=== LINKEDIN MESSAGES ===\nthem: hello',
  'Status': 'On The Radar',
};

const withBase = async (base, fn) => {
  const orig = clientService.getClientBase;
  clientService.getClientBase = () => base.table;
  try { return await fn(); } finally { clientService.getClientBase = orig; }
};
const writtenFields = (base) => Object.assign({}, ...base._updates.map((u) => u.fields));

(async () => {
  console.log('capture-rescue stub + profile scrape:');
  {
    const base = stubBase({ record: { id: 'rec1', fields: STUB_FIELDS } });
    await withBase(base, async () => {
      const r = await wingguyLeads.enrichLeadFromScrape('baseX', 'rec1', PROFILE_SCRAPE, STUB_FIELDS);
      const f = writtenFields(base);
      await acheck('changed, and asks for an instant score', () => assert.ok(r.ok && r.changed && r.scoreNow, JSON.stringify(r)));
      await acheck('fills About / Headline / Location', () => {
        assert.strictEqual(f.About, PROFILE_SCRAPE.about);
        assert.strictEqual(f.Headline, PROFILE_SCRAPE.headline);
        assert.strictEqual(f.Location, PROFILE_SCRAPE.location);
      });
      await acheck('queues it for scoring', () => assert.strictEqual(f['Scoring Status'], 'To Be Scored'));
      await acheck('synthesises scoring JSON with the org fallback the batch gate needs', () => {
        const j = JSON.parse(f['Profile Full JSON']);
        assert.strictEqual(j.organization_title_1, 'Quality Manager');
        assert.strictEqual(j.organization_1, 'Skills Institute');
      });
      await acheck('never touches the saved thread or Status', () => {
        assert.ok(!('Notes' in f) && !('Status' in f), JSON.stringify(Object.keys(f)));
      });
    });
  }

  console.log('a messaging-surface scrape must not be trusted for the headline:');
  {
    const base = stubBase({ record: { id: 'rec2', fields: STUB_FIELDS } });
    await withBase(base, async () => {
      const msgScrape = { ...PROFILE_SCRAPE, _wgSurface: 'messaging', headline: 'sounds good, talk then' };
      await wingguyLeads.enrichLeadFromScrape('baseX', 'rec2', msgScrape, STUB_FIELDS);
      const f = writtenFields(base);
      await acheck('thread snippet is not written as a headline', () => assert.ok(!('Headline' in f), JSON.stringify(f)));
      await acheck('About still fills (trusted on any surface)', () => assert.strictEqual(f.About, PROFILE_SCRAPE.about));
    });
  }

  console.log('never overwrites what is already there:');
  {
    const existing = {
      ...STUB_FIELDS,
      'About': 'Linked Helper wrote this.',
      'Headline': 'LH headline',
      'Location': 'Sydney',
      'Profile Full JSON': '{"about":"rich LH profile","headline":"LH headline"}',
      'Scoring Status': 'Scored',
    };
    const base = stubBase({ record: { id: 'rec3', fields: existing } });
    await withBase(base, async () => {
      const r = await wingguyLeads.enrichLeadFromScrape('baseX', 'rec3', PROFILE_SCRAPE, existing);
      await acheck('writes nothing at all', () => assert.ok(!r.changed && base._updates.length === 0, JSON.stringify(r)));
      await acheck('does not re-score an already-Scored lead', () => assert.strictEqual(r.scoreNow, false));
    });
  }

  console.log('an empty read must not blank a record:');
  {
    const base = stubBase({ record: { id: 'rec4', fields: STUB_FIELDS } });
    await withBase(base, async () => {
      const r = await wingguyLeads.enrichLeadFromScrape('baseX', 'rec4', { _wgSurface: 'profile' }, STUB_FIELDS);
      await acheck('no write, no score', () => assert.ok(!r.changed && !r.scoreNow && base._updates.length === 0, JSON.stringify(r)));
    });
  }

  console.log('a thin About queues but does not instant-score:');
  {
    const base = stubBase({ record: { id: 'rec5', fields: STUB_FIELDS } });
    await withBase(base, async () => {
      const thin = { ...PROFILE_SCRAPE, about: 'Consultant.' }; // under the 40-char gate
      const r = await wingguyLeads.enrichLeadFromScrape('baseX', 'rec5', thin, STUB_FIELDS);
      await acheck('still fills the record', () => assert.ok(r.changed, JSON.stringify(r)));
      await acheck('leaves it to the nightly batch', () => assert.strictEqual(r.scoreNow, false));
      await acheck('and it is queued, not stranded', () => assert.strictEqual(writtenFields(base)['Scoring Status'], 'To Be Scored'));
    });
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
