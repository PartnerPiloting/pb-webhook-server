// services/reconnectDisconnects.js
// Reconnect, brick 5 (docs/RECONNECT-BUILD-PLAN.md): the POTENTIAL DISCONNECTS list - connections
// the client may not want to keep, so removing them frees room for new connection requests.
//
// Two ways onto the list:
//   - the client's own "Potential disconnect" button on a Reconnect row;
//   - a system suggestion: the conversation read as a DECLINE or as THEIR PITCH (Guy, 5 Oct 2026).
//
// Rules this file keeps:
//   - NOTHING IS REMOVED HERE. Approval only records the client's decision. Until the Linked Helper
//     removal route is proven, the approved people come out as a list of profile links to act on
//     by hand; "removed" is the client telling us they have done it.
//   - Nobody connected in the last year is ever suggested, and a client (current or former) never is.
//   - "Never replied" is NOT a reason. The Sales Navigator inbox is not read, so someone who only
//     ever wrote there looks like they never replied. Suggestions come from a conversation we read.
//   - Removing a connection destroys endorsements and recommendations for good - the screen says so
//     before the approve.

const rq = require('./reconnectQueue');

const MS_DAY = 86400000;
const PROTECT_DAYS = 365;
const SUGGEST = { declined: 'Declined', their_pitch: 'Their pitch' };
const MAX_ROWS = 500;

const nrm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Sort the rows into what the screen shows. Pure.
 * Each row: person fields + the score's ending/why + the state row's status/source/approved_at/removed_at.
 */
function planDisconnects(rows, { nowMs = Date.now(), clientNames = new Set() } = {}) {
  const pending = []; const approved = [];
  for (const r of rows) {
    const item = {
      key: r.person_key, name: r.name || '', headline: String(r.headline || '').split('\n')[0].slice(0, 160),
      linkedin: r.profile_url || null, why: r.why || '',
      connectedOn: r.connected_at ? new Date(r.connected_at).toISOString().slice(0, 10) : null,
    };
    if (r.status === 'disconnect') {
      if (r.removed_at) continue;
      if (r.approved_at) { approved.push(item); continue; }
      pending.push({ ...item, source: r.source === 'system' ? 'system' : 'client', tag: r.source === 'system' ? (SUGGEST[r.ending] || 'Suggested') : 'You flagged' });
      continue;
    }
    // Anything the client has already decided about (kept, done, never, skipped) is left alone.
    if (r.status || !SUGGEST[r.ending] || !r.is_connection) continue;
    if (clientNames.has(nrm(r.name))) continue;
    if (r.connected_at && nowMs - new Date(r.connected_at).getTime() < PROTECT_DAYS * MS_DAY) continue;
    pending.push({ ...item, source: 'system', tag: SUGGEST[r.ending] });
  }
  // The client's own picks first, then suggestions, each by name.
  pending.sort((a, b) => (a.source === b.source ? 0 : a.source === 'client' ? -1 : 1) || a.name.localeCompare(b.name));
  approved.sort((a, b) => a.name.localeCompare(b.name));
  return { pending, approved };
}

async function db() {
  const pool = rq._getPool();
  if (!pool) return null;
  await rq.ensureSchema(pool);
  return pool;
}

/** { enabled:false } unless the client's Reconnect switch is on. */
async function buildDisconnects(tenantId, { nowMs = Date.now() } = {}) {
  const clientService = require('./clientService');
  const client = await clientService.getClientById(tenantId);
  if (!client || String(client.reconnect || '').trim() !== 'Yes') return { enabled: false };
  const pool = await db();
  if (!pool) return { enabled: false };
  const r = await pool.query(
    `SELECT p.person_key, p.name, p.headline, p.profile_url, p.connected_at, p.is_connection,
            s.ending, s.why, st.status, st.source, st.approved_at, st.removed_at
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
  return { enabled: true, ...planDisconnects(r.rows, { nowMs, clientNames }) };
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
    await pool.query(
      `INSERT INTO reconnect_state (tenant_id, person_key, lead_rec_id, status, acted_at)
       SELECT $1, x.person_key, x.lead_rec_id, 'kept', now()
       FROM jsonb_to_recordset($2::jsonb) AS x(person_key text, lead_rec_id text)
       ON CONFLICT (tenant_id, person_key) DO UPDATE SET status = 'kept', approved_at = NULL, source = NULL, acted_at = now()`,
      [tenantId, rows]
    );
  }
  return { ok: true, action, count: known.rows.length };
}

module.exports = { buildDisconnects, disconnectAction, planDisconnects, PROTECT_DAYS };
