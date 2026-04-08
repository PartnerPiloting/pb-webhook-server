/**
 * Recall.ai real-time webhook persistence + meetings.
 *
 * Tables:
 *   recall_webhook_events — raw payloads
 *   recall_meetings — one row per bot + recording (review queue)
 *   recall_meeting_participants / recall_meeting_leads
 *   recall_utterances — timed segments for per-lead extraction
 *   recall_participant_presence — join/leave from participant_events.*
 */

const { Pool } = require('pg');

let pool;
let schemaEnsured = false;

function extractSpeakerLabels(text) {
  if (!text) return [];
  const labels = new Set();
  const rx = /^(Speaker \d+|[A-Z][\w ]+?):/gm;
  let m;
  while ((m = rx.exec(text)) !== null) labels.add(m[1]);
  return [...labels];
}

function participantResolvesSpeaker(p) {
  if (!p) return false;
  return !!(p.verified_name || p.verified_email || (p.role && p.role !== 'unknown'));
}

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

  await client.query(`
    DROP TABLE IF EXISTS krisp_meeting_leads CASCADE;
    DROP TABLE IF EXISTS krisp_meeting_participants CASCADE;
    DROP TABLE IF EXISTS krisp_meetings CASCADE;
    DROP TABLE IF EXISTS krisp_webhook_events CASCADE;
  `);

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

async function updateMeetingTimes(meetingId, { meetingStart, meetingEnd }) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `UPDATE recall_meetings SET meeting_start = COALESCE($2, meeting_start), meeting_end = COALESCE($3, meeting_end), updated_at = now() WHERE id = $1`,
      [n, meetingStart || null, meetingEnd || null],
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
// Utterance-based child meetings (auto-split)
// ---------------------------------------------------------------------------

async function createChildMeetingFromUtterances({
  parentId, title, startRel, endRel, participantIds, calendarStart, calendarEnd,
}) {
  const pid = typeof parentId === 'string' ? parseInt(parentId, 10) : Number(parentId);
  const p = getPool();
  if (!p) return { ok: false, error: 'no db' };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const parentRow = await client.query(`SELECT * FROM recall_meetings WHERE id = $1`, [pid]);
    if (parentRow.rows.length === 0) return { ok: false, error: 'parent not found' };
    const parent = parentRow.rows[0];

    let whereClause = `meeting_id = $1`;
    const params = [pid];
    let paramIdx = 2;

    if (startRel != null) {
      whereClause += ` AND end_rel >= $${paramIdx}`;
      params.push(startRel);
      paramIdx++;
    }
    if (endRel != null) {
      whereClause += ` AND start_rel <= $${paramIdx}`;
      params.push(endRel);
      paramIdx++;
    }

    const uttR = await client.query(
      `SELECT * FROM recall_utterances WHERE ${whereClause} ORDER BY seq`,
      params,
    );

    const lines = uttR.rows.map(u => {
      const name = u.participant_name_snapshot || `Participant ${u.platform_participant_id}`;
      return `${name}: ${u.utterance_text}`;
    });
    const transcriptText = lines.join('\n');

    const durSec = uttR.rows.length > 0
      ? Math.ceil((uttR.rows[uttR.rows.length - 1].end_rel || 0) - (uttR.rows[0].start_rel || 0))
      : null;

    const childRecId = `${parent.recording_id}__auto_${pid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const ins = await client.query(
      `INSERT INTO recall_meetings
        (bot_id, recording_id, title, transcript_text, duration_seconds,
         meeting_start, meeting_end, status, status_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'incomplete',
         'Auto-split from meeting #' || $8::text)
       RETURNING id`,
      [
        parent.bot_id, childRecId, title, transcriptText, durSec,
        calendarStart || parent.meeting_start,
        calendarEnd || parent.meeting_end,
        pid,
      ],
    );
    const childId = ins.rows[0].id;

    for (const u of uttR.rows) {
      await client.query(
        `INSERT INTO recall_utterances
          (meeting_id, seq, platform_participant_id, participant_name_snapshot, utterance_text, start_rel, end_rel)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [childId, u.seq, u.platform_participant_id, u.participant_name_snapshot, u.utterance_text, u.start_rel, u.end_rel],
      );
    }

    const partR = await client.query(
      `SELECT * FROM recall_meeting_participants WHERE meeting_id = $1`,
      [pid],
    );
    for (const pr of partR.rows) {
      const isRelevant = participantIds.includes(Number(pr.platform_participant_id))
        || pr.role === 'coach';
      if (!isRelevant) continue;
      await client.query(
        `INSERT INTO recall_meeting_participants
          (meeting_id, platform_participant_id, speaker_label, verified_name, verified_email,
           role, airtable_lead_id, coach_client_id, match_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (meeting_id, speaker_label) DO NOTHING`,
        [
          childId, pr.platform_participant_id, pr.speaker_label,
          pr.verified_name, pr.verified_email, pr.role,
          pr.airtable_lead_id, pr.coach_client_id, pr.match_method,
        ],
      );
      if (pr.airtable_lead_id) {
        await client.query(
          `INSERT INTO recall_meeting_leads (meeting_id, airtable_lead_id, coach_client_id, source)
           VALUES ($1, $2, $3, 'auto_split')
           ON CONFLICT (meeting_id, airtable_lead_id) DO NOTHING`,
          [childId, pr.airtable_lead_id, pr.coach_client_id || 'Guy-Wilson'],
        );
      }
    }

    return { ok: true, childId: String(childId), title, utteranceCount: uttR.rows.length };
  } finally {
    client.release();
  }
}

async function markParentSplit(meetingId, childIds) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  const p = getPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query(
      `UPDATE recall_meetings SET
         status = 'complete',
         status_reason = 'Auto-split into ' || $2::text || ' child meetings',
         needs_split = FALSE,
         updated_at = now()
       WHERE id = $1`,
      [n, String(childIds.length)],
    );
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Participants / leads
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

async function getPresenceForMeeting(meetingId) {
  const n = typeof meetingId === 'string' ? parseInt(meetingId, 10) : Number(meetingId);
  if (!Number.isFinite(n)) return [];
  const p = getPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT platform_participant_id, event_kind, abs_ts, rel_seconds FROM recall_participant_presence WHERE meeting_id = $1 ORDER BY id`,
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

async function getMeetingsForLead(airtableLeadId, limit = 50) {
  const p = getPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT m.id AS meeting_id, m.title, m.transcript_text, m.duration_seconds,
              m.status, m.created_at, m.updated_at, m.meeting_start,
              ml.airtable_lead_id,
              p.verified_name, p.verified_email, p.match_method
       FROM recall_meeting_leads ml
       JOIN recall_meetings m ON m.id = ml.meeting_id
       LEFT JOIN recall_meeting_participants p
         ON p.meeting_id = m.id AND p.airtable_lead_id = ml.airtable_lead_id
       WHERE ml.airtable_lead_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2`,
      [airtableLeadId, limit],
    );
    return r.rows;
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
  const ts = Date.now();
  const botId = `test-bot-${ts}`;

  const meetings = [
    {
      recordingId: `test-rec-${ts}-a`,
      title: 'Intro call — Test Dean Mitchell',
      duration: 1620,
      transcript: [
        'Guy Wilson: Hey Dean, thanks for jumping on. How\'s things your end?',
        'Test Dean Mitchell: Yeah good mate, really good. Been flat out with the new gym launch but keen to chat.',
        'Guy Wilson: Nice one — so tell me, what made you reach out?',
        'Test Dean Mitchell: Honestly, I\'ve been coaching people one-on-one for about three years now and I just can\'t scale it anymore. I\'m working sixty-hour weeks and I still can\'t take on new clients.',
        'Guy Wilson: That\'s really common with coaches at your stage. What does a typical week look like for you right now?',
        'Test Dean Mitchell: Monday to Friday I do about six sessions a day, then weekends I\'m doing program writes and admin. My girlfriend is about ready to kill me.',
        'Guy Wilson: Ha, yeah I\'ve heard that one before. So when you say you can\'t scale, is it more about time or is it the business model itself?',
        'Test Dean Mitchell: Both really. I charge seventy dollars a session and I know I should charge more but my clients are all everyday people, not athletes. I feel bad putting prices up.',
        'Guy Wilson: Makes sense. What if I told you there\'s a way to serve more people at a higher price point without adding hours?',
        'Test Dean Mitchell: I mean that\'s the dream isn\'t it? That\'s exactly why I\'m here.',
        'Guy Wilson: Right. So what we do is help coaches like you build a hybrid model — you keep some one-on-one work but we layer in group coaching, online programs, and a community element. Most of our coaches double their revenue within six months while working fewer hours.',
        'Test Dean Mitchell: Okay that sounds great in theory. How does it actually work though? Like, do I need a big social media following?',
        'Guy Wilson: Not at all. We start with your existing clients and network. The first step is usually mapping out your IP — the stuff you teach every day — and packaging it into a signature program.',
        'Test Dean Mitchell: Right. I\'ve thought about doing an online program before but I never know where to start.',
        'Guy Wilson: That\'s exactly what we help with. We\'ve got templates, tech setup, launch playbooks, the lot. You don\'t have to figure it out alone.',
        'Test Dean Mitchell: And what does the investment look like?',
        'Guy Wilson: We\'ve got a few options — I\'ll send you the details after this call. But typically it\'s a twelve-month partnership. The coaches who commit to it properly see massive results.',
        'Test Dean Mitchell: Yeah cool, send that through. I\'m definitely interested. Just need to chat with my business partner about it.',
        'Guy Wilson: Of course. When do you think you\'d have a decision by?',
        'Test Dean Mitchell: Probably by Friday. We\'ve got a catch-up Thursday arvo.',
        'Guy Wilson: Perfect. I\'ll follow up Friday morning then. Anything else you want to ask before we wrap up?',
        'Test Dean Mitchell: Nah that\'s great mate. Really appreciate the time.',
        'Guy Wilson: Legend. Speak Friday. Cheers Dean.',
        'Test Dean Mitchell: Cheers Guy.',
      ],
      participants: [
        { id: 1, name: 'Guy Wilson', role: 'coach' },
        { id: 2, name: 'Test Dean Mitchell', email: 'test_dean@mitchellfit.com.au', role: 'client' },
      ],
    },
    {
      recordingId: `test-rec-${ts}-b`,
      title: 'Back-to-back — Test Dean then Test Julia',
      duration: 3600,
      meetingStart: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      meetingEnd: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      needsSplit: true,
      transcript: [
        'Guy Wilson: Hey Dean, good to see you again mate.',
        'Test Dean Mitchell: Hey Guy! Yeah good to be back. So I spoke to my business partner.',
        'Guy Wilson: And?',
        'Test Dean Mitchell: We\'re in. We want to do the twelve-month program.',
        'Guy Wilson: That\'s great news Dean. Let me walk you through the onboarding steps.',
        'Test Dean Mitchell: Awesome, fire away.',
        'Guy Wilson: First thing is we\'ll set you up with access to the platform. You\'ll get your own dashboard where you can see your milestones and resources.',
        'Test Dean Mitchell: Sounds good. Is there homework before our next session?',
        'Guy Wilson: Just one thing — fill out the coaching intake form. It helps me understand where you are now so we can build your roadmap.',
        'Test Dean Mitchell: Easy. I\'ll do that tonight.',
        'Guy Wilson: Perfect. Dean, I\'ve got Julia jumping on next so I\'ll let you go. But really stoked to have you on board.',
        'Test Dean Mitchell: Thanks Guy. Chat soon.',
        'Guy Wilson: Hey Julia! Come on in.',
        'Test Julia Chen: Hi Guy! Sorry, am I late?',
        'Guy Wilson: No no, perfect timing. Dean was just wrapping up. How\'s the gut health program going?',
        'Test Julia Chen: So good. I\'ve got fourteen people signed up for the first cohort.',
        'Guy Wilson: Fourteen! That\'s amazing. Ahead of target.',
        'Test Julia Chen: I know right? I priced it at four-ninety-seven like we discussed and it just flew.',
        'Guy Wilson: Love it. So today I want to look at your delivery plan. How are you structuring the weekly calls?',
        'Test Julia Chen: I was thinking Tuesday nights. One hour, group coaching call, then a Q&A at the end.',
        'Guy Wilson: That works. Make sure you record them — you can repurpose those recordings as bonus content for the next launch.',
        'Test Julia Chen: Oh that\'s smart. I hadn\'t thought of that.',
        'Guy Wilson: It\'s a game changer. Alright Julia, same time next week?',
        'Test Julia Chen: Yep! Thanks Guy.',
        'Guy Wilson: Legend. Talk then.',
      ],
      participants: [
        { id: 1, name: 'Guy Wilson', role: 'coach' },
        { id: 2, name: 'Test Dean Mitchell', email: 'test_dean@mitchellfit.com.au', role: 'client' },
        { id: 3, name: 'Test Julia Chen', email: 'test_julia@julianutrition.com', role: 'client' },
      ],
      presence: [
        { pid: 1, kind: 'join', relSec: 0 },
        { pid: 2, kind: 'join', relSec: 5 },
        { pid: 2, kind: 'leave', relSec: 1560 },
        { pid: 3, kind: 'join', relSec: 1500 },
        { pid: 3, kind: 'leave', relSec: 3580 },
      ],
    },
    {
      recordingId: `test-rec-${ts}-c`,
      title: 'Group strategy session — Test Julia & Test George',
      duration: 2340,
      transcript: [
        'Guy Wilson: Alright, Julia and George — welcome. Great to have you both here.',
        'Test Julia Chen: Thanks Guy! Really excited about this.',
        'Test George Papadopoulos: Yeah same, been looking forward to it.',
        'Guy Wilson: So just to set the agenda — today we\'re going to look at your Q2 goals and map out a plan. Julia, you want to kick us off?',
        'Test Julia Chen: Sure. So my main goal for Q2 is to launch my first group program. I\'ve been doing one-on-one nutrition coaching for two years and I\'m ready to scale.',
        'Guy Wilson: Love it. What\'s the program going to look like?',
        'Test Julia Chen: I\'m thinking an eight-week gut health reset. It\'s what I get asked about the most. I\'d run it as a cohort — maybe twelve to fifteen people.',
        'Guy Wilson: Smart. Have you priced it yet?',
        'Test Julia Chen: I was thinking four-ninety-seven. Is that too low?',
        'Guy Wilson: For eight weeks with group calls? I\'d say that\'s fair for a first launch. You can always increase for round two. George, what about you?',
        'Test George Papadopoulos: Mine\'s different. I want to nail down my content strategy. I\'ve got about two thousand followers on Insta but my engagement is rubbish.',
        'Guy Wilson: What kind of content are you posting right now?',
        'Test George Papadopoulos: Mainly workout videos and the occasional transformation post. But it feels like I\'m shouting into the void.',
        'Guy Wilson: Yeah, workout videos are the most saturated content in fitness. Here\'s what I\'d suggest — start sharing your coaching philosophy. Why you do what you do. People buy into the person first, then the program.',
        'Test George Papadopoulos: That makes sense. I guess I just feel weird talking about myself.',
        'Test Julia Chen: George, I felt the same way at first. But honestly, once I started sharing my own health journey, my DMs blew up. People want to know you\'re real.',
        'Test George Papadopoulos: Yeah fair point. Okay, I\'ll give it a go.',
        'Guy Wilson: Good. So action items — Julia, get your program outline done by next Wednesday. George, I want you to post three story-based pieces this week. Sound good?',
        'Test Julia Chen: Done.',
        'Test George Papadopoulos: Yep, on it.',
        'Guy Wilson: Brilliant. Let\'s catch up same time next week to review progress. Great session today.',
        'Test Julia Chen: Thanks Guy!',
        'Test George Papadopoulos: Cheers mate.',
      ],
      participants: [
        { id: 1, name: 'Guy Wilson', role: 'coach' },
        { id: 3, name: 'Test Julia Chen', email: 'test_julia@julianutrition.com', role: 'client' },
        { id: 4, name: 'Test George Papadopoulos', email: 'test_george@ironwillpt.com', role: 'client' },
      ],
    },
  ];

  const client = await p.connect();
  try {
    await ensureSchema(client);
    const results = [];

    for (const m of meetings) {
      const fullText = m.transcript.join('\n');
      const payload = { event: 'manual_test', data: { bot: { id: botId }, recording: { id: m.recordingId }, title: m.title } };

      await client.query(
        `INSERT INTO recall_webhook_events (event, bot_id, recording_id, payload) VALUES ($1, $2, $3, $4::jsonb)`,
        ['manual_test', botId, m.recordingId, JSON.stringify(payload)],
      );

      const mR = await client.query(
        `INSERT INTO recall_meetings (bot_id, recording_id, title, transcript_text, duration_seconds, status, needs_split, meeting_start, meeting_end)
         VALUES ($1, $2, $3, $4, $5, 'incomplete', $6, $7, $8) RETURNING id`,
        [botId, m.recordingId, m.title, fullText, m.duration, !!m.needsSplit, m.meetingStart || null, m.meetingEnd || null],
      );
      const meetingId = mR.rows[0].id;

      for (const part of m.participants) {
        await client.query(
          `INSERT INTO recall_meeting_participants (meeting_id, platform_participant_id, speaker_label, verified_name, verified_email, role)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (meeting_id, speaker_label) DO NOTHING`,
          [meetingId, part.id, part.name, part.name, part.email || null, part.role || 'unknown'],
        );
      }

      let seq = 0;
      const pidTimeCursors = {};
      if (m.presence) {
        for (const pr of m.presence) {
          if (pr.kind === 'join') pidTimeCursors[pr.pid] = pr.relSec || 0;
        }
      }
      for (const line of m.transcript) {
        const colonIdx = line.indexOf(': ');
        if (colonIdx < 0) continue;
        const speakerName = line.slice(0, colonIdx);
        const text = line.slice(colonIdx + 2);
        const part = m.participants.find(pp => pp.name === speakerName);
        const pid = part?.id || 0;
        const dur = 3 + Math.random() * 8;
        const relTime = pidTimeCursors[pid] != null ? pidTimeCursors[pid] : (seq * 5);
        await client.query(
          `INSERT INTO recall_utterances (meeting_id, seq, platform_participant_id, participant_name_snapshot, utterance_text, start_rel, end_rel)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [meetingId, seq++, pid, speakerName, text, relTime, relTime + dur],
        );
        if (pidTimeCursors[pid] != null) pidTimeCursors[pid] = relTime + dur + 0.5;
      }

      if (m.presence) {
        const mStart = m.meetingStart ? new Date(m.meetingStart) : new Date();
        for (const pr of m.presence) {
          const absTs = new Date(mStart.getTime() + (pr.relSec || 0) * 1000).toISOString();
          await client.query(
            `INSERT INTO recall_participant_presence (meeting_id, platform_participant_id, event_kind, abs_ts, rel_seconds)
             VALUES ($1, $2, $3, $4, $5)`,
            [meetingId, pr.pid, pr.kind, absTs, pr.relSec],
          );
        }
      }

      results.push({
        meeting_id: String(meetingId),
        title: m.title,
        speakers: m.participants.length,
        lines: m.transcript.length,
        has_presence: !!(m.presence && m.presence.length),
        needs_split: !!m.needsSplit,
      });
    }

    return { ok: true, bot_id: botId, meetings: results };
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
  updateMeetingTimes,
  splitMeeting,
  appendRecallUtterance,
  recordRecallPresence,
  upsertRecallMeetingParticipant,
  getParticipantsForMeeting,
  getPresenceForMeeting,
  listMeetingLeads,
  addMeetingLead,
  removeMeetingLead,
  syncMeetingReviewStatus,
  recomputeAllRecallMeetingReviewStatuses,
  saveMeetingSpeakers,
  getLeadSegmentsForMeeting,
  createChildMeetingFromUtterances,
  markParentSplit,
  getMeetingsForLead,
  seedManualTestRecall,
  purgeManualTestRecall,
};
