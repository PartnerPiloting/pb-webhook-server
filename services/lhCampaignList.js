/**
 * A client's Linked Helper campaigns - the list behind the "applies to" picker on a scoring
 * attribute and the campaign picker on Today (2026-10-23, Sam Noble).
 *
 * WHY: Guy did not want a new campaign to be untaggable until Linked Helper had sent a lead from it
 * ("a little bit sloppy"). So the source is the MACHINE: the watchdog reports every unarchived
 * campaign every 5 minutes (`campaign.all_campaigns`, scripts/linked-helper/lh-watchdog.py), so a
 * campaign is in the picker within minutes of being created - before anyone is loaded into it.
 *
 * Merged, newest-first, by Linked Helper campaign ID:
 *   1. the machine's full list (lh_campaign_lists - this file)
 *   2. the Monday-numbers snapshot (lh_campaign_snapshots - campaigns with recent activity), for a
 *      machine still on a watchdog from before all_campaigns
 *   3. campaign IDs + names read off the client's recent leads ({Raw Profile Data}) - the only
 *      source for a client running Linked Helper on their own computer (no watchdog)
 *
 * Returns [{ id, name, paused, live, leads }]: live = on the machine now (not archived); leads =
 * recent leads seen from it (only counted when the leads were read).
 */

const { Pool } = require('pg');
const { createSafeLogger } = require('../utils/loggerHelper');
const campaignScope = require('./campaignScope');

const log = createSafeLogger('SYSTEM', null, 'lh_campaign_list');

const MAX_CAMPAIGNS = 100;

let pool;
let schemaEnsured = false;

function getPool() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });
    pool.on('error', (e) => log.error(`lh-campaign-list pool error: ${e.message}`));
  }
  return pool;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS lh_campaign_lists (
      client_id    TEXT        PRIMARY KEY,
      campaigns    JSONB       NOT NULL,
      reported_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  schemaEnsured = true;
}

async function withClient(fn) {
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

/** The machine's list -> [{id, name, paused}], only well-formed entries. */
function cleanList(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const c of list.slice(0, MAX_CAMPAIGNS)) {
    if (!c || typeof c !== 'object') continue;
    const id = Number(c.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    out.push({ id, name: String(c.name || '').trim().slice(0, 80), paused: !!c.paused });
  }
  return out;
}

/** Called on every machine report that carries all_campaigns. Never throws. */
async function saveList(clientId, list) {
  const campaigns = cleanList(list);
  if (!clientId || !campaigns) return false;
  try {
    await withClient((client) => client.query(
      `INSERT INTO lh_campaign_lists (client_id, campaigns, reported_at) VALUES ($1, $2, now())
       ON CONFLICT (client_id) DO UPDATE SET campaigns = $2, reported_at = now()`,
      [String(clientId), JSON.stringify(campaigns)],
    ));
    return true;
  } catch (e) {
    log.error(`lh-campaign-list for ${clientId} not saved (non-fatal): ${e.message}`);
    return false;
  }
}

async function readRow(table, clientId) {
  try {
    const res = await withClient((client) => client.query(`SELECT campaigns, reported_at FROM ${table} WHERE client_id = $1`, [String(clientId)]));
    return res && res.rows && res.rows[0] ? res.rows[0] : null;
  } catch (e) {
    // lh_campaign_snapshots may not exist yet on a fresh database - not a failure here.
    return null;
  }
}

/** Campaign IDs + names off recent leads' {Raw Profile Data}: [{id, name, leads}]. */
function tallyLeadCampaigns(records = []) {
  const byId = new Map();
  for (const r of records) {
    const raw = ((r && r.fields) || {})['Raw Profile Data'];
    const id = campaignScope.campaignIdOf(raw);
    if (!id) continue;
    const name = require('./wingguyRulesSource').lhCampaignNameOf({ rawProfileData: raw });
    const row = byId.get(id) || { id, name: '', leads: 0 };
    row.leads++;
    if (!row.name && name) row.name = name;
    byId.set(id, row);
  }
  return [...byId.values()];
}

async function readRecentLeads(base, days = 120, max = 300) {
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
    return select({});
  }
}

/**
 * Merge the sources into one list. machine = lh_campaign_lists row (or null), snapshot =
 * lh_campaign_snapshots row (or null), fromLeads = tallyLeadCampaigns output (or []).
 * When the machine's full list is there it is the truth about what is live: anything else is an
 * archived (or deleted) campaign, kept only so an attribute tagged with it still shows a name.
 */
function mergeSources({ machine = null, snapshot = null, fromLeads = [] } = {}) {
  const byId = new Map();
  const put = (id, patch) => byId.set(id, { id, name: '', paused: false, live: false, leads: 0, ...(byId.get(id) || {}), ...patch });
  const full = machine && Array.isArray(machine.campaigns) ? machine.campaigns : null;
  for (const c of full || []) put(Number(c.id), { name: c.name || '', paused: !!c.paused, live: true });
  if (!full && snapshot && Array.isArray(snapshot.campaigns)) {
    for (const c of snapshot.campaigns) if (Number(c.id) > 0) put(Number(c.id), { name: c.name || '', paused: !!c.paused, live: true });
  }
  for (const c of fromLeads) {
    const had = byId.get(c.id);
    put(c.id, { name: (had && had.name) || c.name || '', leads: c.leads, live: had ? had.live : !full });
  }
  return [...byId.values()].sort((a, b) => (b.live - a.live) || a.id - b.id);
}

/**
 * The client's campaigns. opts.base: their leads base (to read leads too); opts.withLeads: also
 * read recent leads even when the machine list exists (counts for the Today picker).
 */
async function listCampaigns(clientId, { base = null, withLeads = false } = {}) {
  const machine = await readRow('lh_campaign_lists', clientId);
  const snapshot = machine ? null : await readRow('lh_campaign_snapshots', clientId);
  let fromLeads = [];
  if (base && (withLeads || (!machine && !snapshot))) {
    try {
      fromLeads = tallyLeadCampaigns(await readRecentLeads(base));
    } catch (e) {
      log.warn(`lh-campaign-list: leads not read for ${clientId}: ${e.message}`);
    }
  }
  return {
    campaigns: mergeSources({ machine, snapshot, fromLeads }),
    source: machine ? 'machine' : snapshot ? 'machine-activity' : fromLeads.length ? 'leads' : 'none',
    reportedAt: machine ? machine.reported_at : snapshot ? snapshot.reported_at : null,
  };
}

/**
 * Stamp campaignId on queue items ({recId}) for the Today campaign picker - only worth the read
 * when the client runs 2+ campaigns, so the caller checks that first. Reads {Raw Profile Data} for
 * just those leads, 40 at a time. Never throws; an item it can't place keeps campaignId null.
 */
async function attachLeadCampaigns(base, items = []) {
  const ids = [...new Set(items.map((it) => it && it.recId).filter((x) => /^rec[A-Za-z0-9]{14}$/.test(String(x || ''))))];
  const byRec = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const slice = ids.slice(i, i + 40);
    try {
      const recs = await base('Leads').select({
        fields: ['Raw Profile Data'],
        filterByFormula: `OR(${slice.map((id) => `RECORD_ID()='${id}'`).join(',')})`,
        pageSize: 100,
      }).all();
      for (const r of recs) byRec.set(r.id, campaignScope.campaignIdOfRecord(r));
    } catch (e) {
      log.warn(`lh-campaign-list: campaigns for queue items not read: ${e.message}`);
    }
  }
  for (const it of items) if (it) it.campaignId = byRec.get(it.recId) ?? null;
  return items;
}

/** { id: name } for the names in tags and messages. */
function namesById(campaigns = []) {
  const out = {};
  for (const c of campaigns) if (c.name) out[c.id] = c.name;
  return out;
}

module.exports = { saveList, listCampaigns, mergeSources, tallyLeadCampaigns, cleanList, namesById, attachLeadCampaigns, MAX_CAMPAIGNS };
