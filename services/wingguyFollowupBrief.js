/**
 * wingguyFollowupBrief — the PREPARED follow-up brief (overnight / on-demand pre-computation).
 *
 * Why this exists (Guy, 2026-07-23): the live sweep + read-threads-while-you-wait pattern made every
 * question a 2-minute spinner — unusable as a daily assistant. So ALL the work happens BEFORE the
 * human asks: this module runs the sweep, READS what each surfaced person actually said, triages them
 * (drop / park / draft / clear / attention — every verdict a RECOMMENDATION, nothing automatic,
 * Guy 2026-08-29), writes the recommendation + memory-jog lines, pre-writes real Gmail reply
 * drafts, and stores the finished brief in Postgres. The chat then serves it INSTANTLY via
 * wingguy_followup_brief, and rebuilds happen in the background via wingguy_prepare_brief or the
 * overnight cron (scripts/prepare-followup-brief.js).
 *
 * House style: recallWebhookDb.js / wingguyRulesStore.js (lazy Pool, ensureSchema
 * CREATE-IF-NOT-EXISTS, no migrations). Multi-tenant by parameter, never hardcoded.
 */

require('dotenv').config();
const { Pool } = require('pg');

// INCREMENTAL since 2026-08-24 (Guy: "why wouldn't we build the entire thing overnight?"): EVERY
// surfaced person gets the full story+draft treatment, not just a top slice. The old TOP_N=15 cap
// existed because each night rebuilt everything from scratch; now each person's finished entry is
// KEPT and reused night after night, and only new/changed people are re-prepped — so the full list
// costs one big first night, then pennies. The reuse test is deterministic (entrySig below): same
// tier + same last-message dates + same reconnect stamp = nothing happened = the story still holds.
// CRITICAL INVARIANT: who APPEARS is the sweep's decision alone — prep only decorates. A person
// whose prep fails still ships as an entry (story-less, marked), never silently dropped.
const TRIAGE_BATCH = 15;          // people per triage LLM call (the proven old TOP_N group size)
const REFRESH_DAYS = 60;          // a kept story older than this re-preps anyway — "unchanged" for two
                                  // months still means the draft's framing has aged (October launch in March)
const MAX_DRAFTS_PER_RUN = 40;    // cap on pre-written email drafts per run (the slow+costly step).
                                  // Overflow entries ship with story + draftPending and fill in on the
                                  // next run — capped work is LOGGED, never silent.
const THREAD_MSGS = 6;            // recent messages pulled per person for triage context
const STALE_HOURS = 26;           // a brief older than this is flagged stale when served
const MODEL_ID = process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-5';
// Sonnet 5 THINKS BY DEFAULT — with a modest max_tokens the whole budget goes to thinking and the
// text comes back empty ("triage returned no JSON array", proven live 2026-07-23). Same seam as
// wingguyChat's CHAT_THINKING: disable it — these are structured extract/draft calls, not deep
// reasoning. Harmless on models without default thinking.
const NO_THINKING = { type: 'disabled' };

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

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_followup_brief (
      tenant_id   TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT 'ready',   -- 'preparing' | 'ready' | 'error'
      prepared_at TIMESTAMPTZ,
      started_at  TIMESTAMPTZ,
      error       TEXT,
      payload     JSONB
    );
  `);
}

async function getBrief(tenantId) {
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query('SELECT * FROM wingguy_followup_brief WHERE tenant_id = $1', [tenantId]);
    return r.rows[0] || null;
  } finally { client.release(); }
}

async function setStatus(tenantId, fields) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set — the prepared brief needs Postgres');
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `INSERT INTO wingguy_followup_brief (tenant_id, status, prepared_at, started_at, error, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id) DO UPDATE SET
         status = EXCLUDED.status,
         prepared_at = COALESCE(EXCLUDED.prepared_at, wingguy_followup_brief.prepared_at),
         started_at = COALESCE(EXCLUDED.started_at, wingguy_followup_brief.started_at),
         error = EXCLUDED.error,
         payload = COALESCE(EXCLUDED.payload, wingguy_followup_brief.payload)`,
      [tenantId, fields.status, fields.preparedAt || null, fields.startedAt || null, fields.error || null,
       fields.payload ? JSON.stringify(fields.payload) : null],
    );
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// Context gathering — what did this person actually say?
// ---------------------------------------------------------------------------

/** Last N lines of the LinkedIn conversation block in a lead's Notes, oldest-first. */
function linkedInTail(notes, n = THREAD_MSGS) {
  const m = String(notes || '').split(/===\s*LINKEDIN MESSAGES\s*===/i)[1];
  if (!m) return [];
  // Lines look like "DD-MM-YY H:MM AM - Sender Name - text", newest first in the Notes.
  const lines = m.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d{2}-\d{2}-\d{2}\s/.test(l));
  return lines.slice(0, n).reverse();
}

/**
 * Build the triage context for one surfaced person: recent 1:1 email exchange (via findMessages)
 * and/or the LinkedIn tail. Also captures the newest inbound email (id + subject) for threading a
 * reply draft. Failures degrade to whatever is available — never throw.
 */
async function gatherPersonContext(mailProvider, coach, item, tenant) {
  const out = { transcript: [], lastInbound: null, channel: null, callOutcome: [] };
  const email = (item.lead.email || '').toLowerCase();
  if (email) {
    try {
      const found = await mailProvider.findMessages(coach, { anyEmail: email, limit: THREAD_MSGS });
      if (found.ok && (found.messages || []).length) {
        const msgs = found.messages.slice().sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
        for (const m of msgs) {
          const theirs = (m.fromEmail || '').toLowerCase() === email;
          out.transcript.push(`${(m.date || '').slice(0, 10)} ${theirs ? 'THEM' : 'YOU'}: [${m.subject || ''}] ${String(m.snippet || '').slice(0, 300)}`);
          if (theirs) out.lastInbound = { id: m.id, subject: m.subject || '', date: m.date };
        }
        out.channel = 'email';
      }
    } catch (_) { /* fall through to LinkedIn */ }
  }
  const li = linkedInTail(item.lead.notes);
  if (li.length) {
    // Mark the slice: an unmarked cut reads as the sender stopping mid-thought.
    out.transcript.push(...li.map((l) => `LINKEDIN: ${l.length > 300 ? `${l.slice(0, 300)} …[record clipped]` : l}`));
    if (!out.channel) out.channel = 'linkedin';
  }
  // CALL-AWARE TRIAGE (Guy 2026-08-29, the Nea Dhillon morning): when this person has a stored
  // dossier, its call recaps, standing, promises and sent-email record ride into triage as GROUND
  // TRUTH. Without this, the verdict for someone the coach has MET is derived from the clipped
  // message shadow of a call the deep read already understood — Nea's row claimed her email
  // "appears cut off" (it was our 300-char clip) and proposed a follow-up the transcript had
  // already resolved ("not now, 6-8 months") with an email the mailbox showed already sent.
  // Best-effort: no dossier (outside the deep-read slice) means triage reads the messages alone.
  if (tenant) {
    try {
      const dossier = require('./wingguyDossier');
      const fullName = `${item.lead.first} ${item.lead.last}`.trim();
      const row = (await dossier.getDossierRow(tenant, item.key))
        || (fullName ? await dossier.findDossierByName(tenant, fullName) : null);
      const p = row && row.payload ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) : null;
      if (p) {
        const lines = [];
        for (const r of (Array.isArray(p.meetingRecaps) ? p.meetingRecaps : []).slice(0, 2)) {
          lines.push(`CALL ${r.date || '?'} — what it was for: ${String(r.about || '(not recorded)').slice(0, 300)} HOW IT WAS LEFT: ${String(r.ended || '(not recorded)').slice(0, 400)}`);
        }
        if (p.standing) lines.push(`WHERE IT STANDS: ${String(p.standing).slice(0, 600)}`);
        const you = Array.isArray(p.commitmentsYou) ? p.commitmentsYou : [];
        const them = Array.isArray(p.commitmentsThem) ? p.commitmentsThem : [];
        if (you.length) lines.push(`COACH PROMISED: ${you.join(' · ').slice(0, 400)}`);
        if (them.length) lines.push(`THEY PROMISED: ${them.join(' · ').slice(0, 400)}`);
        const sent = p.emailRecord && Array.isArray(p.emailRecord.outbound) ? p.emailRecord.outbound : [];
        if (sent.length) {
          lines.push(`EMAILS THE COACH ALREADY SENT THEM (from the mailbox itself): ${sent.slice(0, 5).map((o) => `${o.date} "${o.subject}"${Array.isArray(o.links) && o.links.length ? ` [${o.links.length} link${o.links.length === 1 ? '' : 's'} in the body]` : ''}`).join(' · ')}`);
        }
        // The last outbound IN ITS OWN WORDS: the index above proved insufficient on the first
        // live rerun (Nea, 29 Aug) — the triage saw "Great to catch up today, Nea" in the sent
        // list yet still declared the promised model-detail email owed, because a subject line
        // can't show that the body WAS the promised material. The text can.
        const lo = p.emailRecord && p.emailRecord.lastOutbound;
        if (lo && lo.text) {
          lines.push(`THE COACH'S LAST EMAIL TO THEM (${lo.date} "${lo.subject}") — read this before calling any send-material promise unfulfilled: ${String(lo.text).slice(0, 700)}`);
        }
        out.callOutcome = lines;
      }
    } catch (_) { /* dossier store down — triage works from the messages alone */ }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Triage — one LLM call over the whole top group
// ---------------------------------------------------------------------------

// Loose parse lives in wingguyDossier (parseJsonArrayLoose): handles bare object streams and raw
// control chars — both observed live killing triage runs on 2026-07-24.
function parseJson(text) {
  return require('./wingguyDossier').parseJsonArrayLoose(text);
}

const TRIAGE_SYSTEM = `You triage a coach's follow-up queue. For each person you get the engine's mechanical signal (tier/why), what was ACTUALLY said recently (email snippets and/or LinkedIn lines, oldest first; THEM = the person, YOU = the coach), and — for people the coach has met — a CALL OUTCOME + SENT RECORD block from the call-transcript store and the mailbox. Read the words — the mechanical signal is often wrong about what is owed.

GROUND TRUTH ORDER: the CALL OUTCOME + SENT RECORD block, when present, OUTRANKS the message snippets. A decision about someone the coach has MET flows from what was said on the call, not from the email shadow around it. And check the SENT record before declaring anything owed: a promise the record shows already delivered is DONE — never re-propose it. In particular, a coach's wrap email sent on or after the call day usually IS the promised "more detail" — read the last email's text (given below the sent list) before declaring any send-material promise outstanding; if that email covers the promised ground, the promise is fulfilled and the ball is with the other person.

CLIPPED RECORDS: snippets are cut at a fixed length, and LinkedIn lines may end with "…[record clipped]". A cut means OUR COPY of the record stops there — NEVER that the sender stopped mid-sentence, trailed off, or that a message "appears cut off". Never build a verdict on where a clipped line ends.

THE COACH'S DOCTRINE — their time is the scarce resource, and a drop costs almost nothing (dropping only stops the chasing; if the person ever writes again they surface immediately). So:
- "drop": the DEFAULT for a resolved "not now". Recommend drop when they love it but show no financial ability or buying signal; when they are building their own product first and are months from needing anything; when they gave a clean "not right now" with nothing concrete booked; or when the enthusiasm is one-sided. Warmth alone is never a reason to keep chasing — let them come back.
- "park": ONLY for a dated, two-sided reason to return — they named a real time ("September sounds good", "after the audit", "next quarter") or a concrete event, and returning then serves both sides. Give park_date (ISO YYYY-MM-DD, resolved against today's date, leaning a few days LATER than the literal phrase so the nudge never lands early). A vague "someday / when things settle" is a drop, not a park.
- "draft": a real reply is owed — they asked something, offered something, or left a live thread with the coach clearly to answer. ALSO: if their last message DELIVERS something they promised (a list, an intro, a document, information the coach asked for), that deserves a short warm acknowledgment — verdict "draft", never "clear" (the coach's standing preference: a delivered promise is always acknowledged). Give draft_instruction: 1-2 sentences on what the reply should do (ground it ONLY in what was said — never invent facts).
- "clear": nothing is owed — their last message was a pleasantry/close ("thanks, see you Thursday", "no worries"), or the exchange is plainly finished.
- "attention": something is owed but a canned reply would be wrong (complex/sensitive/ambiguous) — the coach should look personally. Say why in the why_line.

For EVERY person also give:
- recommendation: ONE sentence of direct advice in the coach's ear, first person, verdict first with the reason from the record ("I'd drop her — loved the model but she's product-first and months from budget; let her come back to you", "I'd park him to mid-October — he asked you to try again after the audit"). This is the headline the coach reads; it must stand alone. Every verdict here is a RECOMMENDATION the coach clicks — nothing happens automatically, so say it as advice, never as a done deed.
- why_line: ONE short factual line — plain, specific, human ("she said September sounds good", "asked which podcast episode you meant"). Not a category label.
- jog: 1-2 sentences of memory-jog — who this is and where things stand, from the record only. For someone the coach has MET, open with the call and its outcome ("Call 13 Aug went well, but…") — the call is the part they cannot remember.

Return ONLY a JSON array, one object per person, same order as given:
[{"key": "<the person's key exactly as given>", "verdict": "drop|park|draft|clear|attention", "recommendation": "...", "why_line": "...", "jog": "...", "park_date": "YYYY-MM-DD or null", "draft_instruction": "... or null"}]`;

async function triage(client, items, contexts, todayIso) {
  const people = items.map((item, i) => {
    const name = `${item.lead.first} ${item.lead.last}`.trim() || item.lead.email || `#${i}`;
    return [
      `KEY: ${item.key}`,
      `NAME: ${name}`,
      `ENGINE SIGNAL: ${item.tier} — ${item.why}${item.gated ? ' (flagged Cease/Series but surfaced: real obligation)' : ''}`,
      `RECENT EXCHANGE:`,
      ...(contexts[i].transcript.length ? contexts[i].transcript : ['(no readable messages found)']),
      ...((contexts[i].callOutcome || []).length
        ? ['CALL OUTCOME + SENT RECORD (ground truth — outranks the snippets above):', ...contexts[i].callOutcome]
        : []),
    ].join('\n');
  }).join('\n\n---\n\n');
  // Two attempts: the model occasionally malforms its own JSON (bare object stream, unescaped
  // quotes) — retry once with a strict instruction rather than failing the whole preparation.
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: MODEL_ID,
      // 4000 -> 6000 (2026-08-29): the recommendation field adds a sentence per person; a
      // truncated response is not a shorter triage, it is INVALID JSON for the whole batch.
      max_tokens: 6000,
      thinking: NO_THINKING,
      system: TRIAGE_SYSTEM + (attempt ? '\nSTRICT: your previous output was not a valid JSON array. Return ONE array [ ... ] containing all objects, comma-separated, with every inner double-quote escaped and no raw newlines inside strings.' : ''),
      messages: [{ role: 'user', content: require('./wingguyDossier').scrub(`Today is ${todayIso}.\n\n${people}`) }],
    });
    const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    try { return parseJson(text); } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Drafting — real Gmail drafts for the "draft" pile
// ---------------------------------------------------------------------------

const DRAFT_SYSTEM_PREFIX = `You write a short reply email in the coach's own voice, following the coach's RULEBOOK below. Ground every fact in the supplied exchange — never invent. Keep it brief and human. Return ONLY the email body as simple HTML (<p> paragraphs, <a href> for any links) — no subject, no commentary.
HARD RULE — NO SPECIFIC MEETING TIMES: you are drafting offline with no access to the coach's calendar, so NEVER offer concrete days/dates/times ("Tuesday 10am", "Thursday next week"). Propose the meeting and either ask what suits them or say the coach will follow with times. Concrete slots come later from a live calendar check with the lead's timezone handled.`;

// A clock time in a draft = an offered slot. The HARD RULE above already bans offered times, but
// an instruction alone loses to the model's generation default (the em-dash lesson) — proven live
// 2026-08-01 when a brief draft re-offered June dates in August (Farhad Malegam). Clock times
// (digits + am/pm) are the enforcement signal: past references read "back in June", offers read
// "Tue, 16 June, 10:00 am". One strict retry, then the draft is withheld rather than served wrong.
const CLOCK_TIME_RE = /\b\d{1,2}([:.]\d{2})?\s?(am|pm)\b/i;

// /wg-style spacing for the paste-ready text: a BLANK line between paragraphs, exactly as the
// panel's drafts read. htmlToText keeps line breaks but renders a </p> as a single one; doubling
// the paragraph boundary first gives the blank line (its own 3+-newline collapse keeps it tidy).
// This replaced a whitespace-collapse that flattened every draft to one blob (Guy, 2026-08-01).
function draftPlainText(html) {
  const { htmlToText } = require('./wingguyMailMcp');
  return htmlToText(String(html || '').replace(/<\/p>/gi, '</p>\n'));
}

async function writeDraft(client, rulesText, item, context, instruction, tz) {
  const name = `${item.lead.first} ${item.lead.last}`.trim();
  // Day-of-week anchor (coach's clock): overnight drafts are written blind at ~5:30am, so any
  // day-keyed voice rule (e.g. the foundation weekend sign-off) needs the day stated in-prompt.
  const today = new Date().toLocaleDateString('en-AU', { timeZone: tz || 'Australia/Brisbane', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  for (let attempt = 0; attempt < 2; attempt++) {
    // The strict retry note rides the USER message, not the system blocks — the rulebook block's
    // cache prefix (below) stays byte-identical either way, so a retry never busts the cache.
    const strict = attempt
      ? '\nSTRICT: your previous draft offered specific meeting times. You have NO calendar access — remove every concrete day/date/clock time; ask what suits them or say the coach will follow with times.'
      : '';
    // The rulebook block (~25k tokens) is identical across every draft call in a run — cache it.
    // 5-min TTL covers a sequential preparation pass: the first draft writes the cache (1.25x),
    // the rest read at ~0.1x. This was the dominant cost term of the nightly run (Guy, 2026-07-24).
    const response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 1200,
      thinking: NO_THINKING,
      system: [
        { type: 'text', text: DRAFT_SYSTEM_PREFIX },
        { type: 'text', text: `THE COACH'S RULEBOOK:\n\n${rulesText}`, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{
        role: 'user',
        content: require('./wingguyDossier').scrub(`Reply to ${name}.\nToday is ${today} (the coach's local day — apply any day-of-week rules from the rulebook against THIS, e.g. weekend sign-offs).\nWhat the reply should do: ${instruction}${strict}\n\nThe recent exchange (oldest first):\n${context.transcript.join('\n')}`),
      }],
    });
    const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!CLOCK_TIME_RE.test(text)) return text;
  }
  throw new Error('the model kept writing specific meeting times into this draft (it has no calendar overnight) — withheld. Open the thread and use /wg for a live-calendar times message.');
}

// ---------------------------------------------------------------------------
// Incremental reuse — deterministic "did anything happen for this person?"
// ---------------------------------------------------------------------------

/**
 * Fingerprint of everything a person's stored story depends on. Same sig = no message either way,
 * same tier, same reconnect stamp = the story and draft are still true. Dates, not judgement.
 * The leading version bumps to force a one-time global re-prep after a format change.
 */
function entrySig(item) {
  const s = item.signals || {};
  // s2 (2026-08-29): one-time global re-prep so every stored entry gains the recommendation-first,
  // drop-biased, call-aware triage (Guy's go, same day). Subsequent nights are cheap again.
  return `s2|${item.tier}|${s.lastInboundMs || 0}|${s.lastOutboundMs || 0}|${item.lead.reconnectOn || ''}`;
}

/**
 * TRUE if a previous entry can be served again untouched. Pure — unit-tested.
 * Not reusable when: no previous entry / signature changed (something happened) / older than
 * REFRESH_DAYS (framing ages even when nothing happened) / its draft failed or was deferred
 * (both deserve another attempt while the draft budget allows).
 */
function canReuseEntry(prev, sig, nowMs) {
  if (!prev || prev.sig !== sig) return false;
  if (!prev.builtAt || (nowMs - Date.parse(prev.builtAt)) > REFRESH_DAYS * 86400000) return false;
  if (prev.draftError || prev.draftPending) return false;
  return true;
}

/** Carry a reused entry forward: expensive fields kept, mechanical fields refreshed (days tick daily). */
function refreshEntry(prev, item) {
  return {
    ...prev,
    name: `${item.lead.first} ${item.lead.last}`.trim() || item.lead.email || prev.name,
    email: item.lead.email || prev.email,
    linkedin: item.lead.linkedinUrl || prev.linkedin,
    tier: item.tier,
    engineWhy: item.why,
    gated: !!item.gated,
  };
}

// ---------------------------------------------------------------------------
// The preparer
// ---------------------------------------------------------------------------

/**
 * Prepare the full brief for one tenant: sweep → read → triage → draft → store.
 * Long-running (~1-3 min) — call from the cron script or fire-and-forget from the tool.
 */
async function prepareFollowupBrief(tenant) {
  const startedAt = new Date().toISOString();
  await setStatus(tenant, { status: 'preparing', startedAt });
  try {
    const { computeFollowupSweep } = require('./wingguyMailMcp');
    const mailProvider = require('./mailProvider');
    const { resolveClientAnthropic } = require('../config/anthropicClient');
    const clientService = require('./clientService');
    const rulesStore = require('./wingguyRulesStore');

    // BILLING GATE, before any work at all (Guy 2026-08-15). A client with no key of their own is
    // never run on the platform key — and never has their mailbox read for a brief they won't get,
    // so a client switched on before their key exists costs nothing rather than costing Guy quietly.
    // The stored status is what the human sees: wingguy_followup_brief serves `row.error` when
    // there's no payload, so asking for the brief answers "your key isn't set up yet".
    const coachRecord = await clientService.getClientById(tenant);
    const lane = resolveClientAnthropic(coachRecord);
    console.log(`[followupBrief] anthropic lane=${lane.lane} tenant=${tenant}`);
    if (!lane.llm) {
      await setStatus(tenant, { status: 'error', startedAt, error: lane.message });
      return { ok: false, blocked: true, reason: lane.message };
    }

    const sweep = await computeFollowupSweep({}, tenant);
    if (!sweep.ok) throw new Error(sweep.error);

    // EVERY surfaced person, in the sweep's rank order (see the incremental block at the top).
    const all = sweep.surfaced.map((s, i) => ({
      ...s,
      key: (s.lead.email || `${s.lead.first} ${s.lead.last}`.trim() || `row${i}`).toLowerCase(),
    }));

    // Split into reuse (stored story still true) vs prep (new person, or something happened).
    // The previous payload IS the cache — no second store to drift out of step.
    const prevByKey = new Map();
    try {
      const prevRow = await getBrief(tenant);
      const prev = prevRow && prevRow.payload ? (typeof prevRow.payload === 'string' ? JSON.parse(prevRow.payload) : prevRow.payload) : null;
      for (const it of ((prev && prev.items) || [])) prevByKey.set(it.recId || (it.email || it.name || '').toLowerCase(), it);
    } catch (e) { console.warn(`[followupBrief] previous payload unreadable (full re-prep): ${e.message}`); }

    const nowMs = Date.now();
    const entryByKey = new Map();  // key -> finished entry (reused or freshly prepped)
    const toPrep = [];
    for (const item of all) {
      const sig = entrySig(item);
      const prev = prevByKey.get(item.lead.recId || item.key);
      if (canReuseEntry(prev, sig, nowMs)) entryByKey.set(item.key, refreshEntry(prev, item));
      else toPrep.push({ item, sig });
    }
    console.log(`[followupBrief] ${tenant}: ${all.length} surfaced — ${entryByKey.size} reused, ${toPrep.length} to prep`);

    // Read what each to-prep person actually said (sequential quick provider calls).
    const contexts = [];
    for (const { item } of toPrep) contexts.push(await gatherPersonContext(mailProvider, sweep.coach, item, tenant));

    // Triage in batches (a first full run can be ~100+ people — far past one call's output budget).
    // A failed batch degrades those people to engine-signal entries, never fails the whole run.
    const llm = lane.llm;
    const todayIso = new Date().toISOString().slice(0, 10);
    const byKey = new Map();
    for (let i = 0; i < toPrep.length; i += TRIAGE_BATCH) {
      const batchItems = toPrep.slice(i, i + TRIAGE_BATCH).map((t) => t.item);
      const batchCtx = contexts.slice(i, i + TRIAGE_BATCH);
      try {
        const verdicts = await triage(llm, batchItems, batchCtx, todayIso);
        for (const v of verdicts) byKey.set(String(v.key || '').toLowerCase(), v);
        console.log(`[followupBrief] triaged ${Math.min(i + TRIAGE_BATCH, toPrep.length)}/${toPrep.length}`);
      } catch (e) { console.warn(`[followupBrief] triage batch at ${i} failed (engine-signal fallback for those people): ${e.message}`); }
    }

    // Voice rules rendered ONCE for all drafts.
    let rulesText = '';
    try {
      const r = await rulesStore.renderRulesBlock({ tenantId: tenant, contexts: ['reply', 'follow-up'] });
      rulesText = r.text || '';
    } catch (e) { console.warn(`[followupBrief] rules render failed (drafting with plain voice): ${e.message}`); }

    // Build fresh entries; pre-write Gmail drafts for the "draft" pile (email-reachable people
    // only), up to the per-run cap — overflow ships story-first with draftPending.
    let draftsWritten = 0;
    let draftsDeferred = 0;
    for (let i = 0; i < toPrep.length; i++) {
      const { item, sig } = toPrep[i];
      const ctx = contexts[i];
      const v = byKey.get(item.key) || {};
      const name = `${item.lead.first} ${item.lead.last}`.trim() || item.lead.email || '(no name)';
      const entry = {
        sig,
        builtAt: new Date().toISOString(),
        draftPending: false,
        name,
        recId: item.lead.recId || null,
        email: item.lead.email || null,
        linkedin: item.lead.linkedinUrl || null,
        tier: item.tier,
        engineWhy: item.why,
        gated: !!item.gated,
        channel: ctx.channel,
        verdict: v.verdict || 'attention',
        recommendation: v.recommendation || null, // the advice headline ("I'd drop her — …"); screen + chat lead with it
        whyLine: v.why_line || item.why,
        jog: v.jog || '',
        parkDate: v.park_date || null,
        parked: false,     // NEVER set any more (2026-08-29, nothing automatic) — kept so old renderers stay honest
        parkError: null,
        draftHtml: null,
        draftText: null,
        draftError: null,
        wgAngle: null,
        replyToMessageId: null,
        pushSubject: null,
        threadSubject: (ctx.lastInbound && ctx.lastInbound.subject) || null,
      };
      // Drafts live IN THE BRIEF, not the mailbox (Guy 2026-07-23: "create the draft in the chat,
      // let me play with it, THEN push it to Gmail — that's my normal process"). The chat shows
      // draftText, the human tweaks, and on approval pushes via wingguy_create_draft using
      // replyToMessageId/subject stored here (threaded, asset-gated, same as any draft).
      if (entry.verdict === 'draft') {
        if (item.lead.email && ctx.lastInbound) {
          if (draftsWritten >= MAX_DRAFTS_PER_RUN) {
            // Budget spent: story ships tonight, draft fills in on the next run (draftPending
            // blocks reuse, so the person is re-prepped while budget exists). Logged — never silent.
            entry.draftPending = true;
            entry.draftInstruction = v.draft_instruction || null; // chat can draft live from this meanwhile
            draftsDeferred++;
          } else {
            try {
              const html = await writeDraft(llm, rulesText, item, ctx, v.draft_instruction || 'Reply appropriately to their last message.', sweep.coach.timezone);
              entry.draftHtml = html;
              // draftPlainText, NOT a whitespace-collapse: draftText is what the human reads (chat)
              // and pastes (the draft page renders it pre-wrap) — the paragraph breaks must survive,
              // exactly as the /wg panel keeps them (Guy, 2026-08-01, the Farhad one-blob draft).
              entry.draftText = draftPlainText(html);
              entry.replyToMessageId = ctx.lastInbound.id;
              entry.pushSubject = /^re:/i.test(entry.threadSubject || '') ? entry.threadSubject : `Re: ${entry.threadSubject || 'our conversation'}`;
              draftsWritten++;
            } catch (e) { entry.draftError = e.message; }
          }
        } else {
          // LinkedIn person: NO pre-written message, by design (Guy's call 2026-08-01, after the
          // Farhad invented-times draft). Pasting means opening the thread anyway, and /wg there
          // drafts from the LIVE thread + LIVE calendar — the one place times can't go stale. The
          // overnight homework survives as the ANGLE the /wg pass should take.
          entry.channel = 'linkedin';
          entry.wgAngle = String(v.draft_instruction || v.why_line || 'revive the thread naturally').trim();
        }
      }
      entryByKey.set(item.key, entry);
    }
    if (draftsDeferred) console.log(`[followupBrief] draft cap (${MAX_DRAFTS_PER_RUN}) reached — ${draftsDeferred} drafts deferred to the next run`);

    // Assemble in the SWEEP's rank order — every surfaced person ships, reused or fresh. The
    // invariant lives here: entryByKey covers all of `all` by construction (reuse or prep above),
    // and a triage/draft failure only degrades that person's entry, never removes it.
    const items = all.map((item) => entryByKey.get(item.key)).filter(Boolean);

    // NOTHING AUTOMATIC (Guy 2026-08-29, reversing the 2026-08-03 stamp-and-tell): every verdict
    // — park included — is a RECOMMENDATION the human clicks, never a write the system makes on
    // its own. The park verdict ships with its suggested date; the screen offers "Park to <date>"
    // as one click and the chat confirms via wingguy_set_reconnect. Payloads stamped under the old
    // rule (parked=true) still render as done deeds; nothing new is ever stamped here.

    const payload = {
      preparedAt: new Date().toISOString(),
      tenant,
      items,
      totalSurfaced: sweep.surfaced.length,
      counts: sweep.counts,
      windowDays: sweep.windowDays,
      prepped: toPrep.length,
      reused: Math.max(0, items.length - toPrep.length),
      draftsDeferred,
    };
    await setStatus(tenant, { status: 'ready', preparedAt: payload.preparedAt, payload, error: null });
    // Dossier pass rides every preparation (cache-aware — unchanged people are skipped, so after
    // the first run this is cheap). Non-fatal: the brief is already stored and served either way.
    try {
      const d = await require('./wingguyDossier').prepareDossiers(tenant);
      console.log(`[followupBrief] dossiers: ${JSON.stringify(d)}`);
    } catch (e) { console.warn(`[followupBrief] dossier pass failed (brief unaffected): ${e.message}`); }
    return { ok: true, items: items.length, prepped: toPrep.length, reused: payload.reused, draftsDeferred, totalSurfaced: sweep.surfaced.length };
  } catch (e) {
    // A rejected stored key (revoked, or over its spend cap) is a distinct, actionable cause — name
    // it so the stored error the chat serves AND the alert email say "fix your key", not a generic
    // failure. This overnight path is header-less, so the client's stored key is the only BYO lane;
    // a bad key means their brief simply won't run until they re-issue it (it is never silently run
    // on the platform key).
    const keyReason = require('../config/anthropicClient').anthropicKeyError(e);
    const storedError = keyReason
      ? `Anthropic key rejected (${keyReason}): this client's stored Anthropic key is ${keyReason === 'revoked' ? 'revoked or invalid' : 'over its spend limit / out of credit'}. Their brief will not run until the key is fixed in the Anthropic Console.`
      : e.message;
    console.error(`[followupBrief] prepare failed for ${tenant}: ${storedError}`);
    await setStatus(tenant, { status: 'error', error: storedError }).catch(() => {});
    // Loud failure (Guy's ask 2026-07-23): a silent overnight failure = a quietly stale morning
    // brief. Best-effort — the alert failing must never mask the original error.
    try {
      const { sendAlertEmail } = require('./emailNotificationService');
      const keyHint = keyReason
        ? `<p><b>Cause: rejected Anthropic key (${keyReason}).</b> ${tenant}'s stored Claude key is ${keyReason === 'revoked' ? 'revoked/invalid' : 'over its spend cap / out of credit'} — their brief stays stale until they update it in their Anthropic Console.</p>`
        : '';
      await sendAlertEmail(
        `Wingguy follow-up brief FAILED (${tenant})${keyReason ? ' — key rejected' : ''}`,
        `<p>The follow-up brief preparation for <b>${tenant}</b> failed at ${new Date().toISOString()}:</p>` +
        `<pre>${String(e.message).slice(0, 500)}</pre>` + keyHint +
        `<p>The chat will serve the previous brief (flagged stale). Rebuild any time: ask Wingguy to "refresh my follow-ups", or re-run the cron endpoint.</p>`,
      );
    } catch (mailErr) { console.error(`[followupBrief] failure alert email also failed: ${mailErr.message}`); }
    return { ok: false, error: storedError };
  }
}

// ---------------------------------------------------------------------------
// Presentation — the stored brief as instant text
// ---------------------------------------------------------------------------

function formatBrief(row) {
  if (!row || !row.payload) return null;
  const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  const ageH = p.preparedAt ? (Date.now() - new Date(p.preparedAt).getTime()) / 3600000 : 999;
  const piles = { drop: [], park: [], draft: [], clear: [], attention: [] };
  for (const it of (p.items || [])) (piles[it.verdict] || piles.attention).push(it);

  // Names render as markdown links to the lead's LinkedIn profile (Guy: "glance at their profile").
  const nm = (it) => (it.linkedin ? `[${it.name}](${it.linkedin})` : it.name);
  // Recommendation-first (Guy 2026-08-29): the advice headline leads every line when the triage
  // wrote one; the factual why_line is the fallback for pre-change payloads.
  const rec = (it) => (it.recommendation && String(it.recommendation).trim()) || it.whyLine;

  const lines = [];
  // Full-list era (2026-08-24): EVERY surfaced person is in the payload with a story — but the
  // CHAT render caps each pile, or a 140-person brief floods the conversation. The queue
  // (wingguy_queue) is the door that pages through everything ten at a time.
  const PILE_CAP = 10;
  lines.push(`Prepared ${p.preparedAt ? p.preparedAt.slice(0, 16).replace('T', ' ') : '?'} UTC${ageH > STALE_HOURS ? ' ⚠ STALE — offer a refresh (wingguy_prepare_brief)' : ''}. ${p.totalSurfaced} surfaced, ${ (p.items || []).length } with prepared stories. Keep the markdown name-links when relaying.`);
  if (piles.draft.length) {
    // Email people carry a pre-written draft; LinkedIn people carry a /wg ANGLE instead of a
    // message (Guy's call 2026-08-01) — the reply is drafted live in the thread, where the
    // conversation and the calendar are both current. Old stored payloads may still hold a
    // LinkedIn draftText; render it the legacy way until the next preparation replaces it.
    lines.push(`\nREPLIES OWED (${piles.draft.length}${piles.draft.length > PILE_CAP ? `, first ${PILE_CAP} here — the queue pages the rest` : ''}) — email people have drafts IN THE BRIEF (show → tweak in chat → on approval push to their mailbox with wingguy_create_draft, threaded via the reply id below; never push unasked). LinkedIn people get NO pre-written message by design — relay their /wg pointer + angle (they open the thread and type /wg; it drafts from the live conversation and calendar):`);
    for (const it of piles.draft.slice(0, PILE_CAP)) {
      const liTag = it.channel === 'linkedin' ? (it.draftText ? ' [LinkedIn — paste-ready]' : ' [LinkedIn — open the thread and type /wg]') : '';
      lines.push(`- ${nm(it)} — ${rec(it)}${liTag}${it.draftError ? ` [draft generation FAILED: ${it.draftError}]` : ''}${it.draftPending ? ' [draft arrives next overnight run — ask me to draft it now if wanted]' : ''}`);
      if (it.draftText) lines.push(`    draft: "${it.draftText}"`);
      else if (it.wgAngle) lines.push(`    /wg angle: ${it.wgAngle}`);
      if (it.email && it.replyToMessageId) lines.push(`    push with: to=${it.email}, subject="${it.pushSubject}", reply_to_message_id=${it.replyToMessageId}`);
      if (it.jog) lines.push(`    jog: ${it.jog}`);
    }
    if (piles.draft.length > PILE_CAP) lines.push(`  …and ${piles.draft.length - PILE_CAP} more with stories ready — work them via wingguy_queue (ten a page), or ask for anyone by name.`);
  }
  if (piles.drop.length) {
    // Drop-biased doctrine (Guy 2026-08-29): a resolved "not now" is a recommended DROP, not a
    // park — his time is the scarce resource, and a dropped person who writes again still
    // surfaces. RECOMMENDATION ONLY: nothing is ceased until the human says so.
    lines.push(`\nRECOMMENDED DROPS (${piles.drop.length}${piles.drop.length > PILE_CAP ? `, first ${PILE_CAP} here — the queue pages the rest` : ''}) — resolved "not now"s; dropping only stops the chasing (nothing is sent, and a new message from them still surfaces). Relay the recommendations; cease ONLY the names the human confirms (wingguy_cease_followups per name — never drop unconfirmed):`);
    for (const it of piles.drop.slice(0, PILE_CAP)) lines.push(`- ${nm(it)} — ${rec(it)}${it.jog ? `\n    jog: ${it.jog}` : ''}`);
    if (piles.drop.length > PILE_CAP) lines.push(`  …and ${piles.drop.length - PILE_CAP} more — via wingguy_queue, or ask by name.`);
  }
  if (piles.park.length) {
    // LEGACY PAYLOADS ONLY (auto-park retired 2026-08-29 — nothing automatic): under the old
    // 2026-08-03 stamp-and-tell rule, clear future dates were ALREADY stamped at preparation time
    // — report them once as a done deed with an un-park escape. Only unclear/passed/failed cases
    // still ask (pre-change stored payloads have no `parked` flag, so they render as asks — right,
    // since nothing was stamped for them).
    const stamped = piles.park.filter((it) => it.parked);
    const ask = piles.park.filter((it) => !it.parked);
    if (stamped.length) {
      lines.push(`\nPARKED FOR YOU (${stamped.length}) — they named a time, so the reconnect date is already stamped; each surfaces at the top of the queue on their day. Relay these once; say "un-park NAME" (wingguy_set_reconnect with no date) if a read is wrong:`);
      for (const it of stamped) lines.push(`- ${nm(it)} — ${it.whyLine} → parked till ${it.parkDate}${it.jog ? `\n    jog: ${it.jog}` : ''}`);
    }
    if (ask.length) {
      lines.push(`\nRECOMMENDED PARKS (${ask.length}) — a dated reason to come back; NOTHING is stamped until the human confirms (then wingguy_set_reconnect):`);
      for (const it of ask) {
        const passed = it.parkDate && it.parkDate <= new Date().toISOString().slice(0, 10);
        const tail = passed
          ? `their own window (${it.parkDate}) has PASSED — reach out now, natural opening`
          : `park until ${it.parkDate || '(date unclear — ask)'}`;
        lines.push(`- ${nm(it)} — ${rec(it)} → ${tail}${it.parkError ? ` [auto-park failed: ${it.parkError}]` : ''}${it.jog ? `\n    jog: ${it.jog}` : ''}`);
      }
    }
  }
  if (piles.attention.length) {
    lines.push(`\nNEEDS YOUR EYES (${piles.attention.length}${piles.attention.length > PILE_CAP ? `, first ${PILE_CAP} here — the queue pages the rest` : ''}):`);
    for (const it of piles.attention.slice(0, PILE_CAP)) lines.push(`- ${nm(it)} — ${rec(it)}${it.jog ? `\n    jog: ${it.jog}` : ''}`);
    if (piles.attention.length > PILE_CAP) lines.push(`  …and ${piles.attention.length - PILE_CAP} more — via wingguy_queue, or ask by name.`);
  }
  if (piles.clear.length) {
    // Guy (2026-07-24, after two live looks): the checked-and-clear line is noise he'll never read.
    // Moved into the do-not-relay tail — the trust function survives (Wingguy can answer "was Simon
    // checked?" instantly) but it costs zero screen space by default. Capped: names beyond 40 fold
    // into a count (the full list is in the payload for by-name questions).
    const clr = piles.clear.slice(0, 40).map((it) => `${it.name} (${it.whyLine})`).join(' · ');
    lines.push(`\n[checked & clear — do NOT relay unless asked: ${clr}${piles.clear.length > 40 ? ` · +${piles.clear.length - 40} more` : ''}]`);
  }
  const more = (p.totalSurfaced || 0) - (p.items || []).length;
  if (more > 0) lines.push(`\n(${more} more surfaced but not in the prepared top group — the live sweep has them.)`);
  if (p.draftsDeferred) lines.push(`\n(${p.draftsDeferred} pre-written drafts deferred to the next overnight run — their stories are ready now; ask me to draft any of them live.)`);
  // Pipeline footer (Guy 2026-07-23: a quiet brief must SHOW its queue, or calm reads as amnesia).
  const parked = p.counts && p.counts.parkedCount;
  if (parked) lines.push(`\nPIPELINE (relay this): ${parked} people are parked on reconnect dates and will surface on their day${p.counts.nextReconnect ? ` (next: ${p.counts.nextReconnect})` : ''}.`);
  return lines.join('\n');
}

module.exports = { prepareFollowupBrief, getBrief, setStatus, formatBrief, linkedInTail, gatherPersonContext, writeDraft, draftPlainText, entrySig, canReuseEntry, refreshEntry, _setPool, STALE_HOURS, REFRESH_DAYS };
