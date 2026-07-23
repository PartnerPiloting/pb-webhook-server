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
 */

require('dotenv').config();
const { Pool } = require('pg');

const MS_DAY = 86400000;
const MODEL_ID = process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-5';
const NO_THINKING = { type: 'disabled' };
const EMAIL_LIMIT = 12;
const LI_LIMIT = 12;

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

async function saveDossier(tenantId, personKey, basis, payload) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const c = await p.connect();
  try {
    await ensureSchema(c);
    await c.query(
      `INSERT INTO wingguy_dossiers (tenant_id, person_key, built_at, basis, payload) VALUES ($1, $2, now(), $3, $4)
       ON CONFLICT (tenant_id, person_key) DO UPDATE SET built_at = now(), basis = EXCLUDED.basis, payload = EXCLUDED.payload`,
      [tenantId, personKey, basis, JSON.stringify(payload)],
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
    out.push({ date: iso, kind: 'linkedin', dir: theirs ? 'them' : 'you', text: String(m[6]).slice(0, 300) });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out.slice(-max);
}

async function gatherEmails(mailProvider, coach, email, max = EMAIL_LIMIT) {
  if (!email) return [];
  try {
    const found = await mailProvider.findMessages(coach, { anyEmail: email, limit: max });
    if (!found.ok) return [];
    return (found.messages || [])
      .slice().sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
      .map((m) => {
        const theirs = (m.fromEmail || '').toLowerCase() === email;
        const calendarish = /^(accepted|declined|tentative|invitation|updated invitation|canceled)/i.test(m.subject || '');
        return { date: (m.date || '').slice(0, 10), kind: calendarish ? 'calendar' : 'email', dir: theirs ? 'them' : 'you', subject: m.subject || '', text: String(m.snippet || '').slice(0, 280), messageId: m.id };
      });
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
        `SELECT m.title, m.meeting_start, m.summary_json FROM recall_meetings m
         JOIN recall_meeting_leads l ON l.meeting_id = m.id
         WHERE l.airtable_lead_id = $1 AND (m.coach_client_id = $2 OR m.coach_client_id IS NULL)
         ORDER BY m.meeting_start DESC NULLS LAST LIMIT 3`, [recId, tenantId]);
      rows = r.rows;
    }
    if (!rows.length && fullName) {
      const r = await c.query(
        `SELECT title, meeting_start, summary_json FROM recall_meetings
         WHERE title ILIKE $1 AND (coach_client_id = $2 OR coach_client_id IS NULL)
         ORDER BY meeting_start DESC NULLS LAST LIMIT 3`, [`%${fullName}%`, tenantId]);
      rows = r.rows;
    }
    return rows.map((m) => {
      let summary = null;
      try { const j = JSON.parse(m.summary_json || 'null'); summary = j && (j.summary || j.recap || JSON.stringify(j).slice(0, 1200)); } catch (_) { summary = m.summary_json ? String(m.summary_json).slice(0, 1200) : null; }
      return { date: m.meeting_start ? new Date(m.meeting_start).toISOString().slice(0, 10) : null, title: m.title || '(meeting)', summary };
    });
  } catch (e) { return []; } finally { c.release(); }
}

// --- deep read (one LLM pass) ---

const DEEP_SYSTEM = `You prepare a coach's memory-dossier for one contact. From the dated timeline (emails, LinkedIn messages, calendar responses) and any meeting summaries, write JSON:
{"standing": "one tight paragraph: where this relationship ACTUALLY stands right now — read the words, note who spoke last and what is really owed; flag calendar mishaps (accept-then-decline artifacts, invites that lapsed while someone was away) rather than reading them as disinterest",
 "commitments_you": ["each thing the COACH promised, with when"],
 "commitments_them": ["each thing THEY promised or delivered"],
 "next_move": "one sentence: the smartest next action"}
Ground everything ONLY in the material given. Return ONLY the JSON object.`;

async function deepRead(llm, name, timeline, meetings) {
  const material = [
    `CONTACT: ${name}`,
    `TIMELINE (oldest first):`,
    ...timeline.map((t) => `${t.date} [${t.kind}/${t.dir}] ${t.subject ? `(${t.subject}) ` : ''}${t.text || ''}`),
    ...(meetings.length ? ['MEETING SUMMARIES:', ...meetings.map((m) => `${m.date || '?'} "${m.title}": ${m.summary || '(no summary stored)'}`)] : []),
  ].join('\n');
  const resp = await llm.messages.create({
    model: MODEL_ID, max_tokens: 1500, thinking: NO_THINKING,
    system: DEEP_SYSTEM,
    messages: [{ role: 'user', content: scrub(`Today is ${new Date().toISOString().slice(0, 10)}.\n\n${material.slice(0, 16000)}`) }],
  });
  const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  return JSON.parse(text.slice(s, e + 1));
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
    const { getAnthropicClient } = require('../config/anthropicClient');
    const briefStore = require('./wingguyFollowupBrief');
    const backlog = require('./wingguyBacklogAudit');

    const coach = await clientService.getClientById(tenant);
    if (!coach) return out;
    const base = clientService.getClientBase(coach.airtableBaseId);

    // Collect actionable people from both stores.
    const people = new Map(); // key -> {name, recId, email}
    const addFrom = (items, verdicts) => {
      for (const it of (items || [])) {
        if (!verdicts.includes(it.verdict)) continue;
        if (it.status && it.status !== 'pending') continue;
        const key = (it.email || it.name).toLowerCase();
        if (!people.has(key)) people.set(key, { key, name: it.name, recId: it.recId || null, email: it.email || null });
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
      addFrom(p && p.items, ['reopen', 'park']);
    } catch (_) {}
    if (!people.size) return out;

    // One Airtable read for Notes + missing rec ids (dossiers need LinkedIn history).
    const records = await base('Leads').select({ fields: ['First Name', 'Last Name', 'Email', 'Notes'] }).all();
    const byEmail = new Map(); const byName = new Map();
    for (const r of records) {
      const em = String(r.fields['Email'] || '').trim().toLowerCase();
      const nm = `${r.fields['First Name'] || ''} ${r.fields['Last Name'] || ''}`.trim().toLowerCase();
      if (em && !byEmail.has(em)) byEmail.set(em, r);
      if (nm && !byName.has(nm)) byName.set(nm, r);
    }

    const llm = getAnthropicClient();
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

        const basis = `e${emails.length}:${emails.length ? emails[emails.length - 1].date : ''}|l${li.length}:${li.length ? li[li.length - 1].date : ''}|m${meetings.length}:${meetings.length ? meetings[0].date : ''}`;
        const existing = await getDossierRow(tenant, person.key);
        if (existing && existing.basis === basis) { out.cached++; continue; }

        const read = await deepRead(llm, person.name, timeline, meetings);
        const lastHuman = [...timeline].reverse().find((t) => t.kind !== 'calendar');
        await saveDossier(tenant, person.key, basis, {
          name: person.name, email: person.email, recId,
          builtAt: new Date().toISOString(),
          timeline, meetings,
          lastHuman: lastHuman ? `${lastHuman.date} (${lastHuman.dir}, ${lastHuman.kind})${lastHuman.subject ? ` "${lastHuman.subject}"` : ''}` : null,
          standing: read.standing || '', commitmentsYou: read.commitments_you || [], commitmentsThem: read.commitments_them || [], nextMove: read.next_move || '',
        });
        out.built++;
      } catch (e) { out.failed++; console.warn(`[dossier] ${person.name}: ${e.message}`); }
    }
    console.log(`[dossier] tenant=${tenant} built=${out.built} cached=${out.cached} failed=${out.failed} of ${people.size}`);
    return out;
  } catch (e) { console.error(`[dossier] prepareDossiers failed: ${e.message}`); return out; }
}

// --- presentation ---

function formatDossier(row) {
  if (!row || !row.payload) return null;
  const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  const lines = [
    `DOSSIER: ${p.name} (built ${String(p.builtAt).slice(0, 16).replace('T', ' ')} UTC)`,
    `\nWHERE IT STANDS: ${p.standing}`,
  ];
  if ((p.commitmentsYou || []).length) lines.push(`\nYOU promised: ${p.commitmentsYou.join(' · ')}`);
  if ((p.commitmentsThem || []).length) lines.push(`THEY promised/delivered: ${p.commitmentsThem.join(' · ')}`);
  if (p.nextMove) lines.push(`\nSUGGESTED NEXT: ${p.nextMove}`);
  if (p.lastHuman) lines.push(`Last human message: ${p.lastHuman}`);
  if ((p.meetings || []).length) {
    lines.push(`\nMEETINGS:`);
    for (const m of p.meetings) lines.push(`- ${m.date || '?'} "${m.title}"${m.summary ? `: ${String(m.summary).slice(0, 500)}` : ' (no summary stored)'}`);
  }
  if ((p.timeline || []).length) {
    lines.push(`\nTIMELINE:`);
    for (const t of p.timeline) lines.push(`- ${t.date} [${t.kind}/${t.dir}]${t.subject ? ` (${t.subject})` : ''} ${t.text || ''}`);
  }
  return lines.join('\n');
}

module.exports = { prepareDossiers, findDossierByName, getDossierRow, formatDossier, scrub };
