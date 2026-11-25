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
const { campaignIdOf } = require('./campaignScope');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'lead_campaign');

const FIELD = 'Campaign';
const NONE = '__none__';   // the filter's "No campaign" choice
const MAX_NAME = 120;
const SCAN_CAP = 40000;    // leads read when tallying names for the filter (Guy's own base holds ~17,700)
let QUICK_MS = 8000;       // how long a page load waits for that tally before answering with what it has
const CACHE_MS = 5 * 60 * 1000;

/**
 * Clients whose existing leads have had the one-off catch-up (scripts/backfill-lead-campaign.js).
 * The Lead Search filter shows only for these: before the catch-up, every older lead would sit
 * under "No campaign" although Linked Helper sent it. Add a client here once their catch-up has
 * run (or '*' once every base has had it). The field itself fills in for everyone from go-live.
 */
// Every client base had its catch-up on 26 Nov 2026 (Guy), so the filter is on for everyone.
const FILTER_READY = ['*'];

/**
 * Lead Search's "Recently connected" shortcut and its "No tag or note" marker (Guy, 23 Nov 2026).
 * On for these clients only while Guy looks at it on his own portal - '*' turns it on for everyone.
 */
// On for every client since 26 Nov 2026 (Guy) - with it come leads + contacts in one search, Add a
// contact, Import contacts and the wingguy_save_contact tool, which all ask this same question.
const RECENT_SHORTCUT = ['*'];
const recentShortcut = (clientId) => RECENT_SHORTCUT.includes('*') || RECENT_SHORTCUT.includes(String(clientId || ''));

/**
 * Clients whose Linked Helper machine runs the nightly "My own connections" collection
 * (scripts/linked-helper/lh-own-connections.py), so a person they connect with on LinkedIn by hand
 * reaches Wingguy without being typed in. The portal only says "Connect there and they'll arrive
 * here by themselves" where that is true (Guy, 24 Nov 2026). ADD A CLIENT HERE the day the
 * collection is switched on on their machine - never before, or the sentence is a false promise.
 */
const OWN_CONNECTIONS_ARRIVE = ['Guy-Wilson'];
const ownConnectionsArrive = (clientId) => OWN_CONNECTIONS_ARRIVE.includes('*') || OWN_CONNECTIONS_ARRIVE.includes(String(clientId || ''));

/**
 * The catch-all campaign on a client's machine for connections no campaign sent (Guy, 23 Nov 2026:
 * every LinkedIn connection reaches Wingguy through the Linked Helper machine, however the person
 * was met). scripts/linked-helper/lh-own-connections.py feeds it each night. It is a campaign like
 * any other EXCEPT that it never replaces a real one - see keepRealCampaign.
 */
const OWN_CONNECTIONS = 'My own connections';

/**
 * A lead arriving from the catch-all campaign that ALREADY has a campaign keeps it.
 * The machine script skips anyone who is in another campaign, so this is the second lock: a lead
 * sent from another machine, an archived campaign, or given a campaign by the client by hand.
 *
 *   existingFields - the lead's Airtable fields as they are now
 *   incomingRaw    - what Linked Helper just sent (object or JSON string)
 * Returns null when there is nothing to protect, else { name, raw } where raw is the incoming
 * profile with the lead's own campaign put back (scoring reads campaign_id off it).
 */
function keepRealCampaign(existingFields = {}, incomingRaw) {
  if (campaignNameFromRaw(incomingRaw) !== OWN_CONNECTIONS) return null;
  const sentBy = campaignNameFromRaw(existingFields['Raw Profile Data']);
  const stored = String(existingFields[FIELD] || '').trim();
  const fromLh = sentBy && sentBy !== OWN_CONNECTIONS ? sentBy : '';
  const chosen = !fromLh && stored && stored !== OWN_CONNECTIONS ? stored : '';
  if (!fromLh && !chosen) return null;
  let raw;
  try {
    raw = typeof incomingRaw === 'string' ? JSON.parse(incomingRaw) : { ...(incomingRaw || {}) };
  } catch (_) {
    return null;
  }
  raw.wingguy_also_seen_in = OWN_CONNECTIONS;
  if (fromLh) {
    raw.campaign_name = fromLh;
    const id = campaignIdOf(existingFields['Raw Profile Data']);
    if (id === null || id === undefined) delete raw.campaign_id; else raw.campaign_id = id;
  } else {
    // the client's own choice on a lead nobody sent: stays their choice, and stays theirs to change
    delete raw.campaign_name;
    delete raw.campaign_id;
  }
  return { name: fromLh || chosen, raw };
}

/** Lead Search's "no tag" filter: nothing in {Search Terms}. (It first asked for no note as well -
 * notes fill in by themselves, so that was almost never true. Guy, 23 Nov 2026.) */
const UNLABELLED_FORMULA = 'NOT({Search Terms})';

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
  // The field wins over the name in the saved profile: it follows a rename on the machine
  // (followRenames), the saved profile keeps the name as it was on the day. A client can never
  // write the field on a lead Linked Helper sent, so it is still not theirs to change.
  return { campaign: fromLh ? (stored || fromLh) : stored, campaignLocked: !!fromLh };
}

const cache = new Map(); // clientId -> { at, value }

/** Names on the leads, with counts: [{ name, count }], plus whether the read hit the cap. */
async function tallyNamesOnLeads(base, progress = {}) {
  const counts = new Map();
  progress.counts = counts; // readable while the read is still going
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
  // A big base takes about a minute to tally (Guy's own: 17,700 leads). So an answer that has gone
  // stale is still given at once while a new one is worked out behind it, and a first-ever ask
  // waits QUICK_MS and then answers with the names found so far, without counts.
  let building = inflight.get(clientId);
  if (!building) {
    const progress = {};
    const promise = buildOptions(clientId, base, progress)
      .then((value) => { cache.set(clientId, { at: Date.now(), value }); return value; })
      .finally(() => inflight.delete(clientId));
    building = { promise, progress };
    inflight.set(clientId, building);
  }
  if (fresh) return building.promise;
  if (hit) { building.promise.catch(() => {}); return hit.value; }
  let timer;
  const early = new Promise((resolve) => { timer = setTimeout(() => resolve(null), QUICK_MS); });
  const done = await Promise.race([building.promise, early]);
  clearTimeout(timer);
  if (done) return done;
  building.promise.catch(() => {});
  const soFar = [...(building.progress.counts || new Map()).entries()].map(([name, count]) => ({ name, count }));
  return shapeOptions(clientId, building.progress.live || [], { names: soFar, capped: true }, false);
}

const inflight = new Map(); // clientId -> { promise, progress }

async function buildOptions(clientId, base, progress) {

  let live = [];
  try {
    const listed = await lhCampaignList.listCampaigns(clientId, {});
    live = listed.campaigns.filter((c) => c.live && c.name);
  } catch (e) {
    log.warn(`lead-campaign: machine list not read for ${clientId}: ${e.message}`);
  }
  progress.live = live.filter((c) => c.sends !== false).map((c) => c.name);

  let onLeads = { names: [], capped: false };
  let fieldMissing = false;
  if (base) {
    try {
      onLeads = await tallyNamesOnLeads(base, progress);
    } catch (e) {
      fieldMissing = isMissingFieldError(e);
      log.warn(`lead-campaign: names on leads not read for ${clientId}: ${e.message}`);
    }
  }
  // A campaign that can never send anyone to Wingguy - no send-to-webhook step: removals, a
  // collect-only list, a test - is not a choice a client can use, so it is left out (Guy, 23 Nov
  // 2026). Unless leads carry its name: then it is real to the client and it stays.
  const carried = new Set(onLeads.names.map((n) => n.name));
  const shown = live.filter((c) => c.sends !== false || carried.has(c.name)).map((c) => c.name);
  return shapeOptions(clientId, shown, onLeads, fieldMissing);
}

function shapeOptions(clientId, live, onLeads, fieldMissing) {
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
    recentShortcut: recentShortcut(clientId),
    ownConnectionsArrive: ownConnectionsArrive(clientId),
  };
  return value;
}

/**
 * A client choosing the campaign for a lead that has none. value '' clears their own choice.
 * Returns { ok, status, error?, campaign?, campaignLocked? }.
 */
/**
 * RENAMED CAMPAIGNS (Guy, 23 Nov 2026): rename a campaign in Linked Helper and the leads it already
 * sent take the NEW name. Matched on Linked Helper's campaign id in {Raw Profile Data}, never on the
 * name, so two campaigns that once shared a name are not mixed up. A lead whose campaign is no longer
 * on the machine (archived, deleted) keeps the name it has. Only the {Campaign} field changes -
 * {Raw Profile Data} and everything scoring reads are left exactly as they were.
 *
 *   liveById - { <campaign id>: <its name on the machine now> }
 *   names    - the {Campaign} values to look under (every name on the leads that is not a current
 *              name, unless the caller knows the exact old name)
 * Returns { changes: [{ id, from, to, count }], updated }. apply=false counts and writes nothing.
 */
async function followRenames(base, liveById = {}, { names = null, apply = true } = {}) {
  const current = new Set(Object.values(liveById));
  let look = names;
  if (!look) look = (await tallyNamesOnLeads(base)).names.map((n) => n.name).filter((n) => !current.has(n));
  const tally = new Map();
  const updates = [];
  for (const oldName of look) {
    const formula = `{${FIELD}} = "${escapeFormula(oldName)}"`;
    // Look at a handful first: a name that belongs to a campaign no longer on the machine can sit
    // on thousands of leads, and reading every saved profile to learn nothing is minutes wasted.
    const sample = await base('Leads').select({ fields: ['Raw Profile Data'], filterByFormula: formula, maxRecords: 20 }).firstPage();
    if (!sample.some((r) => liveById[campaignIdOf(r.fields['Raw Profile Data'])])) continue;
    await new Promise((resolve, reject) => {
      base('Leads').select({ fields: [FIELD, 'Raw Profile Data'], filterByFormula: formula, pageSize: 100 }).eachPage(
        (records, next) => {
          for (const r of records) {
            const raw = r.fields['Raw Profile Data'];
            if (!campaignNameFromRaw(raw)) continue;          // the client's own choice - never touched
            const id = campaignIdOf(raw);
            const to = id ? liveById[id] : '';
            if (!to || to === oldName) continue;
            const key = `${id}\t${oldName}\t${to}`;
            tally.set(key, (tally.get(key) || 0) + 1);
            updates.push({ id: r.id, fields: { [FIELD]: String(to).slice(0, MAX_NAME) } });
          }
          next();
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }
  let updated = 0;
  if (apply) {
    for (let i = 0; i < updates.length; i += 10) {
      await base('Leads').update(updates.slice(i, i + 10));
      updated += Math.min(10, updates.length - i);
      await new Promise((r) => setTimeout(r, 220));         // under Airtable's 5 requests a second
    }
  }
  const changes = [...tally.entries()].map(([k, count]) => { const [id, from, to] = k.split('\t'); return { id: Number(id), from, to, count }; });
  return { changes, updated };
}

/** { id: name } of the campaigns on the client's machine now. Empty when there is no machine list. */
async function liveCampaignsById(clientId) {
  const listed = await lhCampaignList.listCampaigns(clientId, {});
  if (listed.source !== 'machine') return {};                // only the machine's own full list is trusted for this
  const out = {};
  for (const c of listed.campaigns) if (c.live && c.name) out[c.id] = c.name;
  return out;
}

const following = new Set(); // clients with a rename run in flight

/** One client's leads brought into line with the machine's current names. Never throws. */
async function followRenamesForClient(clientId, base, opts = {}) {
  if (following.has(clientId)) return { changes: [], updated: 0, busy: true };
  following.add(clientId);
  try {
    const liveById = await liveCampaignsById(clientId);
    if (!Object.keys(liveById).length) return { changes: [], updated: 0, noMachineList: true };
    const result = await followRenames(base, liveById, opts);
    if (result.updated) cache.delete(clientId);
    for (const c of result.changes) log.info(`lead-campaign: ${clientId} campaign #${c.id} "${c.from}" -> "${c.to}": ${c.count} lead(s)${opts.apply === false ? ' (count only)' : ''}`);
    return result;
  } catch (e) {
    log.warn(`lead-campaign: renames not followed for ${clientId}: ${e.message}`);
    return { changes: [], updated: 0, error: e.message };
  } finally {
    following.delete(clientId);
  }
}

/** The machine just reported a campaign under a new name (services/lhCampaignList.js saveList). */
async function onMachineRenames(clientId, renames = []) {
  if (!renames.length) return null;
  const { getClientBase } = require('../config/airtableClient');
  const base = await getClientBase(clientId);
  if (!base) return null;
  // Give the new list a moment to be saved - followRenamesForClient reads it back.
  await new Promise((r) => setTimeout(r, 3000));
  return followRenamesForClient(clientId, base, { names: [...new Set(renames.map((r) => r.from))] });
}

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
  FIELD, NONE, OWN_CONNECTIONS, keepRealCampaign, FILTER_READY, filterReady, RECENT_SHORTCUT, recentShortcut, OWN_CONNECTIONS_ARRIVE, ownConnectionsArrive, UNLABELLED_FORMULA,
  _setQuickMs: (ms) => { QUICK_MS = ms; }, campaignNameFromRaw, filterFormula, isMissingFieldError,
  describeLead, writeFields, getOptions, setLeadCampaign, tallyNamesOnLeads,
  followRenames, followRenamesForClient, onMachineRenames,
};
