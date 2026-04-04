/**
 * Persist Krisp webhook payloads when DATABASE_URL is set (Render Postgres).
 * Creates table on first use.
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
  await client.query(`
    CREATE TABLE IF NOT EXISTS krisp_webhook_events (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      event TEXT,
      krisp_id TEXT,
      payload JSONB NOT NULL
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS krisp_event_leads (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      event_id BIGINT NOT NULL REFERENCES krisp_webhook_events(id) ON DELETE CASCADE,
      airtable_lead_id TEXT NOT NULL,
      coach_client_id TEXT NOT NULL DEFAULT 'Guy-Wilson',
      participant_email TEXT,
      match_method TEXT NOT NULL,
      UNIQUE (event_id, airtable_lead_id)
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_krisp_event_leads_lead ON krisp_event_leads (airtable_lead_id);`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_krisp_event_leads_event ON krisp_event_leads (event_id);`,
  );
  await client.query(
    `ALTER TABLE krisp_webhook_events ADD COLUMN IF NOT EXISTS unmatched_alert_sent_at TIMESTAMPTZ`,
  );
  await client.query(
    `ALTER TABLE krisp_webhook_events ADD COLUMN IF NOT EXISTS conversation_alert_sent_at TIMESTAMPTZ`,
  );
  await client.query(
    `ALTER TABLE krisp_webhook_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'to_verify'`,
  );
  await client.query(
    `ALTER TABLE krisp_webhook_events ALTER COLUMN status SET DEFAULT 'to_verify'`,
  );
  await client.query(
    `UPDATE krisp_webhook_events SET status = 'to_verify' WHERE status = 'new'`,
  );
  await client.query(
    `ALTER TABLE krisp_webhook_events ADD COLUMN IF NOT EXISTS verified_speakers JSONB`,
  );
  await client.query(
    `ALTER TABLE krisp_webhook_events ADD COLUMN IF NOT EXISTS status_reason TEXT`,
  );
  await client.query(
    `ALTER TABLE krisp_webhook_events ADD COLUMN IF NOT EXISTS needs_split BOOLEAN NOT NULL DEFAULT FALSE`,
  );
  await client.query(
    `ALTER TABLE krisp_webhook_events ADD COLUMN IF NOT EXISTS parent_event_id BIGINT REFERENCES krisp_webhook_events(id)`,
  );
  schemaEnsured = true;
}

/** @param {string|number} postgresEventId */
async function getKrispUnmatchedAlertAlreadySent(postgresEventId) {
  const n = typeof postgresEventId === 'string' ? parseInt(postgresEventId, 10) : Number(postgresEventId);
  if (!Number.isFinite(n)) return true;
  const p = getPool();
  if (!p) return true;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT unmatched_alert_sent_at FROM krisp_webhook_events WHERE id = $1`,
      [n],
    );
    return !!(r.rows[0] && r.rows[0].unmatched_alert_sent_at);
  } finally {
    client.release();
  }
}

/** @param {string|number} postgresEventId */
async function markKrispUnmatchedAlertSent(postgresEventId) {
  const n = typeof postgresEventId === 'string' ? parseInt(postgresEventId, 10) : Number(postgresEventId);
  if (!Number.isFinite(n)) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `UPDATE krisp_webhook_events SET unmatched_alert_sent_at = now() WHERE id = $1`,
      [n],
    );
    return { ok: true };
  } finally {
    client.release();
  }
}

/** @param {string|number} postgresEventId */
async function getKrispConversationAlertAlreadySent(postgresEventId) {
  const n = typeof postgresEventId === 'string' ? parseInt(postgresEventId, 10) : Number(postgresEventId);
  if (!Number.isFinite(n)) return true;
  const p = getPool();
  if (!p) return true;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT conversation_alert_sent_at FROM krisp_webhook_events WHERE id = $1`,
      [n],
    );
    return !!(r.rows[0] && r.rows[0].conversation_alert_sent_at);
  } finally {
    client.release();
  }
}

/** @param {string|number} postgresEventId */
async function markKrispConversationAlertSent(postgresEventId) {
  const n = typeof postgresEventId === 'string' ? parseInt(postgresEventId, 10) : Number(postgresEventId);
  if (!Number.isFinite(n)) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `UPDATE krisp_webhook_events SET conversation_alert_sent_at = now() WHERE id = $1`,
      [n],
    );
    return { ok: true };
  } finally {
    client.release();
  }
}

/**
 * @param {{ event: string | null, krispId: string | null, payload: object }} row
 * @returns {Promise<{ ok: true } | { skipped: true }>}
 */
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

/**
 * Read-only summary for admin checks (no payload bodies).
 * @param {number} [limit=15]
 */
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
    return {
      database_configured: true,
      table: 'krisp_webhook_events',
      total_rows: countR.rows[0].c,
      recent: recentR.rows,
    };
  } catch (e) {
    return { database_configured: true, error: e.message };
  } finally {
    client.release();
  }
}

/**
 * @param {string|number} id
 * @returns {Promise<{ id, received_at, event, krisp_id, payload } | null>}
 */
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

/** For live test harness only — obvious fake rows, safe to purge. */
async function seedManualTestTranscript() {
  const p = getPool();
  if (!p) return { ok: false, error: 'DATABASE_URL not set' };

  const krispId = `test-${Date.now()}`;
  const payload = {
    id: krispId,
    event: 'manual_test',
    data: {
      note: 'Seeded by POST /krisp-test/seed (safe to delete)',
      raw_content:
        'HARNESS: fake Krisp transcript.\nTania: Thanks for the walkthrough.\nTest User: Agreed — next steps noted.',
      participants: [
        { email: 'taniaadelewilson@gmail.com', first_name: 'Tania', last_name: 'Wilson' },
        { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
      ],
    },
  };

  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `INSERT INTO krisp_webhook_events (event, krisp_id, payload) VALUES ($1, $2, $3::jsonb)`,
      ['manual_test', krispId, JSON.stringify(payload)],
    );
    const idR = await client.query(`SELECT id FROM krisp_webhook_events WHERE krisp_id = $1`, [krispId]);
    return { ok: true, postgres_id: idR.rows[0].id, krisp_id: krispId };
  } finally {
    client.release();
  }
}

/**
 * Backend-only fake rows (no UI). Replaces any prior rows whose krisp_id starts with test-fixture-.
 * Purge with POST /krisp-test/purge (same as other harness rows).
 */
async function seedKrispBackendFixtures() {
  const p = getPool();
  if (!p) return { ok: false, error: 'DATABASE_URL not set' };

  const fixtures = [
    {
      event: 'transcript_created',
      krisp_id: 'test-fixture-transcript-001',
      payload: {
        id: 'test-fixture-transcript-001',
        event: 'transcript_created',
        data: {
          meeting: { title: 'Harness: 1:1 with Tania Wilson', duration_seconds: 180 },
          raw_content:
            '[Harness — not a real call]\nTania: Let’s align on the timeline.\nYou: Sounds good — I’ll send a summary.',
          participants: [{ email: 'taniaadelewilson@gmail.com', first_name: 'Tania', last_name: 'Wilson' }],
        },
      },
    },
    {
      event: 'key_points_generated',
      krisp_id: 'test-fixture-keypoints-002',
      payload: {
        id: 'test-fixture-keypoints-002',
        event: 'key_points_generated',
        data: {
          meeting: { title: 'Harness: trio call' },
          content: { bullets: ['Tania — contract review', 'Test User — demo follow-up'] },
          raw_content: '[Harness] Multi-participant summary (fake).',
          participants: [
            { email: 'taniaadelewilson@gmail.com', first_name: 'Tania', last_name: 'Wilson' },
            { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
          ],
        },
      },
    },
    {
      event: 'manual_test',
      krisp_id: 'test-fixture-unlinked-003',
      payload: {
        id: 'test-fixture-unlinked-003',
        event: 'manual_test',
        data: {
          note: 'Harness: sparse payload (no structured participants)',
          raw_content: 'Harness edge case: only test@example.com mentioned in free text — no participant array.',
        },
      },
    },
  ];

  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(`DELETE FROM krisp_webhook_events WHERE krisp_id LIKE 'test-fixture-%'`);

    const inserted = [];
    for (const f of fixtures) {
      await client.query(
        `INSERT INTO krisp_webhook_events (event, krisp_id, payload) VALUES ($1, $2, $3::jsonb)`,
        [f.event, f.krisp_id, JSON.stringify(f.payload)],
      );
      const idR = await client.query(`SELECT id FROM krisp_webhook_events WHERE krisp_id = $1`, [f.krisp_id]);
      inserted.push({
        postgres_id: String(idR.rows[0].id),
        krisp_id: f.krisp_id,
        event: f.event,
      });
    }
    return { ok: true, count: inserted.length, rows: inserted };
  } finally {
    client.release();
  }
}

/** Removes rows created by the harness (manual_test or krisp_id prefix test-). */
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
  } finally {
    client.release();
  }
}

/**
 * @param {{ eventId: number|string, airtableLeadId: string, coachClientId?: string, participantEmail?: string|null, matchMethod?: string }} row
 */
async function insertKrispEventLead(row) {
  const p = getPool();
  if (!p) return { skipped: true, inserted: false };
  const eventId = typeof row.eventId === 'string' ? parseInt(row.eventId, 10) : Number(row.eventId);
  if (!Number.isFinite(eventId)) return { skipped: true, inserted: false };

  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `INSERT INTO krisp_event_leads (event_id, airtable_lead_id, coach_client_id, participant_email, match_method)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id, airtable_lead_id) DO NOTHING
       RETURNING id`,
      [
        eventId,
        row.airtableLeadId,
        (row.coachClientId || 'Guy-Wilson').trim(),
        row.participantEmail || null,
        (row.matchMethod || 'email').trim(),
      ],
    );
    return { inserted: r.rowCount > 0, skipped: false };
  } finally {
    client.release();
  }
}

async function getKrispLinksForLead(airtableLeadId, limit = 50) {
  const p = getPool();
  if (!p) return [];
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT l.id AS link_id, l.event_id, l.participant_email, l.match_method, l.created_at,
              e.received_at, e.event, e.krisp_id
       FROM krisp_event_leads l
       JOIN krisp_webhook_events e ON e.id = l.event_id
       WHERE l.airtable_lead_id = $1
       ORDER BY e.received_at DESC
       LIMIT $2`,
      [airtableLeadId, cap],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

/** Links for a lead with full webhook payload (for transcript copy / preview). */
async function getKrispTranscriptRowsForLead(airtableLeadId, limit = 50) {
  const p = getPool();
  if (!p) return [];
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT l.id AS link_id, l.event_id, l.participant_email, l.match_method, l.created_at,
              e.received_at, e.event, e.krisp_id, e.payload, e.status, e.verified_speakers
       FROM krisp_event_leads l
       JOIN krisp_webhook_events e ON e.id = l.event_id
       WHERE l.airtable_lead_id = $1
       ORDER BY e.received_at DESC
       LIMIT $2`,
      [airtableLeadId, cap],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

async function getKrispLinksForEvent(eventId) {
  const n = typeof eventId === 'string' ? parseInt(eventId, 10) : Number(eventId);
  if (!Number.isFinite(n)) return [];
  const p = getPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT id AS link_id, airtable_lead_id, participant_email, match_method, created_at
       FROM krisp_event_leads WHERE event_id = $1 ORDER BY id`,
      [n],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

/**
 * Review queue: recent rows with status + verified_speakers (no full payload).
 * @param {number} [limit=50]
 * @param {string} [statusFilter='all'] — 'to_verify' | 'verified' | 'skipped' | 'legacy' (old new/speakers_verified/ready/linked) | 'all'
 */
async function getKrispReviewQueue(limit = 50, statusFilter = 'all') {
  const p = getPool();
  if (!p) return [];
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const f = String(statusFilter || 'all').toLowerCase();
  let where = '';
  if (f === 'to_verify') {
    where = ` WHERE status = 'to_verify'`;
  } else if (f === 'verified') {
    where = ` WHERE status = 'verified'`;
  } else if (f === 'skipped') {
    where = ` WHERE status = 'skipped'`;
  } else if (f === 'legacy') {
    where = ` WHERE status IN ('new','speakers_verified','ready','linked')`;
  }
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT id, received_at, event, krisp_id, status, verified_speakers, needs_split, status_reason,
              payload->'data'->'meeting'->>'title' AS meeting_title,
              payload->'data'->'meeting'->>'duration_seconds' AS duration_seconds
       FROM krisp_webhook_events${where} ORDER BY id DESC LIMIT $1`,
      [cap],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

/**
 * Full row for review page (includes payload).
 * @param {string|number} id
 */
async function getKrispReviewEventById(id) {
  const n = typeof id === 'string' ? parseInt(id, 10) : Number(id);
  if (!Number.isFinite(n) || n < 1) return null;
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT id, received_at, event, krisp_id, payload, status, verified_speakers,
              status_reason, needs_split, parent_event_id
       FROM krisp_webhook_events WHERE id = $1`,
      [n],
    );
    return r.rows[0] || null;
  } finally {
    client.release();
  }
}

/** @param {string|number} id @param {object} speakers */
async function saveVerifiedSpeakers(id, speakers) {
  const n = typeof id === 'string' ? parseInt(id, 10) : Number(id);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `UPDATE krisp_webhook_events SET verified_speakers = $2::jsonb, status = 'verified' WHERE id = $1`,
      [n, JSON.stringify(speakers)],
    );
    return { ok: true };
  } finally {
    client.release();
  }
}

/** @param {string|number} id @param {string} newStatus @param {string} [statusReason] */
async function updateKrispEventStatus(id, newStatus, statusReason) {
  const VALID = ['to_verify', 'verified', 'skipped'];
  if (!VALID.includes(newStatus)) return { ok: false, error: 'invalid status' };
  const n = typeof id === 'string' ? parseInt(id, 10) : Number(id);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    if (statusReason !== undefined) {
      await client.query(
        `UPDATE krisp_webhook_events SET status = $2, status_reason = $3 WHERE id = $1`,
        [n, newStatus, statusReason],
      );
    } else {
      await client.query(`UPDATE krisp_webhook_events SET status = $2 WHERE id = $1`, [n, newStatus]);
    }
    return { ok: true };
  } finally {
    client.release();
  }
}

/** Set the initial status + reason after webhook ingest (won't overwrite manual user changes). */
async function setKrispIngestStatus(id, { status, statusReason, needsSplit }) {
  const n = typeof id === 'string' ? parseInt(id, 10) : Number(id);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  const p = getPool();
  if (!p) return { ok: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `UPDATE krisp_webhook_events
       SET status = $2, status_reason = $3, needs_split = $4
       WHERE id = $1`,
      [n, status || 'to_verify', statusReason || null, !!needsSplit],
    );
    return { ok: true };
  } finally {
    client.release();
  }
}

/**
 * Create a child event by splitting a parent transcript at a given line number.
 * Copies the parent row but trims the payload transcript to [splitAtLine..end].
 * The parent's transcript is trimmed to [0..splitAtLine-1].
 */
async function splitKrispEvent(parentId, splitAtLine, transcriptLines) {
  const n = typeof parentId === 'string' ? parseInt(parentId, 10) : Number(parentId);
  if (!Number.isFinite(n) || n < 1) return { ok: false, error: 'invalid parent id' };
  const p = getPool();
  if (!p) return { ok: false, error: 'no db' };

  const client = await p.connect();
  try {
    await ensureSchema(client);
    const parentRow = await client.query(`SELECT * FROM krisp_webhook_events WHERE id = $1`, [n]);
    if (parentRow.rows.length === 0) return { ok: false, error: 'parent not found' };
    const parent = parentRow.rows[0];

    const childPayload = JSON.parse(JSON.stringify(parent.payload));
    const firstHalf = transcriptLines.slice(0, splitAtLine).join('\n');
    const secondHalf = transcriptLines.slice(splitAtLine).join('\n');

    const setTranscriptText = (pl, text) => {
      if (pl?.data?.meeting?.transcripts && Array.isArray(pl.data.meeting.transcripts)) {
        pl.data.meeting.transcripts = [{ text }];
      } else if (pl?.data?.transcript !== undefined) {
        pl.data.transcript = text;
      } else if (pl?.data?.meeting) {
        pl.data.meeting.transcripts = [{ text }];
      } else if (pl?.data) {
        pl.data.transcript = text;
      }
    };

    setTranscriptText(childPayload, secondHalf);

    const parentPayloadCopy = JSON.parse(JSON.stringify(parent.payload));
    setTranscriptText(parentPayloadCopy, firstHalf);

    const ins = await client.query(
      `INSERT INTO krisp_webhook_events (event, krisp_id, payload, status, status_reason, parent_event_id)
       VALUES ($1, $2, $3::jsonb, 'to_verify', 'Split from parent #' || $4::text, $4)
       RETURNING id`,
      [parent.event, parent.krisp_id ? `${parent.krisp_id}-split` : null, JSON.stringify(childPayload), n],
    );
    const childId = ins.rows[0].id;

    await client.query(
      `UPDATE krisp_webhook_events SET payload = $2::jsonb, needs_split = FALSE,
              status_reason = COALESCE(status_reason, '') || ' (split into #' || $3::text || ')'
       WHERE id = $1`,
      [n, JSON.stringify(parentPayloadCopy), childId],
    );

    return { ok: true, parent_id: n, child_id: childId };
  } finally {
    client.release();
  }
}

module.exports = {
  persistKrispWebhook,
  getPool,
  getKrispWebhookDbSummary,
  getKrispWebhookEventById,
  insertKrispEventLead,
  getKrispLinksForLead,
  getKrispTranscriptRowsForLead,
  getKrispLinksForEvent,
  getKrispUnmatchedAlertAlreadySent,
  markKrispUnmatchedAlertSent,
  getKrispConversationAlertAlreadySent,
  markKrispConversationAlertSent,
  seedManualTestTranscript,
  seedKrispBackendFixtures,
  purgeManualTestTranscripts,
  getKrispReviewQueue,
  getKrispReviewEventById,
  saveVerifiedSpeakers,
  updateKrispEventStatus,
  setKrispIngestStatus,
  splitKrispEvent,
};
