/**
 * Krisp webhook persistence + meetings model.
 *
 * Three tables:
 *   krisp_webhook_events  — raw immutable webhook payloads
 *   krisp_meetings         — one row per real conversation (review queue works off this)
 *   krisp_meeting_participants — who was in each meeting (replaces krisp_event_leads + verified_speakers)
 */

const { Pool } = require('pg');
const {
  extractSpeakerLabels,
  participantResolvesSpeaker,
} = require('./krispSpeakerLabels');

let pool;
let schemaEnsured = false;

function getPool() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;

  // --- Raw webhook storage (immutable after insert) ---
  await client.query(`
    CREATE TABLE IF NOT EXISTS krisp_webhook_events (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      event TEXT,
      krisp_id TEXT,
      payload JSONB NOT NULL,
      unmatched_alert_sent_at TIMESTAMPTZ,
      conversation_alert_sent_at TIMESTAMPTZ
    );
  `);

  // --- One row per real conversation ---
  await client.query(`
    CREATE TABLE IF NOT EXISTS krisp_meetings (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      webhook_event_id BIGINT NOT NULL REFERENCES krisp_webhook_events(id) ON DELETE CASCADE,
      title TEXT,
      transcript_text TEXT,
      duration_seconds INT,
      meeting_start TIMESTAMPTZ,
      meeting_end TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'incomplete',
      status_reason TEXT,
      needs_split BOOLEAN NOT NULL DEFAULT FALSE,
      start_line INT,
      end_line INT
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_krisp_meetings_webhook ON krisp_meetings (webhook_event_id);`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_krisp_meetings_status ON krisp_meetings (status);`,
  );

  // --- Participants in each meeting ---
  await client.query(`
    CREATE TABLE IF NOT EXISTS krisp_meeting_participants (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      meeting_id BIGINT NOT NULL REFERENCES krisp_meetings(id) ON DELETE CASCADE,
      speaker_label TEXT,
      verified_name TEXT,
      verified_email TEXT,
      role TEXT DEFAULT 'unknown',
      airtable_lead_id TEXT,
      coach_client_id TEXT DEFAULT 'Guy-Wilson',
      match_method TEXT,
      UNIQUE (meeting_id, speaker_label)
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_krisp_mp_meeting ON krisp_meeting_participants (meeting_id);`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_krisp_mp_lead ON krisp_meeting_participants (airtable_lead_id);`,
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS krisp_meeting_leads (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      meeting_id BIGINT NOT NULL REFERENCES krisp_meetings(id) ON DELETE CASCADE,
      airtable_lead_id TEXT NOT NULL,
      coach_client_id TEXT NOT NULL DEFAULT 'Guy-Wilson',
      source TEXT,
      UNIQUE (meeting_id, airtable_lead_id)
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_krisp_ml_meeting ON krisp_meeting_leads (meeting_id);`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_krisp_ml_lead ON krisp_meeting_leads (airtable_lead_id);`,
  );

  await client.query(`ALTER TABLE krisp_meetings ALTER COLUMN status SET DEFAULT 'incomplete'`);
  await client.query(`UPDATE krisp_meetings SET status = 'incomplete' WHERE status = 'to_verify'`);
  await client.query(`UPDATE krisp_meetings SET status = 'complete' WHERE status = 'verified'`);
  await client.query(`
    INSERT INTO krisp_meeting_leads (meeting_id, airtable_lead_id, coach_client_id, source)
    SELECT DISTINCT p.meeting_id, p.airtable_lead_id, COALESCE(NULLIF(TRIM(p.coach_client_id), ''), 'Guy-Wilson'), 'migrated_from_participants'
    FROM krisp_meeting_participants p
    WHERE p.airtable_lead_id IS NOT NULL AND TRIM(p.airtable_lead_id) <> ''
    ON CONFLICT (meeting_id, airtable_lead_id) DO NOTHING
  `);

  // Drop old tables that are replaced by the new model (safe: user approved data reset)
  await client.query(`DROP TABLE IF EXISTS krisp_event_leads CASCADE`);

  // Strip old columns from krisp_webhook_events (now on krisp_meetings / krisp_meeting_participants)
  for (const col of ['status', 'status_reason', 'verified_speakers', 'needs_split', 'parent_event_id']) {
    await client.query(`ALTER TABLE krisp_webhook_events DROP COLUMN IF EXISTS ${col}`);
  }

  schemaEnsured = true;
}

// ---------------------------------------------------------------------------
// Webhook events (raw, immutable)
// ---------------------------------------------------------------------------

async function persistKrispWebhook(row) {
  const p = getPool();
  if (!p) return { skipped: true };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const ins = await client.query(
      `INSERT INTO krisp_webhook_events (event, krisp_id, payload) VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [row.event, row.krispId, JSON.stringify(row.payload)],
    );
    return { ok: true, postgres_id: String(ins.rows[0].id) };
  } finally {
    client.release();
  }
}

async function getKrispWebhookEventById(id) {
  const n = typeof id === 'string' ? parseInt(id, 10) : Number(id);
  if (!Number.isFinite(n) || n < 1) return null;
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT id, received_at, event, krisp_id, payload FROM krisp_webhook_events WHERE id = $1`,
      [n],
    );
    return r.rows[0] || null;
  } finally {
    client.release();
  }
}

async function getKrispWebhookDbSummary(limit = 15) {
  const p = getPool();
  if (!p) return { database_configured: false, error: 'DATABASE_URL not set' };
  const cap = Math.min(Math.max(Number(limit) || 15, 1), 50);
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const countR = await client.query('SELECT COUNT(*)::text AS c FROM krisp_webhook_events');
    const recentR = await client.query(
      `SELECT id, received_at, event, krisp_id FROM krisp_webhook_events ORDER BY id DESC LIMIT $1`,
      [cap],
    );
    const meetCap = Math.min(cap, 25);
    const meetingsR = await client.query(
      `SELECT m.id, m.title, m.status, m.created_at, e.received_at AS webhook_received_at, e.krisp_id
       FROM krisp_meetings m
       JOIN krisp_webhook_events e ON e.id = m.webhook_event_id
       ORDER BY m.id DESC LIMIT $1`,
      [meetCap],
    );
    return {
      database_configured: true,
      table: 'krisp_webhook_events',
      total_rows: countR.rows[0].c,
      recent: recentR.rows,
      recent_meetings: meetingsR.rows,
    };
  } catch (e) {
    return { database_configured: true, error: e.message };
  } finally {
    client.release();
  }
}

// Alert dedup (stays on webhook events — one alert per webhook, not per meeting)

async function getKrispUnmatchedAlertAlreadySent(postgresEventId) {
  const n = typeof postgresEventId === 'string' ? parseInt(postgresEventId, 10) : Number(postgresEventId);
  if (!Number.isFinite(n)) return true;
  const p = getPool();
  if (!p) return true;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(`SELECT unmatched_alert_sent_at FROM krisp_webhook_events WHERE id = $1`, [n]);
    return !!(r.rows[0] && r.rows[0].unmatched_alert_sent_at);
  } finally { client.release(); }
}

async function markKrispUnmatchedAlertSent(postgresEventId) {
  const n = typeof postgresEventId === 'string' ? parseInt(postgresEventId, 10) : Number(postgresEventId);
  if (!Number.isFinite(n)) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(`UPDATE krisp_webhook_events SET unmatched_alert_sent_at = now() WHERE id = $1`, [n]);
    return { ok: true };
  } finally { client.release(); }
}

async function getKrispConversationAlertAlreadySent(postgresEventId) {
  const n = typeof postgresEventId === 'string' ? parseInt(postgresEventId, 10) : Number(postgresEventId);
  if (!Number.isFinite(n)) return true;
  const p = getPool();
  if (!p) return true;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(`SELECT conversation_alert_sent_at FROM krisp_webhook_events WHERE id = $1`, [n]);
    return !!(r.rows[0] && r.rows[0].conversation_alert_sent_at);
  } finally { client.release(); }
}

async function markKrispConversationAlertSent(postgresEventId) {
  const n = typeof postgresEventId === 'string' ? parseInt(postgresEventId, 10) : Number(postgresEventId);
  if (!Number.isFinite(n)) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(`UPDATE krisp_webhook_events SET conversation_alert_sent_at = now() WHERE id = $1`, [n]);
    return { ok: true };
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

/** Create a meeting from an ingested webhook event. */
async function createMeeting({ webhookEventId, title, transcriptText, durationSeconds, meetingStart, meetingEnd }) {
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `INSERT INTO krisp_meetings (webhook_event_id, title, transcript_text, duration_seconds, meeting_start, meeting_end)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [webhookEventId, title || null, transcriptText || null, durationSeconds || null, meetingStart || null, meetingEnd || null],
    );
    return { ok: true, meeting_id: String(r.rows[0].id) };
  } finally { client.release(); }
}

async function getMeetingById(id) {
  const n = typeof id === 'string' ? parseInt(id, 10) : Number(id);
  if (!Number.isFinite(n) || n < 1) return null;
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT m.*, e.payload, e.krisp_id, e.event AS webhook_event, e.received_at AS webhook_received_at
       FROM krisp_meetings m
       JOIN krisp_webhook_events e ON e.id = m.webhook_event_id
       WHERE m.id = $1`,
      [n],
    );
    return r.rows[0] || null;
  } finally { client.release(); }
}

/**
 * Review queue: meetings with status.
 * @param {number} [limit=50]
 * @param {string} [statusFilter='all']
 * @param {{ titleContains?: string }} [opts]
 */
async function getMeetingQueue(limit = 50, statusFilter = 'all', opts = {}) {
  const p = getPool();
  if (!p) return [];
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const f = String(statusFilter || 'all').toLowerCase();
  const titleQ = typeof opts.titleContains === 'string' ? opts.titleContains.trim() : '';

  const conds = [];
  // Normalize DB quirks (whitespace / case) and include legacy status values.
  if (f === 'incomplete' || f === 'to_verify') {
    conds.push(`LOWER(TRIM(m.status)) IN ('incomplete', 'to_verify')`);
  } else if (f === 'complete' || f === 'verified') {
    conds.push(`LOWER(TRIM(m.status)) IN ('complete', 'verified')`);
  } else if (f === 'skipped') {
    conds.push(`LOWER(TRIM(m.status)) = 'skipped'`);
  }

  const params = [];
  if (titleQ) {
    conds.push(`POSITION($${params.length + 1}::text IN LOWER(COALESCE(m.title, ''))) > 0`);
    params.push(titleQ.toLowerCase());
  }

  const whereSql = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
  const limitPl = params.length + 1;
  params.push(cap);

  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT m.id, m.created_at, m.webhook_event_id, m.title, m.duration_seconds,
              m.meeting_start, m.meeting_end, m.status, m.status_reason, m.needs_split,
              m.start_line, m.end_line,
              e.received_at AS webhook_received_at, e.krisp_id
       FROM krisp_meetings m
       JOIN krisp_webhook_events e ON e.id = m.webhook_event_id
       ${whereSql} ORDER BY m.id DESC LIMIT $${limitPl}`,
      params,
    );
    return r.rows;
  } finally { client.release(); }
}

async function updateMeetingStatus(meetingId, newStatus, statusReason) {
  const VALID = ['incomplete', 'complete', 'skipped', 'to_verify', 'verified'];
  let st = newStatus;
  if (st === 'to_verify') st = 'incomplete';
  if (st === 'verified') st = 'complete';
  if (!['incomplete', 'complete', 'skipped'].includes(st)) return { ok: false, error: 'invalid status' };
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    if (statusReason !== undefined) {
      await client.query(`UPDATE krisp_meetings SET status = $2, status_reason = $3 WHERE id = $1`, [n, st, statusReason]);
    } else {
      await client.query(`UPDATE krisp_meetings SET status = $2 WHERE id = $1`, [n, st]);
    }
    return { ok: true };
  } finally { client.release(); }
}

async function setMeetingIngestStatus(meetingId, { status, statusReason, needsSplit }) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `UPDATE krisp_meetings SET status = $2, status_reason = $3, needs_split = $4 WHERE id = $1`,
      [
        n,
        status === 'to_verify' || status === 'verified' ? 'incomplete' : status || 'incomplete',
        statusReason || null,
        !!needsSplit,
      ],
    );
    return { ok: true };
  } finally { client.release(); }
}

/**
 * Split a meeting at a given line number.
 * Original meeting keeps lines 1..splitAtLine-1, new meeting gets splitAtLine..end.
 * Both reference the same webhook_event_id.
 */
async function splitMeeting(meetingId, splitAtLine) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n) || n < 1) return { ok: false, error: 'invalid id' };
  const p = getPool();
  if (!p) return { ok: false, error: 'no db' };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const parentRow = await client.query(`SELECT * FROM krisp_meetings WHERE id = $1`, [n]);
    if (parentRow.rows.length === 0) return { ok: false, error: 'meeting not found' };
    const parent = parentRow.rows[0];
    const lines = (parent.transcript_text || '').split('\n');
    if (splitAtLine < 1 || splitAtLine >= lines.length) return { ok: false, error: 'splitAtLine out of range' };

    const firstHalf = lines.slice(0, splitAtLine).join('\n');
    const secondHalf = lines.slice(splitAtLine).join('\n');

    const parentStart = parent.start_line || 1;

    // Update parent to keep first half
    await client.query(
      `UPDATE krisp_meetings SET transcript_text = $2, needs_split = FALSE,
              start_line = $3, end_line = $4,
              status_reason = COALESCE(status_reason, '') || ' (split at line ' || $5::text || ')'
       WHERE id = $1`,
      [n, firstHalf, parentStart, parentStart + splitAtLine - 1, splitAtLine],
    );

    // Create child with second half
    const ins = await client.query(
      `INSERT INTO krisp_meetings (webhook_event_id, title, transcript_text, duration_seconds,
              meeting_start, meeting_end, status, status_reason, start_line, end_line)
       VALUES ($1, $2, $3, NULL, $4, $5, 'incomplete', 'Split from meeting #' || $6::text, $7, $8)
       RETURNING id`,
      [
        parent.webhook_event_id,
        parent.title ? `${parent.title} (part 2)` : 'Split meeting (part 2)',
        secondHalf,
        parent.meeting_start,
        parent.meeting_end,
        n,
        parentStart + splitAtLine,
        parentStart + lines.length - 1,
      ],
    );

    return { ok: true, parent_id: n, child_id: String(ins.rows[0].id) };
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

async function upsertMeetingParticipant({ meetingId, speakerLabel, verifiedName, verifiedEmail, role, airtableLeadId, coachClientId, matchMethod }) {
  const mid = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(mid)) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `INSERT INTO krisp_meeting_participants (meeting_id, speaker_label, verified_name, verified_email, role, airtable_lead_id, coach_client_id, match_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (meeting_id, speaker_label) DO UPDATE SET
         verified_name = COALESCE(EXCLUDED.verified_name, krisp_meeting_participants.verified_name),
         verified_email = COALESCE(EXCLUDED.verified_email, krisp_meeting_participants.verified_email),
         role = COALESCE(EXCLUDED.role, krisp_meeting_participants.role),
         airtable_lead_id = COALESCE(EXCLUDED.airtable_lead_id, krisp_meeting_participants.airtable_lead_id),
         match_method = COALESCE(EXCLUDED.match_method, krisp_meeting_participants.match_method)
       RETURNING id`,
      [mid, speakerLabel || null, verifiedName || null, verifiedEmail || null, role || 'unknown', airtableLeadId || null, (coachClientId || 'Guy-Wilson').trim(), matchMethod || null],
    );
    return { ok: true, id: r.rows[0]?.id };
  } finally { client.release(); }
}

async function getParticipantsForMeeting(meetingId) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n)) return [];
  const p = getPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT * FROM krisp_meeting_participants WHERE meeting_id = $1 ORDER BY id`,
      [n],
    );
    return r.rows;
  } finally { client.release(); }
}

async function listMeetingLeads(meetingId) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n)) return [];
  const p = getPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT id, meeting_id, airtable_lead_id, coach_client_id, source, created_at
       FROM krisp_meeting_leads WHERE meeting_id = $1 ORDER BY id`,
      [n],
    );
    return r.rows;
  } finally { client.release(); }
}

async function addMeetingLead(meetingId, airtableLeadId, coachClientId = 'Guy-Wilson', source = 'manual') {
  const mid = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  const lid = String(airtableLeadId || '').trim();
  if (!Number.isFinite(mid) || !lid) return { ok: false, error: 'invalid' };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `INSERT INTO krisp_meeting_leads (meeting_id, airtable_lead_id, coach_client_id, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (meeting_id, airtable_lead_id) DO NOTHING`,
      [mid, lid, (coachClientId || 'Guy-Wilson').trim(), source || 'manual'],
    );
    await syncMeetingReviewStatusTx(client, mid);
    return { ok: true };
  } finally { client.release(); }
}

async function removeMeetingLead(meetingId, airtableLeadId) {
  const mid = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  const lid = String(airtableLeadId || '').trim();
  if (!Number.isFinite(mid) || !lid) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(`DELETE FROM krisp_meeting_leads WHERE meeting_id = $1 AND airtable_lead_id = $2`, [mid, lid]);
    await syncMeetingReviewStatusTx(client, mid);
    return { ok: true };
  } finally { client.release(); }
}

async function syncMeetingReviewStatusTx(client, meetingId) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  const st = await client.query(`SELECT status FROM krisp_meetings WHERE id = $1`, [n]);
  if (st.rows[0]?.status === 'skipped') return;

  const tr = await client.query(`SELECT transcript_text FROM krisp_meetings WHERE id = $1`, [n]);
  const text = tr.rows[0]?.transcript_text || '';
  const labels = extractSpeakerLabels(text);

  const lc = await client.query(`SELECT COUNT(*)::int AS c FROM krisp_meeting_leads WHERE meeting_id = $1`, [n]);
  const hasLeads = lc.rows[0].c >= 1;

  if (!hasLeads || labels.length === 0) {
    await client.query(`UPDATE krisp_meetings SET status = 'incomplete' WHERE id = $1 AND status <> 'skipped'`, [n]);
    return;
  }

  const parts = await client.query(
    `SELECT speaker_label, role, verified_name, verified_email, airtable_lead_id FROM krisp_meeting_participants WHERE meeting_id = $1`,
    [n],
  );
  const byLabel = {};
  for (const pr of parts.rows) {
    if (pr.speaker_label) byLabel[pr.speaker_label] = pr;
  }

  let all = true;
  for (const lab of labels) {
    if (!participantResolvesSpeaker(byLabel[lab])) {
      all = false;
      break;
    }
  }

  const next = all ? 'complete' : 'incomplete';
  await client.query(`UPDATE krisp_meetings SET status = $2 WHERE id = $1 AND status <> 'skipped'`, [n, next]);
}

async function syncMeetingReviewStatus(meetingId) {
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await syncMeetingReviewStatusTx(client, meetingId);
    return { ok: true };
  } finally { client.release(); }
}

/** Re-run completion rules for recent meetings (admin). Fixes rows wrongly marked complete before stricter rules. */
async function recomputeAllKrispMeetingReviewStatuses(limit = 500) {
  const p = getPool();
  if (!p) return { ok: false, error: 'DATABASE_URL not set' };
  const cap = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(`SELECT id FROM krisp_meetings ORDER BY id DESC LIMIT $1`, [cap]);
    for (const row of r.rows) {
      await syncMeetingReviewStatusTx(client, row.id);
    }
    return { ok: true, recomputed: r.rows.length };
  } finally {
    client.release();
  }
}

/**
 * Save speaker assignments (role coach|client|other + optional lead). Recomputes incomplete/complete.
 * @param {string|number} meetingId
 * @param {Record<string, { name?: string, email?: string, role?: string, airtable_lead_id?: string }>} speakers
 * @param {{ coachClientId?: string }} [opts]
 */
async function saveMeetingSpeakers(meetingId, speakers, opts = {}) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const coachClientId = (opts.coachClientId || 'Guy-Wilson').trim();
  const client = await p.connect();
  try {
    await ensureSchema(client);
    for (const [label, info] of Object.entries(speakers || {})) {
      if (!info || typeof info !== 'object') continue;
      const name = (info.name || '').trim() || null;
      const email = (info.email || '').trim() || null;
      let role = String(info.role || 'unknown').toLowerCase();
      if (!['coach', 'client', 'other', 'unknown'].includes(role)) role = 'unknown';
      const leadId = (info.airtable_lead_id || '').trim() || null;
      await client.query(
        `INSERT INTO krisp_meeting_participants (meeting_id, speaker_label, verified_name, verified_email, role, airtable_lead_id, coach_client_id, match_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual')
         ON CONFLICT (meeting_id, speaker_label) DO UPDATE SET
           verified_name = EXCLUDED.verified_name,
           verified_email = EXCLUDED.verified_email,
           role = EXCLUDED.role,
           airtable_lead_id = EXCLUDED.airtable_lead_id,
           match_method = 'manual'`,
        [n, label, name, email, role, leadId, coachClientId],
      );
      if (role === 'client' && leadId) {
        await client.query(
          `INSERT INTO krisp_meeting_leads (meeting_id, airtable_lead_id, coach_client_id, source)
           VALUES ($1, $2, $3, 'speaker_assign')
           ON CONFLICT (meeting_id, airtable_lead_id) DO NOTHING`,
          [n, leadId, coachClientId],
        );
      }
    }
    await syncMeetingReviewStatusTx(client, n);
    return { ok: true };
  } finally { client.release(); }
}

/** Meetings linked to a lead via krisp_meeting_leads or legacy participant rows. */
async function getMeetingsForLead(airtableLeadId, limit = 50) {
  const p = getPool();
  if (!p) return [];
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT m.id AS meeting_id, m.title, m.transcript_text, m.status, m.duration_seconds,
              m.meeting_start, m.created_at, m.status_reason,
              e.received_at AS webhook_received_at, e.krisp_id, e.event AS webhook_event,
              NULL::text AS speaker_label, NULL::text AS verified_name, NULL::text AS verified_email, NULL::text AS match_method
       FROM krisp_meetings m
       JOIN krisp_webhook_events e ON e.id = m.webhook_event_id
       WHERE m.id IN (
         SELECT meeting_id FROM krisp_meeting_leads WHERE airtable_lead_id = $1
         UNION
         SELECT meeting_id FROM krisp_meeting_participants WHERE airtable_lead_id = $1
       )
       ORDER BY m.created_at DESC
       LIMIT $2`,
      [airtableLeadId, cap],
    );
    return r.rows;
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------

async function seedManualTestTranscript() {
  const p = getPool();
  if (!p) return { ok: false, error: 'DATABASE_URL not set' };
  const krispId = `test-${Date.now()}`;
  const payload = {
    id: krispId,
    event: 'manual_test',
    data: {
      note: 'Seeded by POST /krisp-test/seed',
      raw_content: 'HARNESS: fake transcript.\nTania: Thanks for the walkthrough.\nTest User: Agreed — next steps noted.',
      participants: [
        { email: 'taniaadelewilson@gmail.com', first_name: 'Tania', last_name: 'Wilson' },
        { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
      ],
    },
  };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const evR = await client.query(
      `INSERT INTO krisp_webhook_events (event, krisp_id, payload) VALUES ($1, $2, $3::jsonb) RETURNING id`,
      ['manual_test', krispId, JSON.stringify(payload)],
    );
    const evId = evR.rows[0].id;
    const mR = await client.query(
      `INSERT INTO krisp_meetings (webhook_event_id, title, transcript_text)
       VALUES ($1, 'Harness test meeting', $2) RETURNING id`,
      [evId, payload.data.raw_content],
    );
    return { ok: true, postgres_id: evId, meeting_id: String(mR.rows[0].id), krisp_id: krispId };
  } finally { client.release(); }
}

async function purgeManualTestTranscripts() {
  const p = getPool();
  if (!p) return { ok: false, error: 'DATABASE_URL not set', deleted: 0 };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(`
      DELETE FROM krisp_webhook_events
      WHERE event = 'manual_test' OR krisp_id LIKE 'test-%'
      RETURNING id
    `);
    return { ok: true, deleted: r.rowCount, ids: r.rows.map((row) => row.id) };
  } finally { client.release(); }
}

module.exports = {
  getPool,
  persistKrispWebhook,
  getKrispWebhookEventById,
  getKrispWebhookDbSummary,
  getKrispUnmatchedAlertAlreadySent,
  markKrispUnmatchedAlertSent,
  getKrispConversationAlertAlreadySent,
  markKrispConversationAlertSent,
  createMeeting,
  getMeetingById,
  getMeetingQueue,
  updateMeetingStatus,
  setMeetingIngestStatus,
  splitMeeting,
  upsertMeetingParticipant,
  getParticipantsForMeeting,
  saveMeetingSpeakers,
  listMeetingLeads,
  addMeetingLead,
  removeMeetingLead,
  syncMeetingReviewStatus,
  recomputeAllKrispMeetingReviewStatuses,
  getMeetingsForLead,
  seedManualTestTranscript,
  purgeManualTestTranscripts,
};
