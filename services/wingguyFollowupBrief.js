/**
 * wingguyFollowupBrief — the PREPARED follow-up brief (overnight / on-demand pre-computation).
 *
 * Why this exists (Guy, 2026-07-23): the live sweep + read-threads-while-you-wait pattern made every
 * question a 2-minute spinner — unusable as a daily assistant. So ALL the work happens BEFORE the
 * human asks: this module runs the sweep, READS what each top person actually said, triages them
 * (park / draft / clear / attention), writes the memory-jog lines, pre-writes real Gmail reply
 * drafts, and stores the finished brief in Postgres. The chat then serves it INSTANTLY via
 * wingguy_followup_brief, and rebuilds happen in the background via wingguy_prepare_brief or the
 * overnight cron (scripts/prepare-followup-brief.js).
 *
 * House style: recallWebhookDb.js / wingguyRulesStore.js (lazy Pool, ensureSchema
 * CREATE-IF-NOT-EXISTS, no migrations). Multi-tenant by parameter, never hardcoded.
 */

require('dotenv').config();
const { Pool } = require('pg');

const TOP_N = 15;                 // how many surfaced people get the full read+triage+draft treatment
                                  // (10 proved too tight on catch-up days: ten due deferrals + live replies overflowed it, 2026-07-24)
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
async function gatherPersonContext(mailProvider, coach, item) {
  const out = { transcript: [], lastInbound: null, channel: null };
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
    out.transcript.push(...li.map((l) => `LINKEDIN: ${l.slice(0, 300)}`));
    if (!out.channel) out.channel = 'linkedin';
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

const TRIAGE_SYSTEM = `You triage a coach's follow-up queue. For each person you get the engine's mechanical signal (tier/why) plus what was ACTUALLY said recently (email snippets and/or LinkedIn lines, oldest first; THEM = the person, YOU = the coach). Read the words — the mechanical signal is often wrong about what is owed.

Classify each person:
- "park": they named a future time ("September sounds good", "after the holidays", "next quarter") — nothing is owed until then. Give park_date (ISO YYYY-MM-DD, resolved against today's date, leaning a few days LATER than the literal phrase so the nudge never lands early).
- "draft": a real reply is owed — they asked something, offered something, or left a live thread with the coach clearly to answer. ALSO: if their last message DELIVERS something they promised (a list, an intro, a document, information the coach asked for), that deserves a short warm acknowledgment — verdict "draft", never "clear" (the coach's standing preference: a delivered promise is always acknowledged). Give draft_instruction: 1-2 sentences on what the reply should do (ground it ONLY in what was said — never invent facts).
- "clear": nothing is owed — their last message was a pleasantry/close ("thanks, see you Thursday", "no worries"), or the exchange is plainly finished.
- "attention": something is owed but a canned reply would be wrong (complex/sensitive/ambiguous) — the coach should look personally. Say why in the why_line.

For EVERY person also give:
- why_line: ONE short line the coach sees in the brief — plain, specific, human ("she said September sounds good", "asked which podcast episode you meant"). Not a category label.
- jog: 1-2 sentences of memory-jog — who this is and where things stand, from the transcript only.

Return ONLY a JSON array, one object per person, same order as given:
[{"key": "<the person's key exactly as given>", "verdict": "park|draft|clear|attention", "why_line": "...", "jog": "...", "park_date": "YYYY-MM-DD or null", "draft_instruction": "... or null"}]`;

async function triage(client, items, contexts, todayIso) {
  const people = items.map((item, i) => {
    const name = `${item.lead.first} ${item.lead.last}`.trim() || item.lead.email || `#${i}`;
    return [
      `KEY: ${item.key}`,
      `NAME: ${name}`,
      `ENGINE SIGNAL: ${item.tier} — ${item.why}${item.gated ? ' (flagged Cease/Series but surfaced: real obligation)' : ''}`,
      `RECENT EXCHANGE:`,
      ...(contexts[i].transcript.length ? contexts[i].transcript : ['(no readable messages found)']),
    ].join('\n');
  }).join('\n\n---\n\n');
  // Two attempts: the model occasionally malforms its own JSON (bare object stream, unescaped
  // quotes) — retry once with a strict instruction rather than failing the whole preparation.
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 4000,
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

const DRAFT_SYSTEM_PREFIX = `You write a short reply email in the coach's own voice, following the coach's RULEBOOK below. Ground every fact in the supplied exchange — never invent. Keep it brief and human. Return ONLY the email body as simple HTML (<p> paragraphs, <a href> for any links) — no subject, no commentary.`;

async function writeDraft(client, rulesText, item, context, instruction) {
  const name = `${item.lead.first} ${item.lead.last}`.trim();
  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 1200,
    thinking: NO_THINKING,
    system: `${DRAFT_SYSTEM_PREFIX}\n\nTHE COACH'S RULEBOOK:\n\n${rulesText}`,
    messages: [{
      role: 'user',
      content: require('./wingguyDossier').scrub(`Reply to ${name}.\nWhat the reply should do: ${instruction}\n\nThe recent exchange (oldest first):\n${context.transcript.join('\n')}`),
    }],
  });
  return (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
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
    const { getAnthropicClient } = require('../config/anthropicClient');
    const rulesStore = require('./wingguyRulesStore');

    const sweep = await computeFollowupSweep({}, tenant);
    if (!sweep.ok) throw new Error(sweep.error);

    const top = sweep.surfaced.slice(0, TOP_N).map((s, i) => ({
      ...s,
      key: (s.lead.email || `${s.lead.first} ${s.lead.last}`.trim() || `row${i}`).toLowerCase(),
    }));

    // Read what each person actually said (sequential — ~10 quick provider calls).
    const contexts = [];
    for (const item of top) contexts.push(await gatherPersonContext(mailProvider, sweep.coach, item));

    // One triage call over the whole group.
    const llm = getAnthropicClient();
    const todayIso = new Date().toISOString().slice(0, 10);
    let verdicts = [];
    if (top.length) verdicts = await triage(llm, top, contexts, todayIso);
    const byKey = new Map(verdicts.map((v) => [String(v.key || '').toLowerCase(), v]));

    // Voice rules rendered ONCE for all drafts.
    let rulesText = '';
    try {
      const r = await rulesStore.renderRulesBlock({ tenantId: tenant, contexts: ['reply', 'follow-up'] });
      rulesText = r.text || '';
    } catch (e) { console.warn(`[followupBrief] rules render failed (drafting with plain voice): ${e.message}`); }

    // Build items; pre-write Gmail drafts for the "draft" pile (email-reachable people only).
    const items = [];
    for (let i = 0; i < top.length; i++) {
      const item = top[i];
      const ctx = contexts[i];
      const v = byKey.get(item.key) || {};
      const name = `${item.lead.first} ${item.lead.last}`.trim() || item.lead.email || '(no name)';
      const entry = {
        name,
        recId: item.lead.recId || null,
        email: item.lead.email || null,
        linkedin: item.lead.linkedinUrl || null,
        tier: item.tier,
        engineWhy: item.why,
        gated: !!item.gated,
        channel: ctx.channel,
        verdict: v.verdict || 'attention',
        whyLine: v.why_line || item.why,
        jog: v.jog || '',
        parkDate: v.park_date || null,
        draftHtml: null,
        draftText: null,
        draftError: null,
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
          try {
            const html = await writeDraft(llm, rulesText, item, ctx, v.draft_instruction || 'Reply appropriately to their last message.');
            entry.draftHtml = html;
            entry.draftText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            entry.replyToMessageId = ctx.lastInbound.id;
            entry.pushSubject = /^re:/i.test(entry.threadSubject || '') ? entry.threadSubject : `Re: ${entry.threadSubject || 'our conversation'}`;
          } catch (e) { entry.draftError = e.message; }
        } else {
          // LinkedIn-only person: paste-ready plain text.
          try {
            const html = await writeDraft(llm, rulesText, item, ctx, (v.draft_instruction || 'Reply appropriately.') + ' This will be pasted into LinkedIn chat — plain short text, no HTML links, no subject.');
            entry.draftText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            entry.channel = 'linkedin';
          } catch (e) { entry.draftError = e.message; }
        }
      }
      items.push(entry);
    }

    const payload = {
      preparedAt: new Date().toISOString(),
      tenant,
      items,
      totalSurfaced: sweep.surfaced.length,
      counts: sweep.counts,
      windowDays: sweep.windowDays,
    };
    await setStatus(tenant, { status: 'ready', preparedAt: payload.preparedAt, payload, error: null });
    // Dossier pass rides every preparation (cache-aware — unchanged people are skipped, so after
    // the first run this is cheap). Non-fatal: the brief is already stored and served either way.
    try {
      const d = await require('./wingguyDossier').prepareDossiers(tenant);
      console.log(`[followupBrief] dossiers: ${JSON.stringify(d)}`);
    } catch (e) { console.warn(`[followupBrief] dossier pass failed (brief unaffected): ${e.message}`); }
    return { ok: true, items: items.length, totalSurfaced: sweep.surfaced.length };
  } catch (e) {
    console.error(`[followupBrief] prepare failed for ${tenant}: ${e.message}`);
    await setStatus(tenant, { status: 'error', error: e.message }).catch(() => {});
    // Loud failure (Guy's ask 2026-07-23): a silent overnight failure = a quietly stale morning
    // brief. Best-effort — the alert failing must never mask the original error.
    try {
      const { sendAlertEmail } = require('./emailNotificationService');
      await sendAlertEmail(
        `Wingguy follow-up brief FAILED (${tenant})`,
        `<p>The follow-up brief preparation for <b>${tenant}</b> failed at ${new Date().toISOString()}:</p>` +
        `<pre>${String(e.message).slice(0, 500)}</pre>` +
        `<p>The chat will serve the previous brief (flagged stale). Rebuild any time: ask Wingguy to "refresh my follow-ups", or re-run the cron endpoint.</p>`,
      );
    } catch (mailErr) { console.error(`[followupBrief] failure alert email also failed: ${mailErr.message}`); }
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Presentation — the stored brief as instant text
// ---------------------------------------------------------------------------

function formatBrief(row) {
  if (!row || !row.payload) return null;
  const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  const ageH = p.preparedAt ? (Date.now() - new Date(p.preparedAt).getTime()) / 3600000 : 999;
  const piles = { park: [], draft: [], clear: [], attention: [] };
  for (const it of (p.items || [])) (piles[it.verdict] || piles.attention).push(it);

  // Names render as markdown links to the lead's LinkedIn profile (Guy: "glance at their profile").
  const nm = (it) => (it.linkedin ? `[${it.name}](${it.linkedin})` : it.name);

  const lines = [];
  lines.push(`Prepared ${p.preparedAt ? p.preparedAt.slice(0, 16).replace('T', ' ') : '?'} UTC${ageH > STALE_HOURS ? ' ⚠ STALE — offer a refresh (wingguy_prepare_brief)' : ''}. ${p.totalSurfaced} surfaced; top ${ (p.items || []).length } fully prepared. Keep the markdown name-links when relaying.`);
  if (piles.draft.length) {
    lines.push(`\nREPLIES READY (${piles.draft.length}) — drafts written, IN THE BRIEF (show → tweak in chat → on approval push to Gmail with wingguy_create_draft, threaded via the reply id below; LinkedIn ones are paste-ready). Never push unasked:`);
    for (const it of piles.draft) {
      lines.push(`- ${nm(it)} — ${it.whyLine}${it.channel === 'linkedin' ? ' [LinkedIn — paste-ready]' : ''}${it.draftError ? ` [draft generation FAILED: ${it.draftError}]` : ''}`);
      if (it.draftText) lines.push(`    draft: "${it.draftText}"`);
      if (it.email && it.replyToMessageId) lines.push(`    push with: to=${it.email}, subject="${it.pushSubject}", reply_to_message_id=${it.replyToMessageId}`);
      if (it.jog) lines.push(`    jog: ${it.jog}`);
    }
  }
  if (piles.park.length) {
    lines.push(`\nJUST NEED A DATE (${piles.park.length}) — they named a time; confirm to park via wingguy_set_reconnect:`);
    for (const it of piles.park) lines.push(`- ${nm(it)} — ${it.whyLine} → park until ${it.parkDate || '(date unclear — ask)'}${it.jog ? `\n    jog: ${it.jog}` : ''}`);
  }
  if (piles.attention.length) {
    lines.push(`\nNEEDS YOUR EYES (${piles.attention.length}):`);
    for (const it of piles.attention) lines.push(`- ${nm(it)} — ${it.whyLine}${it.jog ? `\n    jog: ${it.jog}` : ''}`);
  }
  if (piles.clear.length) {
    // Guy (2026-07-24, after two live looks): the checked-and-clear line is noise he'll never read.
    // Moved into the do-not-relay tail — the trust function survives (Wingguy can answer "was Simon
    // checked?" instantly) but it costs zero screen space by default.
    lines.push(`\n[checked & clear — do NOT relay unless asked: ${piles.clear.map((it) => `${it.name} (${it.whyLine})`).join(' · ')}]`);
  }
  const more = (p.totalSurfaced || 0) - (p.items || []).length;
  if (more > 0) lines.push(`\n(${more} more surfaced but not in the prepared top group — the live sweep has them.)`);
  // Pipeline footer (Guy 2026-07-23: a quiet brief must SHOW its queue, or calm reads as amnesia).
  const parked = p.counts && p.counts.parkedCount;
  if (parked) lines.push(`\nPIPELINE (relay this): ${parked} people are parked on reconnect dates and will surface on their day${p.counts.nextReconnect ? ` (next: ${p.counts.nextReconnect})` : ''}.`);
  return lines.join('\n');
}

module.exports = { prepareFollowupBrief, getBrief, setStatus, formatBrief, linkedInTail, writeDraft, _setPool, STALE_HOURS };
