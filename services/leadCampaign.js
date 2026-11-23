/**
 * The Campaign field on a lead (2026-11-23, Roland Illyes: "tag every contact by where it came from").
 *
 * WHY: Linked Helper writes the campaign name on every lead it sends, but only inside the saved
 * {Raw Profile Data} block, where the portal cannot filter on it and a client cannot see it. Guy's
 * decision (23 Nov): a SEPARATE field, not a tag in {Search Terms}.
 *
 *   - Linked Helper sent the lead  -> {Campaign} is filled in by itself with that campaign's name
 *     (leadService.upsertLead) and the client CANNOT change it. Scoring decides which attribute rows
 *     apply from the campaign in {Raw Profile Data} (services/campaignScope.js) and keeps doing so -
 *     an overwritten value here would show one campaign and score under another.
 *   - Nobody sent it (added by hand, brought in by Reconnect) -> blank, and the client may choose
 *     one FROM THE LIST of their own Linked Helper campaigns. Never free text.
 *   - "No campaign" is a real choice in the Lead Search filter.
 *
 * The field holds the NAME as it was when the lead was sent. Rename a campaign in Linked Helper and
 * the people already sent keep the old name; the filter lists every name found on the leads and
 * marks the ones that are not a campaign on the machine today.
 *
 * Newsletter and event groups are not campaigns - they stay as tags.
 */

const { lhCampaignNameOf } = require('./wingguyRulesSource');
const lhCampaignList = require('./lhCampaignList');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'lead_campaign');

const FIELD = 'Campaign';
const NONE = '__none__';   // the filter's "No campaign" choice
const MAX_NAME = 120;
const SCAN_CAP = 5000;     // leads read when tallying names for the filter
const CACHE_MS = 5 * 60 * 1000;

/**
 * Clients whose existing leads have had the one-off catch-up (scripts/backfill-lead-campaign.js).
 * The Lead Search filter shows only for these: before the catch-up, every older lead would sit
 * under "No campaign" although Linked Helper sent it. Add a client here once their catch-up has
 * run (or '*' once every base has had it). The field itself fills in for everyone from go-live.
 */
const FILTER_READY = ['Roland-Illyes'];

const filterReady = (clientId) => FILTER_READY.includes('*') || FILTER_READY.includes(String(clientId || ''));

/** The campaign name Linked Helper wrote on a lead ({Raw Profile Data}: JSON string or object). */
function campaignNameFromRaw(raw) {
  try {
    return lhCampaignNameOf({ rawProfileData: raw }).slice(0, MAX_NAME);
  } catch (_) {
    return '';
  }
}

const escapeFormula = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** The Airtable formula for one filter choice, or null for "all". */
function filterFormula(choice) {
  const v = String(choice === undefined || choice === null ? '' : choice).trim();
  if (!v || v === 'all') return null;
  if (v === NONE) return `NOT({${FIELD}})`;
  return `{${FIELD}} = "${escapeFormula(v.slice(0, MAX_NAME))}"`;
}

/** Did Airtable refuse a write because this base has no {Campaign} field yet? */
function isMissingFieldError(err) {
  if (!err) return false;
  const text = `${err.error || ''} ${err.message || ''}`;
  return /UNKNOWN_FIELD_NAME|Unknown field name/i.test(text) && text.includes(FIELD);
}

/**
 * One Airtable write for a lead, with {Campaign} made best-effort: if a base has no Campaign field
 * yet, Airtable refuses the WHOLE write - so drop that one field and send the rest again. A lead is
 * never lost or held up over its campaign name. Only that exact refusal is retried (nothing was
 * written), so a retry can never double-create a lead.
 */
async function writeFields(write, fields, logger = log) {
  try {
    return await write(fields);
  } catch (err) {
    if (!fields || fields[FIELD] === undefined || !isMissingFieldError(err)) throw err;
    logger.warn(`lead-campaign: this base has no "${FIELD}" field yet - saving the lead without it (run scripts/ensure-client-fields.js)`);
    const { [FIELD]: _dropped, ...rest } = fields;
    return write(rest);
  }
}

/** What the portal shows for one lead: the name, and whether the client may set it. */
function describeLead(fields = {}) {
  const fromLh = campaignNameFromRaw(fields['Raw Profile Data']);
  const stored = String(fields[FIELD] || '').trim();
  return { campaign: fromLh || stored, campaignLocked: !!fromLh };
}

const cache = new Map(); // clientId -> { at, value }

/** Names on the leads, with counts: [{ name, count }], plus whether the read hit the cap. */
async function tallyNamesOnLeads(base) {
  const counts = new Map();
  let read = 0;
  let capped = false;
  await new Promise((resolve, reject) => {
    base('Leads').select({ fields: [FIELD], filterByFormula: `{${FIELD}}`, pageSize: 100 }).eachPage(
      (records, next) => {
        for (const r of records) {
          const name = String(r.get(FIELD) || '').trim();
          if (name) counts.set(name, (counts.get(name) || 0) + 1);
        }
        read += records.length;
        if (read >= SCAN_CAP) { capped = true; return resolve(); }
        next();
      },
      (err) => (err ? reject(err) : resolve()),
    );
  });
  return { names: [...counts.entries()].map(([name, count]) => ({ name, count })), capped };
}

/**
 * Everything the portal's two pickers need:
 *   filterReady - show the Lead Search filter at all (see FILTER_READY)
 *   campaigns   - [{ name, count, live }] for the filter: every name on the leads plus every
 *                 campaign on the machine; live=false = on leads but not a campaign today (renamed,
 *                 archived or deleted)
 *   choices     - the names a client may put on a lead that has none: campaigns on the machine now
 * Never throws.
 */
async function getOptions(clientId, base, { fresh = false } = {}) {
  const hit = cache.get(clientId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let live = [];
  try {
    const listed = await lhCampaignList.listCampaigns(clientId, {});
    live = listed.campaigns.filter((c) => c.live && c.name).map((c) => c.name);
  } catch (e) {
    log.warn(`lead-campaign: machine list not read for ${clientId}: ${e.message}`);
  }

  let onLeads = { names: [], capped: false };
  let fieldMissing = false;
  if (base) {
    try {
      onLeads = await tallyNamesOnLeads(base);
    } catch (e) {
      fieldMissing = isMissingFieldError(e);
      log.warn(`lead-campaign: names on leads not read for ${clientId}: ${e.message}`);
    }
  }

  const byName = new Map();
  for (const name of live) byName.set(name, { name, count: 0, live: true });
  for (const { name, count } of onLeads.names) {
    const row = byName.get(name) || { name, count: 0, live: false };
    row.count = count;
    byName.set(name, row);
  }
  // A client with no machine list (Linked Helper on their own computer): the names on their leads
  // are the only list there is, so they are the choices too.
  const choices = live.length ? [...new Set(live)] : onLeads.names.map((n) => n.name);
  const campaigns = [...byName.values()].sort((a, b) => (b.live - a.live) || b.count - a.count || a.name.localeCompare(b.name));

  const value = {
    filterReady: filterReady(clientId) && !fieldMissing && campaigns.length > 0,
    campaigns,
    countsCapped: onLeads.capped,
    choices: choices.sort((a, b) => a.localeCompare(b)),
  };
  cache.set(clientId, { at: Date.now(), value });
  return value;
}

/**
 * A client choosing the campaign for a lead that has none. value '' clears their own choice.
 * Returns { ok, status, error?, campaign?, campaignLocked? }.
 */
async function setLeadCampaign({ clientId, base, leadId, value }) {
  const wanted = String(value === undefined || value === null ? '' : value).trim();
  let record;
  try {
    record = await base('Leads').find(leadId);
  } catch (e) {
    return { ok: false, status: e.statusCode === 404 ? 404 : 500, error: e.statusCode === 404 ? 'Lead not found' : e.message };
  }
  const now = describeLead(record.fields || {});
  if (now.campaignLocked) {
    return { ok: false, status: 409, error: `Linked Helper sent this person from "${now.campaign}", so the campaign is set and cannot be changed.`, ...now };
  }
  if (wanted) {
    const { choices } = await getOptions(clientId, base, { fresh: true });
    if (!choices.includes(wanted)) {
      return { ok: false, status: 400, error: 'Choose one of your Linked Helper campaigns from the list.' };
    }
  }
  try {
    await base('Leads').update([{ id: leadId, fields: { [FIELD]: wanted } }]);
  } catch (e) {
    if (isMissingFieldError(e)) return { ok: false, status: 409, error: 'The Campaign field has not been added to this leads database yet.' };
    return { ok: false, status: 500, error: e.message };
  }
  cache.delete(clientId);
  return { ok: true, status: 200, campaign: wanted, campaignLocked: false };
}

module.exports = {
  FIELD, NONE, FILTER_READY, filterReady, campaignNameFromRaw, filterFormula, isMissingFieldError,
  describeLead, writeFields, getOptions, setLeadCampaign, tallyNamesOnLeads,
};
