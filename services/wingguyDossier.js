/**
 * wingguyDossier — the pre-built per-person DOSSIER behind the action queue.
 *
 * Guy's ask (2026-07-23, after the Celeste dig): "any emails? how did the call go? — that should be
 * available INSTANTLY." The information was always in our stores; it was slow because it was
 * fetched and synthesized while he watched. So, same cure as the brief: build it at preparation
 * time. For every actionable queue person this assembles:
 *   - timeline: merged chronology — emails both ways (incl. calendar accept/decline machinery),
 *     LinkedIn messages, meetings — dated, one line each
 *   - meetings: transcript-store matches (by Airtable rec id, name fallback) with their Fathom-style
 *     summaries
 *   - deepRead: ONE LLM pass — where this actually stands, commitments each side, suggested next move
 * Cached per person, keyed on a basis fingerprint (message/meeting counts + last dates) — a dossier
 * only rebuilds when that person's thread actually changed, so the nightly cost after the first run
 * is near zero. Served instantly by wingguy_dossier; the live dig remains the fallback for questions
 * a dossier didn't anticipate.
 *
 * COVERAGE (2026-08-03, the Steve Martin blind spot): the store used to be fed ONLY from the
 * follow-up pipeline, whose gates (Reconnect On park, upcoming-booking drop) exclude exactly the
 * people who show up in daily MEETING PREP — parked until their meeting day, booking on the
 * calendar. Two closures:
 *   - prepareDossiers also builds for every CRM-matched attendee on the next few days of the
 *     coach's calendar (park/booking gates deliberately NOT applied — they are follow-up policy,
 *     not prep policy).
 *   - buildLiveMiniDossier: when the store still misses, wingguy_dossier assembles a labelled
 *     live mini-dossier straight from the Leads record (Notes thread, status, transcript-store
 *     meetings) instead of claiming the person is unknown.
 */

require('dotenv').config();
const { Pool } = require('pg');

const MS_DAY = 86400000;
const MODEL_ID = process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-5';
const NO_THINKING = { type: 'disabled' };
const EMAIL_LIMIT = 12;
const LI_LIMIT = 12;
// Calendar look-ahead for the meeting-prep dossier pass: enough that a Monday-morning build has
// covered the weekend's bookings, small enough to stay cheap (cache makes repeats near-free).
const PREP_CAL_DAYS = 3;

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
    CREATE TABLE IF NOT EXISTS wingguy_dossiers (
      tenant_id  TEXT NOT NULL,
      person_key TEXT NOT NULL,
      built_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      basis      TEXT,
      payload    JSONB,
      PRIMARY KEY (tenant_id, person_key)
    );
  `);
}

async function getDossierRow(tenantId, personKey) {
  const p = getPool();
  if (!p) return null;
  const c = await p.connect();
  try {
    await ensureSchema(c);
    const r = await c.query('SELECT * FROM wingguy_dossiers WHERE tenant_id = $1 AND person_key = $2', [tenantId, personKey]);
    return r.rows[0] || null;
  } finally { c.release(); }
}

/** Recursively scrub every string in a payload — Postgres jsonb rejects lone surrogates outright. */
function deepScrub(v) {
  if (typeof v === 'string') return scrub(v);
  if (Array.isArray(v)) return v.map(deepScrub);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = deepScrub(v[k]); return o; }
  return v;
}

async function saveDossier(tenantId, personKey, basis, payload) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const c = await p.connect();
  try {
    await ensureSchema(c);
    await c.query(
      `INSERT INTO wingguy_dossiers (tenant_id, person_key, built_at, basis, payload) VALUES ($1, $2, now(), $3, $4)
       ON CONFLICT (tenant_id, person_key) DO UPDATE SET built_at = now(), basis = EXCLUDED.basis, payload = EXCLUDED.payload`,
      [tenantId, personKey, basis, JSON.stringify(deepScrub(payload))],
    );
  } finally { c.release(); }
}

/** Find a person's dossier by (partial, case-insensitive) name. */
async function findDossierByName(tenantId, name) {
  const p = getPool();
  if (!p) return null;
  const c = await p.connect();
  try {
    await ensureSchema(c);
    const r = await c.query(
      `SELECT * FROM wingguy_dossiers WHERE tenant_id = $1 AND payload->>'name' ILIKE $2 ORDER BY built_at DESC LIMIT 1`,
      [tenantId, `%${String(name || '').trim()}%`],
    );
    return r.rows[0] || null;
  } finally { c.release(); }
}

// --- raw material gathering ---

/**
 * Strip lone UTF-16 surrogates. Snippet trimming (.slice at N chars) can cut an emoji in half,
 * leaving a lone surrogate that makes the whole JSON request body invalid ("no low surrogate in
 * string" — killed Sam Noble's dossier, observed live 2026-07-23). Apply to any text headed to
 * the LLM API.
 */
function scrub(s) {
  return String(s || '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '').replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1');
}

/**
 * Parse an LLM's "JSON array" answer LOOSELY: space out raw control chars, take [..] if present,
 * else accept a bare object-stream ("{..} {..}") by joining and wrapping it. The brief triage died
 * live on exactly that shape (2026-07-24: 7591 chars of objects, no array brackets).
 */
function parseJsonArrayLoose(text) {
  const clean = Array.from(String(text || '')).map((ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('');
  const a = clean.indexOf('['); const b = clean.lastIndexOf(']');
  if (a !== -1 && b > a) return JSON.parse(clean.slice(a, b + 1));
  const s = clean.indexOf('{'); const e = clean.lastIndexOf('}');
  if (s === -1 || e <= s) throw new Error(`no JSON found ("${clean.slice(0, 200)}")`);
  return JSON.parse('[' + clean.slice(s, e + 1).replace(/}\s*,?\s*{/g, '},{') + ']');
}

const LI_RE = /^(\d{2})-(\d{2})-(\d{2})\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(.+?)\s*-\s*(.*)$/;

function gatherLinkedIn(notes, first, max = LI_LIMIT) {
  const block = String(notes || '').split(/===\s*LINKEDIN MESSAGES\s*===/i)[1];
  if (!block) return [];
  const out = [];
  for (const raw of block.split(/\r?\n/)) {
    const m = raw.trim().match(LI_RE);
    if (!m) continue;
    const iso = `20${m[3]}-${m[2]}-${m[1]}`;
    const theirs = first && m[5].trim().toLowerCase().startsWith(first.toLowerCase());
    // scrub at the SOURCE: a lone surrogate here poisons BOTH the LLM request and the jsonb save
    out.push({ date: iso, kind: 'linkedin', dir: theirs ? 'them' : 'you', text: scrub(String(m[6]).slice(0, 300)) });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out.slice(-max);
}

async function gatherEmails(mailProvider, coach, email, max = EMAIL_LIMIT) {
  if (!email) return [];
  try {
    const found = await mailProvider.findMessages(coach, { anyEmail: email, limit: max });
    if (!found.ok) return [];
    const rows = (found.messages || [])
      .slice().sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
      .map((m) => {
        const theirs = (m.fromEmail || '').toLowerCase() === email;
        const calendarish = /^(accepted|declined|tentative|invitation|updated invitation|canceled)/i.test(m.subject || '');
        return { date: (m.date || '').slice(0, 10), kind: calendarish ? 'calendar' : 'email', dir: theirs ? 'them' : 'you', subject: scrub(m.subject || ''), text: scrub(String(m.snippet || '').slice(0, 280)), messageId: m.id };
      });
    // FULL BODY of the latest inbound human emails (up to 2). Snippets truncate mid-sentence and
    // mislead — "as promised, here's a l…" spawned a phantom referral theory on 2026-07-24. The
    // full text is what the human always ends up asking for ("what did they actually say?"), so it
    // belongs IN the dossier, not behind a live read.
    const { htmlToText } = require('./wingguyMailMcp');
    const latestTheirs = rows.filter((r) => r.dir === 'them' && r.kind === 'email').slice(-2);
    for (const r of latestTheirs) {
      try {
        const full = await mailProvider.getMessage(coach, r.messageId);
        if (full.ok && full.message) {
          const body = htmlToText(full.message.body) || String(full.message.snippet || '');
          if (body) r.fullText = scrub(String(body).replace(/\s+/g, ' ').trim().slice(0, 1800));
        }
      } catch (_) { /* snippet remains */ }
    }
    return rows;
  } catch (_) { return []; }
}

async function gatherMeetings(tenantId, recId, fullName) {
  const p = getPool();
  if (!p) return [];
  const c = await p.connect();
  try {
    let rows = [];
    if (recId) {
      const r = await c.query(
        `SELECT m.title, m.meeting_start, m.summary_json, m.transcript_text FROM recall_meetings m
         JOIN recall_meeting_leads l ON l.meeting_id = m.id
         WHERE l.airtable_lead_id = $1 AND (m.coach_client_id = $2 OR m.coach_client_id IS NULL)
         ORDER BY m.meeting_start DESC NULLS LAST LIMIT 3`, [recId, tenantId]);
      rows = r.rows;
    }
    if (!rows.length && fullName) {
      const r = await c.query(
        `SELECT title, meeting_start, summary_json, transcript_text FROM recall_meetings
         WHERE title ILIKE $1 AND (coach_client_id = $2 OR coach_client_id IS NULL)
         ORDER BY meeting_start DESC NULLS LAST LIMIT 3`, [`%${fullName}%`, tenantId]);
      rows = r.rows;
    }
    return rows.map((m, i) => {
      let summary = null;
      try { const j = JSON.parse(m.summary_json || 'null'); summary = j && (j.summary || j.recap || JSON.stringify(j).slice(0, 1200)); } catch (_) { summary = m.summary_json ? String(m.summary_json).slice(0, 1200) : null; }
      return {
        date: m.meeting_start ? new Date(m.meeting_start).toISOString().slice(0, 10) : null,
        title: m.title || '(meeting)',
        summary,
        // FULL transcript of the LATEST meeting only — feeds the overnight deep-read, where the
        // specifics live ("back from Brazil the 17th, week of the 22nd, avoid Mon/Tue" — the
        // Celeste details the summary alone missed). Not stored in the payload (it already lives
        // in recall_meetings); consumed at read time.
        transcript: i === 0 && m.transcript_text ? scrub(String(m.transcript_text).replace(/\s+/g, ' ').slice(0, 14000)) : null,
      };
    });
  } catch (e) { return []; } finally { c.release(); }
}

// --- live CRM fallback (the Steve Martin blind spot, 2026-08-03) ---

// Tolerant Alt-Emails split — same delimiters inboundEmailService reads (written newline-separated).
function splitAltEmails(v) {
  return String(v || '').toLowerCase().split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean);
}

/** Every email address mentioned anywhere in a text blob (lowercased, deduped). */
function extractEmailsFromText(text) {
  const m = String(text || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  return [...new Set(m.map((e) => e.toLowerCase()))];
}

// Fields the mini-dossier wants; the reduced list is the retry when a base lacks the newer columns
// (Alt Emails / Reconnect On etc. roll out per-client) — same tiered-select trick as the sweep.
const LIVE_FIELDS_FULL = ['First Name', 'Last Name', 'Email', 'Alt Emails', 'Notes', 'Status', 'Location', 'Headline', 'Company Name', 'LinkedIn Profile URL', 'AI Score', 'Reconnect On', 'Cease FUP'];
const LIVE_FIELDS_CORE = ['First Name', 'Last Name', 'Email', 'Notes', 'Status', 'Location', 'LinkedIn Profile URL'];

async function selectLeads(base, formula, maxRecords) {
  for (const fields of [LIVE_FIELDS_FULL, LIVE_FIELDS_CORE]) {
    try {
      return await base('Leads').select({ filterByFormula: formula, fields, maxRecords }).all();
    } catch (e) { /* unknown field in this base — retry with the core list */ }
  }
  return [];
}

/**
 * Leads-table lookup for the fallback: email first (exact {Email}, then {Alt Emails} membership —
 * FIND narrows, JS confirms exact, so "jon@x" never matches "tjon@x"), then name substring against
 * First+Last (as forgiving as the store's own lookup). Returns ALL name matches — the caller shows
 * a candidate list rather than guessing (the Steve → Steve Peacocke collision is the cautionary tale).
 */
async function findLeadRecords(base, { name, email } = {}) {
  const esc = (s) => String(s).replace(/"/g, '\\"');
  const em = String(email || '').trim().toLowerCase();
  if (em) {
    let recs = await selectLeads(base, `LOWER({Email}) = "${esc(em)}"`, 2);
    if (!recs.length) {
      const cands = await selectLeads(base, `AND({Alt Emails} != "", FIND("${esc(em)}", LOWER({Alt Emails})) > 0)`, 5);
      recs = cands.filter((r) => splitAltEmails(r.fields['Alt Emails']).includes(em));
    }
    if (recs.length) return recs;
  }
  const nm = String(name || '').trim();
  if (!nm) return [];
  return selectLeads(base, `FIND(LOWER("${esc(nm)}"), LOWER({First Name} & " " & {Last Name})) > 0`, 6);
}

/**
 * Build a mini-dossier LIVE from the CRM record — the answer when the prepared store has nothing.
 * No LLM pass: raw material only (LinkedIn thread from Notes, transcript-store meetings, record
 * facts), clearly labelled so nobody mistakes it for the overnight deep-read. Returns:
 *   null                      — no CRM record either (caller serves the true miss)
 *   { multiple: [...] }       — ambiguous name; candidates for the human to pick from
 *   { payload }               — the mini-dossier, ready for formatLiveDossier
 */
async function buildLiveMiniDossier(tenant, { name, email } = {}) {
  const clientService = require('./clientService');
  const coach = await clientService.getClientById(tenant);
  if (!coach || !coach.airtableBaseId) return null;
  const base = clientService.getClientBase(coach.airtableBaseId);
  const recs = await findLeadRecords(base, { name, email });
  if (!recs.length) return null;
  const brief = (r) => {
    const f = r.fields;
    return {
      name: `${f['First Name'] || ''} ${f['Last Name'] || ''}`.trim(),
      headline: String(f['Headline'] || '').trim() || null,
      company: String(f['Company Name'] || '').trim() || null,
      location: String(f['Location'] || '').trim() || null,
      linkedin: String(f['LinkedIn Profile URL'] || '').trim() || null,
      email: String(f['Email'] || '').trim() || null,
    };
  };
  if (recs.length > 1) return { multiple: recs.map(brief) };

  const rec = recs[0];
  const f = rec.fields;
  const fullName = `${f['First Name'] || ''} ${f['Last Name'] || ''}`.trim() || String(name || '').trim();
  const li = gatherLinkedIn(f['Notes'], f['First Name'] || fullName.split(' ')[0], 20);
  const meetings = await gatherMeetings(tenant, rec.id, fullName);
  const onRecord = new Set([String(f['Email'] || '').trim().toLowerCase(), ...splitAltEmails(f['Alt Emails'])].filter(Boolean));
  // An address handed over IN the conversation that never reached the record (learn-back only
  // listens to inbound email, not LinkedIn) — surface as a suggested update, never write silently.
  const unrecordedEmails = extractEmailsFromText(f['Notes']).filter((e) => !onRecord.has(e));
  return {
    payload: {
      ...brief(rec),
      name: fullName,
      recId: rec.id,
      status: (f['Status'] && f['Status'].name) || f['Status'] || null,
      aiScore: typeof f['AI Score'] === 'number' ? f['AI Score'] : null,
      reconnectOn: f['Reconnect On'] || null,
      ceased: String((f['Cease FUP'] && f['Cease FUP'].name) || f['Cease FUP'] || '') === 'Yes',
      linkedinThread: li,
      meetings: meetings.map(({ transcript, ...rest }) => rest),
      unrecordedEmails,
      builtAt: new Date().toISOString(),
    },
  };
}

/** Render the live mini-dossier — same conventions as formatDossier, honestly labelled. */
function formatLiveDossier(live) {
  if (!live || !live.payload) return null;
  const p = live.payload;
  const lines = [
    `LIVE MINI-DOSSIER: ${p.linkedin ? `[${p.name}](${p.linkedin})` : p.name} — no overnight dossier existed, so this was assembled JUST NOW from the CRM record. Raw material, not the overnight deep-read: relay the facts, don't invent a synthesis the material can't support.`,
  ];
  if (p.linkedin) lines.push(`LinkedIn profile: ${p.linkedin}  ← ALWAYS show this link (or the linked name) when presenting.`);
  lines.push(p.location
    ? `Based: ${p.location} (state where they're based per the booking rules; times offered later must be on THEIR clock)`
    : `Based: NOT RECORDED — before offering any meeting times, ask the human where this person is (booking rules: never guess a timezone).`);
  const facts = [];
  if (p.headline) facts.push(p.headline);
  if (p.company) facts.push(p.company);
  if (facts.length) lines.push(`Who: ${facts.join(' — ')}`);
  const state = [];
  if (p.status) state.push(`status ${p.status}`);
  if (typeof p.aiScore === 'number') state.push(`AI score ${p.aiScore}`);
  if (p.reconnectOn) state.push(`parked (Reconnect On ${String(p.reconnectOn).slice(0, 10)})`);
  if (p.ceased) state.push('follow-ups CEASED (they must speak first)');
  if (state.length) lines.push(`Record state: ${state.join(' · ')}`);
  if ((p.unrecordedEmails || []).length) {
    lines.push(`\n⚠ EMAIL SEEN IN THE THREAD, NOT ON THE RECORD: ${p.unrecordedEmails.join(', ')} — they handed this over in conversation but the record's Email/Alt Emails never learned it. Suggest the human confirm and update the record; NEVER change it silently.`);
  }
  if ((p.meetings || []).length) {
    lines.push(`\nMEETINGS (transcript store):`);
    for (const m of p.meetings) lines.push(`- ${m.date || '?'} "${m.title}"${m.summary ? `: ${String(m.summary).slice(0, 500)}` : ' (no summary stored)'}`);
  }
  if ((p.linkedinThread || []).length) {
    lines.push(`\nLINKEDIN THREAD (from the record's Notes, oldest first):`);
    for (const t of p.linkedinThread) lines.push(`- ${t.date} [${t.dir}] ${t.text || ''}`);
  } else {
    lines.push(`\nNo LinkedIn thread on the record's Notes.`);
  }
  lines.push(`\n(Email history is NOT included in a live build — for that, wingguy_lead_correspondence email=${p.email || '<their email>'}. This person will get a full overnight dossier if they appear on the calendar or in the queue.)`);
  return lines.join('\n');
}

// --- deep read (one LLM pass) ---

const DEEP_SYSTEM = `You prepare a coach's memory-dossier for one contact. From the dated timeline (emails, LinkedIn messages, calendar responses), meeting summaries and any full transcript, write JSON:
{"standing": "one tight paragraph: where this relationship ACTUALLY stands right now — read the words, note who spoke last and what is really owed; flag calendar mishaps (accept-then-decline artifacts, invites that lapsed while someone was away) rather than reading them as disinterest",
 "commitments_you": ["each thing the COACH promised, with when"],
 "commitments_them": ["each thing THEY promised or delivered"],
 "remember": ["4-8 short bullets of concrete specifics worth holding onto — their business and situation (what they do, how long, target market, point of difference), personal details mentioned (travel, family, location, timezone), what resonated or aligned in conversation, objections or hesitations, stated preferences (days, times, channels). The coach juggles many people; these bullets ARE the memory."],
 "next_move": "one sentence: the smartest next action. For a WARM relationship that has clearly ended, that may be a one-line graceful close (door-open goodbye) — say so explicitly. For a cold or never-real thread, say exactly: nothing — let it rest."}
Ground everything ONLY in the material given. Return ONLY the JSON object.`;

async function deepRead(llm, name, timeline, meetings) {
  const withTranscript = meetings.find((m) => m.transcript);
  const material = [
    `CONTACT: ${name}`,
    `TIMELINE (oldest first):`,
    ...timeline.map((t) => `${t.date} [${t.kind}/${t.dir}] ${t.subject ? `(${t.subject}) ` : ''}${t.fullText ? `FULL TEXT: ${t.fullText}` : (t.text || '')}`),
    ...(meetings.length ? ['MEETING SUMMARIES:', ...meetings.map((m) => `${m.date || '?'} "${m.title}": ${m.summary || '(no summary stored)'}`)] : []),
    ...(withTranscript ? [`FULL TRANSCRIPT of the latest meeting (${withTranscript.date} "${withTranscript.title}") — mine it for specifics the summary missed (named dates, travel, commitments, preferences):`, withTranscript.transcript] : []),
  ].join('\n');
  // Up to 2 attempts: the model occasionally breaks its own JSON (unescaped quotes when quoting
  // someone — killed Celeste's and Piyush's dossiers on 2026-07-24). Control-char sanitation first,
  // then one full retry with a sterner instruction.
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await llm.messages.create({
      model: MODEL_ID, max_tokens: 2200, thinking: NO_THINKING,
      system: DEEP_SYSTEM + (attempt ? '\nSTRICT: your previous output was invalid JSON. Escape every double-quote inside string values as \\" and never put raw newlines inside strings.' : ''),
      messages: [{ role: 'user', content: scrub(`Today is ${new Date().toISOString().slice(0, 10)}.\n\n${material.slice(0, 32000)}`) }],
    });
    const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const s = text.indexOf('{'); const e = text.lastIndexOf('}');
    try {
      return JSON.parse(text.slice(s, e + 1).replace(/[\u0000-\u001f]/g, ' '));
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

// --- the batch builder (called after brief preparation; cache-aware) ---

/**
 * Ensure a fresh dossier for every actionable person across BOTH stores (today's brief items with
 * verdicts draft/park/attention + backlog pending reopen/park). Cache-aware: skips anyone whose
 * basis fingerprint (email/LI/meeting counts + last dates) is unchanged. Never throws.
 */
async function prepareDossiers(tenant) {
  const out = { built: 0, cached: 0, failed: 0 };
  try {
    const clientService = require('./clientService');
    const mailProvider = require('./mailProvider');
    const { getAnthropicClientForKey } = require('../config/anthropicClient');
    const briefStore = require('./wingguyFollowupBrief');
    const backlog = require('./wingguyBacklogAudit');
    const rulesStore = require('./wingguyRulesStore');

    const coach = await clientService.getClientById(tenant);
    if (!coach) return out;
    const base = clientService.getClientBase(coach.airtableBaseId);

    // Collect actionable people from both stores. hasDraft tracks whether a store already carries a
    // written draft for them — those without one (attention/park verdicts) get a GUIDANCE DRAFT
    // baked into the dossier (Guy 2026-07-24: even judgment cases deserve a prepared starting
    // point — reacting to a draft beats composing from advice).
    const people = new Map(); // key -> {name, recId, email, hasDraft}
    const addFrom = (items, verdicts) => {
      for (const it of (items || [])) {
        if (!verdicts.includes(it.verdict)) continue;
        if (it.status && it.status !== 'pending') continue;
        const key = (it.email || it.name).toLowerCase();
        const hasDraft = !!(it.draftText || it.draftHtml);
        if (!people.has(key)) people.set(key, { key, name: it.name, recId: it.recId || null, email: it.email || null, hasDraft });
        else if (hasDraft) people.get(key).hasDraft = true;
      }
    };
    try {
      const row = await briefStore.getBrief(tenant);
      const p = row && row.payload ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) : null;
      addFrom(p && p.items, ['draft', 'park', 'attention']);
    } catch (_) {}
    try {
      const row = await backlog.getWorklist(tenant);
      const p = row && row.payload ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) : null;
      // writeoffs included (Guy 2026-07-24): a warm-then-faded relationship deserves the OPTION of
      // a graceful door-open goodbye rather than ghosting — the deep-read decides ("nothing — let
      // it rest" for cold threads suppresses the draft below).
      addFrom(p && p.items, ['reopen', 'park', 'writeoff']);
    } catch (_) {}

    // One Airtable read for Notes + missing rec ids (dossiers need LinkedIn history). Pulled up
    // ahead of the calendar pass, which needs it to match invite emails to records; Alt Emails
    // included tiered-select style (the column rolls out per-client).
    let records = [];
    const NOTE_FIELDS = ['First Name', 'Last Name', 'Email', 'Notes', 'LinkedIn Profile URL', 'Location'];
    for (const fields of [[...NOTE_FIELDS, 'Alt Emails'], NOTE_FIELDS]) {
      try { records = await base('Leads').select({ fields }).all(); break; } catch (_) { /* Alt Emails absent here */ }
    }
    const byEmail = new Map(); const byName = new Map();
    for (const r of records) {
      const em = String(r.fields['Email'] || '').trim().toLowerCase();
      const nm = `${r.fields['First Name'] || ''} ${r.fields['Last Name'] || ''}`.trim().toLowerCase();
      if (em && !byEmail.has(em)) byEmail.set(em, r);
      for (const alt of splitAltEmails(r.fields['Alt Emails'])) if (!byEmail.has(alt)) byEmail.set(alt, r);
      if (nm && !byName.has(nm)) byName.set(nm, r);
    }

    // MEETING-PREP COVERAGE (the Steve Martin blind spot, 2026-08-03): the two stores above are
    // follow-up products, and their gates — Reconnect On park, upcoming-booking drop — exclude
    // exactly the people the coach asks to be prepped on each morning ("parked until their meeting
    // day, with the meeting on the calendar" IS the normal state of someone about to be met). So
    // every CRM-matched attendee on the next few days of the calendar gets a dossier too; the
    // follow-up gates deliberately do NOT apply here. hasDraft=true: prep wants the memory (deep
    // read), not an outreach guidance draft for someone we're about to see anyway.
    try {
      const { getMeetingsInWindow } = require('./calendarProvider');
      const own = require('./wingguyMailMcp').coachOwnEmails(coach);
      const cal = await getMeetingsInWindow(coach, new Date(), new Date(Date.now() + PREP_CAL_DAYS * MS_DAY));
      for (const ev of (cal && cal.events) || []) {
        const cands = [...(ev.attendees || []), ...(ev.organizerEmail ? [{ email: ev.organizerEmail }] : [])];
        for (const a of cands) {
          const em = String(a.email || '').trim().toLowerCase();
          if (!em || a.self || own.has(em)) continue;
          const rec = byEmail.get(em);
          if (!rec) continue; // not a CRM person — no material to build from
          const primary = String(rec.fields['Email'] || '').trim().toLowerCase();
          const nm = `${rec.fields['First Name'] || ''} ${rec.fields['Last Name'] || ''}`.trim();
          const key = primary || em;
          if (!people.has(key)) people.set(key, { key, name: nm || a.displayName || em, recId: rec.id, email: primary || em, hasDraft: true });
        }
      }
    } catch (e) { console.warn(`[dossier] calendar prep pass skipped: ${e.message}`); }

    if (!people.size) return out;

    // Voice rules + asset library, rendered ONCE for guidance drafts. Assets go in as {{asset:key}}
    // placeholders — the push path (wingguy_create_draft) resolves them AND enforces the
    // never-repeat-an-asset gate, so an overnight suggestion can't double-send anything.
    let rulesText = '';
    try { rulesText = (await rulesStore.renderRulesBlock({ tenantId: tenant, contexts: ['reply', 'follow-up'] })).text || ''; } catch (_) {}
    let assetLines = '';
    try {
      const assets = await rulesStore.getAssets({ tenantId: tenant });
      const active = assets.filter((a) => a.status === 'active' && a.url);
      if (active.length) assetLines = `\n\nASSET LIBRARY (optional — include AT MOST ONE link and ONLY when genuinely helpful to this person, as {{asset:KEY}} exactly; usually include none): ${active.map((a) => `${a.asset_key}${a.kind ? ` (${a.kind})` : ''}`).join(', ')}`;
    } catch (_) {}

    // Client's stored key when present (header-less path); blank -> platform, as before.
    const anthropicKey = coach.anthropicApiKey || null;
    console.log(`[dossier] anthropic lane=${anthropicKey ? 'client-stored-key' : 'platform-fallback'} tenant=${tenant}`);
    const llm = getAnthropicClientForKey(anthropicKey);
    for (const person of people.values()) {
      try {
        const rec = (person.email && byEmail.get(person.email)) || byName.get(person.name.toLowerCase()) || null;
        const first = rec ? (rec.fields['First Name'] || '') : person.name.split(' ')[0];
        const recId = person.recId || (rec && rec.id) || null;

        const emails = await gatherEmails(mailProvider, coach, person.email);
        const li = gatherLinkedIn(rec ? rec.fields['Notes'] : '', first);
        const meetings = await gatherMeetings(tenant, recId, person.name);
        const timeline = [...emails, ...li].sort((a, b) => String(a.date).localeCompare(String(b.date)));
        if (!timeline.length && !meetings.length) { out.failed++; continue; }

        // Version prefix invalidates every cached dossier ONCE on upgrade (v2 = full email bodies;
        // v3 = deep-read consumes the full latest-meeting transcript); thereafter cache as before.
        const basis = `v3|e${emails.length}:${emails.length ? emails[emails.length - 1].date : ''}|l${li.length}:${li.length ? li[li.length - 1].date : ''}|m${meetings.length}:${meetings.length ? meetings[0].date : ''}`;
        const existing = await getDossierRow(tenant, person.key);
        if (existing && existing.basis === basis) { out.cached++; continue; }

        const read = await deepRead(llm, person.name, timeline, meetings);
        const lastHuman = [...timeline].reverse().find((t) => t.kind !== 'calendar');

        // An email handed over INSIDE the LinkedIn thread that never reached the record — the
        // learn-back path only listens to inbound email, so surface it here for the human to
        // confirm (never written to the record silently).
        let unrecordedEmails = [];
        if (rec) {
          const onRecord = new Set([String(rec.fields['Email'] || '').trim().toLowerCase(), ...splitAltEmails(rec.fields['Alt Emails'])].filter(Boolean));
          unrecordedEmails = extractEmailsFromText(rec.fields['Notes']).filter((e) => !onRecord.has(e));
        }

        // Guidance draft for anyone WITHOUT a store draft: embodies the deep-read's next move —
        // recalls the relationship warmly, addresses what actually happened, proposes the step.
        let suggested = null;
        const restIt = /nothing\s*[—-]?\s*let it rest|^nothing\b|no action/i.test(read.next_move || '');
        if (!person.hasDraft && read.next_move && !restIt) {
          try {
            const { writeDraft } = require('./wingguyFollowupBrief');
            const lastInbound = [...timeline].reverse().find((t) => t.dir === 'them' && t.kind === 'email');
            const channel = person.email && lastInbound ? 'email' : 'linkedin';
            const instruction =
              `${read.next_move} Context: ${read.standing} ` +
              (channel === 'linkedin' ? 'This will be pasted into LinkedIn chat — plain short text, no HTML links, no subject.' : '') +
              assetLines;
            const html = await writeDraft(llm, rulesText, { lead: { first: person.name.split(' ')[0], last: '', email: person.email } }, { transcript: timeline.map((t) => `${t.date} [${t.kind}/${t.dir}] ${t.fullText || t.text || ''}`) }, instruction, coach.timezone);
            suggested = {
              channel,
              text: scrub(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()),
              html: channel === 'email' ? scrub(html) : null,
              replyToMessageId: (lastInbound && lastInbound.messageId) || null,
              subject: lastInbound && lastInbound.subject ? (/^re:/i.test(lastInbound.subject) ? lastInbound.subject : `Re: ${lastInbound.subject}`) : null,
            };
          } catch (e) { console.warn(`[dossier] guidance draft for ${person.name}: ${e.message}`); }
        }

        await saveDossier(tenant, person.key, basis, {
          name: person.name, email: person.email, recId,
          linkedin: (rec && String(rec.fields['LinkedIn Profile URL'] || '').trim()) || null,
          location: (rec && String(rec.fields['Location'] || '').trim()) || null,
          builtAt: new Date().toISOString(),
          timeline,
          meetings: meetings.map(({ transcript, ...rest }) => rest), // transcript consumed by deepRead, not duplicated in the payload
          lastHuman: lastHuman ? `${lastHuman.date} (${lastHuman.dir}, ${lastHuman.kind})${lastHuman.subject ? ` "${lastHuman.subject}"` : ''}` : null,
          standing: read.standing || '', commitmentsYou: read.commitments_you || [], commitmentsThem: read.commitments_them || [], remember: read.remember || [], nextMove: read.next_move || '',
          suggestedDraft: suggested,
          unrecordedEmails,
        });
        out.built++;
      } catch (e) { out.failed++; console.warn(`[dossier] ${person.name}: ${e.message}`); }
    }
    console.log(`[dossier] tenant=${tenant} built=${out.built} cached=${out.cached} failed=${out.failed} of ${people.size}`);
    return out;
  } catch (e) { console.error(`[dossier] prepareDossiers failed: ${e.message}`); return out; }
}

// --- presentation ---

function formatDossier(row, opts = {}) {
  if (!row || !row.payload) return null;
  const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  // Profile link: stored on new builds; opts.linkedin is the serve-time fallback for dossiers
  // built before the field existed (avoids a rebuild of the whole store).
  const li = p.linkedin || opts.linkedin || null;
  const loc = p.location || opts.location || null;
  const lines = [
    `DOSSIER: ${li ? `[${p.name}](${li})` : p.name} (built ${String(p.builtAt).slice(0, 16).replace('T', ' ')} UTC)`,
  ];
  if (li) lines.push(`LinkedIn profile: ${li}  ← ALWAYS show this link (or the linked name) when presenting — the human clicks through to paste/see the profile.`);
  lines.push(loc
    ? `Based: ${loc} (state where they're based per the booking rules; times offered later must be on THEIR clock)`
    : `Based: NOT RECORDED — before offering any meeting times, ask the human where this person is (booking rules: never guess a timezone).`);
  lines.push(`\nWHERE IT STANDS: ${p.standing}`);
  if ((p.commitmentsYou || []).length) lines.push(`\nYOU promised: ${p.commitmentsYou.join(' · ')}`);
  if ((p.commitmentsThem || []).length) lines.push(`THEY promised/delivered: ${p.commitmentsThem.join(' · ')}`);
  if ((p.remember || []).length) {
    lines.push(`\nREMEMBER:`);
    for (const r of p.remember) lines.push(`- ${r}`);
  }
  if (p.nextMove) lines.push(`\nSUGGESTED NEXT: ${p.nextMove}`);
  if (p.suggestedDraft && p.suggestedDraft.text) {
    lines.push(`\nSUGGESTED DRAFT (embodies the next move — show it, tweak in chat, push/copy ONLY on approval${p.suggestedDraft.channel === 'linkedin' ? '; LinkedIn paste-ready' : ''}):`);
    lines.push(`"${p.suggestedDraft.text}"`);
    if (p.suggestedDraft.channel === 'email' && p.suggestedDraft.replyToMessageId) lines.push(`push with: to=${p.email}, subject="${p.suggestedDraft.subject}", reply_to_message_id=${p.suggestedDraft.replyToMessageId} (any {{asset:KEY}} resolves + usage-gates at push)`);
  } else if (/nothing\s*[—-]?\s*let it rest|^nothing\b|no action/i.test(p.nextMove || '')) {
    // Deliberate absence must never read as "we didn't get to it" (Guy 2026-07-24).
    lines.push(`\nNO DRAFT ON PURPOSE — the overnight read judged this one should rest. Compose only if the human insists.`);
  }
  if (p.lastHuman) lines.push(`Last human message: ${p.lastHuman}`);
  if ((p.unrecordedEmails || []).length) {
    lines.push(`\n⚠ EMAIL SEEN IN THE THREAD, NOT ON THE RECORD: ${p.unrecordedEmails.join(', ')} — handed over in conversation but never learned onto the record's Email/Alt Emails. Suggest the human confirm and update the record; NEVER change it silently.`);
  }
  if ((p.meetings || []).length) {
    lines.push(`\nMEETINGS:`);
    for (const m of p.meetings) lines.push(`- ${m.date || '?'} "${m.title}"${m.summary ? `: ${String(m.summary).slice(0, 500)}` : ' (no summary stored)'}`);
  }
  if ((p.timeline || []).length) {
    lines.push(`\nTIMELINE:`);
    for (const t of p.timeline) lines.push(`- ${t.date} [${t.kind}/${t.dir}]${t.subject ? ` (${t.subject})` : ''} ${t.text || ''}`);
  }
  const fulls = (p.timeline || []).filter((t) => t.fullText);
  if (fulls.length) {
    lines.push(`\nLATEST FROM THEM, FULL TEXT (no need to read the mailbox live):`);
    for (const t of fulls) lines.push(`--- ${t.date}${t.subject ? ` "${t.subject}"` : ''} ---\n${t.fullText}`);
  }
  return lines.join('\n');
}

module.exports = { prepareDossiers, findDossierByName, getDossierRow, formatDossier, buildLiveMiniDossier, formatLiveDossier, scrub, parseJsonArrayLoose };
