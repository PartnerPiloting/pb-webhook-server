/**
 * One-off catch-up for the Campaign field (services/leadCampaign.js, 2026-11-23): copy the Linked
 * Helper campaign name out of each existing lead's {Raw Profile Data} into {Campaign}.
 *
 * ONE CLIENT AT A TIME, on purpose - Guy rolls this out client by client. After a client's
 * catch-up has run, add them to FILTER_READY in services/leadCampaign.js so the Lead Search
 * campaign filter shows for them.
 *
 *   node scripts/backfill-lead-campaign.js --client=Roland-Illyes            # dry run: counts only
 *   node scripts/backfill-lead-campaign.js --client=Roland-Illyes --apply    # write
 *
 * Safe to run again: only a BLANK {Campaign} is filled. A lead that already carries a campaign is
 * left alone - it may hold the campaign's new name after a rename on the machine. A lead Linked
 * Helper did not send is never touched, so a client's own choice on a hand-added lead survives.
 * After the catch-up, bring renamed campaigns into line once:
 *   POST /api/linkedin/lead-campaigns/follow-renames  (it also runs by itself on every later rename)
 *
 * Needs AIRTABLE_API_KEY + MASTER_CLIENTS_BASE_ID. The base must already have the field
 * (scripts/ensure-client-fields.js).
 */

require('dotenv').config();
const Airtable = require('airtable');
const { FIELD, campaignNameFromRaw, isMissingFieldError } = require('../services/leadCampaign');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What to do with one lead: { action: 'set'|'skip'|'none', name, was }. Pure - tested. */
function planFor(fields = {}) {
  const name = campaignNameFromRaw(fields['Raw Profile Data']);
  const was = String(fields[FIELD] || '').trim();
  if (!name) return { action: 'none', name: '', was };
  // A lead that already carries a campaign is left alone. Its value may be the campaign's NEW name
  // (a rename on the machine is followed - services/leadCampaign.js followRenames), and writing
  // the name from the saved profile back over it would undo that. Only a blank is filled.
  if (was) return { action: 'skip', name: was, was };
  return { action: 'set', name, was };
}

async function run() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const clientArg = args.find((a) => a.startsWith('--client='));
  const clientId = clientArg ? clientArg.split('=')[1] : '';
  if (!clientId) { console.error('Say which client: --client=<Client ID>. There is no "all" on purpose.'); process.exit(1); }
  if (!process.env.AIRTABLE_API_KEY || !process.env.MASTER_CLIENTS_BASE_ID) { console.error('AIRTABLE_API_KEY and MASTER_CLIENTS_BASE_ID must be set'); process.exit(1); }

  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });
  const master = await airtable.base(process.env.MASTER_CLIENTS_BASE_ID)('Clients')
    .select({ filterByFormula: `{Client ID} = "${clientId.replace(/"/g, '')}"`, fields: ['Client ID', 'Airtable Base ID'], maxRecords: 2 }).firstPage();
  if (master.length !== 1) { console.error(`Expected one client "${clientId}", found ${master.length}`); process.exit(1); }
  const baseId = master[0].get('Airtable Base ID');
  if (!baseId) { console.error(`${clientId} has no leads base`); process.exit(1); }
  const base = airtable.base(baseId);

  console.log(`Campaign catch-up for ${clientId} (${baseId}) - ${apply ? 'APPLYING' : 'dry run, nothing written'}\n`);

  const tally = new Map();      // name -> leads that will carry it once done
  const toSet = [];
  let total = 0, none = 0, skipped = 0, chosenByClient = 0, changed = 0;
  // A dry run still works on a base that has no Campaign field yet (it just reads without it).
  let readFields = [FIELD, 'Raw Profile Data', 'First Name', 'Last Name'];
  try {
    await base('Leads').select({ fields: [FIELD], maxRecords: 1 }).firstPage();
  } catch (e) {
    if (!isMissingFieldError(e)) throw e;
    if (apply) throw new Error(`This base has no "${FIELD}" field yet - run scripts/ensure-client-fields.js first.`);
    console.log(`(this base has no "${FIELD}" field yet - counting only)
`);
    readFields = readFields.filter((f) => f !== FIELD);
  }
  await base('Leads').select({ fields: readFields, pageSize: 100 }).eachPage((records, next) => {
    for (const r of records) {
      total++;
      const plan = planFor(r.fields);
      if (plan.action === 'none') {
        none++;
        if (plan.was) chosenByClient++;
        continue;
      }
      tally.set(plan.name, (tally.get(plan.name) || 0) + 1);
      if (plan.action === 'skip') { skipped++; continue; }
      if (plan.was) {
        changed++;
        console.log(`  differs: ${r.get('First Name') || ''} ${r.get('Last Name') || ''} (${r.id}) had "${plan.was}", Linked Helper says "${plan.name}"`);
      }
      toSet.push({ id: r.id, fields: { [FIELD]: plan.name } });
    }
    next();
  });

  let written = 0;
  if (apply) {
    for (let i = 0; i < toSet.length; i += 10) {
      await base('Leads').update(toSet.slice(i, i + 10));
      written += Math.min(10, toSet.length - i);
      await sleep(220); // stay under Airtable's 5 requests a second
    }
  }

  console.log(`Leads in the base:                 ${total}`);
  console.log(`Sent by a Linked Helper campaign:  ${total - none}`);
  console.log(`No campaign:                       ${none}${chosenByClient ? ` (${chosenByClient} with a campaign the client chose)` : ''}`);
  console.log(`Already right, left alone:         ${skipped}`);
  console.log(`${apply ? 'Filled in now:                    ' : 'Would fill in:                    '} ${apply ? written : toSet.length}${changed ? ` (${changed} replacing a different value)` : ''}`);
  console.log('\nPer campaign (once done):');
  for (const [name, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(5)}  ${name}`);
  console.log(`  ${String(none).padStart(5)}  (no campaign)`);
  if (!apply) console.log('\nDry run - add --apply to write.');
}

if (require.main === module) {
  run().catch((err) => { console.error('\nFailed:', err.message); process.exit(1); });
}

module.exports = { planFor };
