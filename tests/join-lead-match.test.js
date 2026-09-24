/**
 * Join -> lead match: a new member's Clients row is filled from their lead record in Guy's base.
 *
 * 24 Sep 2026: Steve Nelson paid from australia@euroswift.com; his lead is steve@euroswift.com in
 * "Greater Melbourne Area". His row came out Brisbane with no LinkedIn and no phone. This pins:
 *   1. the lookup order - email, then Alt Emails, then name - and Steve's exact case;
 *   2. two leads with the same name and no tie-break = no match (never guess a stranger's phone);
 *   3. the same-domain tie-break between same-name leads;
 *   4. what gets copied, and that the join email is never listed as an "alternative";
 *   5. timezone from {Location}, then the CURRENT role's city, never a past one.
 *
 * Run: node tests/join-lead-match.test.js
 */
const assert = require('assert');
const { findJoinerLead, clientFieldsFromLead } = require('../services/joinLeadMatch');

// A fake base('Leads'): evaluates the three formula shapes the finder uses against plain rows.
function fakeLeads(rows) {
  const recs = rows.map((fields, i) => ({ id: `rec${i}`, fields }));
  const lc = (v) => String(v || '').trim().toLowerCase();
  return {
    select({ filterByFormula }) {
      const strs = [...filterByFormula.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
      let out;
      if (filterByFormula.startsWith('LOWER({Email})')) out = recs.filter((r) => lc(r.fields.Email) === strs[0]);
      else if (filterByFormula.includes('{Alt Emails}')) out = recs.filter((r) => lc(r.fields['Alt Emails']).includes(strs[1]));
      else out = recs.filter((r) => lc(r.fields['First Name']) === strs[0] && lc(r.fields['Last Name']) === strs[1]);
      return { firstPage: async () => out };
    },
  };
}

const STEVE = {
  'First Name': 'Steve', 'Last Name': 'Nelson', Email: 'steve@euroswift.com',
  Phone: '+61 452 296 878', 'LinkedIn Profile URL': 'www.linkedin.com/in/stevenelsonau',
  Location: 'Greater Melbourne Area',
  Headline: 'Founder. Operator. Fractional Sales Director',
};

(async () => {
  // 1. Steve's case: no email hit, one name hit.
  let r = await findJoinerLead(fakeLeads([STEVE, { 'First Name': 'Rick', 'Last Name': 'Wong', Email: 'r@x.com' }]),
    { email: 'australia@euroswift.com', firstName: 'Steve', lastName: 'Nelson' });
  assert.strictEqual(r.matchedBy, 'name');
  assert.strictEqual(r.record.fields.Email, 'steve@euroswift.com');

  // Email beats name; Alt Emails is an exact-member match, not a substring.
  r = await findJoinerLead(fakeLeads([STEVE]), { email: 'Steve@Euroswift.com', firstName: 'X', lastName: 'Y' });
  assert.strictEqual(r.matchedBy, 'email');
  r = await findJoinerLead(fakeLeads([{ ...STEVE, 'Alt Emails': 'australia@euroswift.com\nold@x.com' }]),
    { email: 'australia@euroswift.com', firstName: 'X', lastName: 'Y' });
  assert.strictEqual(r.matchedBy, 'alt email');
  r = await findJoinerLead(fakeLeads([{ ...STEVE, 'Alt Emails': 'taustralia@euroswift.com' }]),
    { email: 'australia@euroswift.com', firstName: 'X', lastName: 'Y' });
  assert.strictEqual(r.record, null, 'substring of an alt email is not a match');

  // 2. Two Steve Nelsons, joiner on webmail: no guess.
  const other = { ...STEVE, Email: 'steve.nelson@acme.com.au', Phone: '0400 000 000' };
  r = await findJoinerLead(fakeLeads([STEVE, other]), { email: 'stevo@gmail.com', firstName: 'Steve', lastName: 'Nelson' });
  assert.strictEqual(r.record, null);
  assert.match(r.reason, /2 leads named/);

  // 3. ...but the joiner's business domain picks the right one.
  r = await findJoinerLead(fakeLeads([STEVE, other]), { email: 'australia@euroswift.com', firstName: 'Steve', lastName: 'Nelson' });
  assert.strictEqual(r.record.fields.Email, 'steve@euroswift.com');
  assert.strictEqual(r.matchedBy, 'name + euroswift.com');

  // No full name and no email hit = no match, not a crash.
  r = await findJoinerLead(fakeLeads([STEVE]), { email: 'nobody@x.com', firstName: 'Steve', lastName: '' });
  assert.strictEqual(r.record, null);

  // 4. What gets copied.
  const c = clientFieldsFromLead({ ...STEVE, 'Alt Emails': 'australia@euroswift.com; s@old.com' }, 'australia@euroswift.com');
  assert.strictEqual(c.fields['LinkedIn URL'], 'https://www.linkedin.com/in/stevenelsonau');
  assert.strictEqual(c.fields.Phone, '+61 452 296 878');
  assert.strictEqual(c.fields['Alternative Email Addresses'], 'steve@euroswift.com\ns@old.com');
  assert.strictEqual(c.timezone, 'Australia/Melbourne');
  assert.ok(!('Timezone' in c.fields), 'timezone is written by finish_row, not here');
  const bare = clientFieldsFromLead({ 'First Name': 'A' }, 'a@x.com');
  assert.deepStrictEqual(bare.fields, {});
  assert.strictEqual(bare.timezone, null);

  // 5. Country-only Location -> current role city; a past role's city is not used.
  const raw = (end) => JSON.stringify({
    organization_1: 'Acme', organization_location_1: 'Perth, Western Australia, Australia', organization_end_1: end,
  });
  assert.strictEqual(clientFieldsFromLead({ Location: 'Australia', 'Raw Profile Data': raw(null) }, '').timezone, 'Australia/Perth');
  assert.strictEqual(clientFieldsFromLead({ Location: 'Australia', 'Raw Profile Data': raw('2022.06') }, '').timezone, null);

  console.log('join-lead-match: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
