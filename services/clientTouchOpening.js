// services/clientTouchOpening.js
//
// THE PERSONAL OPENING - the one to three sentences written fresh for one client at the top of
// their weekly email (docs/CLIENT-TOUCH-PLANNER.md, "Each email = a personal opening + an approved
// body" and "The craft rules"). Drafted here, approved by Guy on the Monday screen, never sent from
// this file.
//
// What it reads: the client's recent calls with Guy (the transcript store the follow-up brief and
// the dossier read - recall_meetings, matched by attendee email or the client's name in the title),
// the recent email record between Guy and the client (Guy's own mailbox, through mailProvider -
// subjects and snippets only), the client note (lasting things: frame per topic, length, what to
// avoid, their own number), and the live facts the planner gathered this Monday (so "your
// invitations are going out" is only ever said when they are).
//
// Craft rules, in code and in the prompt:
//   - reads as a next instalment, never "we noticed you haven't..."; the reason line never appears
//   - helpful, never watched: "following up from our call" yes; quoting their leads' emails, never
//   - facts are checked at send time - only what the live facts and the material say is current
//   - the frame comes from the note, per topic: recognise ("you'll know better than most") or teach
//   - length per note; at most three sentences; no links; never a booking link
//   - house style: ' - ' dashes, Australian English, Guy's first person, no AI tells, and the
//     opening never praises Wingguy or mentions that a system chose the email
// Plus the opening instructions Guy adds from the "why not" box (client_touch_opening_rules),
// which ride into every week's prompt from then on.

const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'PLANNER', clientId: 'SYSTEM', operation: 'client_touch_opening' });

const MODEL_ID = process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-5-5';
const MAX_SENTENCES = 3;
const TRANSCRIPT_HEAD = 5000;   // chars of each of the last calls
const MEETINGS = 3;
const EMAIL_DAYS = 60;

// ---------------------------------------------------------------------------------------------
// Pure: the prompt, and the check on what comes back

const CRAFT = [
  "Write ONLY the opening: one to three sentences that sit above the piece Guy is sending this week. The piece's own title and body follow straight after, so end on something that leads into it - never introduce the piece by name and never summarise it.",
  "It reads as the next instalment of an ongoing conversation. Never 'we noticed you haven't...', never a nudge about what they have not done, never a reason for why this piece was chosen.",
  "Helpful, never watched. 'Following up from our call' is fine. Quoting their own leads' emails back to them, or anything that shows the system reading their inbox, is never fine.",
  "Only say what the LIVE FACTS and the MATERIAL support, and only what is true now. If the facts say invitations are not going out, do not say they are. If you are not sure something still holds, leave it out.",
  "Use the CLIENT NOTE for the frame: on a topic marked 'recognise', speak to them as someone who already knows this ('you'll know better than most...'); on a topic marked 'teach', say it plainly. Respect anything the note says to avoid.",
  "Guy's voice, first person, Australian English, plain. Short spaced dashes ' - ' only, never an em or en dash. No exclamation marks. No 'I hope this finds you well', no 'Great news', no 'Just checking in', no 'I wanted to reach out'.",
  "No links of any kind. Never offer a booking link. Never praise Wingguy, Claude, or the emails themselves. Never mention that anything was automated, scheduled or chosen.",
  "If there is nothing personal and true to say, one plain sentence that leads into the piece is better than an invented detail.",
];

function buildPrompt({ client, pick, facts, note, meetings, emails, rules, today }) {
  const sys = [
    "You draft the opening lines of a weekly email from Guy Wilson - a network-building coach (I Know A Guy / Wingguy) - to one of his clients. Guy reads and approves every word before anything is sent.",
    '',
    'THE CRAFT:',
    ...CRAFT.map((c, i) => `${i + 1}. ${c}`),
    ...(rules && rules.length ? ['', "GUY'S STANDING INSTRUCTIONS FOR OPENINGS (from past weeks - every one holds):", ...rules.map((r) => `- ${r}`)] : []),
    '',
    'Answer with ONE JSON object and nothing else: {"opening": "<the sentences>", "factsUsed": ["<each fact from the material you relied on>"], "confidence": <0 to 1>}. Confidence is how sure you are that every fact in the opening is true today.',
  ].join('\n');

  const lines = [];
  lines.push(`Today is ${today}.`);
  lines.push(`CLIENT: ${client.clientName}${client.clientFirstName ? ` (first name ${client.clientFirstName})` : ''}.`);
  lines.push('');
  lines.push(`THIS WEEK'S PIECE: "${pick.title}"${pick.dek ? ` - ${pick.dek}` : ''}${pick.kindLine ? ` (${pick.kindLine})` : ''}. Form: ${pick.form}.`);
  lines.push('');
  lines.push('LIVE FACTS (checked this morning):');
  for (const f of facts || []) lines.push(`- ${f}`);
  lines.push('');
  lines.push('CLIENT NOTE (lasting things Guy keeps about how to write to them):');
  lines.push(note && note.trim() ? note.trim() : '(no note yet - use a plain, warm, teach frame and keep it short)');
  lines.push('');
  lines.push(`RECENT CALLS WITH GUY (newest first; ${meetings && meetings.length ? meetings.length : 'none'} on record):`);
  for (const m of meetings || []) {
    lines.push(`--- ${m.date || '(no date)'} ${m.title || ''}`);
    if (m.summary) lines.push(`Summary: ${m.summary}`);
    if (m.transcript) lines.push(`Transcript (head): ${m.transcript}`);
  }
  lines.push('');
  lines.push(`RECENT EMAIL BETWEEN GUY AND THE CLIENT (last ${EMAIL_DAYS} days, subjects and snippets; YOU = Guy, THEM = the client):`);
  if (emails && emails.length) for (const e of emails) lines.push(`- ${e.date} ${e.dir === 'them' ? 'THEM' : 'YOU'}: [${e.subject}] ${e.text}`);
  else lines.push('(none found)');
  return { system: sys, user: lines.join('\n') };
}

/** Split into sentences, generously (a trailing fragment counts). */
function sentencesOf(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z"'(])/).filter((s) => s.trim());
}

/**
 * The code-side checks on a drafted opening. Returns { ok, problems: [] } - a failed check never
 * sends anything; it shows on the Monday screen as "needs Guy's words".
 */
function checkOpening(text, { maxSentences = MAX_SENTENCES } = {}) {
  const t = String(text || '').trim();
  const problems = [];
  if (!t) problems.push('empty');
  if (/[–—]/.test(t)) problems.push('em or en dash');
  if (/https?:\/\/|www\.|calendly|tidycal|book a time|booking link/i.test(t)) problems.push('a link or booking offer');
  if (/we noticed|you haven't|you have not|haven't yet|still haven't|just checking in|hope this finds you|wanted to reach out|great news/i.test(t)) problems.push('an AI tell or a nudge');
  if (/wingguy|claude|this email was|automat|scheduled/i.test(t)) problems.push('mentions the system');
  if (/!/.test(t)) problems.push('exclamation mark');
  const n = sentencesOf(t).length;
  if (n > maxSentences) problems.push(`${n} sentences (at most ${maxSentences})`);
  return { ok: problems.length === 0, problems, sentences: n };
}

function parseReply(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON object in the reply');
  const j = JSON.parse(m[0]);
  return {
    opening: String(j.opening || '').replace(/\s+/g, ' ').trim(),
    factsUsed: Array.isArray(j.factsUsed) ? j.factsUsed.map(String) : [],
    confidence: Number.isFinite(Number(j.confidence)) ? Number(j.confidence) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Material - the stores the follow-up brief and the dossier read

async function gatherMeetings(coachClientId, client, deps = {}) {
  const getPool = deps.getPool || (() => require('./recallWebhookDb').getPool());
  const p = getPool();
  if (!p) return [];
  const emails = clientEmails(client);
  let c;
  try {
    c = await p.connect();
    const r = await c.query(
      `SELECT DISTINCT m.id, m.title, m.meeting_start, m.summary_json, LEFT(m.transcript_text, $4) AS head
         FROM recall_meetings m
         LEFT JOIN recall_meeting_participants p ON p.meeting_id = m.id
        WHERE m.coach_client_id = $1
          AND (LOWER(p.verified_email) = ANY($2) OR m.title ILIKE $3)
        ORDER BY m.meeting_start DESC NULLS LAST LIMIT $5`,
      [coachClientId, [...emails], `%${client.clientName}%`, TRANSCRIPT_HEAD, MEETINGS],
    );
    const { scrub } = require('./wingguyDossier');
    return r.rows.map((m) => {
      let summary = null;
      try { const j = JSON.parse(m.summary_json || 'null'); summary = j && (j.summary || j.recap || JSON.stringify(j).slice(0, 1200)); } catch (_) { summary = m.summary_json ? String(m.summary_json).slice(0, 1200) : null; }
      return {
        date: m.meeting_start ? new Date(m.meeting_start).toISOString().slice(0, 10) : null,
        title: m.title || '(call)',
        summary: summary ? scrub(String(summary)) : null,
        transcript: m.head ? scrub(String(m.head)) : null,
      };
    });
  } catch (e) {
    logger.warn(`meetings for ${client.clientId} skipped: ${e.message}`);
    return [];
  } finally {
    if (c) c.release();
  }
}

function clientEmails(client) {
  const raw = (client.rawRecord && client.rawRecord._rawJson && client.rawRecord._rawJson.fields) || {};
  const alts = String(raw['Alternative Email Addresses'] || '').split(/[;,\n]/);
  return new Set([client.clientEmailAddress, client.lhAccountEmail, client.billingEmail, ...alts].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean));
}

async function gatherEmails(coach, client, deps = {}) {
  try {
    const mailProvider = deps.mailProvider || require('./mailProvider');
    if (!mailProvider.hasMailbox(coach)) return [];
    const { gatherEmailRecord } = deps.dossier || require('./wingguyDossier');
    const { timeline } = await gatherEmailRecord(mailProvider, coach, [...clientEmails(client)], 40);
    const since = new Date(Date.now() - EMAIL_DAYS * 86400000).toISOString().slice(0, 10);
    return (timeline || []).filter((e) => e.kind === 'email' && e.date >= since).slice(-20);
  } catch (e) {
    logger.warn(`emails for ${client.clientId} skipped: ${e.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------------------------

/**
 * Draft the opening for one client's pick. Never throws; returns
 * { opening, factsUsed, confidence, check: { ok, problems }, source: 'llm'|'none', error? }.
 * `deps` = { llm, getPool, mailProvider, dossier, rules } for tests.
 */
async function draftOpening({ coach, client, pick, factLines, note, today = new Date().toISOString().slice(0, 10) }, deps = {}) {
  let llm = deps.llm;
  if (!llm) {
    try { llm = require('../config/anthropicClient').resolveClientAnthropic(coach).llm; } catch (_) { llm = null; }
  }
  const [meetings, emails, rules] = await Promise.all([
    deps.meetings || gatherMeetings(coach.clientId, client, deps),
    deps.emails || gatherEmails(coach, client, deps),
    deps.rules || require('./clientTouchPlanStore').openingRules().then((rows) => rows.map((r) => r.rule)).catch(() => []),
  ]);
  const prompt = buildPrompt({ client, pick, facts: factLines, note, meetings, emails, rules, today });
  if (!llm) return { opening: '', factsUsed: [], confidence: null, check: checkOpening(''), source: 'none', error: 'no Claude key for the coach', prompt };

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await llm.messages.create({
        model: MODEL_ID,
        max_tokens: 600,
        system: prompt.system + (attempt ? '\nSTRICT: answer with one JSON object only, no prose.' : ''),
        messages: [{ role: 'user', content: prompt.user }],
      });
      const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const out = parseReply(text);
      const check = checkOpening(out.opening);
      return { ...out, check, source: 'llm', meetingsRead: meetings.length, emailsRead: emails.length };
    } catch (e) {
      lastErr = e;
      if (require('../config/anthropicClient').anthropicKeyError && require('../config/anthropicClient').anthropicKeyError(e)) break;
    }
  }
  logger.warn(`opening for ${client.clientId} failed: ${lastErr && lastErr.message}`);
  return { opening: '', factsUsed: [], confidence: null, check: checkOpening(''), source: 'none', error: lastErr && lastErr.message, prompt };
}

module.exports = { draftOpening, buildPrompt, checkOpening, sentencesOf, parseReply, gatherMeetings, gatherEmails, CRAFT, MAX_SENTENCES };
