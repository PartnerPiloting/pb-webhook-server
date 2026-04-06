/**
 * Recall.ai real-time webhook persistence + meetings (mirrors Krisp model).
 *
 * Tables:
 *   recall_webhook_events — raw payloads
 *   recall_meetings — one row per bot + recording (review queue)
 *   recall_meeting_participants / recall_meeting_leads — same roles as Krisp
 *   recall_utterances — timed segments for per-lead extraction
 *   recall_participant_presence — join/leave from participant_events.*
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

  await client.query(`
    CREATE TABLE IF NOT EXISTS recall_webhook_events (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      event TEXT,
      bot_id TEXT,
      recording_id TEXT,
      payload JSONB NOT NULL
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_recall_whe_bot_rec ON recall_webhook_events (bot_id, recording_id);`,
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS recall_meetings (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      bot_id TEXT NOT NULL,
      recording_id TEXT NOT NULL,
      title TEXT,
      transcript_text TEXT,
      duration_seconds INT,
      meeting_start TIMESTAMPTZ,
      meeting_end TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'incomplete',
      status_reason TEXT,
      needs_split BOOLEAN NOT NULL DEFAULT FALSE,
      start_line INT,
      end_line INT,
      UNIQUE (bot_id, recording_id)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_recall_m_status ON recall_meetings (status);`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS recall_meeting_participants (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      meeting_id BIGINT NOT NULL REFERENCES recall_meetings(id) ON DELETE CASCADE,
      platform_participant_id INT,
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
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_recall_mp_meeting_plat
     ON recall_meeting_participants (meeting_id, platform_participant_id)
     WHERE platform_participant_id IS NOT NULL;`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_recall_mp_meeting ON recall_meeting_participants (meeting_id);`,
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS recall_meeting_leads (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      meeting_id BIGINT NOT NULL REFERENCES recall_meetings(id) ON DELETE CASCADE,
      airtable_lead_id TEXT NOT NULL,
      coach_client_id TEXT NOT NULL DEFAULT 'Guy-Wilson',
      source TEXT,
      UNIQUE (meeting_id, airtable_lead_id)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS recall_utterances (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      meeting_id BIGINT NOT NULL REFERENCES recall_meetings(id) ON DELETE CASCADE,
      seq INT NOT NULL DEFAULT 0,
      platform_participant_id INT NOT NULL,
      participant_name_snapshot TEXT,
      utterance_text TEXT NOT NULL,
      start_rel DOUBLE PRECISION,
      end_rel DOUBLE PRECISION
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_recall_utt_meeting ON recall_utterances (meeting_id, start_rel);`,
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS recall_participant_presence (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      meeting_id BIGINT NOT NULL REFERENCES recall_meetings(id) ON DELETE CASCADE,
      platform_participant_id INT NOT NULL,
      event_kind TEXT NOT NULL,
      abs_ts TIMESTAMPTZ,
      rel_seconds DOUBLE PRECISION
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_recall_pres_meeting ON recall_participant_presence (meeting_id, platform_participant_id);`,
  );

  schemaEnsured = true;
}

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

async function persistRecallWebhookEvent({ event, botId, recordingId, payload }) {
  const p = getPool();
  if (!p) return { skipped: true };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const ins = await client.query(
      `INSERT INTO recall_webhook_events (event, bot_id, recording_id, payload)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [event || null, botId || null, recordingId || null, JSON.stringify(payload)],
    );
    return { ok: true, postgres_id: String(ins.rows[0].id) };
  } finally {
    client.release();
  }
}

async function getRecallWebhookDbSummary(limit = 15) {
  const p = getPool();
  if (!p) return { database_configured: false, error: 'DATABASE_URL not set' };
  const cap = Math.min(Math.max(Number(limit) || 15, 1), 50);
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const countR = await client.query('SELECT COUNT(*)::text AS c FROM recall_webhook_events');
    const recentR = await client.query(
      `SELECT id, received_at, event, bot_id, recording_id FROM recall_webhook_events ORDER BY id DESC LIMIT $1`,
      [cap],
    );
    const meetingsR = await client.query(
      `SELECT m.id, m.title, m.status, m.created_at, m.bot_id, m.recording_id
       FROM recall_meetings m ORDER BY m.id DESC LIMIT $1`,
      [Math.min(cap, 25)],
    );
    return {
      database_configured: true,
      table: 'recall_webhook_events',
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

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

async function upsertRecallMeeting({ botId, recordingId, title }) {
  const p = getPool();
  if (!p) return { ok: false };
  if (!botId || !recordingId) return { ok: false, error: 'bot_id and recording_id required' };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `INSERT INTO recall_meetings (bot_id, recording_id, title)
       VALUES ($1, $2, $3)
       ON CONFLICT (bot_id, recording_id) DO UPDATE SET
         updated_at = now(),
         title = COALESCE(recall_meetings.title, EXCLUDED.title)
       RETURNING id`,
      [String(botId), String(recordingId), title || null],
    );
    return { ok: true, meeting_id: String(r.rows[0].id) };
  } finally {
    client.release();
  }
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
      `SELECT m.*,
              e.payload,
              e.event AS webhook_event,
              e.received_at AS webhook_received_at
       FROM recall_meetings m
       LEFT JOIN LATERAL (
         SELECT payload, event, received_at FROM recall_webhook_events
         WHERE bot_id = m.bot_id AND recording_id = m.recording_id
         ORDER BY id DESC LIMIT 1
       ) e ON true
       WHERE m.id = $1`,
      [n],
    );
    return r.rows[0] || null;
  } finally {
    client.release();
  }
}

async function getMeetingQueue(limit = 50, statusFilter = 'all', opts = {}) {
  const p = getPool();
  if (!p) return [];
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const f = String(statusFilter || 'all').toLowerCase();
  const titleQ = typeof opts.titleContains === 'string' ? opts.titleContains.trim() : '';

  const conds = [];
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
      `SELECT m.id, m.created_at, m.updated_at, m.bot_id, m.recording_id, m.title, m.duration_seconds,
              m.meeting_start, m.meeting_end, m.status, m.status_reason, m.needs_split,
              m.start_line, m.end_line,
              (SELECT MAX(w.received_at) FROM recall_webhook_events w
               WHERE w.bot_id = m.bot_id AND w.recording_id = m.recording_id) AS webhook_received_at
       FROM recall_meetings m
       ${whereSql} ORDER BY m.id DESC LIMIT $${limitPl}`,
      params,
    );
    return r.rows;
  } finally {
    client.release();
  }
}

async function updateMeetingStatus(meetingId, newStatus, statusReason) {
  const VALID_NORMALIZE = { to_verify: 'incomplete', verified: 'complete' };
  let st = newStatus;
  if (VALID_NORMALIZE[st]) st = VALID_NORMALIZE[st];
  if (!['incomplete', 'complete', 'skipped'].includes(st)) return { ok: false, error: 'invalid status' };
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    if (statusReason !== undefined) {
      await client.query(`UPDATE recall_meetings SET status = $2, status_reason = $3, updated_at = now() WHERE id = $1`, [n, st, statusReason]);
    } else {
      await client.query(`UPDATE recall_meetings SET status = $2, updated_at = now() WHERE id = $1`, [n, st]);
    }
    return { ok: true };
  } finally {
    client.release();
  }
}

async function setMeetingIngestStatus(meetingId, { status, statusReason, needsSplit }) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const st = status === 'to_verify' || status === 'verified' ? 'incomplete' : status || 'incomplete';
    await client.query(
      `UPDATE recall_meetings SET status = $2, status_reason = $3, needs_split = $4, updated_at = now() WHERE id = $1`,
      [n, st, statusReason || null, !!needsSplit],
    );
    return { ok: true };
  } finally {
    client.release();
  }
}

async function splitMeeting(meetingId, splitAtLine) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n) || n < 1) return { ok: false, error: 'invalid id' };
  const p = getPool();
  if (!p) return { ok: false, error: 'no db' };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const parentRow = await client.query(`SELECT * FROM recall_meetings WHERE id = $1`, [n]);
    if (parentRow.rows.length === 0) return { ok: false, error: 'meeting not found' };
    const parent = parentRow.rows[0];
    const lines = (parent.transcript_text || '').split('\n');
    if (splitAtLine < 1 || splitAtLine >= lines.length) return { ok: false, error: 'splitAtLine out of range' };

    const firstHalf = lines.slice(0, splitAtLine).join('\n');
    const secondHalf = lines.slice(splitAtLine).join('\n');
    const parentStart = parent.start_line || 1;

    await client.query(
      `UPDATE recall_meetings SET transcript_text = $2, needs_split = FALSE,
              start_line = $3, end_line = $4,
              status_reason = COALESCE(status_reason, '') || ' (split at line ' || $5::text || ')',
              updated_at = now()
       WHERE id = $1`,
      [n, firstHalf, parentStart, parentStart + splitAtLine - 1, splitAtLine],
    );

    const childRecordingId = `${parent.recording_id}__split_${n}_${Date.now()}`;
    const ins = await client.query(
      `INSERT INTO recall_meetings (bot_id, recording_id, title, transcript_text, duration_seconds,
              meeting_start, meeting_end, status, status_reason, start_line, end_line)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, 'incomplete', 'Split from meeting #' || $7::text, $8, $9)
       RETURNING id`,
      [
        parent.bot_id,
        childRecordingId,
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
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Utterances + presence
// ---------------------------------------------------------------------------

async function appendRecallUtterance({
  meetingId,
  platformParticipantId,
  participantNameSnapshot,
  utteranceText,
  startRel,
  endRel,
  transcriptChunk,
}) {
  const mid = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  const pid = Number(platformParticipantId);
  if (!Number.isFinite(mid) || !Number.isFinite(pid)) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const seqR = await client.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM recall_utterances WHERE meeting_id = $1`,
      [mid],
    );
    const seq = seqR.rows[0].n;
    await client.query(
      `INSERT INTO recall_utterances (meeting_id, seq, platform_participant_id, participant_name_snapshot, utterance_text, start_rel, end_rel)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [mid, seq, pid, participantNameSnapshot || null, utteranceText || '', startRel ?? null, endRel ?? null],
    );
    const durSec = endRel != null && Number.isFinite(endRel) ? Math.ceil(Math.max(0, endRel)) : null;
    await client.query(
      `UPDATE recall_meetings SET
         transcript_text = COALESCE(transcript_text, '') || $2::text,
         duration_seconds = CASE
           WHEN $3::int IS NULL THEN duration_seconds
           ELSE GREATEST(COALESCE(duration_seconds, 0), $3::int)
         END,
         updated_at = now()
       WHERE id = $1`,
      [mid, transcriptChunk || '', durSec],
    );
    return { ok: true, seq };
  } finally {
    client.release();
  }
}

async function recordRecallPresence({ meetingId, platformParticipantId, eventKind, absIso, relSeconds }) {
  const mid = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  const pid = Number(platformParticipantId);
  if (!Number.isFinite(mid) || !Number.isFinite(pid)) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    let absTs = null;
    if (absIso && typeof absIso === 'string') {
      const d = new Date(absIso);
      if (!Number.isNaN(d.getTime())) absTs = d.toISOString();
    }
    await client.query(
      `INSERT INTO recall_participant_presence (meeting_id, platform_participant_id, event_kind, abs_ts, rel_seconds)
       VALUES ($1, $2, $3, $4, $5)`,
      [mid, pid, String(eventKind || '').toLowerCase(), absTs, relSeconds != null && Number.isFinite(relSeconds) ? relSeconds : null],
    );
    return { ok: true };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Participants / leads (Krisp-compatible semantics)
// ---------------------------------------------------------------------------

async function upsertRecallMeetingParticipant({
  meetingId,
  platformParticipantId,
  speakerLabel,
  verifiedName,
  verifiedEmail,
  role,
  airtableLeadId,
  coachClientId,
  matchMethod,
}) {
  const mid = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(mid)) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const plat = platformParticipantId != null && Number.isFinite(Number(platformParticipantId))
      ? Number(platformParticipantId)
      : null;
    const r = await client.query(
      `INSERT INTO recall_meeting_participants
         (meeting_id, platform_participant_id, speaker_label, verified_name, verified_email, role, airtable_lead_id, coach_client_id, match_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (meeting_id, speaker_label) DO UPDATE SET
         platform_participant_id = COALESCE(EXCLUDED.platform_participant_id, recall_meeting_participants.platform_participant_id),
         verified_name = COALESCE(EXCLUDED.verified_name, recall_meeting_participants.verified_name),
         verified_email = COALESCE(EXCLUDED.verified_email, recall_meeting_participants.verified_email),
         role = COALESCE(NULLIF(EXCLUDED.role, 'unknown'), recall_meeting_participants.role, EXCLUDED.role),
         airtable_lead_id = COALESCE(EXCLUDED.airtable_lead_id, recall_meeting_participants.airtable_lead_id),
         match_method = COALESCE(EXCLUDED.match_method, recall_meeting_participants.match_method)
       RETURNING id`,
      [
        mid,
        plat,
        speakerLabel || null,
        verifiedName || null,
        verifiedEmail || null,
        role || 'unknown',
        airtableLeadId || null,
        (coachClientId || 'Guy-Wilson').trim(),
        matchMethod || null,
      ],
    );
    return { ok: true, id: r.rows[0]?.id };
  } finally {
    client.release();
  }
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
      `SELECT * FROM recall_meeting_participants WHERE meeting_id = $1 ORDER BY id`,
      [n],
    );
    return r.rows;
  } finally {
    client.release();
  }
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
       FROM recall_meeting_leads WHERE meeting_id = $1 ORDER BY id`,
      [n],
    );
    return r.rows;
  } finally {
    client.release();
  }
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
      `INSERT INTO recall_meeting_leads (meeting_id, airtable_lead_id, coach_client_id, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (meeting_id, airtable_lead_id) DO NOTHING`,
      [mid, lid, (coachClientId || 'Guy-Wilson').trim(), source || 'manual'],
    );
    await syncMeetingReviewStatusTx(client, mid);
    return { ok: true };
  } finally {
    client.release();
  }
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
    await client.query(`DELETE FROM recall_meeting_leads WHERE meeting_id = $1 AND airtable_lead_id = $2`, [mid, lid]);
    await syncMeetingReviewStatusTx(client, mid);
    return { ok: true };
  } finally {
    client.release();
  }
}

async function syncMeetingReviewStatusTx(client, meetingId) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  const st = await client.query(`SELECT status FROM recall_meetings WHERE id = $1`, [n]);
  if (st.rows[0]?.status === 'skipped') return;

  const tr = await client.query(`SELECT transcript_text FROM recall_meetings WHERE id = $1`, [n]);
  const text = tr.rows[0]?.transcript_text || '';
  const labels = extractSpeakerLabels(text);

  const lc = await client.query(`SELECT COUNT(*)::int AS c FROM recall_meeting_leads WHERE meeting_id = $1`, [n]);
  const hasLeads = lc.rows[0].c >= 1;

  if (!hasLeads || labels.length === 0) {
    await client.query(`UPDATE recall_meetings SET status = 'incomplete', updated_at = now() WHERE id = $1 AND status <> 'skipped'`, [n]);
    return;
  }

  const parts = await client.query(
    `SELECT speaker_label, role, verified_name, verified_email, airtable_lead_id FROM recall_meeting_participants WHERE meeting_id = $1`,
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
  await client.query(`UPDATE recall_meetings SET status = $2, updated_at = now() WHERE id = $1 AND status <> 'skipped'`, [n, next]);
}

async function syncMeetingReviewStatus(meetingId) {
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await syncMeetingReviewStatusTx(client, meetingId);
    return { ok: true };
  } finally {
    client.release();
  }
}

async function recomputeAllRecallMeetingReviewStatuses(limit = 500) {
  const p = getPool();
  if (!p) return { ok: false, error: 'DATABASE_URL not set' };
  const cap = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(`SELECT id FROM recall_meetings ORDER BY id DESC LIMIT $1`, [cap]);
    for (const row of r.rows) {
      await syncMeetingReviewStatusTx(client, row.id);
    }
    return { ok: true, recomputed: r.rows.length };
  } finally {
    client.release();
  }
}

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
      const mPlat = /^Participant\s*(\d+)$/i.exec(String(label).trim());
      const plat = mPlat ? parseInt(mPlat[1], 10) : null;
      await client.query(
        `INSERT INTO recall_meeting_participants
           (meeting_id, platform_participant_id, speaker_label, verified_name, verified_email, role, airtable_lead_id, coach_client_id, match_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual')
         ON CONFLICT (meeting_id, speaker_label) DO UPDATE SET
           platform_participant_id = COALESCE(EXCLUDED.platform_participant_id, recall_meeting_participants.platform_participant_id),
           verified_name = EXCLUDED.verified_name,
           verified_email = EXCLUDED.verified_email,
           role = EXCLUDED.role,
           airtable_lead_id = EXCLUDED.airtable_lead_id,
           match_method = 'manual'`,
        [n, Number.isFinite(plat) ? plat : null, label, name, email, role, leadId, coachClientId],
      );
      if (role === 'client' && leadId) {
        await client.query(
          `INSERT INTO recall_meeting_leads (meeting_id, airtable_lead_id, coach_client_id, source)
           VALUES ($1, $2, $3, 'speaker_assign')
           ON CONFLICT (meeting_id, airtable_lead_id) DO NOTHING`,
          [n, leadId, coachClientId],
        );
      }
    }
    await syncMeetingReviewStatusTx(client, n);
    return { ok: true };
  } finally {
    client.release();
  }
}

/**
 * Per-lead transcript: utterances for platform IDs mapped to that lead, clipped to join→leave windows.
 */
async function getLeadSegmentsForMeeting(meetingId) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n)) return { segments: [], windows: [], note: 'invalid id' };
  const p = getPool();
  if (!p) return { segments: [], windows: [], note: 'no db' };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const uttR = await client.query(
      `SELECT platform_participant_id, utterance_text, start_rel, end_rel, seq
       FROM recall_utterances WHERE meeting_id = $1 ORDER BY seq ASC`,
      [n],
    );
    const presR = await client.query(
      `SELECT platform_participant_id, event_kind, rel_seconds, abs_ts, id
       FROM recall_participant_presence WHERE meeting_id = $1 ORDER BY id ASC`,
      [n],
    );
    const partR = await client.query(
      `SELECT platform_participant_id, airtable_lead_id, speaker_label
       FROM recall_meeting_participants
       WHERE meeting_id = $1 AND airtable_lead_id IS NOT NULL AND TRIM(airtable_lead_id) <> ''`,
      [n],
    );

    const leadToPlatformIds = new Map();
    for (const row of partR.rows) {
      const lid = String(row.airtable_lead_id || '').trim();
      const pid = Number(row.platform_participant_id);
      if (!lid || !Number.isFinite(pid)) continue;
      if (!leadToPlatformIds.has(lid)) leadToPlatformIds.set(lid, new Set());
      leadToPlatformIds.get(lid).add(pid);
    }

    const maxRel = uttR.rows.reduce((acc, u) => {
      const e = u.end_rel != null ? Number(u.end_rel) : Number(u.start_rel) || 0;
      return Math.max(acc, e);
    }, 0);

    /** @type {Map<number, Array<{ start: number, end: number }>>} */
    const windowsByPid = new Map();
    for (const row of presR.rows) {
      const pid = Number(row.platform_participant_id);
      if (!Number.isFinite(pid)) continue;
      const kind = String(row.event_kind || '').toLowerCase();
      const rel = row.rel_seconds != null ? Number(row.rel_seconds) : null;
      if (!Number.isFinite(rel)) continue;
      if (!windowsByPid.has(pid)) windowsByPid.set(pid, []);
      const arr = windowsByPid.get(pid);
      if (kind === 'join') {
        arr.push({ start: rel, end: Infinity, open: true });
      } else if (kind === 'leave') {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i].open) {
            arr[i].end = rel;
            arr[i].open = false;
            break;
          }
        }
      }
    }
    for (const arr of windowsByPid.values()) {
      for (const w of arr) {
        if (w.open) {
          w.end = maxRel > 0 ? maxRel : Infinity;
          w.open = false;
        }
      }
    }

    const windowsFlat = [];
    for (const [pid, arr] of windowsByPid) {
      for (const w of arr) {
        windowsFlat.push({ platform_participant_id: pid, start_rel: w.start, end_rel: w.end });
      }
    }

    function utteranceInWindow(u, winStart, winEnd) {
      const u0 = u.start_rel != null ? Number(u.start_rel) : null;
      const u1 = u.end_rel != null ? Number(u.end_rel) : u0;
      if (!Number.isFinite(u0)) return true;
      const a = u0;
      const b = Number.isFinite(u1) ? u1 : u0;
      const ws = winStart;
      const we = winEnd;
      return b >= ws && a <= we;
    }

    const segments = [];
    for (const [leadId, pidSet] of leadToPlatformIds) {
      const lines = [];
      for (const u of uttR.rows) {
        const pid = Number(u.platform_participant_id);
        if (!pidSet.has(pid)) continue;
        const wins = windowsByPid.get(pid);
        if (wins && wins.length > 0) {
          let ok = false;
          for (const w of wins) {
            if (utteranceInWindow(u, w.start, w.end)) {
              ok = true;
              break;
            }
          }
          if (!ok) continue;
        }
        const t = (u.utterance_text || '').trim();
        if (t) lines.push(t);
      }
      segments.push({
        airtable_lead_id: leadId,
        text: lines.join('\n\n'),
        utterance_count: lines.length,
      });
    }

    return { segments, windows: windowsFlat };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

async function seedManualTestRecall() {
  const p = getPool();
  if (!p) return { ok: false, error: 'DATABASE_URL not set' };
  const botId = `test-bot-${Date.now()}`;
  const recordingId = `test-rec-${Date.now()}`;
  const payload = {
    event: 'manual_test',
    data: {
      bot: { id: botId, metadata: { meeting_title: 'Harness Recall meeting' } },
      recording: { id: recordingId },
      data: {
        participant: { id: 9001, name: 'Harness User', email: 'test@example.com' },
        words: [
          { text: 'Hello ', start_timestamp: { relative: 0.1 }, end_timestamp: { relative: 0.5 } },
          { text: 'world.', start_timestamp: { relative: 0.5 }, end_timestamp: { relative: 1.0 } },
        ],
      },
    },
  };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const evR = await client.query(
      `INSERT INTO recall_webhook_events (event, bot_id, recording_id, payload) VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      ['manual_test', botId, recordingId, JSON.stringify(payload)],
    );
    const mR = await client.query(
      `INSERT INTO recall_meetings (bot_id, recording_id, title, transcript_text)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [botId, recordingId, 'Harness Recall meeting', 'Participant 9001 | 00:00\nHello world.'],
    );
    return { ok: true, postgres_id: String(evR.rows[0].id), meeting_id: String(mR.rows[0].id), bot_id: botId };
  } finally {
    client.release();
  }
}

async function purgeManualTestRecall() {
  const p = getPool();
  if (!p) return { ok: false, error: 'DATABASE_URL not set', deleted: 0 };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(`DELETE FROM recall_meetings WHERE bot_id LIKE 'test-bot-%'`);
    const r = await client.query(`
      DELETE FROM recall_webhook_events
      WHERE event = 'manual_test' OR bot_id LIKE 'test-bot-%'
      RETURNING id
    `);
    return { ok: true, deleted: r.rowCount, ids: r.rows.map((row) => row.id) };
  } finally {
    client.release();
  }
}

module.exports = {
  getPool,
  persistRecallWebhookEvent,
  getRecallWebhookDbSummary,
  upsertRecallMeeting,
  getMeetingById,
  getMeetingQueue,
  updateMeetingStatus,
  setMeetingIngestStatus,
  splitMeeting,
  appendRecallUtterance,
  recordRecallPresence,
  upsertRecallMeetingParticipant,
  getParticipantsForMeeting,
  listMeetingLeads,
  addMeetingLead,
  removeMeetingLead,
  syncMeetingReviewStatus,
  recomputeAllRecallMeetingReviewStatuses,
  saveMeetingSpeakers,
  getLeadSegmentsForMeeting,
  seedManualTestRecall,
  purgeManualTestRecall,
};
