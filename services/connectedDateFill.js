/**
 * Fill a lead's blank Date Connected from the client's own LinkedIn connections list
 * (Guy, 25 Nov 2026).
 *
 * WHY: the nightly "My own connections" run on a client's Linked Helper machine reads the top of
 * their My Connections page and passes on anyone no campaign sent. Anyone who IS in a campaign's
 * history is skipped there, to save the profile visit. But "in a campaign's history" does not mean
 * "that campaign told Wingguy they connected": someone a visit-only campaign found, who later
 * connects outside a connect campaign, is already a lead and stays "Not connected" for ever. 787 of
 * Guy's leads had built up that way.
 *
 * The machine already has what is needed from the read it does anyway - each new connection's
 * profile address and the day they connected. For the people it skips, it now reports those two
 * things here (scripts/linked-helper/lh-own-connections.py), and this fills the date. No profile
 * visit, no webhook send: it costs no daily actions.
 *
 * RULES (do not loosen without Guy):
 *   - match on the LinkedIn address EXACTLY (utils/linkedinCanonical - the prefilter is re-verified).
 *     Never on a name.
 *   - write Date Connected ONLY where it is blank. A date already there is never replaced.
 *   - the connection status is set to 'Connected' only where it is blank; any other status
 *     ('Candidate' - which Top Scoring Leads selects on) is left exactly as it is.
 *   - nothing else on the record is written. The campaign is never touched.
 *   - only for clients the nightly collection is switched on for (leadCampaign.OWN_CONNECTIONS_ARRIVE).
 *
 * The answer says, per address, what happened - so the machine stops re-reporting people who are
 * settled:  'filled' | 'dated' (already had a date) | 'no-lead' (not a lead yet - try again later).
 */

const { canonicalLinkedinSlug, slugPrefilterFormula, findExactSlugMatch } = require('../utils/linkedinCanonical');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'connected_date_fill');

const MAX_PEOPLE = 300;      // one report; the machine sends the oldest first and the rest next night
const BATCH = 10;            // addresses per Airtable read
const FIELDS = ['LinkedIn Profile URL', 'Date Connected', 'LinkedIn Connection Status'];

/** A reported date as ISO, or '' when it cannot be a real connection date. ms epoch or a date string. */
function cleanDate(v, now = Date.now()) {
  if (v === undefined || v === null || v === '') return '';
  const n = typeof v === 'number' || /^\d{10,13}$/.test(String(v)) ? Number(v) : NaN;
  const d = new Date(Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : v);
  const t = d.getTime();
  if (Number.isNaN(t)) return '';
  // not before LinkedIn existed, not more than a day ahead (the machine reports its local midnight)
  if (t < Date.UTC(2003, 0, 1) || t > now + 36 * 3600 * 1000) return '';
  return d.toISOString();
}

/** [{ slug | link, connected_at }] -> one clean entry per address (the earliest date wins). */
function cleanPeople(people, now = Date.now()) {
  const by = new Map();
  for (const p of Array.isArray(people) ? people : []) {
    const slug = canonicalLinkedinSlug((p && (p.slug || p.link || p.url)) || '');
    const iso = cleanDate(p && (p.connected_at !== undefined ? p.connected_at : p.connectedAt), now);
    if (!slug || !iso) continue;
    const had = by.get(slug);
    if (!had || iso < had) by.set(slug, iso);
  }
  return [...by.entries()].map(([slug, iso]) => ({ slug, iso }));
}

/**
 * Fill the blank dates. `client` is the client record ({ clientId, airtableBaseId }).
 * Returns { ok, off?, received, filled, dated, noLead, results: { slug: 'filled'|'dated'|'no-lead' } }.
 */
async function fillConnectedDates(client, people, { deps = {}, now = Date.now() } = {}) {
  const leadCampaign = deps.leadCampaign || require('./leadCampaign');
  const clientService = deps.clientService || require('./clientService');
  const clientId = client && client.clientId;
  if (!clientId || !leadCampaign.ownConnectionsArrive(clientId)) return { ok: true, off: true, received: 0, filled: 0, dated: 0, noLead: 0, results: {} };
  const clean = cleanPeople(people, now).slice(0, MAX_PEOPLE);
  const out = { ok: true, received: clean.length, filled: 0, dated: 0, noLead: 0, results: {} };
  if (!clean.length) return out;
  const base = client.airtableBaseId ? clientService.getClientBase(client.airtableBaseId) : null;
  if (!base) return { ok: false, error: 'no leads base for this client' };

  for (let i = 0; i < clean.length; i += BATCH) {
    const slice = clean.slice(i, i + BATCH);
    let candidates = [];
    try {
      candidates = await base('Leads').select({ fields: FIELDS, filterByFormula: `OR(${slice.map((p) => slugPrefilterFormula(p.slug)).join(', ')})`, pageSize: 100 }).all();
    } catch (e) {
      log.warn(`connected dates: ${clientId} - leads not read (${e.message}); those people are tried again next time`);
      continue;                                   // no result for these = the machine reports them again
    }
    const updates = [];
    for (const p of slice) {
      const leads = findExactSlugMatch(candidates, p.slug);          // strict equality - the prefilter over-matches
      if (!leads.length) { out.results[p.slug] = 'no-lead'; out.noLead++; continue; }
      const blank = leads.filter((r) => !r.fields['Date Connected']);
      if (!blank.length) { out.results[p.slug] = 'dated'; out.dated++; continue; }
      for (const r of blank) {
        const fields = { 'Date Connected': p.iso };
        if (!r.fields['LinkedIn Connection Status']) fields['LinkedIn Connection Status'] = 'Connected';
        updates.push({ id: r.id, fields, slug: p.slug });
      }
    }
    for (let j = 0; j < updates.length; j += 10) {
      const chunk = updates.slice(j, j + 10);
      try {
        await base('Leads').update(chunk.map((u) => ({ id: u.id, fields: u.fields })));
        for (const u of chunk) { if (out.results[u.slug] !== 'filled') { out.results[u.slug] = 'filled'; out.filled++; } }
        log.info(`connected dates: ${clientId} - filled ${chunk.map((u) => `${u.id} ${u.fields['Date Connected'].slice(0, 10)}`).join(', ')}`);
      } catch (e) {
        log.warn(`connected dates: ${clientId} - write failed (${e.message}); those people are tried again next time`);
      }
    }
  }
  if (out.filled) log.info(`connected dates: ${clientId} - ${out.filled} filled, ${out.dated} already dated, ${out.noLead} not leads yet (of ${out.received} reported)`);
  return out;
}

module.exports = { fillConnectedDates, cleanPeople, cleanDate, MAX_PEOPLE };
