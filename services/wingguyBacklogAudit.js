/**
 * wingguyBacklogAudit — the ONE-TIME (re-runnable) backlog reckoning + its worklist.
 *
 * The daily prepared brief (wingguyFollowupBrief.js) covers what's LIVE (~45d). This module digs
 * through the DEBT: every engaged lead whose thread went quiet 45 days to 12 months ago, reads what
 * was actually said (12mo LinkedIn from Notes — free and complete; ~90d email — provider depth
 * limit), triages each into reopen / park / writeoff, and PRE-WRITES the re-opening draft for every
 * reopen (email draft with push params, or LinkedIn paste-ready text). Output = a WORKLIST stored in
 * Postgres that the human chews through a few a day in chat: "give me the draft for Kay" → tweak →
 * push/copy → marked done → the list shrinks. Guy's design session 2026-07-23.
 */

require('dotenv').config();
const { Pool } = require('pg');

const MS_DAY = 86400000;
const QUIET_MIN_DAYS = 45;          // younger = the daily brief's job
const QUIET_MAX_DAYS = 365;         // older = re-engagement campaign territory, not follow-up
const EMAIL_LOOKBACK_DAYS = 90;     // provider depth limit (volume finding 2026-07-22)
const TRIAGE_BATCH = 20;            // people per triage LLM call
const MAX_DRAFTS = 80;              // cap pre-written drafts; beyond = draft-on-request
const MODEL_ID = process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-5';
const NO_THINKING = { type: 'disabled' };

let pool;
function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return pool;
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_backlog_worklist (
      tenant_id  TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ,
      payload    JSONB
    );
  `);
}

async function getWorklist(tenantId) {
  const p = getPool();
  if (!p) return null;
  const c = await p.connect();
  try {
    await ensureSchema(c);
    const r = await c.query('SELECT * FROM wingguy_backlog_worklist WHERE tenant_id = $1', [tenantId]);
    return r.rows[0] || null;
  } finally { c.release(); }
}

async function saveWorklist(tenantId, payload) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const c = await p.connect();
  try {
    await ensureSchema(c);
    await c.query(
      `INSERT INTO wingguy_backlog_worklist (tenant_id, created_at, payload) VALUES ($1, now(), $2)
       ON CONFLICT (tenant_id) DO UPDATE SET created_at = now(), payload = EXCLUDED.payload`,
      [tenantId, JSON.stringify(payload)],
    );
  } finally { c.release(); }
}

/** Mark one item done/skipped (by case-insensitive name match). Returns the updated item or null. */
async function markItem(tenantId, name, status) {
  const row = await getWorklist(tenantId);
  if (!row || !row.payload) return null;
  const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  const item = (p.items || []).find((i) => i.name.toLowerCase() === String(name || '').toLowerCase());
  if (!item) return null;
  item.status = status;
  item.actedAt = new Date().toISOString();
  await saveWorklist(tenantId, p);
  return item;
}

// --- LinkedIn history from Notes (full lines with dates, windowed) ---
const LI_RE = /^(\d{2})-(\d{2})-(\d{2})\s+\d{1,2}:\d{2}\s*[AP]M\s*-\s*(.+?)\s*-\s*(.*)$/;
function linkedInHistory(notes, sinceMs, maxLines = 10) {
  const block = String(notes || '').split(/===\s*LINKEDIN MESSAGES\s*===/i)[1];
  if (!block) return { lines: [], lastMs: null, lastInbound: null };
  const out = [];
  let lastMs = null;
  for (const raw of block.split(/\r?\n/)) {
    const m = raw.trim().match(LI_RE);
    if (!m) continue;
    const ms = Date.UTC(2000 + parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    if (!lastMs || ms > lastMs) lastMs = ms;
    if (ms >= sinceMs) out.push({ ms, sender: m[4].trim(), text: m[5] });
  }
  out.sort((a, b) => a.ms - b.ms);
  return { lines: out.slice(-maxLines), lastMs };
}

function parseJsonArr(text) {
  return require('./wingguyDossier').parseJsonArrayLoose(text);
}

const TRIAGE_SYSTEM = `You triage a coach's NEGLECTED follow-up backlog — threads that went quiet 6 weeks to 12 months ago. For each person you get their recent exchange (oldest first; THEM = the person, YOU = the coach) and how long it's been silent. Classify:
- "reopen": the relationship had real warmth or an open loop (they engaged, asked, promised, or the coach promised) and a genuine re-opening message is worth sending.
- "park": they named a future time that hasn't arrived, or circumstances clearly say later — give park_date (ISO, resolved against today, lean later).
- "writeoff": politely dead — they declined, went cold after a pitch, or the exchange never had substance. No action.
For every person: why_line (ONE short specific human line) and jog (1-2 sentences: who this is, where it left off). For "reopen" also draft_instruction (1-2 sentences: what the re-opening message should do, grounded ONLY in what was said).
Return ONLY a JSON array, same order: [{"key":"<key as given>","verdict":"reopen|park|writeoff","why_line":"...","jog":"...","park_date":null,"draft_instruction":null}]`;

/**
 * Run the full audit for one tenant. Long-running (10-30 min at scale) — call from a job/script.
 */
async function runBacklogAudit(tenant) {
  const clientService = require('./clientService');
  const mailProvider = require('./mailProvider');
  const { getAnthropicClient } = require('../config/anthropicClient');
  const rulesStore = require('./wingguyRulesStore');
  const { computeMailSignals } = require('./wingguyMailMcp');

  const coach = await clientService.getClientById(tenant);
  if (!coach) throw new Error(`coach ${tenant} not found`);
  const base = clientService.getClientBase(coach.airtableBaseId);
  const records = await base('Leads').select({
    fields: ['First Name', 'Last Name', 'Email', 'Cease FUP', 'Notes', 'Series Sent Count', 'Series Unsubscribed', 'Date Connected', 'Reconnect On', 'LinkedIn Profile URL'],
  }).all();

  const now = Date.now();
  const yearAgo = now - QUIET_MAX_DAYS * MS_DAY;
  const quietCut = now - QUIET_MIN_DAYS * MS_DAY;

  // Email signals over the last 90d (thread-aware 1:1) — anyone active there is NOT backlog.
  const mail = await mailProvider.listRecent(coach, { after: Math.floor((now - EMAIL_LOOKBACK_DAYS * MS_DAY) / 1000), max: 3000 });
  const emails = new Set(records.map((r) => String(r.fields['Email'] || '').trim().toLowerCase()).filter(Boolean));
  const signals = mail.ok ? computeMailSignals(mail.messages, emails) : new Map();

  // Candidate selection.
  const candidates = [];
  let skipped = { cease: 0, series: 0, stamped: 0, live: 0, cold: 0, never: 0 };
  for (const r of records) {
    const f = r.fields || {};
    const email = String(f['Email'] || '').trim().toLowerCase();
    const first = f['First Name'] || '';
    const li = linkedInHistory(f['Notes'], yearAgo);
    const sig = email ? signals.get(email) : null;
    const lastEmailMs = sig ? Math.max(sig.lastInboundMs || 0, sig.lastOutboundMs || 0) || null : null;
    const lastMs = Math.max(li.lastMs || 0, lastEmailMs || 0) || null;
    const theyEngaged = (sig && sig.lastInboundMs) || li.lines.some((l) => first && l.sender.toLowerCase().startsWith(first.toLowerCase()));
    const connected = !!f['Date Connected'];

    if (!lastMs) { skipped.never++; continue; }                                  // no interaction at all
    if (lastMs > quietCut) { skipped.live++; continue; }                          // daily brief's territory
    if (lastMs < yearAgo) { skipped.cold++; continue; }                           // >12mo = re-engagement, not follow-up
    if (String(f['Cease FUP'] && f['Cease FUP'].name || f['Cease FUP'] || '') === 'Yes') { skipped.cease++; continue; }
    if (Number(f['Series Sent Count'] || 0) > 0 && f['Series Unsubscribed'] !== true) { skipped.series++; continue; }
    if (f['Reconnect On']) { skipped.stamped++; continue; }                       // already captured
    if (!theyEngaged && !connected) { skipped.never++; continue; }                // pure ignored cold outreach

    candidates.push({
      key: (email || `${first} ${f['Last Name'] || ''}`.trim()).toLowerCase(),
      recId: r.id,
      name: `${first} ${f['Last Name'] || ''}`.trim(),
      email: email || null,
      linkedin: String(f['LinkedIn Profile URL'] || '').trim() || null,
      first,
      notes: f['Notes'] || '',
      quietDays: Math.floor((now - lastMs) / MS_DAY),
      liLines: li.lines,
      hasEmailSignal: !!sig,
    });
  }
  // Most-recently-quiet first — warmest debt first.
  candidates.sort((a, b) => a.quietDays - b.quietDays);
  console.log(`[backlogAudit] candidates=${candidates.length} skipped=${JSON.stringify(skipped)}`);

  // Build transcripts (email context per-person only where a signal existed — bounded calls).
  const llm = getAnthropicClient();
  const today = new Date().toISOString().slice(0, 10);
  const withContext = [];
  for (const c of candidates) {
    const transcript = c.liLines.map((l) => `${new Date(l.ms).toISOString().slice(0, 10)} ${c.first && l.sender.toLowerCase().startsWith(c.first.toLowerCase()) ? 'THEM' : 'YOU'} (LinkedIn): ${String(l.text).slice(0, 280)}`);
    if (c.email && c.hasEmailSignal) {
      try {
        const found = await mailProvider.findMessages(coach, { anyEmail: c.email, limit: 5 });
        if (found.ok) {
          for (const m of (found.messages || []).slice().sort((x, y) => new Date(x.date || 0) - new Date(y.date || 0))) {
            const theirs = (m.fromEmail || '').toLowerCase() === c.email;
            transcript.push(`${(m.date || '').slice(0, 10)} ${theirs ? 'THEM' : 'YOU'} (email): [${m.subject || ''}] ${String(m.snippet || '').slice(0, 280)}`);
            if (theirs) c.lastInbound = { id: m.id, subject: m.subject || '' };
          }
        }
      } catch (_) { /* LinkedIn-only context */ }
    }
    if (!transcript.length) continue;   // nothing readable — skip
    c.transcript = transcript;
    withContext.push(c);
  }

  // Triage in batches.
  const verdicts = new Map();
  for (let i = 0; i < withContext.length; i += TRIAGE_BATCH) {
    const batch = withContext.slice(i, i + TRIAGE_BATCH);
    const listText = batch.map((c) =>
      `KEY: ${c.key}\nNAME: ${c.name}\nSILENT: ${c.quietDays} days\nEXCHANGE:\n${c.transcript.join('\n')}`).join('\n\n---\n\n');
    try {
      const resp = await llm.messages.create({
        model: MODEL_ID, max_tokens: 4000, thinking: NO_THINKING,
        system: TRIAGE_SYSTEM,
        messages: [{ role: 'user', content: require('./wingguyDossier').scrub(`Today is ${today}.\n\n${listText}`) }],
      });
      const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      for (const v of parseJsonArr(text)) verdicts.set(String(v.key || '').toLowerCase(), v);
      console.log(`[backlogAudit] triaged ${Math.min(i + TRIAGE_BATCH, withContext.length)}/${withContext.length}`);
    } catch (e) { console.warn(`[backlogAudit] triage batch ${i} failed: ${e.message}`); }
  }

  // Voice rules once; drafts for reopen (capped).
  let rulesText = '';
  try { rulesText = (await rulesStore.renderRulesBlock({ tenantId: tenant, contexts: ['reply', 'follow-up'] })).text || ''; }
  catch (e) { console.warn(`[backlogAudit] rules render failed: ${e.message}`); }
  const { writeDraft } = require('./wingguyFollowupBrief');

  const items = [];
  let drafted = 0;
  for (const c of withContext) {
    const v = verdicts.get(c.key);
    if (!v) continue;
    const item = {
      name: c.name, recId: c.recId || null, email: c.email, linkedin: c.linkedin,
      quietDays: c.quietDays, verdict: v.verdict,
      whyLine: v.why_line || '', jog: v.jog || '', parkDate: v.park_date || null,
      channel: c.email && c.lastInbound ? 'email' : 'linkedin',
      draftText: null, draftHtml: null, pushSubject: null,
      replyToMessageId: (c.lastInbound && c.lastInbound.id) || null,
      status: 'pending',
    };
    if (v.verdict === 'reopen' && drafted < MAX_DRAFTS) {
      try {
        const instruction = (v.draft_instruction || 'Re-open the thread warmly, referencing where it left off.') +
          (item.channel === 'linkedin' ? ' This will be pasted into LinkedIn chat — plain short text, no HTML, no subject.' : '');
        const html = await writeDraft(llm, rulesText, { lead: { first: c.first, last: '', email: c.email } }, { transcript: c.transcript }, instruction);
        item.draftHtml = item.channel === 'email' ? html : null;
        item.draftText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (item.channel === 'email') item.pushSubject = c.lastInbound && c.lastInbound.subject ? (/^re:/i.test(c.lastInbound.subject) ? c.lastInbound.subject : `Re: ${c.lastInbound.subject}`) : 'Picking our conversation back up';
        drafted++;
        if (drafted % 10 === 0) console.log(`[backlogAudit] drafts written: ${drafted}`);
      } catch (e) { item.draftError = e.message; }
    }
    items.push(item);
  }

  const payload = {
    createdAt: new Date().toISOString(), tenant,
    horizon: { linkedInDays: QUIET_MAX_DAYS, emailDays: EMAIL_LOOKBACK_DAYS, quietMinDays: QUIET_MIN_DAYS },
    counts: {
      candidates: candidates.length, triaged: items.length,
      reopen: items.filter((i) => i.verdict === 'reopen').length,
      park: items.filter((i) => i.verdict === 'park').length,
      writeoff: items.filter((i) => i.verdict === 'writeoff').length,
      drafted, skipped,
    },
    items,
  };
  await saveWorklist(tenant, payload);
  return payload.counts;
}

// --- Presentation for the chat tool ---

function formatWorklist(row, { name, batch = 5 } = {}) {
  if (!row || !row.payload) return null;
  const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  const items = p.items || [];
  const nm = (it) => (it.linkedin ? `[${it.name}](${it.linkedin})` : it.name);

  if (name) {
    const it = items.find((i) => i.name.toLowerCase().includes(String(name).toLowerCase()));
    if (!it) return `No backlog entry matching "${name}".`;
    const lines = [
      `${nm(it)} — ${it.verdict.toUpperCase()} (${it.quietDays}d silent, ${it.status})`,
      `why: ${it.whyLine}`, `jog: ${it.jog}`,
    ];
    // Explicit URL line (not just the linked name): survives the assistant's re-phrasing, and for a
    // LinkedIn paste-ready draft it's the "click straight in and paste" door (Guy 2026-07-24).
    if (it.linkedin) lines.push(`LinkedIn profile: ${it.linkedin}  ← ALWAYS show this link whenever presenting this person or their draft.`);
    if (it.parkDate) lines.push(`suggested park date: ${it.parkDate} (stamp via wingguy_set_reconnect)`);
    if (it.draftText) lines.push(it.channel === 'email'
      ? `draft (email — tweak in chat, then push via wingguy_create_draft with to=${it.email}, subject="${it.pushSubject}"${it.replyToMessageId ? `, reply_to_message_id=${it.replyToMessageId}` : ''}):\n"${it.draftText}"`
      : `draft (LinkedIn — paste-ready):\n"${it.draftText}"`);
    else if (it.verdict === 'reopen') lines.push('draft: not pre-written (over the cap) — compose from the jog + exchange.');
    lines.push(`when dealt with: mark done via wingguy_backlog {name, action:"done"} (or "skip").`);
    return lines.join('\n');
  }

  const pending = items.filter((i) => i.status === 'pending');
  const reopen = pending.filter((i) => i.verdict === 'reopen');
  const park = pending.filter((i) => i.verdict === 'park');
  const done = items.length - pending.length;
  const lines = [
    `BACKLOG WORKLIST (built ${String(p.createdAt).slice(0, 10)}): ${pending.length} pending of ${items.length} (${done} dealt with). Reopen ${reopen.length} · park ${park.length} · writeoff ${pending.filter((i) => i.verdict === 'writeoff').length}.`,
    `\nNext ${Math.min(batch, reopen.length)} to re-open (drafts ready — ask for anyone by name):`,
  ];
  for (const it of reopen.slice(0, batch)) lines.push(`- ${nm(it)} (${it.quietDays}d) — ${it.whyLine}`);
  if (park.length) {
    lines.push(`\nParks awaiting a stamp (confirm each via wingguy_set_reconnect):`);
    for (const it of park.slice(0, batch)) lines.push(`- ${nm(it)} → ${it.parkDate || '(date unclear)'} — ${it.whyLine}`);
  }
  lines.push(`\n(Writeoffs need nothing by default — but warm-then-faded ones may carry an OPTIONAL graceful goodbye draft in their dossier (wingguy_dossier name=...); cold ones just rest. Work at any pace — "give me the draft for X", act, mark done.)`);
  return lines.join('\n');
}

module.exports = { runBacklogAudit, getWorklist, saveWorklist, markItem, formatWorklist };
