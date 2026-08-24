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
 *   - emailRecord (2026-08-19): the sent/received mail record folded INTO the payload — outbound
 *     index with every link written out in full, the latest outbound email whole, facts extracted
 *     from what was actually written (commitments and whether honoured, deferrals verbatim,
 *     promised intros), and an inbound index. Born of the 19 Aug brief telling the human to
 *     "check whether the links actually went out" instead of checking: the instruction existed,
 *     was read, and still lost to the moment. A step that does not exist cannot be skipped, so
 *     the data now arrives in the payload. Read from the tenant's own mailbox across EVERY
 *     address on the record (Email + Alt Emails + the invite address) — never the asset ledger,
 *     which only knows library assets drafted through wingguy_create_draft since 2026-07-16 and
 *     is blind to a hand-typed link.
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
// Transcript budget for the deep read (Guy 2026-08-17: "I'm having so many calls that I can't
// remember what happened"). The LAST TWO calls are read, not just the latest — a third call needs
// to know what the second one was about. Older meetings still contribute their stored summary.
// Characters, not tokens. Was [14000, 10000] — which covered ~15 minutes of a call, and the deep
// read confidently reported the cut point as "the call ended there", deriving next steps from a
// false premise (Matthew Bulat's 61-min call recapped as ending at minute 16; two promised
// follow-up emails missed — 2026-08-18). An hour of talk is ~55k chars, so these budgets fit
// whole real calls; anything that still overflows gets an explicit truncation marker instead of
// a silent cliff (see gatherMeetings / deepRead).
const TRANSCRIPT_CHARS = [100000, 60000];
// Material ceiling for the deep read. Must comfortably hold both transcript budgets plus the
// timeline; ~220k chars is ~55k tokens, well inside the model's window, cents and only on rebuild.
const MATERIAL_CHARS = 220000;

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
    // Sort must include the TIME: Notes are newest-first, and a date-only key left same-day
    // messages reversed (a reply rendered above the message it answers — the Steve Martin serve,
    // 2026-08-03). The time is dropped before return: only this sort needs it.
    const tm = m[4].match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    const hh = tm ? (parseInt(tm[1], 10) % 12) + (/^P/i.test(tm[3]) ? 12 : 0) : 0;
    const sortKey = `${iso} ${String(hh).padStart(2, '0')}:${tm ? tm[2] : '00'}`;
    // scrub at the SOURCE: a lone surrogate here poisons BOTH the LLM request and the jsonb save.
    // A silent slice reads as "the sender stopped mid-thought" (the 24 Jul 2026 dossier invented
    // an apology for an 'unfinished' message) - mark it so downstream knows the RECORD ends here,
    // not the message.
    const liBody = String(m[6]);
    out.push({ sortKey, date: iso, kind: 'linkedin', dir: theirs ? 'them' : 'you', text: scrub(liBody.length > 300 ? `${liBody.slice(0, 300)} …[record clipped]` : liBody) });
  }
  // SAME-MINUTE ties: Notes are newest-first, and a stable sort keeps source order for equal keys
  // — so two messages in the same minute rendered reply-above-question (John Addario's 8:11 PM
  // opener + "Sounds good" reply, spotted by Guy on the Follow-Ups screen 2026-08-15). Reversing
  // BEFORE the sort makes ties land oldest-first, matching the conversation's actual flow.
  out.reverse();
  out.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return out.slice(-max).map(({ sortKey, ...rest }) => rest);
}

// --- the email record (2026-08-19) ---

const EMAIL_FETCH_LIMIT = 20;    // findMessages hard-caps a page at 20 — per ADDRESS, so alts widen it
const RECORD_BODY_FETCHES = 24;  // full-body reads per person per rebuild, newest human emails first
const FACT_BODY_CHARS = 3500;    // per-message text handed to the facts pass
const FACT_MATERIAL_CHARS = 120000; // ceiling for the whole facts-pass material
const LAST_OUTBOUND_CHARS = 6000;

/**
 * Inline every anchor's href beside its label BEFORE tags are stripped — a link written as
 * <a href="url">this article</a> otherwise vanishes with the markup and the record under-reports,
 * which is the exact failure this block exists to end.
 */
function inlineAnchorHrefs(html) {
  return String(html || '').replace(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)');
}

/** Every http(s) link in a rendered body, in order of appearance, deduped, trailing punctuation shed. */
function extractLinks(text) {
  const raw = String(text || '').match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  return [...new Set(raw.map((u) => u.replace(/[.,;:!?]+$/, '')))];
}

const EMPTY_RECORD = () => ({ addresses: [], capped: false, outbound: [], lastOutbound: null, inbound: [], facts: null });

/**
 * ONE fetch pass over a person's email exchange, across EVERY address known for them (primary +
 * Alt Emails + the invite address). A lookup that misses an alt address silently under-reports and
 * the brief looks complete while being wrong (Owen Pyrah writes from two addresses; Guy McPhee from
 * several). Returns:
 *   - timeline: the snippet rows the dossier always carried (same shape — deepRead and the served
 *     timeline are unchanged), newest `max`, plus fullText on the latest 2 inbound human emails
 *     (snippets truncate mid-sentence and mislead — the 2026-07-24 phantom-referral theory).
 *   - record: the EMAIL RECORD block — outbound index with every link extracted from the body
 *     itself, latest outbound in full, inbound index. facts stays null here; the caller fills it.
 *   - thread: the full-text exchange (quoted tails stripped) for the facts pass.
 * Direction is strict for the record: a third party writing on an intro thread is NEITHER side and
 * must never appear as coach outbound (the timeline keeps its historical them/not-them split).
 */
async function gatherEmailRecord(mailProvider, coach, addresses, max = EMAIL_LIMIT) {
  const addrs = [...new Set((addresses || []).map((a) => String(a || '').trim().toLowerCase()).filter(Boolean))];
  if (!addrs.length) return { timeline: [], record: EMPTY_RECORD(), thread: [] };
  const addrSet = new Set(addrs);
  const { htmlToText, stripQuotedTail, coachOwnEmails } = require('./wingguyMailMcp');
  const own = coachOwnEmails(coach);

  const byId = new Map();
  let capped = false;
  for (const a of addrs) {
    try {
      const found = await mailProvider.findMessages(coach, { anyEmail: a, limit: EMAIL_FETCH_LIMIT });
      if (!found.ok) continue;
      if ((found.messages || []).length >= EMAIL_FETCH_LIMIT) capped = true; // page cap hit — oldest mail may be missing; say so, never imply completeness
      for (const m of found.messages || []) if (m.id && !byId.has(m.id)) byId.set(m.id, m);
    } catch (_) { /* one address failing must not empty the whole record */ }
  }
  const rows = [...byId.values()]
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
    .map((m) => {
      const fromLc = (m.fromEmail || '').toLowerCase();
      const theirs = addrSet.has(fromLc);
      const calendarish = /^(accepted|declined|tentative|invitation|updated invitation|canceled)/i.test(m.subject || '');
      return {
        date: (m.date || '').slice(0, 10), kind: calendarish ? 'calendar' : 'email',
        dir: theirs ? 'them' : 'you',
        strictDir: theirs ? 'them' : (!own.size || own.has(fromLc) ? 'you' : 'other'),
        subject: scrub(m.subject || ''), text: scrub(String(m.snippet || '').slice(0, 280)),
        messageId: m.id, attachments: m.attachments || [],
      };
    });

  // FULL BODIES (newest human emails first, capped). Links and facts both come from what was
  // actually written, so the body is the source, never the snippet and never a summary phrase.
  // Quoted tails stripped: a reply must not inherit the OTHER side's links or words.
  const human = rows.filter((r) => r.kind === 'email');
  for (const r of human.slice(-RECORD_BODY_FETCHES)) {
    try {
      const full = await mailProvider.getMessage(coach, r.messageId);
      if (full.ok && full.message) {
        const text = stripQuotedTail(htmlToText(inlineAnchorHrefs(full.message.body || '')) || String(full.message.snippet || ''));
        r.bodyText = scrub(text);
        r.links = extractLinks(text);
        if (!r.attachments.length && (full.message.attachments || []).length) r.attachments = full.message.attachments;
      }
    } catch (_) { /* snippet remains; links stay null = honestly unknown */ }
  }
  const latestTheirs = human.filter((r) => r.strictDir === 'them' && r.bodyText).slice(-2);
  for (const r of latestTheirs) r.fullText = r.bodyText.replace(/\s+/g, ' ').trim().slice(0, 1800);

  const out = human.filter((r) => r.strictDir === 'you');
  const lastOut = out.length ? out[out.length - 1] : null;
  const record = {
    addresses: addrs,
    capped,
    // Newest first. links: null means the body was never read (older than the fetch budget) —
    // honestly distinct from [] = "read, and no links". Never collapse either into a phrase like
    // "links were sent".
    outbound: [...out].reverse().map((r) => ({
      date: r.date, subject: r.subject,
      links: r.links || null,
      attachments: (r.attachments || []).length ? r.attachments : [],
    })),
    // The message that set up the conversation about to happen — regularly carries a ready-made
    // opening line. THE one full body the record keeps; everything else is index + facts, because
    // forty raw emails five minutes before the first call relocates the problem, not solves it.
    lastOutbound: lastOut ? {
      date: lastOut.date, subject: lastOut.subject,
      text: lastOut.bodyText
        ? (lastOut.bodyText.length > LAST_OUTBOUND_CHARS
          ? lastOut.bodyText.slice(0, LAST_OUTBOUND_CHARS) + ' [CLIPPED FOR LENGTH — the email continues past this point]'
          : lastOut.bodyText)
        : null,
    } : null,
    inbound: human.filter((r) => r.strictDir === 'them').reverse().map((r) => ({ date: r.date, subject: r.subject, snippet: r.text })),
    facts: null,
  };
  // Calendar accept/decline machinery stays OUT of the indexes, but a decline's comment is often
  // the deferral in the sender's own words (Celeste, 14 Aug: "really flat out with new staff and a
  // few big projects") — feed those snippets to the facts pass so the reason survives verbatim
  // instead of the record claiming no quote exists.
  const calendarNotes = rows.filter((r) => r.kind === 'calendar' && r.text);
  const thread = [...human.filter((r) => r.bodyText), ...calendarNotes]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((r) => ({
      date: r.date, dir: r.strictDir, subject: r.subject,
      text: r.bodyText
        ? (r.bodyText.length > FACT_BODY_CHARS ? r.bodyText.slice(0, FACT_BODY_CHARS) + ' [CLIPPED FOR LENGTH]' : r.bodyText)
        : r.text,
      attachments: r.attachments || [],
    }));
  const timeline = rows.slice(-max).map(({ strictDir, bodyText, links, attachments, ...rest }) => rest);
  return { timeline, record, thread };
}

const FACTS_SYSTEM = `You extract the EMAIL RECORD facts for a coach's dossier on one contact, from the full text of their actual email exchange. Quoted reply-tails were already stripped; a [CLIPPED FOR LENGTH] marker means YOUR INPUT was cut, never that the sender stopped. dir=you is the coach, dir=them is the contact, dir=other is a third party on the thread. Ground EVERYTHING in the words given — never infer, never invent; empty arrays are the correct answer when the material holds nothing. Return ONLY JSON:
{"commitments_you": ["each commitment the COACH made in writing, with its date, each ending with one of: — appears honoured / — appears outstanding / — unclear from the thread"],
 "commitments_them": ["same for commitments THEY made (a promised introduction counts)"],
 "dates_promised": ["every date, time or deadline promised in writing, either direction, with who said it"],
 "deferrals": ["each deferral, with the stated reason QUOTED VERBATIM in the sender's own words, e.g.: them, 2026-08-14: \\"flat out with the audit until month end\\" — never paraphrase a deferral as declined"],
 "third_parties": ["named third parties — especially introductions promised but not yet made"],
 "personal": ["personal details volunteered in the emails — travel, illness, family, transitions"],
 "attachments": ["anything attached, from the attachment names given per message; empty if none"]}`;

/** The facts pass — one small LLM read of the full thread, separate from deepRead so a long
 * dossier response can never truncate these facts into invalid JSON (nor vice versa). */
async function emailFactsRead(llm, name, thread) {
  const material = [
    `CONTACT: ${name}`,
    'EMAIL THREAD (oldest first):',
    ...thread.map((t) => `--- ${t.date} [${t.dir}] "${t.subject}"${(t.attachments || []).length ? ` (attached: ${t.attachments.join(', ')})` : ''} ---\n${t.text}`),
  ].join('\n');
  const clipped = material.length > FACT_MATERIAL_CHARS
    ? material.slice(0, FACT_MATERIAL_CHARS) + ' [MATERIAL CLIPPED FOR LENGTH — the thread continues past this point; treat everything after the last complete email as unknown]'
    : material;
  // Up to 2 attempts, same shape as deepRead: a truncated or malformed reply is INVALID JSON and
  // the facts vanish for the night (Rick Wong, first v7 backfill 2026-08-19: "Unexpected end of
  // JSON input"). max_tokens 2500 -> 4000 for the same reason: headroom beats a silent hole.
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await llm.messages.create({
      model: MODEL_ID, max_tokens: 4000, thinking: NO_THINKING,
      system: FACTS_SYSTEM + (attempt ? '\nSTRICT: your previous output was invalid or truncated JSON. Be more concise per item, escape every double-quote inside string values as \\" and never put raw newlines inside strings.' : ''),
      messages: [{ role: 'user', content: scrub(`Today is ${new Date().toISOString().slice(0, 10)}.\n\n${clipped}`) }],
    });
    const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const s = text.indexOf('{'); const e = text.lastIndexOf('}');
    try {
      return JSON.parse(text.slice(s, e + 1).replace(/[\u0000-\u001f]/g, ' '));
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

/**
 * Trim a transcript to budget WITHOUT lying about it. The old bare .slice() handed the deep read
 * a text that stopped mid-sentence, and the model read "my input ended" as "the call ended" —
 * then wrote WHERE IT STANDS and next moves from that false premise (Matthew Bulat 2026-08-04:
 * 61-min call recapped as cutting off at minute 16; Nikki Tadic 2026-07-22 likewise). Any clip
 * must therefore say so IN the material, with the honest proportion, so the summariser can report
 * partial coverage as a property of the summary, never of the meeting.
 */
function clipTranscript(text, cap) {
  const whole = String(text).replace(/\s+/g, ' ');
  if (whole.length <= cap) return scrub(whole);
  const pct = Math.round((cap / whole.length) * 100);
  return scrub(whole.slice(0, cap)) +
    ` [TRANSCRIPT CLIPPED FOR LENGTH — this is only the first ~${pct}% of the call. The meeting continued past this point; how it ended is NOT in this material.]`;
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
        // FULL transcript of the last TWO meetings — feeds the overnight deep-read, where the
        // specifics live ("back from Brazil the 17th, week of the 22nd, avoid Mon/Tue" — the
        // Celeste details the summary alone missed) and where the per-call recap is written from.
        // Not stored in the payload (it already lives in recall_meetings); consumed at read time.
        transcript: m.transcript_text && i < TRANSCRIPT_CHARS.length
          ? clipTranscript(m.transcript_text, TRANSCRIPT_CHARS[i])
          : null,
      };
    });
  } catch (e) { return []; } finally { c.release(); }
}

// --- live CRM fallback (the Steve Martin blind spot, 2026-08-03) ---

// Tolerant Alt-Emails split — same delimiters inboundEmailService reads (written newline-separated).
function splitAltEmails(v) {
  return String(v || '').toLowerCase().split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Every email address mentioned anywhere in a text blob (lowercased, deduped).
 *
 * LinkedIn capture flattens newlines, so a sign-off can run straight into the address:
 * "...4th of Aug.RegardsStevesteve@salesdirectorcentral.com" (the real Steve Martin Notes text) —
 * a naive match swallows the sentence tail into the local part. Repair heuristic, deliberately
 * conservative: only when the RAW local part shows smash evidence (an internal capital after a
 * lowercase letter or a dot — sentence case, which typed addresses lack), trim to the LAST
 * occurrence of the person's first name (sign-offs end with the name; addresses usually start
 * with it). A clean lowercase address is never touched.
 */
function extractEmailsFromText(text, firstName) {
  const raws = String(text || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const fn = String(firstName || '').trim().toLowerCase();
  const out = [];
  for (const raw of raws) {
    const at = raw.lastIndexOf('@');
    let local = raw.slice(0, at);
    const domain = raw.slice(at + 1).toLowerCase();
    if (/[a-z.][A-Z]/.test(local) && fn.length >= 3) {
      const i = local.toLowerCase().lastIndexOf(fn);
      if (i > 0) local = local.slice(i);
    }
    out.push(`${local.toLowerCase()}@${domain}`);
  }
  return [...new Set(out)];
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
  const unrecordedEmails = extractEmailsFromText(f['Notes'], f['First Name']).filter((e) => !onRecord.has(e));
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
 "remember": ["4-8 short bullets of concrete specifics worth holding onto — their business and situation (what they do, how long, target market, point of difference), what resonated or aligned in conversation, objections or hesitations, stated preferences (days, times, channels). The coach juggles many people; these bullets ARE the memory."],
 "personal": ["0-5 short bullets of the HUMAN detail, kept apart from the business facts so it survives: family, travel and holidays, where they live and what they said about it, health, sport, hobbies, how they spend their time, what they were excited or frustrated about. Only what they actually said. Empty array if the material holds none — never invent warmth."],
 "why_meeting": "one or two sentences: WHY this person and the coach are talking at all — how the meeting came about and what they said they wanted from it, quoting their own words where you can. Read the messages that arranged the meeting, not just the meeting itself. This is what the coach reads walking in to a FIRST call, so it must stand alone. Empty string only if the material genuinely never says.",
 "meeting_recaps": [{"date": "YYYY-MM-DD", "title": "the meeting title", "about": "one sentence: what this call was for", "happened": "a full paragraph, and be generous with it — what was actually discussed, what THEY said in their own words, what they reacted to, where it warmed or cooled, what was decided. The coach cannot remember this call and is walking into the next one; detail here is the whole point, so do not compress it into a summary line.", "personal": "any human detail that came up in THIS call, or empty string", "ended": "one sentence: how the call was left — what each side said they would do next"}],
 "next_move": "one sentence: the smartest next action. For a WARM relationship that has clearly ended, that may be a one-line graceful close (door-open goodbye) — say so explicitly. For a cold or never-real thread, say exactly: nothing — let it rest."}
Write one meeting_recaps entry per meeting you were given a FULL TRANSCRIPT for, newest first; if you were given no transcript, return an empty array rather than reconstructing a call from the emails around it. Ground everything ONLY in the material given.
PARTIAL INPUT IS NEVER A MEETING FACT. A transcript ending with a [TRANSCRIPT CLIPPED FOR LENGTH …] marker (or any material ending with [MATERIAL CLIPPED …]) means YOUR INPUT was cut, not that the call ended there. Never write that a call "ended", "cut off", "cut out" or "was interrupted" at the point your text stops. For a clipped call: open its "happened" with the coverage ("covers roughly the first N% of the call"), keep standing/commitments/next_move within what that portion supports, and set "ended" to exactly what is true — the ending is not in this material. Even without a marker, describe how a call ended only when the words themselves close the meeting (goodbyes, agreed next steps). Return ONLY the JSON object.`;

async function deepRead(llm, name, timeline, meetings) {
  const withTranscript = meetings.filter((m) => m.transcript);
  const material = [
    `CONTACT: ${name}`,
    `TIMELINE (oldest first):`,
    ...timeline.map((t) => `${t.date} [${t.kind}/${t.dir}] ${t.subject ? `(${t.subject}) ` : ''}${t.fullText ? `FULL TEXT: ${t.fullText}` : (t.text || '')}`),
    ...(meetings.length ? ['MEETING SUMMARIES:', ...meetings.map((m) => `${m.date || '?'} "${m.title}": ${m.summary || '(no summary stored)'}`)] : []),
    // Newest transcript first, each labelled so the recaps can be attributed to the right call.
    ...withTranscript.flatMap((m, i) => [
      `FULL TRANSCRIPT of the ${i === 0 ? 'most recent' : 'previous'} meeting (${m.date} "${m.title}") — mine it for specifics the summary missed (named dates, travel, commitments, preferences) AND write its meeting_recaps entry from it:`,
      m.transcript,
    ]),
  ].join('\n');
  // Ceiling clip must be as honest as the transcript clip — a bare slice here would recreate the
  // exact bug the marker upstream exists to prevent (input-end read as meeting-end).
  const materialClipped = material.length > MATERIAL_CHARS
    ? material.slice(0, MATERIAL_CHARS) + ' [MATERIAL CLIPPED FOR LENGTH — the records continue past this point; treat everything after the last complete item as unknown, not as absent.]'
    : material;
  // Up to 2 attempts: the model occasionally breaks its own JSON (unescaped quotes when quoting
  // someone — killed Celeste's and Piyush's dossiers on 2026-07-24). Control-char sanitation first,
  // then one full retry with a sterner instruction.
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    // max_tokens 2200 -> 6000 (2026-08-17): the per-call recaps are deliberately long, and a
    // truncated response is not a short dossier — it is INVALID JSON, so the person's dossier
    // fails outright. Headroom is far cheaper than a silent miss on the morning of a call.
    const resp = await llm.messages.create({
      model: MODEL_ID, max_tokens: 6000, thinking: NO_THINKING,
      system: DEEP_SYSTEM + (attempt ? '\nSTRICT: your previous output was invalid JSON. Escape every double-quote inside string values as \\" and never put raw newlines inside strings.' : ''),
      messages: [{ role: 'user', content: scrub(`Today is ${new Date().toISOString().slice(0, 10)}.\n\n${materialClipped}`) }],
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
async function prepareDossiers(tenant, opts = {}) {
  const out = { built: 0, cached: 0, failed: 0 };
  try {
    const clientService = require('./clientService');
    const mailProvider = require('./mailProvider');
    const { resolveClientAnthropic } = require('../config/anthropicClient');
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
      // Since the brief went full-list (2026-08-24, ~140 items), the dossier pass takes only its
      // TOP slice — a deep dossier is minutes + several LLM calls per person, and 100+ of them
      // nightly is hours and real money. Everyone past the slice still gets a live mini-dossier
      // on demand (buildLiveMiniDossier), and rises into the slice as the queue is worked down.
      const DOSSIER_BRIEF_TOP = 25;
      const briefItems = (p && p.items) || [];
      if (briefItems.length > DOSSIER_BRIEF_TOP) console.log(`[dossier] brief has ${briefItems.length} items — deep dossiers for the top ${DOSSIER_BRIEF_TOP} only (rest live on demand)`);
      addFrom(briefItems.slice(0, DOSSIER_BRIEF_TOP), ['draft', 'park', 'attention']);
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
      // Window starts a day BACK, not at "now": this pass also runs ad hoc mid-morning (the
      // followups route, one-off jobs), and a window-from-now silently dropped the attendees of
      // meetings already held that day — the very people being prepped/followed up. Cached
      // dossiers make the extra day's checks near-free.
      const cal = await getMeetingsInWindow(coach, new Date(Date.now() - MS_DAY), new Date(Date.now() + PREP_CAL_DAYS * MS_DAY));
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

    // NAMED BUILDS (2026-08-19): opts.extraPeople = [{name, email}] forces specific people into
    // the set. This is the door the live mini-dossier promises ("will get a full overnight
    // dossier if they appear on the calendar or in the queue") for someone who appears in
    // NEITHER — e.g. a meeting already held whose calendar event has since gone. hasDraft=true:
    // a named build wants the memory, not an outreach guidance draft. force=true: an explicit
    // request means BUILD IT NOW — the cache shortcut would refuse to repair a same-basis dossier
    // (e.g. one whose facts pass failed on the night).
    for (const x of opts.extraPeople || []) {
      const em = String(x.email || '').trim().toLowerCase();
      const key = em || String(x.name || '').trim().toLowerCase();
      if (key) people.set(key, { ...(people.get(key) || { key, name: x.name || em, recId: null, email: em || null, hasDraft: true }), force: true });
    }

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

    // Billing gate — see resolveClientAnthropic. No key of their own (and not owner/managed) means
    // no dossier building on Guy's key; the brief's stored error is where the human is told why.
    const lane = resolveClientAnthropic(coach);
    console.log(`[dossier] anthropic lane=${lane.lane} tenant=${tenant}`);
    if (!lane.llm) return { ...out, blocked: true, reason: lane.message };
    const llm = lane.llm;
    for (const person of people.values()) {
      try {
        const rec = (person.email && byEmail.get(person.email)) || byName.get(person.name.toLowerCase()) || null;
        const first = rec ? (rec.fields['First Name'] || '') : person.name.split(' ')[0];
        const recId = person.recId || (rec && rec.id) || null;

        // EVERY address known for this person — primary, Alt Emails, and whatever key the queue or
        // calendar matched them on. One address short = a silently incomplete email record.
        const mail = await gatherEmailRecord(mailProvider, coach, [
          person.email, person.key,
          ...(rec ? [String(rec.fields['Email'] || '').trim().toLowerCase(), ...splitAltEmails(rec.fields['Alt Emails'])] : []),
        ].filter((a) => a && a.includes('@')));
        const emails = mail.timeline;
        const li = gatherLinkedIn(rec ? rec.fields['Notes'] : '', first);
        const meetings = await gatherMeetings(tenant, recId, person.name);
        const timeline = [...emails, ...li].sort((a, b) => String(a.date).localeCompare(String(b.date)));
        if (!timeline.length && !meetings.length) { out.failed++; continue; }

        // Version prefix invalidates every cached dossier ONCE on upgrade (v2 = full email bodies;
        // v3 = deep-read consumes the full latest-meeting transcript); thereafter cache as before.
        // v4 (2026-08-15): version bump forces a ONE-TIME rebuild of every stored dossier. Dossiers
        // built before the 2026-08-03 time-aware sort were fossilised with scrambled within-day
        // timelines (John Addario, built 23 Jul, served wrong on the Follow-Ups screen) — the
        // fingerprint saw "thread unchanged" and never rebuilt them. Subsequent nights are cheap
        // again: the fingerprint compares equal at v4 from then on.
        // v5 (2026-08-17): meeting_recaps / why_meeting / personal are new payload fields, so every
        // stored dossier must be rebuilt once to carry them. Same one-off cost shape as v4.
        // v6 (2026-08-18): the backfill for the truncation bug. v5 dossiers were deep-read from a
        // 14k-char transcript slice with no clip marker, so any call past ~15 minutes was recapped
        // as "cutting off" partway through — WHERE IT STANDS, promises and next moves derived from
        // a false ending (Matthew Bulat, Nikki Tadic). Every stored dossier rebuilds once against
        // the whole transcripts.
        // v7 (2026-08-19): emailRecord is a new payload block (see the header), so every stored
        // dossier rebuilds once to carry it. Same one-off cost shape as v4-v6.
        const basis = `v7|e${emails.length}:${emails.length ? emails[emails.length - 1].date : ''}|l${li.length}:${li.length ? li[li.length - 1].date : ''}|m${meetings.length}:${meetings.length ? meetings[0].date : ''}`;
        const existing = await getDossierRow(tenant, person.key);
        if (!person.force && existing && existing.basis === basis) { out.cached++; continue; }

        const read = await deepRead(llm, person.name, timeline, meetings);
        const lastHuman = [...timeline].reverse().find((t) => t.kind !== 'calendar');

        // The email-record facts pass — best-effort, like the guidance draft: a facts failure
        // costs the FACTS, never the dossier (the mechanical index and full last outbound above
        // it carry the load-bearing answer, "did the links actually go out").
        const emailRecord = mail.record;
        if (mail.thread.length) {
          try { emailRecord.facts = await emailFactsRead(llm, person.name, mail.thread); }
          catch (e) { console.warn(`[dossier] email facts for ${person.name}: ${e.message}`); }
        }

        // An email handed over INSIDE the LinkedIn thread that never reached the record — the
        // learn-back path only listens to inbound email, so surface it here for the human to
        // confirm (never written to the record silently).
        let unrecordedEmails = [];
        if (rec) {
          const onRecord = new Set([String(rec.fields['Email'] || '').trim().toLowerCase(), ...splitAltEmails(rec.fields['Alt Emails'])].filter(Boolean));
          unrecordedEmails = extractEmailsFromText(rec.fields['Notes'], rec.fields['First Name']).filter((e) => !onRecord.has(e));
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
          // Meeting-prep fields (2026-08-17). whyMeeting answers the FIRST-call question ("what is
          // this call even about?"); meetingRecaps answers the SECOND-call one ("what happened last
          // time?"). personal is split out of remember so the human detail can't be crowded out by
          // business facts competing for the same handful of bullets.
          whyMeeting: read.why_meeting || '', personal: read.personal || [],
          meetingRecaps: Array.isArray(read.meeting_recaps) ? read.meeting_recaps : [],
          suggestedDraft: suggested,
          unrecordedEmails,
          emailRecord,
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
  // MEETING PREP FIRST (Guy 2026-08-17). Walking into a call, two questions come before relationship
  // state: what is this call about, and what happened last time. Both sit above WHERE IT STANDS so
  // they survive any summarising on the way to the human.
  if (p.whyMeeting) lines.push(`\nWHY YOU'RE MEETING: ${p.whyMeeting}`);
  const recaps = (p.meetingRecaps || []).filter((r) => r && (r.happened || r.about));
  if (recaps.length) {
    lines.push(`\nPREVIOUS CALLS — relay the most recent one IN FULL when prepping the human for a meeting with this person. This is the part they cannot remember, and a one-line summary of it is a failed brief. Length is fine here; they would rather scroll.`);
    for (const r of recaps) {
      lines.push(`\n--- ${r.date || '?'} "${r.title || 'call'}" ---`);
      if (r.about) lines.push(`What it was for: ${r.about}`);
      if (r.happened) lines.push(`What happened: ${r.happened}`);
      if (r.personal) lines.push(`Personal: ${r.personal}`);
      if (r.ended) lines.push(`Left as: ${r.ended}`);
    }
  } else if ((p.meetings || []).length) {
    lines.push(`\n(Meetings are on record for this person but no transcript was stored, so there is no recap of what was said — say that plainly rather than implying the calls were empty.)`);
  }
  if ((p.personal || []).length) {
    lines.push(`\nPERSONAL — worth opening with, and worth asking after:`);
    for (const r of p.personal) lines.push(`- ${r}`);
  }
  lines.push(`\nWHERE IT STANDS: ${p.standing}`);
  if ((p.commitmentsYou || []).length) lines.push(`\nYOU promised: ${p.commitmentsYou.join(' · ')}`);
  if ((p.commitmentsThem || []).length) lines.push(`THEY promised/delivered: ${p.commitmentsThem.join(' · ')}`);
  if ((p.remember || []).length) {
    lines.push(`\nREMEMBER:`);
    for (const r of p.remember) lines.push(`- ${r}`);
  }
  // EMAIL RECORD (2026-08-19): read from the mailbox at build time so "did the links actually go
  // out?" is answered BY THE PAYLOAD — never handed back to the human as a job, never dependent on
  // remembering an extra tool call. Absences are stated, not implied: "no links" is a checked fact,
  // a missing block is named as missing.
  const er = p.emailRecord;
  if (er) {
    if (!(er.addresses || []).length) {
      lines.push(`\nEMAIL RECORD: no email address on the record for this person — there is no mailbox history to read.`);
    } else {
      lines.push(`\nEMAIL RECORD (read from the mailbox itself at build time, across every known address: ${er.addresses.join(', ')})${er.capped ? ' — provider page cap reached, the OLDEST emails may be missing from this index; say so if asked for the full history' : ''}:`);
      if ((er.outbound || []).length) {
        lines.push(`SENT TO THEM (newest first — every link in the body written out; "no links" is a checked fact):`);
        for (const o of er.outbound) {
          const att = (o.attachments || []).length ? ` (attached: ${o.attachments.join(', ')})` : '';
          if (o.links === null) lines.push(`- ${o.date} "${o.subject}"${att} — body not read (beyond the fetch budget); links UNKNOWN, not absent`);
          else if (!o.links.length) lines.push(`- ${o.date} "${o.subject}"${att} — no links`);
          else {
            lines.push(`- ${o.date} "${o.subject}"${att} — links:`);
            for (const l of o.links) lines.push(`    ${l}`);
          }
        }
      } else {
        lines.push(`SENT TO THEM: nothing on record at any known address.`);
      }
      const f = er.facts;
      if (f) {
        const sec = (label, arr) => { if ((arr || []).length) { lines.push(`${label}:`); for (const x of arr) lines.push(`- ${x}`); } };
        lines.push(`\nFROM THE THREAD (extracted from what was actually written):`);
        sec('Commitments — you', f.commitments_you);
        sec('Commitments — them', f.commitments_them);
        sec('Dates/deadlines promised in writing', f.dates_promised);
        sec('Deferrals (their own words — never paraphrase these as "declined")', f.deferrals);
        sec('Named third parties / promised intros', f.third_parties);
        sec('Personal (from the emails)', f.personal);
        sec('Attachments', f.attachments);
      }
      if (er.lastOutbound && er.lastOutbound.text) {
        lines.push(`\nMOST RECENT OUTBOUND IN FULL (${er.lastOutbound.date} "${er.lastOutbound.subject}") — this set up the conversation about to happen; its closing idea is often the natural opening line:`);
        lines.push(er.lastOutbound.text);
      }
      if ((er.inbound || []).length) {
        lines.push(`\nTHEIR REPLIES (newest first — the shape of the exchange; full bodies via wingguy_read_message only if genuinely needed):`);
        for (const i of er.inbound) lines.push(`- ${i.date} "${i.subject}": ${i.snippet}`);
      } else {
        lines.push(`\nTHEIR REPLIES: none on record at any known address.`);
      }
    }
  } else {
    lines.push(`\nEMAIL RECORD: not in this dossier build (it predates the email-record upgrade); it arrives with the next overnight rebuild. Until then the email side is UNCHECKED — read it live via wingguy_lead_correspondence before claiming anything about what was or wasn't sent.`);
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
  // Everything below is DEPTH, not headline. On a morning meeting-prep run, relay the sections
  // above and close with the offer — "say 'more on <first name>' for the full thread" — rather than
  // rendering the whole record for every attendee. Three attendees relayed in full is the wall the
  // brief exists to avoid; the human asked for length on the RECAP, not on the archive.
  lines.push(`\n[DEPTH — serve on request ("more on ${String(p.name || '').split(' ')[0]}"), not in the morning brief. When prepping meetings, end each person with that offer.]`);
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
