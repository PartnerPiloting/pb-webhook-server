// services/wisprStore.js
// Where the Wispr feed keeps its state (Postgres, the same database as the transcript store):
//
//   wispr_connections   - one row per connected client: the pass, the renewal ticket, when the pass
//                         runs out, connection status, last good check. THE SECRETS LIVE HERE.
//   wispr_oauth_pending - a sign-in that has been started and not finished (15 minutes).
//   wispr_recordings    - one row per Wispr recording we have looked at: what we did with it, and
//                         for a recording nobody could put a name to, the "who was this with?" state.
//
// WHY POSTGRES AND NOT THE CLIENT'S MASTER RECORD (where the Fathom/Granola/Claude keys sit): those
// keys never change. Wispr's renewal ticket CHANGES ON EVERY RENEWAL, and the old one dies the
// moment the new one is issued - so the new one has to be saved under a lock two renewals cannot
// both hold. Airtable has no lock and no transaction. Same handling otherwise: never sent to a
// browser, never logged, cleared by offboarding (deleteConnection).
//
// The lock is a Postgres advisory lock (works across processes - prod and a one-off job cannot both
// renew) with ordinary auto-committed writes inside it, so a ticket saved is saved even if
// something after it throws.
//
// createMemoryStore() is the same interface with no database - the tests run the real feed code on it.

const CONN_COLS = {
  status: 'status',
  accessToken: 'access_token',
  refreshToken: 'refresh_token',
  prevRefreshToken: 'prev_refresh_token',
  expiresAt: 'expires_at',
  connectedAt: 'connected_at',
  lastRefreshAt: 'last_refresh_at',
  lastCheckAt: 'last_check_at',
  lastSuccessAt: 'last_success_at',
  lastError: 'last_error',
  lastErrorAt: 'last_error_at',
  disconnectedAt: 'disconnected_at',
  disconnectReason: 'disconnect_reason',
  reconnectEmailedAt: 'reconnect_emailed_at',
  wisprUser: 'wispr_user',
  lastResult: 'last_result',
};

const REC_COLS = {
  outcome: 'outcome',
  meetingId: 'meeting_id',
  title: 'title',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  detail: 'detail',
  needsName: 'needs_name',
  guess: 'guess',
  askEmailedAt: 'ask_emailed_at',
  namedAt: 'named_at',
  namedLeadId: 'named_lead_id',
  skippedAt: 'skipped_at',
};

const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)));

function mapConn(r) {
  if (!r) return null;
  return {
    coachClientId: r.coach_client_id,
    status: r.status,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    prevRefreshToken: r.prev_refresh_token,
    expiresAt: iso(r.expires_at),
    connectedAt: iso(r.connected_at),
    lastRefreshAt: iso(r.last_refresh_at),
    lastCheckAt: iso(r.last_check_at),
    lastSuccessAt: iso(r.last_success_at),
    lastError: r.last_error,
    lastErrorAt: iso(r.last_error_at),
    disconnectedAt: iso(r.disconnected_at),
    disconnectReason: r.disconnect_reason,
    reconnectEmailedAt: iso(r.reconnect_emailed_at),
    wisprUser: r.wispr_user,
    lastResult: r.last_result,
  };
}

function mapRec(r) {
  if (!r) return null;
  let guess = null;
  try { guess = r.guess ? (typeof r.guess === 'string' ? JSON.parse(r.guess) : r.guess) : null; } catch (_) { guess = null; }
  return {
    coachClientId: r.coach_client_id,
    wisprId: r.wispr_id,
    outcome: r.outcome,
    meetingId: r.meeting_id == null ? null : String(r.meeting_id),
    title: r.title,
    startedAt: iso(r.started_at),
    endedAt: iso(r.ended_at),
    detail: r.detail,
    needsName: !!r.needs_name,
    guess,
    askEmailedAt: iso(r.ask_emailed_at),
    namedAt: iso(r.named_at),
    namedLeadId: r.named_lead_id,
    skippedAt: iso(r.skipped_at),
    createdAt: iso(r.created_at),
  };
}

/** A connection with the secrets left out - the only shape that may be logged or shown. */
function publicConnection(c) {
  if (!c) return null;
  const { accessToken, refreshToken, prevRefreshToken, ...rest } = c;
  return { ...rest, hasPass: !!accessToken, hasTicket: !!refreshToken };
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

let ensured = false;
async function ensure(q) {
  if (ensured) return;
  await q.query(`
    CREATE TABLE IF NOT EXISTS wispr_connections (
      coach_client_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'connected',
      access_token TEXT,
      refresh_token TEXT,
      prev_refresh_token TEXT,
      expires_at TIMESTAMPTZ,
      connected_at TIMESTAMPTZ,
      last_refresh_at TIMESTAMPTZ,
      last_check_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      last_error TEXT,
      last_error_at TIMESTAMPTZ,
      disconnected_at TIMESTAMPTZ,
      disconnect_reason TEXT,
      reconnect_emailed_at TIMESTAMPTZ,
      wispr_user TEXT,
      last_result TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await q.query(`
    CREATE TABLE IF NOT EXISTS wispr_oauth_pending (
      state TEXT PRIMARY KEY,
      coach_client_id TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await q.query(`
    CREATE TABLE IF NOT EXISTS wispr_recordings (
      coach_client_id TEXT NOT NULL,
      wispr_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      meeting_id BIGINT,
      title TEXT,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      detail TEXT,
      needs_name BOOLEAN NOT NULL DEFAULT FALSE,
      guess TEXT,
      ask_emailed_at TIMESTAMPTZ,
      named_at TIMESTAMPTZ,
      named_lead_id TEXT,
      skipped_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (coach_client_id, wispr_id)
    );
  `);
  await q.query(`CREATE INDEX IF NOT EXISTS idx_wispr_rec_needs_name ON wispr_recordings (coach_client_id) WHERE needs_name;`);
  ensured = true;
}

function setClause(cols, fields, startAt = 1) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (!cols[k]) continue;
    vals.push(k === 'guess' && v != null && typeof v !== 'string' ? JSON.stringify(v) : v);
    sets.push(`${cols[k]} = $${startAt + vals.length - 1}`);
  }
  return { sets, vals };
}

// One renewal at a time per tenant inside THIS process, before the database lock is even asked for.
const chains = new Map();
function inProcess(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

function createPgStore(getPool = () => require('./recallWebhookDb').getPool()) {
  const pool = () => {
    const p = getPool();
    if (!p) throw new Error('database not available');
    return p;
  };
  const ready = async () => { const p = pool(); await ensure(p); return p; };

  async function patchConn(q, tenant, fields) {
    const { sets, vals } = setClause(CONN_COLS, fields, 2);
    if (!sets.length) return;
    await q.query(`UPDATE wispr_connections SET ${sets.join(', ')}, updated_at = now() WHERE coach_client_id = $1`, [tenant, ...vals]);
  }

  return {
    kind: 'pg',

    async getConnection(tenant) {
      const p = await ready();
      const r = await p.query(`SELECT * FROM wispr_connections WHERE coach_client_id = $1`, [String(tenant)]);
      return mapConn(r.rows[0]);
    },

    async listConnections() {
      const p = await ready();
      const r = await p.query(`SELECT * FROM wispr_connections ORDER BY coach_client_id`);
      return r.rows.map(mapConn);
    },

    /** A finished sign-in (first connect or reconnect). Keeps last_success_at so the catch-up knows where to start. */
    async saveNewConnection(tenant, { accessToken, refreshToken, expiresAt, wisprUser }) {
      const p = await ready();
      await p.query(
        `INSERT INTO wispr_connections (coach_client_id, status, access_token, refresh_token, prev_refresh_token, expires_at, connected_at, wispr_user)
         VALUES ($1, 'connected', $2, $3, NULL, $4, now(), $5)
         ON CONFLICT (coach_client_id) DO UPDATE SET
           status = 'connected', access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
           prev_refresh_token = NULL, expires_at = EXCLUDED.expires_at, connected_at = now(),
           wispr_user = COALESCE(EXCLUDED.wispr_user, wispr_connections.wispr_user),
           disconnected_at = NULL, disconnect_reason = NULL, reconnect_emailed_at = NULL,
           last_error = NULL, last_error_at = NULL, updated_at = now()`,
        [String(tenant), accessToken, refreshToken, expiresAt, wisprUser || null],
      );
    },

    async updateConnection(tenant, fields) {
      const p = await ready();
      await patchConn(p, String(tenant), fields);
    },

    async deleteConnection(tenant) {
      const p = await ready();
      await p.query(`DELETE FROM wispr_connections WHERE coach_client_id = $1`, [String(tenant)]);
    },

    /**
     * Run fn(row, save) while holding THE lock for this tenant's connection. `row` is read after
     * the lock is held (so a renewal that just finished elsewhere is visible); `save(fields)`
     * writes at once and stays written.
     */
    async withConnectionLock(tenant, fn) {
      const key = String(tenant);
      return inProcess(key, async () => {
        const p = await ready();
        const client = await p.connect();
        try {
          await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [`wispr:${key}`]);
          try {
            const r = await client.query(`SELECT * FROM wispr_connections WHERE coach_client_id = $1`, [key]);
            return await fn(mapConn(r.rows[0]), (fields) => patchConn(client, key, fields));
          } finally {
            await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`wispr:${key}`]).catch(() => {});
          }
        } finally {
          client.release();
        }
      });
    },

    async putPendingAuth(state, tenant, codeVerifier) {
      const p = await ready();
      await p.query(`DELETE FROM wispr_oauth_pending WHERE created_at < now() - interval '1 day'`);
      await p.query(`INSERT INTO wispr_oauth_pending (state, coach_client_id, code_verifier) VALUES ($1, $2, $3)`, [state, String(tenant), codeVerifier]);
    },

    /** One use only: reading it removes it. Older than 15 minutes = gone. */
    async takePendingAuth(state) {
      const p = await ready();
      const r = await p.query(`DELETE FROM wispr_oauth_pending WHERE state = $1 RETURNING coach_client_id, code_verifier, created_at`, [String(state || '')]);
      const row = r.rows[0];
      if (!row) return null;
      if (Date.now() - new Date(row.created_at).getTime() > 15 * 60 * 1000) return null;
      return { coachClientId: row.coach_client_id, codeVerifier: row.code_verifier };
    },

    async getRecording(tenant, wisprId) {
      const p = await ready();
      const r = await p.query(`SELECT * FROM wispr_recordings WHERE coach_client_id = $1 AND wispr_id = $2`, [String(tenant), String(wisprId)]);
      return mapRec(r.rows[0]);
    },

    async getRecordingByMeetingId(tenant, meetingId) {
      const p = await ready();
      const r = await p.query(`SELECT * FROM wispr_recordings WHERE coach_client_id = $1 AND meeting_id = $2 LIMIT 1`, [String(tenant), Number(meetingId)]);
      return mapRec(r.rows[0]);
    },

    async upsertRecording(tenant, wisprId, fields) {
      const p = await ready();
      const existing = await p.query(`SELECT 1 FROM wispr_recordings WHERE coach_client_id = $1 AND wispr_id = $2`, [String(tenant), String(wisprId)]);
      if (!existing.rows.length) {
        await p.query(
          `INSERT INTO wispr_recordings (coach_client_id, wispr_id, outcome) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [String(tenant), String(wisprId), String(fields.outcome || 'seen')],
        );
      }
      const { sets, vals } = setClause(REC_COLS, fields, 3);
      if (sets.length) {
        await p.query(`UPDATE wispr_recordings SET ${sets.join(', ')}, updated_at = now() WHERE coach_client_id = $1 AND wispr_id = $2`, [String(tenant), String(wisprId), ...vals]);
      }
    },

    /** Recordings still waiting on "who was this with?" - newest first. */
    async listNeedsName(tenant) {
      const p = await ready();
      const r = tenant
        ? await p.query(`SELECT * FROM wispr_recordings WHERE needs_name AND coach_client_id = $1 ORDER BY started_at DESC NULLS LAST LIMIT 50`, [String(tenant)])
        : await p.query(`SELECT * FROM wispr_recordings WHERE needs_name ORDER BY started_at DESC NULLS LAST LIMIT 200`);
      return r.rows.map(mapRec);
    },
  };
}

// ---------------------------------------------------------------------------
// In memory (tests)
// ---------------------------------------------------------------------------

function createMemoryStore() {
  const conns = new Map();
  const pending = new Map();
  const recs = new Map();
  const locks = new Map();
  const recKey = (t, id) => `${t}|${id}`;
  const lock = (key, fn) => {
    const prev = locks.get(key) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    locks.set(key, run.catch(() => {}));
    return run;
  };
  const patch = (tenant, fields) => {
    const cur = conns.get(tenant);
    if (!cur) return;
    for (const [k, v] of Object.entries(fields || {})) if (CONN_COLS[k]) cur[k] = v;
  };
  return {
    kind: 'memory',
    _conns: conns,
    _recs: recs,
    async getConnection(tenant) { const c = conns.get(String(tenant)); return c ? { ...c } : null; },
    async listConnections() { return [...conns.values()].map((c) => ({ ...c })); },
    async saveNewConnection(tenant, { accessToken, refreshToken, expiresAt, wisprUser }) {
      const t = String(tenant);
      const prev = conns.get(t) || { coachClientId: t, lastSuccessAt: null, lastCheckAt: null };
      conns.set(t, {
        ...prev, status: 'connected', accessToken, refreshToken, prevRefreshToken: null, expiresAt,
        connectedAt: new Date().toISOString(), wisprUser: wisprUser || prev.wisprUser || null,
        disconnectedAt: null, disconnectReason: null, reconnectEmailedAt: null, lastError: null, lastErrorAt: null,
      });
    },
    async updateConnection(tenant, fields) { patch(String(tenant), fields); },
    async deleteConnection(tenant) { conns.delete(String(tenant)); },
    async withConnectionLock(tenant, fn) {
      const t = String(tenant);
      return lock(t, async () => {
        const c = conns.get(t);
        return fn(c ? { ...c } : null, async (fields) => patch(t, fields));
      });
    },
    async putPendingAuth(state, tenant, codeVerifier) { pending.set(state, { coachClientId: String(tenant), codeVerifier, at: Date.now() }); },
    async takePendingAuth(state) {
      const p = pending.get(state);
      if (!p) return null;
      pending.delete(state);
      if (Date.now() - p.at > 15 * 60 * 1000) return null;
      return { coachClientId: p.coachClientId, codeVerifier: p.codeVerifier };
    },
    async getRecording(tenant, wisprId) { const r = recs.get(recKey(tenant, wisprId)); return r ? { ...r } : null; },
    async getRecordingByMeetingId(tenant, meetingId) {
      const r = [...recs.values()].find((x) => x.coachClientId === String(tenant) && String(x.meetingId) === String(meetingId));
      return r ? { ...r } : null;
    },
    async upsertRecording(tenant, wisprId, fields) {
      const k = recKey(tenant, wisprId);
      const cur = recs.get(k) || {
        coachClientId: String(tenant), wisprId: String(wisprId), outcome: 'seen', meetingId: null, title: null,
        startedAt: null, endedAt: null, detail: null, needsName: false, guess: null, askEmailedAt: null,
        namedAt: null, namedLeadId: null, skippedAt: null, createdAt: new Date().toISOString(),
      };
      for (const [f, v] of Object.entries(fields || {})) if (REC_COLS[f]) cur[f] = f === 'meetingId' && v != null ? String(v) : v;
      recs.set(k, cur);
    },
    async listNeedsName(tenant) {
      return [...recs.values()]
        .filter((r) => r.needsName && (!tenant || r.coachClientId === String(tenant)))
        .sort((a, b) => Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0))
        .map((r) => ({ ...r }));
    },
  };
}

let defaultStore = null;
/** The live store (Postgres). Built on first use so loading this file never needs a database. */
function getStore() {
  if (!defaultStore) defaultStore = createPgStore();
  return defaultStore;
}

module.exports = { getStore, createPgStore, createMemoryStore, publicConnection };
