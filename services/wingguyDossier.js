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
    const { getAnthropicClient } = require('../config/anthropicClient');
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

    // One Airtable read for Notes + missing rec ids (dossiers need LinkedIn history).
    const records = await base('Leads').select({ fields: ['First Name', 'Last Name', 'Email', 'Notes', 'LinkedIn Profile URL', 'Location'] }).all();
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

        // Version prefix invalidates every cached dossier ONCE on upgrade (v2 = full email bodies;
        // v3 = deep-read consumes the full latest-meeting transcript); thereafter cache as before.
        const basis = `v3|e${emails.length}:${emails.length ? emails[emails.length - 1].date : ''}|l${li.length}:${li.length ? li[li.length - 1].date : ''}|m${meetings.length}:${meetings.length ? meetings[0].date : ''}`;
        const existing = await getDossierRow(tenant, person.key);
        if (existing && existing.basis === basis) { out.cached++; continue; }

        const read = await deepRead(llm, person.name, timeline, meetings);
        const lastHuman = [...timeline].reverse().find((t) => t.kind !== 'calendar');

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
            const html = await writeDraft(llm, rulesText, { lead: { first: person.name.split(' ')[0], last: '', email: person.email } }, { transcript: timeline.map((t) => `${t.date} [${t.kind}/${t.dir}] ${t.fullText || t.text || ''}`) }, instruction);
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

module.exports = { prepareDossiers, findDossierByName, getDossierRow, formatDossier, scrub, parseJsonArrayLoose };
