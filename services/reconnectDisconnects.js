// services/reconnectDisconnects.js
// Reconnect, brick 5 (docs/RECONNECT-BUILD-PLAN.md): the POTENTIAL DISCONNECTS list - connections
// the client may not want to keep, so removing them frees room for new connection requests.
//
// Two ways onto the list:
//   - the client's own "Potential disconnect" button on a Reconnect row;
//   - a system suggestion: the conversation read as a DECLINE or as THEIR PITCH (Guy, 5 Oct 2026).
//
// Rules this file keeps:
//   - NOTHING IS REMOVED HERE. Approval records the client's decision. Each night the client's own
//     Linked Helper machine collects the approved profile links (pendingForMachine, through the
//     per-machine secret) and puts them in its removal campaign, which runs midnight to 5am.
//     Approved people sit in "going tonight" until that pick-up and can be undone until then.
//   - It is an OPTIONAL EXTRA with its own switch (Reconnect Disconnects = Yes): most clients never
//     need it - only those near LinkedIn's connection limit.
//   - Nobody connected in the last year is ever suggested, and a client (current or former) never is.
//   - "Never replied" is NOT a reason. The Sales Navigator inbox is not read, so someone who only
//     ever wrote there looks like they never replied. Suggestions come from a conversation we read.
//   - The PROFILE score rides on every row and the list is ordered highest first (Guy, 5 Oct 2026),
//     so a strong profile is seen before it is approved. Anyone at HIGH_SCORE or above is marked
//     `guard` - the screen starts them unticked.
//   - Removing a connection destroys endorsements and recommendations for good - the screen says so
//     before the approve.

const rq = require('./reconnectQueue');

const MS_DAY = 86400000;
const PROTECT_DAYS = 365;
const SUGGEST = { declined: 'Declined', their_pitch: 'Their pitch' };
const MAX_ROWS = 500;
const HIGH_SCORE = 70;
const SCORES_CACHE_MS = 5 * 60 * 1000;

const nrm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Sort the rows into what the screen shows. Pure.
 * Each row: person fields + the score's ending/why + the state row's status/source/approved_at/removed_at.
 */
function planDisconnects(rows, { nowMs = Date.now(), clientNames = new Set(), scoresByLead = new Map() } = {}) {
  const pending = []; const approved = []; const handedOver = [];
  for (const r of rows) {
    const raw = r.lead_rec_id ? scoresByLead.get(r.lead_rec_id) : null;
    const profileScore = raw == null || raw === '' || Number.isNaN(Number(raw)) ? null : Math.round(Number(raw));
    const item = {
      profileScore, guard: profileScore != null && profileScore >= HIGH_SCORE,
      key: r.person_key, name: r.name || '', headline: String(r.headline || '').split('\n')[0].slice(0, 160),
      linkedin: r.profile_url || null, why: r.why || '',
      connectedOn: r.connected_at ? new Date(r.connected_at).toISOString().slice(0, 10) : null,
    };
    if (r.status === 'disconnect') {
      if (r.removed_at) continue;
      if (r.approved_at) { (r.queued_at ? handedOver : approved).push(item); continue; }
      pending.push({ ...item, source: r.source === 'system' ? 'system' : 'client', tag: r.source === 'system' ? (SUGGEST[r.ending] || 'Suggested') : 'You flagged' });
      continue;
    }
    // Anything the client has already decided about (kept, done, never, skipped) is left alone.
    if (r.status || !SUGGEST[r.ending] || !r.is_connection) continue;
    if (clientNames.has(nrm(r.name))) continue;
    if (r.connected_at && nowMs - new Date(r.connected_at).getTime() < PROTECT_DAYS * MS_DAY) continue;
    pending.push({ ...item, source: 'system', tag: SUGGEST[r.ending] });
  }
  // Highest profile score first, so a strong profile is the first thing seen; unscored people last.
  pending.sort((a, b) => ((b.profileScore ?? -1) - (a.profileScore ?? -1)) || a.name.localeCompare(b.name));
  approved.sort((a, b) => a.name.localeCompare(b.name));
  // approved = going tonight (not yet with Linked Helper, can be undone); handedOver = with it.
  return { pending, approved, handedOver: handedOver.length };
}

async function db() {
  const pool = rq._getPool();
  if (!pool) return null;
  await rq.ensureSchema(pool);
  return pool;
}

const scoresCache = new Map(); // tenantId -> { at, byId }
/** Profile score (AI Score) for every lead that carries a conversation score, by record id. */
async function loadProfileScores(base, tenantId) {
  const hit = scoresCache.get(tenantId);
  if (hit && Date.now() - hit.at < SCORES_CACHE_MS) return hit.byId;
  const records = await base('Leads').select({ filterByFormula: '{Conversation Score} >= 1', fields: ['AI Score'] }).all();
  const byId = new Map(records.map((r) => [r.id, r.fields['AI Score']]));
  scoresCache.set(tenantId, { at: Date.now(), byId });
  return byId;
}

/** { enabled:false } unless the client's Reconnect switch is on. */
async function buildDisconnects(tenantId, { nowMs = Date.now() } = {}) {
  const clientService = require('./clientService');
  const client = await clientService.getClientById(tenantId);
  if (!rq.disconnectsOn(client)) return { enabled: false };
  const pool = await db();
  if (!pool) return { enabled: false };
  const r = await pool.query(
    `SELECT p.person_key, p.lead_rec_id, p.name, p.headline, p.profile_url, p.connected_at, p.is_connection,
            s.ending, s.why, st.status, st.source, st.approved_at, st.removed_at, st.queued_at
     FROM linkedin_people p
     LEFT JOIN linkedin_conversation_scores s ON s.tenant_id = p.tenant_id AND s.person_key = p.person_key
     LEFT JOIN reconnect_state st ON st.tenant_id = p.tenant_id AND st.person_key = p.person_key
     WHERE p.tenant_id = $1 AND (st.status = 'disconnect' OR s.ending = ANY($2))
     ORDER BY (st.status = 'disconnect') DESC NULLS LAST, p.name
     LIMIT ${MAX_ROWS}`,
    [tenantId, Object.keys(SUGGEST)]
  );
  const clients = await clientService.getAllClients();
  const clientNames = new Set((clients || []).map((c) => nrm(c.clientName)).filter(Boolean));
  // The score is a safeguard, not a requirement: if the leads read fails the list still serves.
  let scoresByLead = new Map();
  try {
    const base = client.airtableBaseId && clientService.getClientBase(client.airtableBaseId);
    if (base) scoresByLead = await loadProfileScores(base, tenantId);
  } catch (e) { console.error(`[reconnectDisconnects] ${tenantId}: profile scores unavailable - ${e.message}`); }
  return { enabled: true, highScore: HIGH_SCORE, ...planDisconnects(r.rows, { nowMs, clientNames, scoresByLead }) };
}

/**
 * approve - record that these people are approved for removal (nothing is removed).
 * keep    - take them off the list for good; a flagged person returns to the Reconnect pool.
 * removed - the client has removed every approved person themselves; clear the approved list.
 */
async function disconnectAction(tenantId, action, keys = []) {
  const pool = await db();
  if (!pool) return { ok: false, error: 'store_unavailable' };
  if (action === 'removed') {
    const r = await pool.query(
      `UPDATE reconnect_state SET removed_at = now()
       WHERE tenant_id = $1 AND status = 'disconnect' AND approved_at IS NOT NULL AND removed_at IS NULL`,
      [tenantId]
    );
    return { ok: true, action, count: r.rowCount || 0 };
  }
  const list = [...new Set((Array.isArray(keys) ? keys : []).map((k) => String(k || '').trim()).filter(Boolean))];
  if (!list.length || !['approve', 'keep'].includes(action)) return { ok: false, error: 'invalid_action' };
  // Only people who are really this client's - a key from anywhere else matches nothing.
  const known = await pool.query('SELECT person_key, lead_rec_id FROM linkedin_people WHERE tenant_id = $1 AND person_key = ANY($2)', [tenantId, list]);
  if (!known.rows.length) return { ok: false, error: 'unknown_people' };
  const rows = JSON.stringify(known.rows);
  if (action === 'approve') {
    await pool.query(
      `INSERT INTO reconnect_state (tenant_id, person_key, lead_rec_id, status, source, approved_at, acted_at)
       SELECT $1, x.person_key, x.lead_rec_id, 'disconnect', 'system', now(), now()
       FROM jsonb_to_recordset($2::jsonb) AS x(person_key text, lead_rec_id text)
       ON CONFLICT (tenant_id, person_key) DO UPDATE SET status = 'disconnect', approved_at = now(), acted_at = now(),
         source = COALESCE(reconnect_state.source, 'system')`,
      [tenantId, rows]
    );
  } else {
    // Keep is also the UNDO for someone going tonight. Once Linked Helper has them it is too
    // late from here, so those rows are left alone and the count says how many were changed.
    const r = await pool.query(
      `INSERT INTO reconnect_state (tenant_id, person_key, lead_rec_id, status, acted_at)
       SELECT $1, x.person_key, x.lead_rec_id, 'kept', now()
       FROM jsonb_to_recordset($2::jsonb) AS x(person_key text, lead_rec_id text)
       ON CONFLICT (tenant_id, person_key) DO UPDATE SET status = 'kept', approved_at = NULL, source = NULL, acted_at = now()
         WHERE reconnect_state.queued_at IS NULL`,
      [tenantId, rows]
    );
    return { ok: true, action, count: r.rowCount || 0 };
  }
  return { ok: true, action, count: known.rows.length };
}

/**
 * What the client's Linked Helper machine collects: profile links of approved people not yet handed
 * over. Only for a client with the disconnects switch on.
 */
async function pendingForMachine(client) {
  if (!rq.disconnectsOn(client)) return [];
  const pool = await db();
  if (!pool) return [];
  const r = await pool.query(
    `SELECT st.person_key, p.profile_url, p.public_identifier
     FROM reconnect_state st JOIN linkedin_people p ON p.tenant_id = st.tenant_id AND p.person_key = st.person_key
     WHERE st.tenant_id = $1 AND st.status = 'disconnect' AND st.approved_at IS NOT NULL
       AND st.queued_at IS NULL AND st.removed_at IS NULL
     ORDER BY st.approved_at LIMIT 500`,
    [client.clientId]
  );
  return r.rows.map((x) => ({
    key: x.person_key,
    link: x.public_identifier ? `https://www.linkedin.com/in/${x.public_identifier}/` : (x.profile_url || ''),
  })).filter((x) => /linkedin\.com\/in\//.test(x.link));
}

/** The machine confirming which people it has put in its removal campaign. */
async function markQueued(tenantId, keys = []) {
  const list = [...new Set((Array.isArray(keys) ? keys : []).map((k) => String(k || '').trim()).filter(Boolean))].slice(0, 500);
  if (!list.length) return { ok: true, count: 0 };
  const pool = await db();
  if (!pool) return { ok: false, error: 'store_unavailable' };
  const r = await pool.query(
    `UPDATE reconnect_state SET queued_at = now()
     WHERE tenant_id = $1 AND person_key = ANY($2) AND status = 'disconnect' AND approved_at IS NOT NULL AND queued_at IS NULL`,
    [tenantId, list]
  );
  return { ok: true, count: r.rowCount || 0 };
}

module.exports = { buildDisconnects, disconnectAction, planDisconnects, pendingForMachine, markQueued, PROTECT_DAYS, HIGH_SCORE };
