/**
 * Which Linked Helper campaigns a client's leads came from - the lookup behind "what campaigns do
 * I have?" (2026-10-07, after Ashley Knowles' call).
 *
 * WHY: campaign instructions are matched on the Linked Helper campaign name exactly (see
 * wingguyRulesSource - a near miss would write for the wrong crowd, so it never guesses). Exact
 * matching is only safe if nobody has to TYPE the name. This reads the names off the client's own
 * leads ({Raw Profile Data}.campaign_name) so Claude can show them and the client picks one.
 *
 * Reads the newest leads only (a window of days, capped): a campaign that has sent nobody in
 * months is not one anyone is writing thank-yous for. {Raw Profile Data} is ~15KB a lead, so the
 * cap keeps one call to a few pages. Read-only. Never throws - a failure comes back as { error }.
 */

const clientService = require('./clientService');
const rulesSource = require('./wingguyRulesSource');
const rulesStore = require('./wingguyRulesStore');

const DEFAULT_DAYS = 120;
const DEFAULT_MAX = 1000;

/** Count leads per campaign name. records = Airtable records holding {Raw Profile Data}. */
function tallyCampaigns(records = []) {
  const byKey = new Map();
  let withName = 0;
  for (const r of records) {
    const name = rulesSource.lhCampaignNameOf({ rawProfileData: ((r && r.fields) || {})['Raw Profile Data'] });
    if (!name) continue;
    withName++;
    const key = name.toLowerCase();
    const row = byKey.get(key) || { name, count: 0 };
    row.count++;
    byKey.set(key, row);
  }
  const campaigns = [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { campaigns, scanned: records.length, withName };
}

/**
 * Decorate each campaign with the tag its instructions carry and whether any exist.
 * lhNames = the registry mapping { slug: [lowercased names] }; tagged = campaign tags in use.
 */
function describeCampaigns(campaigns = [], { lhNames = {}, tagged = [] } = {}) {
  return campaigns.map((c) => {
    const mapped = Object.entries(lhNames).find(([, names]) => names.includes(c.name.toLowerCase()));
    const tag = mapped ? mapped[0] : rulesSource.campaignSlugFromName(c.name);
    return { ...c, tag, mappedInRegistry: !!mapped, hasInstructions: !!tag && tagged.includes(tag) };
  });
}

function formatCampaigns(described, { scanned, withName, days, max }) {
  if (!scanned) {
    return `No leads arrived in the last ${days} days, so there are no recent Linked Helper campaigns to show.`;
  }
  if (!described.length) {
    return `Read your ${scanned} newest leads (last ${days} days) and none came from a Linked Helper campaign - ` +
      'they were added another way (by hand, a referral, the extension). Campaign instructions only apply to leads Linked Helper sends.';
  }
  const lines = described.map((c) =>
    `- "${c.name}" - ${c.count} lead${c.count === 1 ? '' : 's'} - tag: ${c.tag} - ` +
    (c.hasInstructions ? 'HAS its own instructions' : 'no instructions yet (uses the normal ones)'));
  return [
    `Linked Helper campaigns your leads came from (your ${scanned} newest leads, last ${days} days${scanned >= max ? `, capped at ${max}` : ''}):`,
    ...lines,
    withName < scanned ? `(${scanned - withName} of those leads came in some other way - by hand, a referral or the extension.)` : null,
    '',
    'FOR THE ASSISTANT: show the human this list and let THEM pick the campaign - never decide which one they meant. ' +
      'To give a campaign its own instructions, pass its tag EXACTLY as shown as `campaign` to wingguy_rule_propose ' +
      '(and wingguy_rule_get to see what is there now). Write only what differs for that campaign - everything else ' +
      'comes from their normal instructions. Call these "instructions", never "rules".',
  ].filter((l) => l !== null).join('\n');
}

async function readRecentLeads(base, { days, max }) {
  const select = (opts) => base('Leads').select({
    fields: ['Raw Profile Data'],
    filterByFormula: `IS_AFTER(CREATED_TIME(), DATEADD(TODAY(), -${days}, 'days'))`,
    maxRecords: max,
    pageSize: 100,
    ...opts,
  }).all();
  try {
    return await select({ sort: [{ field: 'Date Created', direction: 'desc' }] });
  } catch (e) {
    // An older base without a {Date Created} field can't sort on it - the window still holds.
    return select({});
  }
}

/** The tool executor: { text, isError? }. */
async function runListCampaigns({ days, max } = {}, tenant) {
  const d = Math.min(Math.max(Number(days) || DEFAULT_DAYS, 7), 365);
  const m = Math.min(Math.max(Number(max) || DEFAULT_MAX, 50), 2000);
  try {
    const client = await clientService.getClientById(tenant);
    if (!client || !client.airtableBaseId) return { text: `No leads database is set up for ${tenant}.`, isError: true };
    const base = clientService.getClientBase(client.airtableBaseId);
    if (!base) return { text: `Couldn't open the leads database for ${tenant}.`, isError: true };

    const records = await readRecentLeads(base, { days: d, max: m });
    const { campaigns, scanned, withName } = tallyCampaigns(records);

    const rules = await rulesStore.getActiveRules({ tenantId: tenant });
    const tagged = [...new Set(rules.map((r) => String(r.campaign || '').toLowerCase().trim()).filter(Boolean))];
    const markers = rules.find((r) => r.rule_key === 'campaign-markers' && r.layer === 'client')
      || rules.find((r) => r.rule_key === 'campaign-markers');
    const lhNames = rulesSource.parseLhCampaignNames(markers ? markers.body : '');

    return { text: formatCampaigns(describeCampaigns(campaigns, { lhNames, tagged }), { scanned, withName, days: d, max: m }) };
  } catch (e) {
    return { text: `Couldn't read your campaigns: ${e.message}`, isError: true };
  }
}

module.exports = { runListCampaigns, tallyCampaigns, describeCampaigns, formatCampaigns, DEFAULT_DAYS, DEFAULT_MAX };
