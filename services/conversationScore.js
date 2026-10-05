// services/conversationScore.js
// Reconnect, brick 2 (docs/RECONNECT-BUILD-PLAN.md): the CONVERSATION SCORE - an AI read of how
// each old LinkedIn thread ended, for people the client is connected to, who replied at least once
// and have been quiet for 90 days or more. Reads linkedin_people + linkedin_messages (brick 1) and
// writes linkedin_conversation_scores.
//
// What is fixed and what is not (agreed with Guy 5 Oct 2026):
//   HARD-CODED here - the ending types, the 1-5 warmth scale and the four things returned. The
//     nightly order, the row chips and the disconnect suggestions all read these, so they must
//     mean the same thing for every client.
//   PER CLIENT - a short "who I am and who I'm looking for" paragraph. It is what makes the same
//     thread a 2 for one client and a 4 for another.
//   TUNABLE - the reading guidance (what a 5 is, what a polite closer is). DEFAULT_GUIDANCE below
//     is the shared wording; loadProfile() is the one seam where the instructions store takes
//     over from it.
//
// Rules this file keeps:
//   - The client's own Claude key, through resolveClientAnthropic. No key = refused, not billed
//     to the platform.
//   - A thread is read once. It is read again only when the thread itself changes, or when the
//     caller deliberately asks for a re-score after the paragraph or guidance changed.
//   - Run as a one-off job (scripts/conversation-score.js), never a chat tool call.

const crypto = require('crypto');
const { Pool } = require('pg');
const { createLogger } = require('../utils/contextLogger');

const MODEL_ID = process.env.CONVERSATION_SCORE_MODEL_ID || 'claude-opus-5-5';
// Bump to force every thread to count as stale on the next deliberate re-score.
const PROMPT_VERSION = 'c1';
const QUIET_DAYS = 90;
const TAIL_MESSAGES = 8;
const MESSAGE_CHARS = 500;
const BATCH = 10;
const WORKERS = 4;
const MS_DAY = 86400000;
// US$ per million tokens, for the estimate only.
const PRICE_IN = 4; const PRICE_OUT = 20;

const ENDINGS = [
  'open_question_or_offer', 'stalled_after_interest', 'answered_then_dropped', 'not_now',
  'closed_politely', 'declined', 'their_pitch', 'moved_to_call_or_email', 'other',
];

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['ref', 'ending', 'warmth', 'why', 'anchor'],
        properties: {
          ref: { type: 'string' }, ending: { type: 'string', enum: ENDINGS }, warmth: { type: 'integer' },
          why: { type: 'string' }, anchor: { type: 'string' },
        },
      },
    },
  },
};

const DEFAULT_GUIDANCE = `warmth: 1 to 5, judged against who this person is looking for.
5 = plainly willing to talk and the kind of person they want - write to them this week.
4 = real engagement and a good fit, good odds.
3 = some engagement, or a strong fit with only a little said.
2 = thin, or one polite line.
1 = no point, or do not contact.
A thank-you with nothing about themselves is never above 2. A decline or their own sales pitch is never above 1.`;

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

function buildSystem({ coachName, who, guidance }) {
  const name = String(coachName || 'the client').trim();
  const first = name.split(/\s+/)[0];
  return `You are reading old LinkedIn message threads belonging to ${name}. They are deciding who to reconnect with after a long silence. For each thread, judge from ${first}'s side how it ended.

WHO ${first.toUpperCase()} IS AND WHO THEY ARE LOOKING FOR (in their own words):
${String(who || '').trim()}

ending:
- open_question_or_offer: THEY left something open that ${first} never answered - proposed a time, asked a real question, sent a booking link, said they were happy to talk.
- stalled_after_interest: they showed genuine interest, ${first} replied or asked something, and then they went silent.
- answered_then_dropped: they gave a real answer to ${first}'s opening question or made conversation, and the thread simply stopped with no ask from either side.
- not_now: they deferred with a reason or a time ("after the trip", "try me next quarter", "busy until").
- closed_politely: thanks, thumbs up, "nice to connect", "will do" - nothing owed, nothing open.
- declined: not interested, unsubscribe, or irritated.
- their_pitch: their messages are selling, promoting an event, asking a favour, or mass greetings.
- moved_to_call_or_email: the thread is call logistics or an email handover, so they almost certainly met or continued elsewhere.
- other: none of the above.

${String(guidance || DEFAULT_GUIDANCE).trim()}

why: one plain sentence, 18 words or fewer, stating the fact that matters, written so ${first} can read it in a list. No names.
anchor: 12 words or fewer naming the specific thing a reconnect message could pick up, in their terms. Empty string if there is none. Never invent.

Judge only from the text given. Return one item per thread, using the ref exactly as given.`;
}

/** What the read depends on besides the thread. A different sig = the stored score is out of date. */
function profileSig({ who, guidance }) {
  return crypto.createHash('sha1')
    .update([PROMPT_VERSION, MODEL_ID, String(who || '').trim(), String(guidance || DEFAULT_GUIDANCE).trim()].join('\u0001'))
    .digest('hex').slice(0, 12);
}

const threadSig = (p) => `${new Date(p.last_msg_at).toISOString()}|${Number(p.msgs_in) + Number(p.msgs_out)}`;
const refOf = (p) => crypto.createHash('sha1').update(String(p.person_key)).digest('hex').slice(0, 10);
const day = (t) => new Date(t).toISOString().slice(0, 10);

function transcript(person, messages, coachFirst, nowMs) {
  const sorted = [...messages].sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));
  const tail = sorted.slice(-TAIL_MESSAGES);
  const quiet = Math.floor((nowMs - new Date(person.last_msg_at).getTime()) / MS_DAY);
  const head = sorted.length > TAIL_MESSAGES
    ? `(${sorted.length - TAIL_MESSAGES} earlier messages omitted; ${person.msgs_in} from them and ${person.msgs_out} from ${coachFirst} in total)\n` : '';
  const me = coachFirst.toUpperCase();
  const lines = tail.map((m) => `[${day(m.sent_at)}] ${m.is_sender ? me : 'THEM'}: ${String(m.body || '').replace(/\s+/g, ' ').trim().slice(0, MESSAGE_CHARS) || '(no text - attachment or reaction)'}`);
  return `### ref ${refOf(person)}\nTheir headline: ${String(person.headline || '').slice(0, 120)}\nDays since last message: ${quiet}\n${head}${lines.join('\n')}`;
}

/** Who needs reading: never read, or the thread has changed; with rescore, also a changed profile. */
function pickTodo(candidates, scoresByKey, sig, { rescore = false } = {}) {
  const todo = []; let upToDate = 0; let staleProfile = 0;
  for (const p of candidates) {
    const s = scoresByKey.get(p.person_key);
    if (!s || s.thread_sig !== threadSig(p)) { todo.push(p); continue; }
    if (s.profile_sig !== sig) { staleProfile++; if (rescore) { todo.push(p); continue; } }
    upToDate++;
  }
  return { todo, upToDate, staleProfile };
}

function normaliseItem(it) {
  const warmth = Math.max(1, Math.min(5, Math.round(Number(it && it.warmth)) || 1));
  return {
    ending: ENDINGS.includes(it && it.ending) ? it.ending : 'other',
    warmth,
    why: String((it && it.why) || '').trim().slice(0, 300),
    pick_up_on: String((it && it.anchor) || '').trim().slice(0, 200),
  };
}

/** An even spread across the list, so a sample is not just the most recent people. */
function spread(list, n) {
  if (!n || n >= list.length) return list;
  const out = []; const step = list.length / n;
  for (let i = 0; i < n; i++) out.push(list[Math.floor(i * step)]);
  return out;
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One request for up to BATCH threads. Returns { byKey: Map(person_key -> score), usage }. */
async function scoreBatch(llm, system, people, messagesByKey, coachFirst, nowMs) {
  const body = people.map((p) => transcript(p, messagesByKey.get(p.person_key) || [], coachFirst, nowMs)).join('\n\n');
  const keyByRef = new Map(people.map((p) => [refOf(p), p.person_key]));
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await llm.messages.create({
        model: MODEL_ID, max_tokens: 8000, system,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: body }],
      });
    } catch (e) {
      const status = e && e.status;
      if (status === 429 || status >= 500) { await sleep(5000 * (attempt + 1)); continue; }
      throw e;
    }
    if (res.stop_reason === 'refusal') return { byKey: new Map(), usage: res.usage, refused: true };
    const text = ((res.content || []).find((b) => b.type === 'text') || {}).text;
    let parsed = null; try { parsed = JSON.parse(text); } catch (_) { /* retry */ }
    if (!parsed || !Array.isArray(parsed.items)) continue;
    const byKey = new Map();
    for (const it of parsed.items) { const k = keyByRef.get(it && it.ref); if (k) byKey.set(k, normaliseItem(it)); }
    return { byKey, usage: res.usage };
  }
  return { byKey: new Map(), usage: null };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let pool;
function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return pool;
}
/** Test seam. */
function _setPool(fake) { pool = fake; }

async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS linkedin_conversation_scores (
      tenant_id   TEXT NOT NULL,
      person_key  TEXT NOT NULL,
      ending      TEXT NOT NULL,
      warmth      INTEGER NOT NULL,
      why         TEXT NOT NULL DEFAULT '',
      pick_up_on  TEXT NOT NULL DEFAULT '',
      thread_sig  TEXT NOT NULL,             -- the thread as it was when read
      profile_sig TEXT NOT NULL,             -- the paragraph + guidance + prompt it was read with
      model       TEXT,
      scored_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, person_key)
    );
  `);
}

async function loadCandidates(db, tenantId, nowMs) {
  const cutoff = new Date(nowMs - QUIET_DAYS * MS_DAY).toISOString();
  const r = await db.query(
    `SELECT person_key, member_id, sales_nav_id, name, headline, msgs_in, msgs_out, last_msg_at
     FROM linkedin_people
     WHERE tenant_id = $1 AND is_connection AND msgs_in > 0 AND last_msg_at <= $2::timestamptz
     ORDER BY last_msg_at DESC, person_key`,
    [tenantId, cutoff]
  );
  return r.rows;
}

async function loadMessages(db, tenantId, people) {
  const keyById = new Map();
  for (const p of people) for (const id of [p.member_id, p.sales_nav_id, p.person_key]) if (id) keyById.set(id, p.person_key);
  const byKey = new Map();
  if (!keyById.size) return byKey;
  const r = await db.query(
    'SELECT attendee_id, sent_at, is_sender, body FROM linkedin_messages WHERE tenant_id = $1 AND attendee_id = ANY($2)',
    [tenantId, [...keyById.keys()]]
  );
  for (const m of r.rows) {
    const k = keyById.get(m.attendee_id);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(m);
  }
  return byKey;
}

async function saveScores(db, tenantId, rows) {
  if (!rows.length) return;
  await db.query(
    `INSERT INTO linkedin_conversation_scores (tenant_id, person_key, ending, warmth, why, pick_up_on, thread_sig, profile_sig, model, scored_at)
     SELECT $1, x.person_key, x.ending, x.warmth, x.why, x.pick_up_on, x.thread_sig, x.profile_sig, $3, now()
     FROM jsonb_to_recordset($2::jsonb) AS x(person_key text, ending text, warmth integer, why text, pick_up_on text, thread_sig text, profile_sig text)
     ON CONFLICT (tenant_id, person_key) DO UPDATE SET ending = EXCLUDED.ending, warmth = EXCLUDED.warmth, why = EXCLUDED.why,
       pick_up_on = EXCLUDED.pick_up_on, thread_sig = EXCLUDED.thread_sig, profile_sig = EXCLUDED.profile_sig,
       model = EXCLUDED.model, scored_at = EXCLUDED.scored_at`,
    [tenantId, JSON.stringify(rows), MODEL_ID]
  );
}

/**
 * The client's paragraph and the reading guidance. `who` passed by the caller wins (that is how a
 * draft paragraph is tried on a sample before it is saved). THE SEAM: when the instructions store
 * carries these, read them here - nothing else in this file changes.
 */
async function loadProfile(tenantId, { who } = {}) {
  return { who: String(who || '').trim(), guidance: DEFAULT_GUIDANCE };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {string} tenantId
 * @param {object} opts
 *   who      the client's paragraph (until the instructions store holds it)
 *   dryRun   count who would be read and estimate the cost; read nothing
 *   sample   read an even spread of N people and RETURN the results without storing them
 *   limit    read at most N (stored)
 *   rescore  also re-read threads whose paragraph/guidance has changed since they were read
 */
async function scoreConversations(tenantId, { who, dryRun = false, sample = 0, limit = 0, rescore = false, nowMs = Date.now() } = {}) {
  const logger = createLogger({ runId: 'CONV-SCORE', clientId: tenantId, operation: 'conversation_score' });
  const clientService = require('./clientService');
  const { resolveClientAnthropic } = require('../config/anthropicClient');
  const client = await clientService.getClientById(tenantId);
  if (!client) return { ok: false, error: `no client ${tenantId}` };

  const profile = await loadProfile(tenantId, { who });
  if (!profile.who) return { ok: false, error: `${tenantId} has no "who I'm looking for" paragraph yet` };
  const sig = profileSig(profile);

  const db = getPool();
  if (!db) return { ok: false, error: 'DATABASE_URL not configured' };
  await ensureSchema(db);
  const candidates = await loadCandidates(db, tenantId, nowMs);
  const existing = await db.query('SELECT person_key, thread_sig, profile_sig FROM linkedin_conversation_scores WHERE tenant_id = $1', [tenantId]);
  const scoresByKey = new Map(existing.rows.map((r) => [r.person_key, r]));

  const picked = pickTodo(candidates, scoresByKey, sig, { rescore });
  let todo = sample ? spread(candidates, sample) : picked.todo;
  if (!sample && limit) todo = todo.slice(0, limit);
  const result = { ok: true, candidates: candidates.length, upToDate: picked.upToDate, staleProfile: picked.staleProfile, toRead: todo.length };
  if (dryRun) {
    // ~1,100 tokens in and ~75 out per thread on the 4 Oct prototype run.
    result.dryRun = true;
    result.estimateUsd = Number(((todo.length * (1100 * PRICE_IN + 75 * PRICE_OUT)) / 1e6).toFixed(2));
    return result;
  }

  // Billing gate before any read: a client with no key of their own is never run on the platform's.
  const lane = resolveClientAnthropic(client);
  if (!lane.llm) return { ok: false, blocked: true, error: lane.message };
  result.lane = lane.lane;

  const coachFirst = String(client.clientFirstName || client.clientName || 'the client').trim().split(/\s+/)[0];
  const system = buildSystem({ coachName: client.clientName || coachFirst, who: profile.who, guidance: profile.guidance });
  const messagesByKey = await loadMessages(db, tenantId, todo);

  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  let next = 0; let read = 0; let tokensIn = 0; let tokensOut = 0; let refused = 0;
  const sampled = [];
  async function worker() {
    while (next < batches.length) {
      const people = batches[next++];
      const { byKey, usage, refused: wasRefused } = await scoreBatch(lane.llm, system, people, messagesByKey, coachFirst, nowMs);
      if (wasRefused) refused++;
      if (usage) { tokensIn += usage.input_tokens || 0; tokensOut += usage.output_tokens || 0; }
      const rows = [];
      for (const p of people) {
        const s = byKey.get(p.person_key);
        if (!s) continue;
        read++;
        if (sample) sampled.push({ name: p.name, headline: p.headline, quietDays: Math.floor((nowMs - new Date(p.last_msg_at).getTime()) / MS_DAY), ...s });
        else rows.push({ person_key: p.person_key, ...s, thread_sig: threadSig(p), profile_sig: sig });
      }
      if (rows.length) await saveScores(db, tenantId, rows);
      if (next % 20 === 0) logger.info(`${next}/${batches.length} batches, ${read} read`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(WORKERS, batches.length) }, worker));

  Object.assign(result, {
    read, missed: todo.length - read, refusedBatches: refused,
    costUsd: Number(((tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1e6).toFixed(2)),
  });
  if (sample) { result.sample = true; result.results = sampled.sort((a, b) => b.warmth - a.warmth); }
  logger.info(`read ${read} of ${todo.length}${sample ? ' (sample, not stored)' : ''}, about US$${result.costUsd}`);
  return result;
}

module.exports = {
  scoreConversations, buildSystem, profileSig, threadSig, transcript, pickTodo, normaliseItem, spread,
  scoreBatch, loadProfile, ensureSchema, _setPool, ENDINGS, DEFAULT_GUIDANCE, QUIET_DAYS,
};
