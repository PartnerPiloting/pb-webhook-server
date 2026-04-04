/**
 * Krisp webhook persistence + meetings model.
 *
 * Three tables:
 *   krisp_webhook_events  — raw immutable webhook payloads
 *   krisp_meetings         — one row per real conversation (review queue works off this)
 *   krisp_meeting_participants — who was in each meeting (replaces krisp_event_leads + verified_speakers)
 */

const { Pool } = require('pg');

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
      status TEXT NOT NULL DEFAULT 'to_verify',
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
    return { database_configured: true, table: 'krisp_webhook_events', total_rows: countR.rows[0].c, recent: recentR.rows };
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
 * @param {string} [statusFilter='to_verify']
 */
async function getMeetingQueue(limit = 50, statusFilter = 'all') {
  const p = getPool();
  if (!p) return [];
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const f = String(statusFilter || 'all').toLowerCase();
  let where = '';
  if (f === 'to_verify') where = ` WHERE m.status = 'to_verify'`;
  else if (f === 'verified') where = ` WHERE m.status = 'verified'`;
  else if (f === 'skipped') where = ` WHERE m.status = 'skipped'`;

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
       ${where} ORDER BY m.id DESC LIMIT $1`,
      [cap],
    );
    return r.rows;
  } finally { client.release(); }
}

async function updateMeetingStatus(meetingId, newStatus, statusReason) {
  const VALID = ['to_verify', 'verified', 'skipped'];
  if (!VALID.includes(newStatus)) return { ok: false, error: 'invalid status' };
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    if (statusReason !== undefined) {
      await client.query(`UPDATE krisp_meetings SET status = $2, status_reason = $3 WHERE id = $1`, [n, newStatus, statusReason]);
    } else {
      await client.query(`UPDATE krisp_meetings SET status = $2 WHERE id = $1`, [n, newStatus]);
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
      [n, status || 'to_verify', statusReason || null, !!needsSplit],
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
       VALUES ($1, $2, $3, NULL, $4, $5, 'to_verify', 'Split from meeting #' || $6::text, $7, $8)
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

/**
 * Save verified speakers for a meeting: bulk upsert all participant rows, set status to verified.
 * @param {string|number} meetingId
 * @param {Record<string, { name: string, email: string }>} speakers
 */
async function saveMeetingSpeakers(meetingId, speakers) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    for (const [label, info] of Object.entries(speakers)) {
      if (!info || typeof info !== 'object') continue;
      await client.query(
        `INSERT INTO krisp_meeting_participants (meeting_id, speaker_label, verified_name, verified_email, match_method)
         VALUES ($1, $2, $3, $4, 'manual')
         ON CONFLICT (meeting_id, speaker_label) DO UPDATE SET
           verified_name = EXCLUDED.verified_name,
           verified_email = EXCLUDED.verified_email,
           match_method = 'manual'`,
        [n, label, info.name || null, info.email || null],
      );
    }
    await client.query(`UPDATE krisp_meetings SET status = 'verified' WHERE id = $1`, [n]);
    return { ok: true };
  } finally { client.release(); }
}

/** Meetings linked to a specific Airtable lead (via participants). For lead detail panel. */
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
              p.speaker_label, p.verified_name, p.verified_email, p.match_method
       FROM krisp_meeting_participants p
       JOIN krisp_meetings m ON m.id = p.meeting_id
       JOIN krisp_webhook_events e ON e.id = m.webhook_event_id
       WHERE p.airtable_lead_id = $1
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
  getMeetingsForLead,
  seedManualTestTranscript,
  purgeManualTestTranscripts,
};
