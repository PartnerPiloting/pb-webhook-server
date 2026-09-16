/**
 * Wingguy unanswered-messages store - the WAREHOUSE behind "who wrote to me and never got an
 * answer?" (decided with Guy 2026-09-16).
 *
 * WHY: a coach running outreach at volume generates replies faster than they can follow through.
 * Thanks-for-Connecting goes out, people answer warmly, and some proportion of them are simply
 * lost - not through neglect but because the inbox has no view of "you owe this person". Those
 * people are the warmest leads the coach has and nobody has ever looked at them.
 *
 * WHERE THE DATA COMES FROM: LinkedIn's own data export (messages.csv), uploaded ONCE at
 * onboarding. That is deliberate. Linked Helper CAN scrape messaging history, but it costs one
 * action per profile out of a 150-a-day budget, which makes a whole-inbox sweep a six-month job
 * (verified against the LH manual, 10 Sep 2026). The export is free, complete, instant and
 * touches no automation limit - LinkedIn handing the user their own data. Keeping it CURRENT is
 * the extension's job later (sweep the inbox top-down while the coach is on LinkedIn anyway);
 * this store is written so that feed is a second writer into the same tables, not a rewrite.
 *
 * THE ONE DESIGN RULE - derive, don't queue (Guy, 2026-09-16):
 *   Who spoke last is RECOMPUTED from the stored messages every time, never remembered. The
 *   coach will answer some of these directly in LinkedIn without touching the screen, and a list
 *   that keeps showing people they have already replied to is worse than no list at all - they
 *   stop trusting it inside a week. Because it is derived, a later reply (from an export refresh
 *   or the extension) removes them automatically, with no state left to go stale.
 *   The AI VERDICT is the one thing cached, because it costs money - and it is keyed to the last
 *   message, so a new message in the thread invalidates it and it gets judged again.
 *
 * TENANCY: every write carries coach_client_id and every read filters on it. Somebody else's
 * inbox must never answer this coach's screen. There is no fallback tenant and no env default;
 * a missing id is a refused call.
 *
 * Reuses the recall store's pool (same as contactsStore/commsLog) - no new connection config.
 */

const crypto = require('crypto');

// The pool is required LAZILY, inside the functions that touch the database. Requiring it at
// module load would drag the `pg` driver in just to read a CSV, which makes the pure half of this
// file (parsing, thread building, the sign-off heuristic - the part with all the logic worth
// testing) impossible to exercise anywhere `pg` is not installed.
function getPool() {
  return require('./recallWebhookDb').getPool();
}

// Group conversations are excluded entirely. A "you owe them a reply" list only makes sense
// one-to-one - nobody owes a personal answer to a fifteen-person thread, and the whole screen
// is about restarting individual conversations.
const MAX_THREAD_PARTICIPANTS = 2;

let ensured = false;
async function ensureTables(client) {
  if (ensured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_li_messages (
      id BIGSERIAL PRIMARY KEY,
      coach_client_id TEXT NOT NULL,
      thread_key TEXT NOT NULL,
      message_key TEXT NOT NULL,
      sender_name TEXT,
      sender_url TEXT,
      outbound BOOLEAN NOT NULL,
      sent_at TIMESTAMPTZ,
      subject TEXT,
      content TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (coach_client_id, message_key)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wg_li_msg_thread ON wingguy_li_messages (coach_client_id, thread_key, sent_at);`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_li_threads (
      coach_client_id TEXT NOT NULL,
      thread_key TEXT NOT NULL,
      counterpart_name TEXT,
      counterpart_url TEXT,
      last_at TIMESTAMPTZ,
      last_outbound BOOLEAN,
      last_text TEXT,
      last_message_key TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      verdict TEXT,
      verdict_reason TEXT,
      verdict_for_message_key TEXT,
      judged_at TIMESTAMPTZ,
      dismissed_at TIMESTAMPTZ,
      dismissed_for_message_key TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (coach_client_id, thread_key)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wg_li_thr_open ON wingguy_li_threads (coach_client_id, last_outbound, last_at DESC);`);
  ensured = true;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests - no database, no network)
// ---------------------------------------------------------------------------

/**
 * Minimal RFC4180 CSV reader. LinkedIn's messages.csv carries message bodies verbatim, so fields
 * routinely contain commas, quotes and hard newlines - a split(',') mangles roughly every third
 * row. Written here rather than pulling a dependency: it is thirty lines and the shape never
 * changes. Returns an array of string arrays, one per record.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text || '').replace(/^﻿/, ''); // strip the BOM LinkedIn ships
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

// Header aliases. LinkedIn has renamed these columns more than once across export versions and
// the casing is not stable, so match on a squashed lowercase key rather than the literal header.
const HEADER_ALIASES = {
  conversationid: 'threadKey',
  conversationtitle: 'title',
  from: 'fromName',
  senderprofileurl: 'fromUrl',
  to: 'toName',
  recipientprofileurls: 'toUrls',
  date: 'sentAt',
  subject: 'subject',
  content: 'content',
  folder: 'folder',
};

function headerKey(h) {
  return String(h || '').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Turn the raw export into row objects. Unknown columns are ignored rather than rejected - a
 * future LinkedIn column must not break the upload.
 */
function parseMessagesCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => HEADER_ALIASES[headerKey(h)] || null);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const rec = {};
    for (let c = 0; c < header.length; c++) {
      if (header[c]) rec[header[c]] = rows[i][c] === undefined ? '' : String(rows[i][c]).trim();
    }
    if (!rec.threadKey) continue;
    out.push(rec);
  }
  return out;
}

/**
 * Work out which name in the file is the coach themself.
 *
 * The export is the coach's own mailbox, so they are a party to EVERY conversation while anyone
 * else appears in one or two. Counting distinct conversations per sender (not messages - a single
 * chatty contact would otherwise outrank the owner) makes this robust without asking the coach to
 * type their own name, which they would get subtly wrong often enough to matter.
 */
function detectOwnerName(rows) {
  const threadsBySender = new Map();
  for (const r of rows) {
    const name = String(r.fromName || '').trim();
    if (!name) continue;
    if (!threadsBySender.has(name)) threadsBySender.set(name, new Set());
    threadsBySender.get(name).add(r.threadKey);
  }
  let best = null;
  let bestCount = 0;
  for (const [name, threads] of threadsBySender) {
    if (threads.size > bestCount) { best = name; bestCount = threads.size; }
  }
  return best;
}

function messageKey(threadKey, sentAt, content) {
  const h = crypto.createHash('sha1').update(`${threadKey}|${sentAt}|${content}`).digest('hex').slice(0, 16);
  return `${threadKey}:${h}`;
}

function parseDate(v) {
  if (!v) return null;
  const d = new Date(String(v).trim().replace(' UTC', 'Z'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Group the rows into one-to-one threads and compute, for each, who spoke last.
 * `ownerName` identifies the coach; everything from anyone else is inbound.
 */
function buildThreads(rows, ownerName) {
  const byThread = new Map();
  for (const r of rows) {
    if (!byThread.has(r.threadKey)) byThread.set(r.threadKey, []);
    byThread.get(r.threadKey).push(r);
  }
  const threads = [];
  for (const [threadKey, msgs] of byThread) {
    // A group chat is any thread with a third party in it, on either side of the exchange.
    const participants = new Set();
    for (const m of msgs) {
      if (m.fromName) participants.add(m.fromName);
      for (const t of String(m.toName || '').split(/[;,]/)) {
        const n = t.trim();
        if (n) participants.add(n);
      }
    }
    if (participants.size > MAX_THREAD_PARTICIPANTS) continue;

    const parsed = msgs
      .map((m) => ({
        messageKey: messageKey(threadKey, m.sentAt, m.content),
        senderName: m.fromName || '',
        senderUrl: m.fromUrl || '',
        outbound: !!ownerName && m.fromName === ownerName,
        sentAt: parseDate(m.sentAt),
        subject: m.subject || '',
        content: m.content || '',
      }))
      .filter((m) => m.sentAt)
      .sort((a, b) => a.sentAt - b.sentAt);
    if (!parsed.length) continue;

    const last = parsed[parsed.length - 1];
    const other = parsed.find((m) => !m.outbound);
    threads.push({
      threadKey,
      counterpartName: other ? other.senderName : '',
      counterpartUrl: other ? other.senderUrl : '',
      lastAt: last.sentAt,
      lastOutbound: last.outbound,
      lastText: last.content,
      lastMessageKey: last.messageKey,
      messageCount: parsed.length,
      messages: parsed,
    });
  }
  return threads;
}

// Pure acknowledgements - the sign-off that ends a conversation rather than leaving it open.
// Catching these without an AI call is what stops the screen handing back four hundred people
// who said "thanks" three years ago, which is the difference between a list Guy opens daily and
// one he never opens twice. Anything longer or less clear-cut goes to the model.
const CLOSING_PATTERNS = [
  /^(many )?thanks[.! ]*$/i,
  /^thank you( so much| very much)?[.! ]*$/i,
  /^(ok|okay|great|perfect|excellent|brilliant|lovely|wonderful|awesome)[.! ]*$/i,
  /^(no worries|no problem|not at all|my pleasure|any ?time)[.! ]*$/i,
  /^(will do|sounds good|got it|noted|understood)[.! ]*$/i,
  /^(cheers|speak soon|talk soon|see you (then|soon)|catch (you )?(up )?soon)[.! ]*$/i,
  /^(you too|likewise|same to you)[.! ]*$/i,
];

/**
 * Cheap pre-filter, run before any model call. Returns 'no-reply' when the last message is
 * plainly a conversation-ender, otherwise null (meaning: ask the model).
 */
function closingHeuristic(text) {
  const t = String(text || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')  // strip emoji, then re-test
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return 'no-reply';                               // an empty body asks nothing
  if (t.length > 80) return null;                          // long enough to contain a question
  for (const re of CLOSING_PATTERNS) if (re.test(t)) return 'no-reply';
  return null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function requireTenant(coachClientId) {
  const t = String(coachClientId || '').trim();
  if (!t) throw new Error('coach_client_id is required');
  return t;
}

/**
 * Ingest a LinkedIn messages export for one tenant.
 *
 * Messages are upserted on (tenant, message_key), so re-uploading a later export is additive and
 * safe - the overlap is ignored and only genuinely new messages land. Thread state is then
 * REBUILT from what is stored, which is what lets a newer export retire a thread the coach has
 * since answered.
 */
async function ingestExport(coachClientId, csvText, opts = {}) {
  const tenant = requireTenant(coachClientId);
  const rows = parseMessagesCsv(csvText);
  if (!rows.length) return { ok: false, reason: 'no_rows' };

  const ownerName = String(opts.ownerName || '').trim() || detectOwnerName(rows);
  if (!ownerName) return { ok: false, reason: 'owner_not_detected' };

  const threads = buildThreads(rows, ownerName);
  const pool = getPool();
  const client = await pool.connect();
  let inserted = 0;
  try {
    await ensureTables(client);
    await client.query('BEGIN');
    for (const t of threads) {
      for (const m of t.messages) {
        const r = await client.query(
          `INSERT INTO wingguy_li_messages
             (coach_client_id, thread_key, message_key, sender_name, sender_url, outbound, sent_at, subject, content)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (coach_client_id, message_key) DO NOTHING`,
          [tenant, t.threadKey, m.messageKey, m.senderName, m.senderUrl, m.outbound, m.sentAt, m.subject, m.content]
        );
        inserted += r.rowCount;
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    return { ok: false, reason: 'ingest_failed', error: e.message };
  }
  client.release();

  const rebuilt = await rebuildThreads(tenant);
  return { ok: true, ownerName, threads: threads.length, messagesInserted: inserted, threadsRebuilt: rebuilt };
}

/**
 * Recompute every thread's derived state from the stored messages. This is the "derive, don't
 * queue" rule made concrete: last speaker is never trusted from an earlier run.
 *
 * A cached verdict survives only while it still describes the same last message; a dismissal
 * likewise, so that someone who was dismissed and then writes again comes back onto the list.
 */
async function rebuildThreads(coachClientId) {
  const tenant = requireTenant(coachClientId);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await ensureTables(client);
    const { rows } = await client.query(
      `WITH ranked AS (
         SELECT thread_key, outbound, sent_at, content, message_key, id,
                ROW_NUMBER() OVER (PARTITION BY thread_key ORDER BY sent_at DESC, id DESC) AS rn,
                COUNT(*)    OVER (PARTITION BY thread_key) AS n
           FROM wingguy_li_messages
          WHERE coach_client_id = $1
       ),
       counterpart AS (
         SELECT DISTINCT ON (thread_key) thread_key, sender_name, sender_url
           FROM wingguy_li_messages
          WHERE coach_client_id = $1 AND outbound = false
          ORDER BY thread_key, sent_at ASC
       )
       SELECT r.thread_key, r.outbound, r.sent_at, r.content, r.message_key, r.n,
              c.sender_name AS counterpart_name, c.sender_url AS counterpart_url
         FROM ranked r LEFT JOIN counterpart c ON c.thread_key = r.thread_key
        WHERE r.rn = 1`,
      [tenant]
    );
    for (const r of rows) {
      await client.query(
        `INSERT INTO wingguy_li_threads
           (coach_client_id, thread_key, counterpart_name, counterpart_url,
            last_at, last_outbound, last_text, last_message_key, message_count, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (coach_client_id, thread_key) DO UPDATE SET
           counterpart_name = EXCLUDED.counterpart_name,
           counterpart_url  = EXCLUDED.counterpart_url,
           last_at          = EXCLUDED.last_at,
           last_outbound    = EXCLUDED.last_outbound,
           last_text        = EXCLUDED.last_text,
           last_message_key = EXCLUDED.last_message_key,
           message_count    = EXCLUDED.message_count,
           updated_at       = now()`,
        [tenant, r.thread_key, r.counterpart_name || '', r.counterpart_url || '',
         r.sent_at, r.outbound, String(r.content || '').slice(0, 4000), r.message_key, Number(r.n) || 0]
      );
    }
    return rows.length;
  } finally {
    client.release();
  }
}

/**
 * The worklist: one-to-one threads where the OTHER person spoke last, newest first.
 *
 * `includeAll` returns everything for debugging. The default (what the screen asks for) hides
 * threads the model has ruled need no reply, and anything the coach has dismissed. Unjudged
 * threads ARE returned, so the screen can show them as pending and send them for judgement
 * rather than pretending they do not exist.
 */
async function listOpenThreads(coachClientId, opts = {}) {
  const tenant = requireTenant(coachClientId);
  const sinceDays = Number(opts.sinceDays) > 0 ? Number(opts.sinceDays) : 365;
  const limit = Math.min(Number(opts.limit) > 0 ? Number(opts.limit) : 500, 2000);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await ensureTables(client);
    const { rows } = await client.query(
      `SELECT thread_key, counterpart_name, counterpart_url, last_at, last_text, message_count,
              verdict, verdict_reason, verdict_for_message_key, last_message_key,
              dismissed_at, dismissed_for_message_key
         FROM wingguy_li_threads
        WHERE coach_client_id = $1
          AND last_outbound = false
          AND last_at > now() - ($2 || ' days')::interval
        ORDER BY last_at DESC
        LIMIT $3`,
      [tenant, String(sinceDays), limit]
    );
    return rows
      .map((r) => {
        // A verdict only counts while it describes the CURRENT last message; same for a dismissal.
        const verdictFresh = r.verdict && r.verdict_for_message_key === r.last_message_key;
        const dismissed = !!r.dismissed_at && r.dismissed_for_message_key === r.last_message_key;
        return {
          threadKey: r.thread_key,
          name: r.counterpart_name || '',
          linkedinUrl: r.counterpart_url || null,
          lastAt: r.last_at,
          lastText: r.last_text || '',
          lastMessageKey: r.last_message_key,
          messageCount: Number(r.message_count) || 0,
          verdict: verdictFresh ? r.verdict : null,
          verdictReason: verdictFresh ? r.verdict_reason : null,
          dismissed,
        };
      })
      .filter((t) => (opts.includeAll ? true : !t.dismissed && t.verdict !== 'no-reply'));
  } finally {
    client.release();
  }
}

/** The recent exchange for one thread, oldest first - what /wg needs to write a reply in context. */
async function getThreadMessages(coachClientId, threadKey, limit = 20) {
  const tenant = requireTenant(coachClientId);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await ensureTables(client);
    const { rows } = await client.query(
      `SELECT sender_name, outbound, sent_at, content
         FROM (SELECT * FROM wingguy_li_messages
                WHERE coach_client_id = $1 AND thread_key = $2
                ORDER BY sent_at DESC LIMIT $3) t
        ORDER BY sent_at ASC`,
      [tenant, String(threadKey), Math.min(Number(limit) || 20, 100)]
    );
    return rows.map((r) => ({
      senderName: r.sender_name || '',
      outbound: !!r.outbound,
      sentAt: r.sent_at,
      content: r.content || '',
    }));
  } finally {
    client.release();
  }
}

async function saveVerdict(coachClientId, threadKey, lastMessageKey, verdict, reason) {
  const tenant = requireTenant(coachClientId);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await ensureTables(client);
    await client.query(
      `UPDATE wingguy_li_threads
          SET verdict = $3, verdict_reason = $4, verdict_for_message_key = $5, judged_at = now(), updated_at = now()
        WHERE coach_client_id = $1 AND thread_key = $2`,
      [tenant, String(threadKey), verdict, String(reason || '').slice(0, 400), lastMessageKey]
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

/** Dismiss (or un-dismiss) a thread. Tied to the current last message, so a new one revives it. */
async function setDismissed(coachClientId, threadKey, dismissed) {
  const tenant = requireTenant(coachClientId);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await ensureTables(client);
    if (dismissed) {
      await client.query(
        `UPDATE wingguy_li_threads
            SET dismissed_at = now(), dismissed_for_message_key = last_message_key, updated_at = now()
          WHERE coach_client_id = $1 AND thread_key = $2`,
        [tenant, String(threadKey)]
      );
    } else {
      await client.query(
        `UPDATE wingguy_li_threads
            SET dismissed_at = NULL, dismissed_for_message_key = NULL, updated_at = now()
          WHERE coach_client_id = $1 AND thread_key = $2`,
        [tenant, String(threadKey)]
      );
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

module.exports = {
  // pure (tests)
  parseCsv,
  parseMessagesCsv,
  detectOwnerName,
  buildThreads,
  closingHeuristic,
  messageKey,
  // store
  ingestExport,
  rebuildThreads,
  listOpenThreads,
  getThreadMessages,
  saveVerdict,
  setDismissed,
};
