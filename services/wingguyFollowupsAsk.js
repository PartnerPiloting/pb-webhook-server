// services/wingguyFollowupsAsk.js
// The Ask box on the Follow-Ups screen (Guy, 2026-09-11): "I'm looking at Simon Haines - have I
// missed any appointments? What should I do now?" answered in a couple of sentences, right on the
// row, instead of a dense story panel he has to read top to bottom.
//
// WHAT IT IS: a tiny question-answering agent scoped to ONE person. The person's stored dossier
// (the same text wingguy_dossier serves in chat) is loaded up front as ground truth, so most
// questions ("where are we up to?", "what did I promise?") need no tool call and answer in a couple
// of seconds. Live questions ("have I missed anything?", "has he replied since?") reach the coach's
// real calendar and mailbox through the SAME tool functions chat uses (TOOL_DEFS in wingguyMailMcp
// and wingguyBookingMcp) - never a second implementation of a read.
//
// WHAT IT IS NOT: hands. It answers; it never drafts-to-send, parks, drops, books or ceases. The
// row's buttons stay the only actions on the screen (the one-queue rule, docs/FOLLOWUPS-SCREEN-PLAN.md).
// It is also NOT the LinkedIn-panel chat agent (wingguyChat.js) - that one is built to act
// (book/draft) and has no access to the story.
//
// Billing: runs on the tenant's own lane via resolveClientAnthropic (stored key -> platform for the
// owner/managed -> blocked). A blocked lane returns {ok:false, blocked:true} with the standard
// message; nothing is billed to the platform key silently.
//
// Stateless per turn, like the panel chat: the screen sends the running text conversation
// ([{role, content}]) and gets the reply back; tool blocks are rebuilt server-side each turn and
// never persisted.

const { resolveClientAnthropic, anthropicKeyError } = require('../config/anthropicClient');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'followups_ask' });

// Same lane as the panel chat (latency-sensitive, interactive). Override per deploy with
// WINGGUY_ASK_MODEL_ID; falls back to the drafting model id so one env flip moves both.
const MODEL_ID = process.env.WINGGUY_ASK_MODEL_ID || process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-5';
// Thinking off, as in wingguyChat.js: with tools + a small answer budget, Sonnet 5's default
// thinking produced empty turns there (2026-07-01). Answers here are short recall, not reasoning.
const THINKING = { type: 'disabled' };
const MAX_TOKENS = 1500;
const MAX_TOOL_ITERATIONS = 5;
const MAX_HISTORY_TURNS = 12;   // text turns kept from the screen's running conversation

// Reader-facing text uses " - " (Guy's house style); the model is told, and this is the code guard.
function normaliseDashes(s) {
  return String(s || '')
    .replace(/&(?:mdash|ndash);/g, '—')
    .replace(/\s*[—–]\s*/g, ' - ');
}

// Today, in the coach's own clock - the anchor every "have they replied since", "has that time
// passed" question needs. Never the server's clock (Render is UTC).
function todayLine(tz) {
  const zone = tz || 'Australia/Brisbane';
  try {
    const d = new Date();
    const long = new Intl.DateTimeFormat('en-AU', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return `TODAY IS ${long} (${ymd}, ${zone}).`;
  } catch (_) {
    return `TODAY IS ${new Date().toISOString().slice(0, 10)} (UTC).`;
  }
}

const SYSTEM_RULES = `You are Wingguy, answering the coach's questions about ONE person from their follow-up queue. The coach is reading a busy screen and wants the answer in a few sentences, not the whole file.

HOW TO ANSWER
- Lead with the answer. Two to four short paragraphs at most; a single sentence when that is all it takes.
- Plain English, first person as the coach's assistant ("I'd nudge him", "you promised"). Use the coach's own words for things where the story has them.
- Say what is LIVE versus what is from the STORED story when it matters ("no email from him since 3 Sep - checked the mailbox just now").
- Dates matter: compare every offered time, promised window or reconnect date against TODAY. An offered time that has passed is a fact worth stating.
- Never invent. If the story and the tools do not say, say so in one line.
- Use a plain spaced dash " - " for asides, never an em dash. No headings, no tables, no emoji. **Bold** the one or two phrases that carry the answer, sparingly.
- Do not paste the dossier back. Summarise.

WHAT YOU CAN AND CANNOT DO
- You ANSWER. You do not send, draft-to-send, book, park, drop or cease anything, and you have no tools that do. If the coach asks you to do one of those, say the row's buttons (Draft, Done, Park, Drop) or chat do that, then give the advice they would need to click well.
- You may SUGGEST wording for a message when asked, marked plainly as a suggestion to copy.
- Stay on this one person. If the coach asks about someone else, say the box is scoped to this person and they can open that person's row.

WHEN TO USE TOOLS
- The stored story below already answers "where are we up to", "what did I promise", "how did the call go". Do not call a tool for those.
- "Have I missed anything / any appointments" -> read the calendar for the period the story covers (from the first contact to a week or two ahead) and compare with the story's dates.
- "Has he replied / anything since" -> check the mailbox since the last date in the story. LinkedIn replies are already in the story's timeline (synced into the CRM record) - say if the story is older than the question needs and suggest "Refresh story".
- "What did that email actually say" -> read the message if the story only has a snippet.
- Do not call the same tool twice with the same arguments.`;

function buildTools(person) {
  const hasEmail = !!(person && person.email);
  const tools = [
    {
      name: 'calendar',
      description: 'What is actually booked on the coach\'s own calendar for a date range (live). Use for "have I missed an appointment", "is anything booked with them", "what does next week look like for a new time". Returns every event in the range with attendees; look for this person\'s name or email. Also states TODAY in the coach\'s timezone.',
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
          end_date: { type: 'string', description: 'Inclusive end date, YYYY-MM-DD. Keep ranges under ~40 days.' },
        },
        required: ['date', 'end_date'],
      },
    },
  ];
  if (hasEmail) {
    tools.push({
      name: 'replied_since',
      description: 'Has this person emailed the coach since a date (live mailbox check)? Answers YES with the latest inbound (date, subject, message_id) or NO. Use for "has he come back to me", "anything since the call".',
      input_schema: {
        type: 'object',
        properties: { since_iso: { type: 'string', description: 'ISO date, e.g. "2026-09-03" - count only mail received after this.' } },
        required: ['since_iso'],
      },
    });
    tools.push({
      name: 'read_email',
      description: 'Read ONE email in full from the coach\'s mailbox by message_id (from replied_since or the story). Use only when a snippet is not enough to answer.',
      input_schema: {
        type: 'object',
        properties: { message_id: { type: 'string' } },
        required: ['message_id'],
      },
    });
  }
  return tools;
}

// Map the model's tool calls onto the shared MCP tool functions - one dispatch, no new reads.
function makeToolRunner({ clientId, person, mailTools, bookingTools }) {
  const call = async (defs, name, args) => {
    const def = defs.find((d) => d.name === name);
    if (!def) throw new Error(`tool ${name} not found`);
    const out = await def.run(args || {}, clientId);
    return { ok: !(out && out.isError), text: (out && out.text) || '' };
  };
  return async function runTool(name, input) {
    if (name === 'calendar') {
      return call(bookingTools, 'wingguy_list_events', { date: input.date, end_date: input.end_date });
    }
    if (name === 'replied_since') {
      if (!person.email) return { ok: false, text: 'No email address on file for this person - the mailbox cannot be checked.' };
      return call(mailTools, 'wingguy_lead_replied_since', { lead_email: person.email, since_iso: input.since_iso });
    }
    if (name === 'read_email') {
      return call(mailTools, 'wingguy_read_message', { message_id: input.message_id });
    }
    return { ok: false, text: `unknown tool ${name}` };
  };
}

// What the screen shows under the answer: which sources it came from.
const SOURCE_LABEL = { calendar: 'calendar (live)', replied_since: 'mailbox (live)', read_email: 'mailbox (live)' };

/**
 * Answer one question about one person.
 * @param {Object} p
 * @param {Object} p.coach       clientService record (clientId, timezone, anthropicApiKey, managedClaudeKey, clientName)
 * @param {Object} p.person      { name, email }
 * @param {Array}  p.messages    running text conversation [{role:'user'|'assistant', content:string}], last = the question
 * @param {Object} [p.deps]      test seams: llm (Anthropic client), mailTools, bookingTools, dossierText, now
 * @returns {{ok:boolean, reply?:string, sources?:string[], blocked?:boolean, error?:string, model?:string}}
 */
async function answerAboutPerson({ coach, person, messages, deps = {} }) {
  const clientId = coach && coach.clientId;
  if (!clientId) return { ok: false, error: 'no_client' };
  const p = { name: String((person && person.name) || '').trim(), email: String((person && person.email) || '').trim().toLowerCase() };
  if (!p.name && !p.email) return { ok: false, error: 'name_or_email_required' };

  // Key lane - the same one-door rule the overnight brief and the drafting path use.
  let llm = deps.llm || null;
  if (!llm) {
    const lane = resolveClientAnthropic(coach);
    if (!lane.llm) return { ok: false, blocked: true, error: lane.message };
    llm = lane.llm;
  }

  const mailTools = deps.mailTools || require('./wingguyMailMcp').TOOL_DEFS;
  const bookingTools = deps.bookingTools || require('./wingguyBookingMcp').TOOL_DEFS;

  // Ground truth: the stored dossier, exactly as chat serves it (falls back to the live mini
  // dossier inside runDossier when nothing is stored). Loaded once per turn, cached across the
  // tool loop by the API's prompt cache.
  let dossierText = deps.dossierText;
  if (dossierText == null) {
    try {
      const def = mailTools.find((d) => d.name === 'wingguy_dossier');
      const out = await def.run({ name: p.name || p.email, ...(p.email ? { email: p.email } : {}) }, clientId);
      dossierText = (out && out.text) || '';
      if (out && out.isError) dossierText = `(No stored story could be loaded: ${dossierText})`;
    } catch (e) {
      dossierText = `(No stored story could be loaded: ${e.message})`;
    }
  }

  // The screen's running conversation: text only, trimmed, must end with the question.
  const history = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content.trim() }));
  if (!history.length || history[history.length - 1].role !== 'user') return { ok: false, error: 'question_required' };
  if (history[0].role !== 'user') history.shift();

  const system = [
    { type: 'text', text: SYSTEM_RULES, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `THE PERSON: ${p.name || p.email}${p.email ? ` <${p.email}>` : ''}\nTHE COACH: ${coach.clientName || clientId}\n${todayLine(coach.timezone || coach.timeZone)}\n\nSTORED STORY (built by the overnight pass; ground truth for everything up to its build date):\n${dossierText}`, cache_control: { type: 'ephemeral' } },
  ];

  const tools = buildTools(p);
  const runTool = makeToolRunner({ clientId, person: p, mailTools, bookingTools });
  const convo = history.map((m) => ({ role: m.role, content: m.content }));
  const sources = new Set(['story']);
  let text = '';

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await llm.messages.create({
        model: MODEL_ID,
        max_tokens: MAX_TOKENS,
        thinking: THINKING,
        system,
        tools,
        messages: convo,
      });
      if (response.stop_reason === 'refusal') return { ok: false, error: 'Claude declined the request.' };
      convo.push({ role: 'assistant', content: response.content });
      text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      const uses = (response.content || []).filter((b) => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !uses.length) break;
      const results = [];
      for (const tu of uses) {
        let r;
        try { r = await runTool(tu.name, tu.input || {}); } catch (e) { r = { ok: false, text: e.message }; }
        if (SOURCE_LABEL[tu.name]) sources.add(SOURCE_LABEL[tu.name]);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(r.text || ''), ...(r.ok ? {} : { is_error: true }) });
      }
      convo.push({ role: 'user', content: results });
    }
  } catch (e) {
    const kind = anthropicKeyError(e);
    logger.warn(`followupsAsk: ${clientId}/${p.name}: ${e && e.message}`);
    if (kind === 'revoked') return { ok: false, keyError: kind, error: 'Your Claude key was rejected - check it on the My Wingguy page.' };
    if (kind === 'billing') return { ok: false, keyError: kind, error: 'Your Claude account has hit its spend limit or has no credit - check it, then try again.' };
    return { ok: false, error: `Couldn't reach Wingguy: ${e && e.message}` };
  }

  if (!text) text = "I couldn't put an answer together for that - try asking it another way.";
  return { ok: true, reply: normaliseDashes(text), sources: [...sources], model: MODEL_ID };
}

module.exports = { answerAboutPerson, normaliseDashes, todayLine, buildTools, MODEL_ID };
