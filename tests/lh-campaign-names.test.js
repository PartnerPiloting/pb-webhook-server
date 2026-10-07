/**
 * Tests for the "what campaigns do I have?" lookup (services/lhCampaignNames.js): counting
 * campaign names off {Raw Profile Data}, tagging each with the slug its instructions carry (the
 * registry mapping wins), and the listing text the assistant shows the client.
 * Pure functions only - no Airtable, no database. Synthetic data.
 *
 * Run: node tests/lh-campaign-names.test.js
 */
const assert = require('assert');
const { tallyCampaigns, describeCampaigns, formatCampaigns } = require('../services/lhCampaignNames');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const lead = (campaign) => ({ fields: { 'Raw Profile Data': campaign === undefined ? undefined : JSON.stringify({ id: 'x', campaign_name: campaign }) } });

console.log('lh-campaign-names tests');

check('tally: counts per name, case-insensitive, biggest first; leads with no campaign counted apart', () => {
  const t = tallyCampaigns([lead('Defence suppliers'), lead('defence suppliers'), lead('Founders'), lead(undefined), lead('')]);
  assert.strictEqual(t.scanned, 5);
  assert.strictEqual(t.withName, 3);
  assert.deepStrictEqual(t.campaigns, [{ name: 'Defence suppliers', count: 2 }, { name: 'Founders', count: 1 }]);
});

check('describe: registry mapping wins; otherwise the slug; instructions flagged from the tags in use', () => {
  const d = describeCampaigns(
    [{ name: 'Fractional in profile', count: 9 }, { name: 'Defence suppliers - Qld', count: 4 }, { name: 'Founders', count: 1 }],
    { lhNames: { frac: ['fractional in profile'] }, tagged: ['frac', 'defence-suppliers-qld'] },
  );
  assert.deepStrictEqual(d.map((c) => [c.tag, c.hasInstructions, c.mappedInRegistry]), [
    ['frac', true, true],
    ['defence-suppliers-qld', true, false],
    ['founders', false, false],
  ]);
});

check('format: lists exact names, tags and status, and tells the assistant to let the human pick', () => {
  const text = formatCampaigns(
    [{ name: 'Defence suppliers - Qld', count: 4, tag: 'defence-suppliers-qld', hasInstructions: false }],
    { scanned: 6, withName: 4, days: 120, max: 1000 },
  );
  assert.ok(text.includes('"Defence suppliers - Qld" - 4 leads - tag: defence-suppliers-qld - no instructions yet'));
  assert.ok(text.includes('2 of those leads came in some other way'));
  assert.ok(text.includes('let THEM pick'));
  assert.ok(!/\brules\b(?![^"]*")/.test(text.split('Call these')[0]), 'client-facing wording must say instructions');
});

check('format: no leads, and leads with no campaign, each get a plain answer', () => {
  assert.ok(formatCampaigns([], { scanned: 0, withName: 0, days: 120, max: 1000 }).includes('No leads arrived'));
  assert.ok(formatCampaigns([], { scanned: 3, withName: 0, days: 120, max: 1000 }).includes('none came from a Linked Helper campaign'));
});

console.log(failures ? `\n${failures} FAILING` : '\nALL PASS');
process.exit(failures ? 1 : 0);
