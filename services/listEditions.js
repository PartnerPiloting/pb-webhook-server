// services/listEditions.js
//
// "Network building, rethought" - Guy's weekly email to PROSPECTS (designed with Guy, 26 Oct 2026;
// docs/LIST-EDITIONS.md). It revives the old Mindset Mastery list: the leads tagged `mindset
// mastery` in Guy's CRM, plus anyone he adds with the Weekly button on the Today tab.
//
// How a week runs:
//   - The edition is written once, by the weekend before its Wednesday: one idea from the idea
//     library (services/inspirationLibrary.js), always told through network building - a moment
//     people recognise, the idea, what is different now, one small thing to try - then the short
//     fixed closer. The launch edition (and every newcomer's first email) is the fixed "what does
//     better mean?" piece instead.
//   - Guy approves it - in chat (wingguy_list_edition, first in "let's do this week's emails") or on
//     the portal's Scheduled page. Nothing goes until he does. A nudge reaches him Monday afternoon.
//   - Wednesday from 9:30am Brisbane it goes one email per person ("Hi Sarah,"), a batch each tick,
//     FROM guy@knowaguy.com.au through Mailgun with replies to Guy's own mailbox - so ~250 sends a
//     week never bury his Gmail Sent folder (Guy, 26 Oct). Each send is recorded here per person.
//   - Left off every time: active clients (they get their own weekly email), `unsubscribed`,
//     addresses that bounced in the last 30 days, Guy himself.
//   - A reply that just says "unsubscribe" takes them off by itself (the tag comes off,
//     `unsubscribed` goes on). Anything longer is a normal reply for Guy.
//
// Never twice: an idea used by an edition is never used again for the list. Guy's own Mindset
// Mastery editions are left out - most of the old list has had them.

const { Pool } = require('pg');
const library = require('./inspirationLibrary');
const sched = require('./scheduledEmails');

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
const TZ = 'Australia/Brisbane';
const LIST_TAG = 'mindset mastery';
const UNSUB_TAG = 'unsubscribed';
const SERIES = 'Network building, rethought';
const LAUNCH = (process.env.LIST_EDITION_LAUNCH || '2026-11-04').trim(); // the first Wednesday
const SEND_DAY = 3;                 // Wednesday
const SEND_TIME = { hour: 9, minute: 30 };
const BUILD_DAYS_AHEAD = 4;         // written by the Saturday before (and shown to Guy from then)
const NUDGE = { day: 1, hour: 15 }; // Monday 3pm, when not approved yet
const BATCH = Number(process.env.LIST_EDITION_BATCH || 20);
const TICK_MS = 5 * 60 * 1000;
const DAY = 86400000;
const FIRST_IDEAS = ['book-who-not-how']; // agreed 26 Oct: week 2 follows on from the launch piece

// ---------------------------------------------------------------------------------------------
// The fixed words (Guy approved these in chat, 26 Oct 2026)

const WELCOME_LINE = "I'm starting a short weekly email for people I've enjoyed talking with. Before the ideas start, here's what they're about.";
const BACK_LINE = `Mindset Mastery is back, with a new name - ${SERIES} - and weekly again from here. Before the ideas start, here's what they're about.`;
const INTRO_SUBJECT = `${SERIES} - What does better mean?`;
const INTRO_TITLE = 'What does better mean?';
const INTRO = [
  'Ask most people what a better network looks like and they\'ll say "bigger". I don\'t think that\'s it any more.',
  'AI has made things possible that weren\'t a year ago, and network building is one of them. Working out who\'s worth meeting. Getting to know them properly before you\'ve even spoken. Keeping hundreds of relationships warm without dropping any. One person can now do what used to take a team.',
  'And a better network isn\'t for one thing. The same people can bring you clients, a side gig, the right collaborator, or simply good people around you.',
  "That's what I'm working on at {{link}}. Have a look, and when you're ready to talk about what better could mean for you, just hit reply.",
];
const CLOSER = 'What would a better network mean for you - more clients, a side gig, the right people around you? With AI, more of that is possible than ever. That\'s what I work on at {{link}} - when you\'re ready to talk, just hit reply.';
const FOOTER = 'If you\'d prefer not to receive these, just reply "unsubscribe" and I\'ll take you off straight away - no hard feelings at all.';
const SITE_FALLBACK = 'https://knowaguy.com.au/';

// ---------------------------------------------------------------------------------------------
// Time (pure)

const ymd = (ms) => sched.localParts(ms, TZ).dateStr;
function addDays(dateStr, n) { const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const dow = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();
const sendAtMs = (sendDate) => sched.zonedToUtc(sendDate, SEND_TIME.hour, SEND_TIME.minute, TZ);

/** The Wednesday the list is working towards at `nowMs`: today until 1pm on a Wednesday, else the next one; never before the launch. Pure. */
function nextSendDate(nowMs) {
  const today = ymd(nowMs);
  const p = sched.localParts(nowMs, TZ);
  let d = today;
  const ahead = (SEND_DAY - dow(today) + 7) % 7;
  if (ahead === 0 && p.hour >= 13) d = addDays(today, 7);
  else d = addDays(today, ahead);
  return d < LAUNCH ? LAUNCH : d;
}

function dayLabel(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------------------------
// Rendering (pure)

const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const linked = (text, url) => esc(text).replace('{{link}}', `<a href="${esc(url)}">I Know A Guy</a>`);
const wrapHtml = (inner) => `<div style="max-width:620px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">\n${inner}\n</div>`;
const para = (t) => `<p>${t}</p>`;

function firstNameOf(name) {
  const f = String(name || '').trim().split(/\s+/)[0] || '';
  return /^[A-Za-z][A-Za-z'-]{0,24}$/.test(f) ? f[0].toUpperCase() + f.slice(1) : '';
}

/** One person's email. variant: 'welcome' | 'back' (their first: the launch piece) | 'regular' (this week's idea). Pure. */
function render({ edition, variant, firstName, siteUrl = SITE_FALLBACK }) {
  const hi = para(`Hi ${esc(firstName || 'there')},`);
  const signOff = [para('Cheers'), para('(I know a) Guy')];
  const foot = `<p style="margin-top:28px;font-size:12px;color:#777">${esc(FOOTER)}</p>`;
  if (variant === 'welcome' || variant === 'back' || !edition || edition.kind === 'intro') {
    const top = variant === 'back' ? BACK_LINE : WELCOME_LINE;
    const html = wrapHtml([hi, para(esc(top)), ...INTRO.map((t) => para(linked(t, siteUrl))), ...signOff, foot].join('\n'));
    return { subject: INTRO_SUBJECT, html };
  }
  const body = (edition.paragraphs || []).map((t) => para(esc(t)));
  const ps = edition.source === 'beth' ? [para(esc('P.S. This week\'s idea comes from my friend Beth Berghan.'))] : [];
  const html = wrapHtml([hi, ...body, para(linked(CLOSER, siteUrl)), ...signOff, ...ps, foot].join('\n'));
  return { subject: `${SERIES} - ${edition.title}`, html };
}

function htmlToText(html) {
  return String(html || '').replace(/<\/p>/gi, '\n\n').replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, '$2 ($1)').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------------------------
// Which idea (pure)

/** The ideas the list can still have, in the order they'd go: Guy's agreed first ones, then best-rated, books and Beth taken in turn. Pure. */
function ideaQueue(usedIds = [], { all = library.ideas(), first = FIRST_IDEAS } = {}) {
  const used = new Set(usedIds);
  const ok = all.filter((i) => i.source !== 'mindset-mastery' && !used.has(i.id));
  const out = [];
  for (const id of first) { const i = ok.find((x) => x.id === id); if (i) out.push(i); }
  const rest = ok.filter((i) => !out.includes(i)).sort((a, b) => a.rank - b.rank);
  const books = rest.filter((i) => i.source === 'book');
  const beth = rest.filter((i) => i.source === 'beth');
  while (books.length || beth.length) {
    if (books.length) out.push(books.shift());
    if (beth.length) out.push(beth.shift());
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Drafting (Claude)

const LIST_SYSTEM = `You write this week's edition of "Network building, rethought" - a short weekly email from Guy Wilson (a network-building coach, I Know A Guy, Brisbane) to people he has enjoyed talking with: business owners, consultants, people with side gigs. Not clients - so nothing about any product, setup or system. Guy reads it before anything is sent.
- ONE idea, given to you. Tell it THROUGH NETWORK BUILDING - Guy's rule: the idea must be about building a network, never a stand-alone self-help thought. Four beats, in short paragraphs:
  1. A networking moment people recognise (a first coffee, a quiet contact, asking for help too late).
  2. The idea, in Guy's own words. A BOOK: name the book and author once ("Keith Ferrazzi makes the case in Never Eat Alone that..."). NEVER a direct quote and never quote marks around an author's words - say it in Guy's words. BETH BERGHAN'S EMAIL: tell it in Guy's words and do NOT name or credit her - a P.S. credit is added for you.
  3. What it means for their network now. Where it is honestly part of the idea, what has changed (for example you can now read someone's story before you meet). At most one sentence touching AI, and only when it fits - often none.
  4. One small thing to try this week, starting "This week," or similar.
- About 120-160 words in all. Plain, warm, first person, Australian English. Short spaced dashes ' - ' only, never an em or en dash. No exclamation marks. No links. No greeting and no sign-off - "Hi <name>," and the closing lines are added for you, and the closing lines already invite them to reply, so do not ask for a reply.
- Never repeat the ideas listed under ALREADY SENT.
Return ONE JSON object: {"title": "2-7 words, the idea as a short phrase, no brand name", "paragraphs": ["..."], "why": "one line for Guy: why this idea works for this list"}.`;

function draftPrompt(idea, { sentTitles = [], direction = '' } = {}) {
  return [
    `THIS WEEK'S IDEA (${idea.source === 'book' ? 'a book' : "from Beth Berghan's emails"}): "${idea.title}" - ${idea.idea}${idea.angle ? ` How it fits networking: ${idea.angle}` : ''}`,
    direction ? `GUY'S DIRECTION FOR THIS EDITION (follow it first): ${direction}` : '',
    sentTitles.length ? ['ALREADY SENT (never repeat these):', ...sentTitles.map((t) => `- ${t}`)].join('\n') : '',
  ].filter(Boolean).join('\n\n');
}

function serverLlm() {
  try { return require('../config/anthropicClient').getAnthropicClient(); } catch (_) { return null; }
}

async function draftIdea(idea, { sentTitles = [], direction = '', llm = serverLlm() } = {}) {
  if (!llm) throw new Error('no Claude key on the server');
  const briefs = require('./clientTouchBrief');
  const response = await llm.messages.create({
    model: briefs.MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: LIST_SYSTEM,
    messages: [{ role: 'user', content: draftPrompt(idea, { sentTitles, direction }) }],
  });
  const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const j = briefs.parseJsonObject(text);
  const clean = (s) => String(s || '').replace(/[–—]/g, '-').trim();
  const paragraphs = (Array.isArray(j.paragraphs) ? j.paragraphs : []).map(clean).filter(Boolean);
  if (!clean(j.title) || !paragraphs.length) throw new Error('the draft came back empty');
  return { title: clean(j.title), paragraphs, why: clean(j.why) };
}

// ---------------------------------------------------------------------------------------------
// Store

let pool = null;
let schemaEnsured = false;
function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });
  return pool;
}
function __setTestPool(fake) { pool = fake; schemaEnsured = !!fake; }

async function withDb(fn, fallback) {
  const p = getPool();
  if (!p) return fallback;
  const c = await p.connect();
  try {
    if (!schemaEnsured) {
      await c.query(`
        CREATE TABLE IF NOT EXISTS list_editions (
          id BIGSERIAL PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          send_date DATE NOT NULL,
          kind TEXT NOT NULL,
          idea_id TEXT,
          source TEXT,
          title TEXT,
          paragraphs JSONB,
          why TEXT,
          direction TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          approved_at TIMESTAMPTZ,
          sending_at TIMESTAMPTZ,
          sent_at TIMESTAMPTZ,
          nudged_at TIMESTAMPTZ,
          error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (tenant_id, send_date)
        );
        CREATE TABLE IF NOT EXISTS list_sends (
          id BIGSERIAL PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          edition_id BIGINT NOT NULL,
          email TEXT NOT NULL,
          name TEXT,
          lead_rec_id TEXT,
          variant TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          mailgun_id TEXT,
          error TEXT,
          sent_at TIMESTAMPTZ,
          UNIQUE (edition_id, email)
        );
        CREATE INDEX IF NOT EXISTS list_sends_email ON list_sends (tenant_id, email);
        CREATE TABLE IF NOT EXISTS list_members (
          tenant_id TEXT NOT NULL,
          email TEXT NOT NULL,
          lead_rec_id TEXT,
          source TEXT,
          at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (tenant_id, email, source)
        );
        CREATE TABLE IF NOT EXISTS list_state (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      `);
      schemaEnsured = true;
    }
    return await fn(c);
  } finally { c.release(); }
}
const q = (sql, params, fallback = []) => withDb(async (c) => (await c.query(sql, params)).rows, fallback);

function editionOut(r) {
  if (!r) return null;
  return {
    id: Number(r.id), tenantId: r.tenant_id, sendDate: r.send_date instanceof Date ? r.send_date.toISOString().slice(0, 10) : String(r.send_date).slice(0, 10),
    kind: r.kind, ideaId: r.idea_id, source: r.source, title: r.kind === 'intro' ? INTRO_TITLE : r.title, paragraphs: r.paragraphs || [], why: r.why, direction: r.direction,
    status: r.status, approvedAt: r.approved_at, sentAt: r.sent_at, nudgedAt: r.nudged_at, error: r.error,
  };
}

async function editionFor(tenantId, sendDate) {
  const r = await q('SELECT * FROM list_editions WHERE tenant_id = $1 AND send_date = $2', [tenantId, sendDate]);
  return editionOut(r[0]);
}
async function editionById(tenantId, id) {
  const r = await q('SELECT * FROM list_editions WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  return editionOut(r[0]);
}
async function usedIdeas(tenantId) {
  return (await q("SELECT idea_id, title FROM list_editions WHERE tenant_id = $1 AND idea_id IS NOT NULL AND status <> 'replaced'", [tenantId]));
}
async function getState(key) { const r = await q('SELECT value FROM list_state WHERE key = $1', [key]); return r[0] ? r[0].value : null; }
async function setState(key, value) {
  await q('INSERT INTO list_state (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [key, value]);
}

/** Write (or rewrite) the edition for a Wednesday. The launch is the fixed piece; any other week drafts the next idea. */
async function buildEdition(tenantId, sendDate, { ideaId = null, direction = '', llm, replace = false } = {}) {
  const have = await editionFor(tenantId, sendDate);
  if (have && !replace) return { ok: true, edition: have, built: false };
  if (have && ['sending', 'sent'].includes(have.status)) return { ok: false, text: `The ${dayLabel(sendDate)} edition has already gone out.` };
  if (sendDate === LAUNCH && !ideaId) {
    await q(`INSERT INTO list_editions (tenant_id, send_date, kind, status) VALUES ($1, $2, 'intro', 'draft')
      ON CONFLICT (tenant_id, send_date) DO UPDATE SET kind = 'intro', idea_id = NULL, title = NULL, paragraphs = NULL, status = 'draft', approved_at = NULL, updated_at = now()`, [tenantId, sendDate]);
    return { ok: true, edition: await editionFor(tenantId, sendDate), built: true };
  }
  const used = (await usedIdeas(tenantId)).filter((u) => !have || u.idea_id !== have.ideaId);
  const all = library.ideas();
  const idea = ideaId ? all.find((i) => i.id === ideaId) : ideaQueue(used.map((u) => u.idea_id), { all })[0];
  if (!idea) return { ok: false, text: ideaId ? `"${ideaId}" is not in the idea library.` : 'The idea library has nothing left the list has not had.' };
  const d = await draftIdea(idea, { sentTitles: used.map((u) => u.title).filter(Boolean), direction, ...(llm !== undefined ? { llm } : {}) });
  await q(`INSERT INTO list_editions (tenant_id, send_date, kind, idea_id, source, title, paragraphs, why, direction, status)
    VALUES ($1, $2, 'idea', $3, $4, $5, $6, $7, $8, 'draft')
    ON CONFLICT (tenant_id, send_date) DO UPDATE SET kind = 'idea', idea_id = EXCLUDED.idea_id, source = EXCLUDED.source, title = EXCLUDED.title,
      paragraphs = EXCLUDED.paragraphs, why = EXCLUDED.why, direction = EXCLUDED.direction, status = 'draft', approved_at = NULL, updated_at = now()`,
  [tenantId, sendDate, idea.id, idea.source, d.title, JSON.stringify(d.paragraphs), d.why, direction || null]);
  return { ok: true, edition: await editionFor(tenantId, sendDate), built: true };
}

// ---------------------------------------------------------------------------------------------
// Recipients

const isEmail = (e) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(String(e || '').trim());
const tagsOf = (f) => String(f['Search Tokens (canonical)'] || f['Search Terms'] || f['Search Term'] || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

/** Who gets this week's email, and who is left off and why. Pure given its inputs. */
function pickRecipients(leads, { clientEmails = new Set(), bounced = new Set(), selfEmails = new Set() } = {}) {
  const seen = new Set();
  const go = [];
  const off = { client: [], unsubscribed: [], bounced: [], noEmail: [], self: [] };
  for (const l of leads) {
    const tags = l.tags || [];
    if (!tags.includes(LIST_TAG)) continue;
    const email = String(l.email || '').trim().toLowerCase();
    const who = l.name || email;
    if (tags.includes(UNSUB_TAG)) { off.unsubscribed.push(who); continue; }
    if (!isEmail(email)) { off.noEmail.push(who); continue; }
    if (selfEmails.has(email)) { off.self.push(who); continue; }
    if (clientEmails.has(email)) { off.client.push(who); continue; }
    if (bounced.has(email)) { off.bounced.push(who); continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    go.push({ email, name: l.name || '', firstName: l.firstName || firstNameOf(l.name), leadRecId: l.id || null });
  }
  return { go, off };
}

async function coachRecord(tenantId) { return require('./clientService').getClientById(tenantId); }

async function listLeads(tenantId) {
  const cs = require('./clientService');
  const coach = await coachRecord(tenantId);
  if (!coach || !coach.airtableBaseId) throw new Error('no CRM base for the coach');
  const base = cs.getClientBase(coach.airtableBaseId);
  const formulas = [
    `FIND('${LIST_TAG}', LOWER({Search Tokens (canonical)} & ''))`,
    `FIND('${LIST_TAG}', LOWER({Search Terms} & ''))`,
  ];
  let lastErr;
  for (const f of formulas) {
    try {
      const recs = await base('Leads').select({ filterByFormula: f, pageSize: 100 }).all();
      return recs.map((r) => ({
        id: r.id,
        name: `${r.fields['First Name'] || ''} ${r.fields['Last Name'] || ''}`.trim(),
        firstName: firstNameOf(r.fields['First Name']),
        email: r.fields['Email'] || '',
        tags: tagsOf(r.fields),
      }));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('the list could not be read');
}

async function exclusions(tenantId) {
  const cs = require('./clientService');
  const all = await cs.getAllClients();
  const clientEmails = new Set();
  const selfEmails = new Set();
  for (const c of all) {
    const addrs = [c.clientEmailAddress, c.googleCalendarEmail].filter(Boolean).map((e) => String(e).trim().toLowerCase());
    if (c.clientId === tenantId) addrs.forEach((e) => selfEmails.add(e));
    else if (String(c.status || '').toLowerCase() === 'active') addrs.forEach((e) => clientEmails.add(e));
  }
  selfEmails.add('guyralphwilson@gmail.com');
  selfEmails.add(String(require('./mailgunCreds').fromEmail() || '').replace(/^.*<|>.*$/g, '').trim().toLowerCase());
  const bounced = new Set((await q(`SELECT DISTINCT LOWER(address) AS a FROM wingguy_bounce_alerts WHERE coach_client_id = $1 AND alerted_at > now() - interval '30 days'`, [tenantId]).catch(() => [])).map((x) => x.a));
  return { clientEmails, bounced, selfEmails };
}

async function audience(tenantId) {
  const [leads, ex] = await Promise.all([listLeads(tenantId), exclusions(tenantId)]);
  return pickRecipients(leads, ex);
}

/** First email or not: anyone never sent before gets the launch piece - 'back' at the launch unless they joined by the Weekly button. Pure. */
function variantFor(email, { sentBefore = new Set(), buttonAdds = new Set(), isLaunch = false } = {}) {
  if (sentBefore.has(email)) return 'regular';
  if (isLaunch && !buttonAdds.has(email)) return 'back';
  return 'welcome';
}

// ---------------------------------------------------------------------------------------------
// Sending

function sendSwitchOn() {
  const v = (name) => String(process.env[name] || 'on').trim().toLowerCase() !== 'off';
  // Staging reads the same CRM - it must never send to a real person.
  return v('LIST_EDITION_SEND') && v('SCHEDULED_SEND_ENABLED') && v('CLIENT_TOUCH_SEND_ENABLED');
}

async function siteUrl(tenantId) {
  try {
    const rows = await require('./wingguyRulesStore').getAssets({ tenantId });
    const a = (rows || []).find((r) => r.asset_key === 'knowaguy_landing_page' && r.status === 'active' && r.url);
    return a ? a.url : SITE_FALLBACK;
  } catch (_) { return SITE_FALLBACK; }
}

async function replyToFor(tenantId) {
  const coach = await coachRecord(tenantId);
  return (coach && coach.clientEmailAddress) || 'guyralphwilson@gmail.com';
}

async function mailOne({ to, subject, html, replyTo, tag = 'list-edition' }) {
  const mg = require('./mailgunCreds');
  return mg.sendMailgunMessage({
    from: mg.fromAddress('Guy Wilson'),
    to,
    subject,
    html,
    text: htmlToText(html),
    'h:Reply-To': replyTo,
    'h:List-Unsubscribe': `<mailto:${replyTo}?subject=unsubscribe>`,
    'o:tag': tag,
  });
}

/** Queue every recipient for an approved edition (once), so the sends can go a batch at a time. */
async function queueSends(tenantId, edition) {
  const { go, off } = await audience(tenantId);
  const sent = new Set((await q("SELECT DISTINCT email FROM list_sends WHERE tenant_id = $1 AND status = 'sent'", [tenantId])).map((r) => r.email));
  const buttonAdds = new Set((await q("SELECT email FROM list_members WHERE tenant_id = $1 AND source = 'weekly-button'", [tenantId])).map((r) => r.email));
  const isLaunch = edition.kind === 'intro' && edition.sendDate === LAUNCH;
  for (const p of go) {
    await q(`INSERT INTO list_sends (tenant_id, edition_id, email, name, lead_rec_id, variant) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (edition_id, email) DO NOTHING`,
      [tenantId, edition.id, p.email, p.firstName || '', p.leadRecId, variantFor(p.email, { sentBefore: sent, buttonAdds, isLaunch })]);
  }
  await setState(`off:${edition.id}`, JSON.stringify(off));
  return { queued: go.length, off };
}

async function sendBatch(tenantId, edition, { limit = BATCH } = {}) {
  const rows = await q("SELECT * FROM list_sends WHERE tenant_id = $1 AND edition_id = $2 AND status = 'queued' ORDER BY id LIMIT $3", [tenantId, edition.id, limit]);
  if (!rows.length) return 0;
  const [url, replyTo] = await Promise.all([siteUrl(tenantId), replyToFor(tenantId)]);
  for (const r of rows) {
    const { subject, html } = render({ edition, variant: r.variant, firstName: r.name, siteUrl: url });
    try {
      const res = await mailOne({ to: r.email, subject, html, replyTo });
      await q("UPDATE list_sends SET status = 'sent', mailgun_id = $2, sent_at = now() WHERE id = $1", [r.id, res && res.id ? res.id : null]);
    } catch (e) {
      await q("UPDATE list_sends SET status = 'failed', error = $2 WHERE id = $1", [r.id, String(e.message).slice(0, 300)]);
    }
  }
  return rows.length;
}

async function notifyGuy(tenantId, subject, text) {
  try {
    const replyTo = await replyToFor(tenantId);
    await mailOne({ to: replyTo, subject, html: wrapHtml(text.split('\n\n').map((t) => para(esc(t).replace(/\n/g, '<br>'))).join('\n')), replyTo, tag: 'list-edition-note' });
  } catch (e) { console.error(`[listEditions] note to Guy failed: ${e.message}`); }
}

async function finishIfDone(tenantId, edition) {
  const left = await q("SELECT COUNT(*)::int AS n FROM list_sends WHERE edition_id = $1 AND status = 'queued'", [edition.id]);
  if (left[0] && left[0].n > 0) return false;
  await q("UPDATE list_editions SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = $1", [edition.id]);
  const counts = await q('SELECT status, variant, COUNT(*)::int AS n FROM list_sends WHERE edition_id = $1 GROUP BY status, variant', [edition.id]);
  const n = (s) => counts.filter((c) => c.status === s).reduce((a, c) => a + c.n, 0);
  const off = JSON.parse((await getState(`off:${edition.id}`)) || '{}');
  await notifyGuy(tenantId, `${SERIES} went out - ${n('sent')} sent`, [
    `This week's edition ("${edition.title}") went to ${n('sent')} people${n('failed') ? `, ${n('failed')} failed (ask Claude "what failed on the list?")` : ''}.`,
    `Left off: ${(off.client || []).length} clients, ${(off.unsubscribed || []).length} unsubscribed, ${(off.bounced || []).length} bounced, ${(off.noEmail || []).length} with no email.`,
    'Replies come to your inbox as normal, and anyone who replies is back at the top of your Today tab.',
  ].join('\n\n'));
  return true;
}

// ---------------------------------------------------------------------------------------------
// Unsubscribe replies

/** A reply that is only an unsubscribe - nothing else in it worth Guy's eye. Pure. */
function isUnsubscribeReply(text) {
  const first = String(text || '').split(/\n\s*(On .+wrote:|From:|-----Original|>)/)[0].replace(/\s+/g, ' ').trim();
  return first.length <= 80 && /^(please\s+)?(unsubscribe|remove me|take me off)\b/i.test(first);
}

async function watchUnsubscribes(tenantId, nowMs = Date.now()) {
  const mail = require('./mailProvider');
  const coach = await coachRecord(tenantId);
  if (!coach || !mail.hasMailbox(coach)) return [];
  const since = Number(await getState('unsub:since')) || (nowMs - 2 * DAY);
  const r = await mail.findMessages(coach, { subject: SERIES, receivedAfter: Math.floor(since / 1000), limit: 20 });
  await setState('unsub:since', String(nowMs - 10 * 60 * 1000));
  if (!r || !r.ok) return [];
  const self = (await exclusions(tenantId)).selfEmails;
  const done = [];
  for (const m of r.messages || []) {
    const from = String(m.fromEmail || '').toLowerCase();
    if (!from || self.has(from) || !/^re:/i.test(String(m.subject || ''))) continue;
    if (await getState(`unsub:msg:${m.id}`)) continue;
    await setState(`unsub:msg:${m.id}`, '1');
    if (!isUnsubscribeReply(m.snippet)) continue;
    const t = await require('./wingguyLeadsMcp').runTagLead({ lead_email: from, remove_tags: LIST_TAG, add_tags: UNSUB_TAG }, tenantId);
    await q("INSERT INTO list_members (tenant_id, email, source) VALUES ($1, $2, 'unsubscribed') ON CONFLICT DO NOTHING", [tenantId, from]);
    done.push({ email: from, result: t && t.text });
  }
  return done;
}

// ---------------------------------------------------------------------------------------------
// The Weekly button

/** Put a lead on the list: the tag on their record, and a note that they came by the button (so their first email is the welcome). */
async function addToList(tenantId, { leadRecId = null, email = '', name = '' } = {}) {
  const lm = require('./wingguyLeadsMcp');
  let target = { lead_email: email || undefined, lead_name: !email ? name || undefined : undefined };
  if (leadRecId) {
    const cs = require('./clientService');
    const coach = await coachRecord(tenantId);
    const base = cs.getClientBase(coach.airtableBaseId);
    const rec = await base('Leads').find(leadRecId);
    email = email || rec.fields['Email'] || '';
    target = rec.fields['LinkedIn Profile URL'] ? { linkedin_url: rec.fields['LinkedIn Profile URL'] } : { lead_email: email || undefined };
  }
  const t = await lm.runTagLead({ ...target, add_tags: LIST_TAG, remove_tags: UNSUB_TAG }, tenantId);
  if (t && t.isError) return { ok: false, text: t.text };
  if (/More than one lead matches/i.test(String((t && t.text) || ''))) return { ok: false, text: t.text, ambiguous: true };
  const found = String(t.text || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const addr = String(email || (found ? found[0] : '')).trim().toLowerCase();
  if (addr) await q("INSERT INTO list_members (tenant_id, email, lead_rec_id, source) VALUES ($1, $2, $3, 'weekly-button') ON CONFLICT DO NOTHING", [tenantId, addr, leadRecId]);
  const noEmail = !isEmail(addr);
  return { ok: true, noEmail, text: noEmail ? `${name || 'They'} are on the list, but there is no email address on their record yet - add one and they'll get the next edition.` : `${name || addr} will get the weekly email from the next edition - starting with the welcome.` };
}

// ---------------------------------------------------------------------------------------------
// Guy's review (chat tool + Scheduled page)

async function statusText(tenantId, nowMs = Date.now()) {
  const sendDate = nextSendDate(nowMs);
  const ed = await editionFor(tenantId, sendDate);
  const used = (await usedIdeas(tenantId)).map((u) => u.idea_id);
  const upcoming = ideaQueue(ed && ed.ideaId ? [...used] : used).slice(0, 2);
  const lines = [`${SERIES.toUpperCase()} - the weekly email to your list, ${dayLabel(sendDate)} from 9:30am Brisbane`];
  if (!ed) lines.push(`  Not written yet - it is written by ${dayLabel(addDays(sendDate, -BUILD_DAYS_AHEAD))}. Say "write this week's list edition" to do it now.`);
  else lines.push(`  "${ed.title}" - ${({ draft: 'WAITING FOR YOU (it will not go until you approve it)', approved: 'approved - it goes on Wednesday', sending: 'going out now', sent: 'sent', held: 'held by you this week', missed: 'not approved in time - it did not go' })[ed.status] || ed.status}`);
  if (upcoming.length) lines.push(`  Coming up: ${upcoming.map((i) => `"${i.title}"`).join(' · ')}`);
  return { text: lines.join('\n'), edition: ed, sendDate };
}

async function showText(tenantId, { sendDate, nowMs = Date.now() } = {}) {
  const d = sendDate || nextSendDate(nowMs);
  const ed = await editionFor(tenantId, d);
  if (!ed) return { text: `Nothing written for ${dayLabel(d)} yet.`, isError: true };
  const [{ go, off }, url] = await Promise.all([audience(tenantId).catch((e) => ({ go: [], off: {}, error: e.message })), siteUrl(tenantId)]);
  const sent = new Set((await q("SELECT DISTINCT email FROM list_sends WHERE tenant_id = $1 AND status = 'sent'", [tenantId])).map((r) => r.email));
  const firsts = go.filter((p) => !sent.has(p.email)).length;
  const main = render({ edition: ed, variant: ed.kind === 'intro' ? (d === LAUNCH ? 'back' : 'welcome') : 'regular', firstName: 'Sarah', siteUrl: url });
  const used = (await usedIdeas(tenantId)).map((u) => u.idea_id);
  const upcoming = ideaQueue(used).slice(0, 2);
  return {
    edition: ed,
    text: [
      `${SERIES} - ${dayLabel(d)} - STATUS: ${ed.status}${ed.why ? `\nWHY THIS IDEA: ${ed.why}` : ''}`,
      `WHO IT GOES TO: ${go.length} people - ${firsts} getting their first email (the "What does better mean?" piece${d === LAUNCH ? ': old Mindset Mastery readers get the "it\'s back" line, Weekly-button adds the welcome line' : ' with the welcome line'}), ${go.length - firsts} regulars.`,
      `LEFT OFF: ${(off.client || []).length} clients, ${(off.unsubscribed || []).length} unsubscribed, ${(off.bounced || []).length} bounced, ${(off.noEmail || []).length} with no email.`,
      '', '--- THE EMAIL, AS A REGULAR GETS IT ---', `Subject: ${main.subject}`, '', htmlToText(main.html), '--- END ---', '',
      upcoming.length ? `COMING UP: ${upcoming.map((i) => `"${i.title}" (${i.source === 'book' ? 'book' : 'Beth'})`).join(' · ')} - swap either by name.` : '',
    ].filter((x) => x !== null).join('\n'),
  };
}

async function setStatus(tenantId, id, from, to, extra = '') {
  const r = await q(`UPDATE list_editions SET status = $3${extra}, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = ANY($4) RETURNING *`, [tenantId, id, to, from]);
  return editionOut(r[0]);
}

async function approve(tenantId, id) {
  const ed = await setStatus(tenantId, id, ['draft', 'held', 'missed'], 'approved', ', approved_at = now()');
  return ed ? { ok: true, text: `Approved - "${ed.title}" goes ${dayLabel(ed.sendDate)} from 9:30am Brisbane.` } : { ok: false, text: 'That edition cannot be approved (it may have gone already).' };
}
async function hold(tenantId, id) {
  const ed = await setStatus(tenantId, id, ['draft', 'approved', 'missed'], 'held');
  return ed ? { ok: true, text: `Held - nothing goes to the list on ${dayLabel(ed.sendDate)}. Approve it again any time before then.` } : { ok: false, text: 'That edition cannot be held now.' };
}
/** Guy's own words. paragraphs: a blank line between them. */
async function edit(tenantId, id, { title, body } = {}) {
  const ed = await editionById(tenantId, id);
  if (!ed || ['sending', 'sent'].includes(ed.status)) return { ok: false, text: 'That edition cannot be changed now.' };
  if (ed.kind === 'intro') return { ok: false, text: 'The launch piece is the fixed text you approved - change it in services/listEditions.js (ask Claude).' };
  const paragraphs = body ? String(body).split(/\n\s*\n/).map((s) => s.replace(/[–—]/g, '-').trim()).filter(Boolean) : ed.paragraphs;
  await q("UPDATE list_editions SET title = $3, paragraphs = $4, status = 'approved', approved_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2",
    [tenantId, id, String(title || ed.title).trim(), JSON.stringify(paragraphs)]);
  return { ok: true, text: `Changed and approved - "${String(title || ed.title).trim()}" goes ${dayLabel(ed.sendDate)}.` };
}
async function swap(tenantId, sendDate, { idea, direction } = {}) {
  let ideaId = null;
  if (idea) {
    const n = String(idea).toLowerCase();
    const hit = library.ideas().find((i) => i.id === n || i.title.toLowerCase().includes(n));
    if (!hit) return { ok: false, text: `No idea in the library matches "${idea}".` };
    ideaId = hit.id;
  }
  const r = await buildEdition(tenantId, sendDate, { ideaId: ideaId || (await editionFor(tenantId, sendDate) || {}).ideaId || null, direction: direction || '', replace: true });
  return r.ok ? { ok: true, text: `Rewritten - "${r.edition.title}". It waits for your approval.`, edition: r.edition } : r;
}

/** A test copy of each version to Guy only - the inbox-or-spam check. */
async function testSend(tenantId, { sendDate, nowMs = Date.now() } = {}) {
  const d = sendDate || nextSendDate(nowMs);
  const ed = await editionFor(tenantId, d);
  const [url, replyTo] = await Promise.all([siteUrl(tenantId), replyToFor(tenantId)]);
  const coach = await coachRecord(tenantId);
  const first = firstNameOf(coach && coach.clientName) || 'Guy';
  const variants = ed && ed.kind === 'idea' ? ['regular', 'welcome'] : ['back', 'welcome'];
  for (const v of variants) {
    const { subject, html } = render({ edition: ed, variant: v, firstName: first, siteUrl: url });
    await mailOne({ to: replyTo, subject: `[TEST ${v}] ${subject}`, html, replyTo, tag: 'list-edition-test' });
  }
  return { ok: true, text: `Sent ${variants.length} test copies to ${replyTo} from guy@knowaguy.com.au (${variants.join(' + ')}). Check they landed in your inbox, not spam.` };
}

/** For the Scheduled page. */
async function forPage(tenantId, nowMs = Date.now()) {
  const s = await statusText(tenantId, nowMs);
  if (!s.edition) return { sendDate: s.sendDate, status: 'not-written', summary: s.text };
  const used = (await usedIdeas(tenantId)).map((u) => u.idea_id);
  const url = await siteUrl(tenantId);
  const v = s.edition.kind === 'intro' ? (s.sendDate === LAUNCH ? 'back' : 'welcome') : 'regular';
  const { subject, html } = render({ edition: s.edition, variant: v, firstName: 'Sarah', siteUrl: url });
  return {
    id: s.edition.id, sendDate: s.sendDate, when: `${dayLabel(s.sendDate)}, 9:30am`, status: s.edition.status, title: s.edition.title, why: s.edition.why,
    subject, html, paragraphs: s.edition.kind === 'idea' ? s.edition.paragraphs : null, coming: ideaQueue(used).slice(0, 2).map((i) => i.title),
  };
}

// ---------------------------------------------------------------------------------------------
// The tick

async function tick(nowMs = Date.now(), tenantId = TENANT) {
  const sendDate = nextSendDate(nowMs);
  const sendAt = sendAtMs(sendDate);
  const p = sched.localParts(nowMs, TZ);
  // 1. Write the edition by the weekend before.
  let ed = await editionFor(tenantId, sendDate);
  if (!ed && nowMs >= sendAt - BUILD_DAYS_AHEAD * DAY) {
    try { ed = (await buildEdition(tenantId, sendDate)).edition; } catch (e) { console.error(`[listEditions] build failed: ${e.message}`); }
  }
  if (!ed) return;
  // 2. Monday afternoon, still not approved: one nudge.
  const today = ymd(nowMs);
  if (ed.status === 'draft' && !ed.nudgedAt && dow(today) === NUDGE.day && p.hour >= NUDGE.hour && today === addDays(sendDate, -2)) {
    await q('UPDATE list_editions SET nudged_at = now() WHERE id = $1', [ed.id]);
    await notifyGuy(tenantId, `This week's ${SERIES} edition is ready for you`, [
      `"${ed.title}" goes to your list on ${dayLabel(sendDate)} - but only once you approve it.`,
      'Approve it on the Scheduled page in your portal, or say "let\'s do this week\'s emails" to Claude.',
    ].join('\n\n'));
  }
  // 3. Send day.
  if (nowMs < sendAt) return;
  if (ed.status === 'draft') {
    if (p.hour >= 12) await setStatus(tenantId, ed.id, ['draft'], 'missed'); // approvable until noon, then it's next week's
    return;
  }
  if (!sendSwitchOn()) return;
  if (ed.status === 'approved') {
    const moved = await setStatus(tenantId, ed.id, ['approved'], 'sending', ', sending_at = now()');
    if (!moved) return;
    ed = moved;
    await queueSends(tenantId, ed);
  }
  if (ed.status === 'sending') {
    await sendBatch(tenantId, ed);
    await finishIfDone(tenantId, ed);
  }
}

let intervalHandle = null;
let ticking = false;
let lastUnsubCheck = 0;
function startListEditions() {
  if (String(process.env.LIST_EDITION_TICK || 'on').toLowerCase() === 'off') return;
  if (intervalHandle || !getPool()) return;
  const run = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await tick();
      if (Date.now() - lastUnsubCheck > 60 * 60 * 1000) { lastUnsubCheck = Date.now(); await watchUnsubscribes(TENANT); }
    } catch (e) { console.error(`[listEditions] tick failed (non-fatal): ${e.message}`); } finally { ticking = false; }
  };
  intervalHandle = setInterval(run, TICK_MS);
  setTimeout(run, 3 * 60 * 1000);
  console.log(`[listEditions] started - launch ${LAUNCH}; sending ${sendSwitchOn() ? 'ON' : 'OFF here'}`);
}

module.exports = {
  // pure, tested
  nextSendDate, render, ideaQueue, pickRecipients, variantFor, isUnsubscribeReply, firstNameOf, draftPrompt, htmlToText,
  // store + actions
  buildEdition, editionFor, editionById, statusText, showText, approve, hold, edit, swap, testSend, forPage, addToList, audience, tick, watchUnsubscribes,
  startListEditions, __setTestPool,
  LIST_TAG, SERIES, LAUNCH, INTRO, CLOSER, WELCOME_LINE, BACK_LINE, INTRO_SUBJECT,
};
