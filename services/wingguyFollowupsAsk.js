// services/wingguyFollowupsAsk.js
// The Ask box on the Follow-Ups screen (Guy, 2026-09-11): "I'm looking at Simon Haines - have I
// missed any appointments? What should I do now?" answered in a couple of sentences, right on the
// row, instead of a dense story panel he has to read top to bottom.
//
// WHAT IT IS: a small agent scoped to ONE person. The person's stored dossier (the same text
// wingguy_dossier serves in chat) is loaded up front as ground truth, so most questions ("where
// are we up to?", "what did I promise?") need no tool call and answer in a couple of seconds. Live
// questions ("have I missed anything?", "has he replied since?") reach the coach's real calendar
// and mailbox through the SAME tool functions chat uses (TOOL_DEFS in wingguyMailMcp and
// wingguyBookingMcp) - never a second implementation of a read.
//
// TWO HANDS, added the same afternoon after Guy's first live use ("are the dates proposed being
// checked from my calendar?" - they were not; v1 had no availability tool and invented times):
//   check_availability -> wingguy_check_availability: the ONLY source of any day/date/time the box
//     may write. Booking rules, lead timezone labels, the one-clear-day rule - all enforced in code.
//   push_draft -> wingguy_create_draft: an email DRAFT in the coach's own mailbox, threaded, never
//     sent, addressed ONLY to this person (the recipient is fixed server-side). Wording is shown in
//     the box first; the push happens only when the coach says push/send it.
// PARK, PROPOSED NOT DONE (Guy, 2026-09-12, Deon's row: "okay can you park until then?" got "I
// can't action it from here" - a dead end after a clear instruction). The box has NO park tool.
// When the coach asks to park, the model writes the date in a ```park fence; the screen renders
// that as a confirm card ("Park Deon until Mon 24 Nov?") whose button calls the row's own park
// action. The date is checked in code before it reaches the card (real date, not in the past)
// because dates are exactly where the model drifts - "end of November" once became "23-25 Nov".
// Still NOT here, by design: book, drop, cease, mark done, send. Those stay the row's buttons.
// It is also NOT the LinkedIn-panel chat agent (wingguyChat.js) - that one has no story.
//
// Voice: the tenant's rendered rulebook (reply + follow-up + booking contexts) rides in the system
// prompt, cached 1h, so a pushed draft reads like the coach - the same block the overnight drafts
// and the panel chat are written from.
//
// Billing: the tenant's own lane via resolveClientAnthropic (stored key -> platform for the
// owner/managed -> blocked). A blocked lane returns {ok:false, blocked:true}; nothing is billed to
// the platform key silently.
//
// Stateless per turn, like the panel chat: the screen sends the running text conversation
// ([{role, content}]) and gets the reply back; tool blocks are rebuilt server-side each turn.

const { resolveClientAnthropic, anthropicKeyError } = require('../config/anthropicClient');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'followups_ask' });

// Same lane as the panel chat (latency-sensitive, interactive). Override per deploy with
// WINGGUY_ASK_MODEL_ID; falls back to the drafting model id so one env flip moves both.
const MODEL_ID = process.env.WINGGUY_ASK_MODEL_ID || process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-5';
// Thinking off, as in wingguyChat.js: with tools + a small answer budget, Sonnet 5's default
// thinking produced empty turns there (2026-07-01). Answers here are short recall, not reasoning.
const THINKING = { type: 'disabled' };
const MAX_TOKENS = 2500;          // an answer, or an HTML draft body plus a line of commentary
const MAX_TOOL_ITERATIONS = 6;    // availability -> draft -> push is three; headroom for a re-read
const MAX_HISTORY_TURNS = 12;     // text turns kept from the screen's running conversation
const RULEBOOK_CONTEXTS = ['reply', 'follow-up', 'booking'];

// Reader-facing text uses " - " (Guy's house style); the model is told, and this is the code guard.
function normaliseDashes(s) {
  return String(s || '')
    .replace(/&(?:mdash|ndash);/g, '—')
    .replace(/\s*[—–]\s*/g, ' - ');
}

// Today, in the coach's own clock - the anchor every "have they replied since", "has that time
// passed" question needs. Never the server's clock (Render is UTC).
function todayYmd(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}
function todayLine(tz) {
  const zone = tz || 'Australia/Brisbane';
  try {
    const long = new Intl.DateTimeFormat('en-AU', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
    return `TODAY IS ${long} (${todayYmd(zone)}, ${zone}).`;
  } catch (_) {
    return `TODAY IS ${new Date().toISOString().slice(0, 10)} (UTC).`;
  }
}

// The park proposal, checked in code before it reaches the card. A ```park fence holds the date
// (YYYY-MM-DD) on its first line and an optional one-line reason after it. A fence whose date is
// malformed, impossible or already behind us is replaced with plain text pointing at the row's
// Park button - a wrong date must never be one click from landing. Returns the cleaned text and
// the first valid proposal (the screen renders the fence; the API also reports it structured).
const PARK_FENCE = /```park\s*\n([\s\S]*?)\n?```/g;
function checkParkProposals(text, tz) {
  const today = todayYmd(tz);
  let proposal = null;
  const out = String(text || '').replace(PARK_FENCE, (_m, body) => {
    const lines = String(body || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const date = lines[0] || '';
    const why = normaliseDashes(lines.slice(1).join(' ')).trim();
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
    if (!valid) return "(I couldn't settle on a proper date for that - use the row's Park button to pick one.)";
    if (date < today) return `(The date I had in mind, ${date}, is already behind us - use the row's Park button to pick one.)`;
    if (!proposal) proposal = { kind: 'park', date, ...(why ? { why } : {}) };
    return `\`\`\`park\n${date}${why ? `\n${why}` : ''}\n\`\`\``;
  });
  return { text: out, proposal };
}

const SYSTEM_RULES = `You are Wingguy, working with the coach on ONE person from their follow-up queue. The coach is reading a busy screen and wants answers in a few sentences, not the whole file.

HOW TO ANSWER
- Lead with the answer. Two to four short paragraphs at most; a single sentence when that is all it takes.
- Plain English, first person as the coach's assistant ("I'd nudge him", "you promised"). Use the coach's own words for things where the story has them.
- Say what is LIVE versus what is from the STORED story when it matters ("no email from him since 3 Sep - checked the mailbox just now").
- Dates matter: compare every offered time, promised window or reconnect date against TODAY. An offered time that has passed is a fact worth stating.
- Never invent. If the story and the tools do not say, say so in one line.
- Use a plain spaced dash " - " for asides, never an em dash. No headings, no tables, no emoji. **Bold** the one or two phrases that carry the answer, sparingly.
- Do not paste the dossier back. Summarise.

WHAT YOU CAN DO
- ANSWER questions from the stored story, the live calendar and the live mailbox.
- FIND TIMES TO OFFER with check_availability - the coach's real free slots with all their booking rules applied.
- WRITE an email reply in the coach's voice (the rulebook below), show it in the box, and PUSH it to the coach's mailbox as an unsent draft with push_draft when they say so.
- PROPOSE A PARK DATE when the coach wants to park / hold / come back to this person later - see PARKING below. You propose; the coach clicks.

WHAT YOU CANNOT DO
- Book a meeting, drop, cease, mark done, or send anything. Those are the row's buttons (Done, Drop) and chat. The row's Draft button opens the overnight pre-written draft page, it does not send. If asked for one of these, say where it lives, then give the advice they need to do it well.
- Park anyone yourself. You can only propose the date (PARKING below); nothing is parked until the coach clicks the card.

PARKING
- When the coach says to park, hold, snooze, or come back later ("park him until then", "park until December", "put her on ice for a month", "yes, flag it to resurface"), put the date inside a fenced block that opens with a line reading exactly \`\`\`park and closes with a line reading \`\`\`. First line of the block: the date as YYYY-MM-DD, nothing else. Optional second line: one short reason in the coach's terms (e.g. "your own promise - end of November, ahead of the Langley Park event"). The screen turns that block into a card with a Park button; the coach clicks to make it real, so tell them that in one line outside the block.
- Choosing the date: the coach's own words win ("until the 24th", "3 months"). Otherwise use the promise in the story ("end of November" -> a weekday in the last week of November, a few days before any event it is tied to). Otherwise pick a sensible working day and say why. Resolve every relative phrase against TODAY above; never a date in the past, never a weekend if a weekday will do.
- One date, one block. Do not offer a range or several blocks - pick, and say the reason in the block's second line.
- If the coach only asks whether to park, advise; write the block only when they want it done.
- Message anyone other than this person. push_draft is addressed to this person only.
- Write for LinkedIn beyond suggesting wording to paste: a LinkedIn reply is typed in the thread (with /wg), not pushed.

TIMES - HARD RULE
- Never write a day, date or clock time as an offer unless it came back from check_availability IN THIS CONVERSATION. You have no calendar in your head. Do not work out "next week" yourself: the tool result opens with TODAY and the week boundaries - resolve every relative phrase against that. If the coach wants times beyond next week ("the week after", "when I'm back"), call check_availability with include_far_weeks true.
- Offer two or three slots, on different days where possible, using each slot's "label" exactly as the tool wrote it, and end the list with one line saying whose time it is, as the tool reports (the lead's clock when it differs from the coach's).
- Pass the person's location from the story as lead_location so the labels are on their clock.
- Past references ("back on 26 August") are fine; those are not offers.

DRAFTS
- Wording first: when asked to draft, write the message in the coach's voice per the rulebook, grounded in the story, short. Put the wording - and ONLY the wording - inside a fenced block that opens with a line reading exactly \`\`\`draft and closes with a line reading \`\`\`. Plain text, a blank line between paragraphs, greeting and sign-off included, no subject line, no HTML, no commentary inside the block. The screen turns that block into a card with a Copy button, the person's LinkedIn profile link, and a Push button for email. Your commentary goes outside the block, in a sentence or two.
- Which channel: reply where the conversation lives. The story's timeline shows the channel of each message; the person line below says whether they have an email address. A LinkedIn-only person gets a LinkedIn message (shorter, no links unless asked, no subject); say "copy this into the LinkedIn thread". An email person gets an email; say the coach can push it when happy. If both channels are live, use the one their last message came on, and say so.
- Push only on the coach's say-so: "push it", "send it to my drafts", "put it in Gmail", "yes push" - then call push_draft with the SAME wording as simple HTML (<p> paragraphs, <a href> for links), replying in the existing thread when the story shows a reply_to_message_id ("push with: ..."), subject "Re: <their subject>". If the coach asks for a change and a push in one breath, apply the change, show the final wording in a draft block, and push in the same turn.
- After a push, say it is in their mailbox Drafts, threaded, unsent, for them to read and send. Never say it was sent. A LinkedIn message cannot be pushed - the card's Copy button and profile link are the route.
- Library links: write them as {{asset:key}} exactly as the rulebook says; they are turned into the real link before the card is shown and again at push. Never write a link whose key is not in the rulebook.
- A draft must not contain a time that did not come from check_availability.

RECONNECTING AFTER A GAP (the coach's doctrine, 2026-09-12)
- After weeks of silence, "let's continue" makes THEM do the remembering. Most won't. So when the draft follows a park, a promised window, or a gap of more than about two weeks, open with ONE specific thing from the story, in THEIR terms: their reason for the timing ("you said to try again once Bali was behind you, so here I am"), their event, or their promise. Never the coach's pitch ("we discussed how Wingguy could help your outreach") - that is a chase with a memory attached.
- One anchor, not a recap. A summary of where things got to reads like a file note. Then a tiny ask - ONE question, still shaped by the rulebook's proactive close (format, purpose, soft timeframe): "Still keen? Worth a quick call in the next week or two to pick up where you wanted to?" - because momentum comes back from an easy next step, not from a reminder of enthusiasm they no longer feel. Tiny means one question, not an open-ended "whenever suits". Never "where were we".
- Leave the past alone when: the gap is short (under two weeks - "shall we pick this up?" is enough); the last exchange ended awkwardly (they went quiet or missed a call - anchor to the neutral thing, the event or the season, never the lapse); their circumstances changed (a job move, a launch - ask about that first; the answer tells the coach whether the original reason still holds).
- Where the anchor lives: the story's promises, "remember" lines and last exchange, and the park reason if the coach gives one. Use their words where the story has them.

WHEN TO USE TOOLS
- The stored story already answers "where are we up to", "what did I promise", "how did the call go". Do not call a tool for those.
- "Have I missed anything / any appointments" -> calendar for the period the story covers (first contact to a week or two ahead), compared with the story's dates.
- "Has he replied / anything since" -> replied_since from the last date in the story. LinkedIn replies are already in the story's timeline; if the story is older than the question needs, say so and suggest "Refresh story".
- "What did that email actually say" -> read_email if the story only has a snippet.
- Do not call the same tool twice with the same arguments.`;

function buildTools(person) {
  const hasEmail = !!(person && person.email);
  const tools = [
    {
      name: 'calendar',
      description: 'What is actually booked on the coach\'s own calendar for a date range (live). Use for "have I missed an appointment", "is anything booked with them". Returns every event in the range with attendees; look for this person\'s name or email. Also states TODAY in the coach\'s timezone. NOT for finding times to offer - use check_availability for that.',
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
          end_date: { type: 'string', description: 'Inclusive end date, YYYY-MM-DD. Keep ranges under ~40 days.' },
        },
        required: ['date', 'end_date'],
      },
    },
    {
      name: 'check_availability',
      description: 'The coach\'s REAL offerable slots with every booking rule applied in code (hours, lunch hold, one-clear-day notice, daily load, nothing in the past). THE ONLY SOURCE of any time you may offer. Opens with TODAY and the this-week / next-week boundaries - resolve "next week" and every relative phrase against that. Each slot has a "label" (exactly how it reads on the lead\'s clock) - use labels verbatim. Days flagged BUSY DAY are still offerable but prefer lighter ones.',
      input_schema: {
        type: 'object',
        properties: {
          lead_location: { type: 'string', description: 'The person\'s location as the story states it (e.g. "Greater Sydney Area") - drives their-clock labels. Omit if unknown.' },
          include_far_weeks: { type: 'boolean', description: 'true ONLY when the coach wants times beyond next week ("the week after", "when I\'m back").' },
          include_soon: { type: 'boolean', description: 'true ONLY when the coach explicitly wants today or tomorrow.' },
          include_lunch: { type: 'boolean', description: 'true ONLY when the coach explicitly wants a lunch-time slot.' },
          include_weekends: { type: 'boolean', description: 'true ONLY when the coach explicitly wants a weekend.' },
        },
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
    tools.push({
      name: 'push_draft',
      description: 'Create an UNSENT email draft to this person in the coach\'s own mailbox (threaded when reply_to_message_id is given). Call ONLY after the coach has said to push/send it to their drafts. The recipient is fixed to this person. Returns the draft id; the coach reads and sends it themselves.',
      input_schema: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Subject line. "Re: <their subject>" when replying in the thread.' },
          html_body: { type: 'string', description: 'The full body as simple HTML: <p> per paragraph, <a href="…">…</a> for any link. No times that did not come from check_availability.' },
          reply_to_message_id: { type: 'string', description: 'The message id to reply to (the story\'s "push with: reply_to_message_id=…" or a replied_since result) so the draft lands in the existing thread.' },
          resend_ok: { type: 'boolean', description: 'true only if the coach explicitly wants an asset link re-sent that this person already received.' },
        },
        required: ['subject', 'html_body'],
      },
    });
  }
  return tools;
}

// Map the model's tool calls onto the shared MCP tool functions - one dispatch, no new reads or
// writes. push_draft's recipient is pinned to the person here: the model never picks a "to".
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
    if (name === 'check_availability') {
      const args = {};
      if (input.lead_location) args.lead_location = String(input.lead_location);
      for (const k of ['include_far_weeks', 'include_soon', 'include_lunch', 'include_weekends']) if (input[k] === true) args[k] = true;
      return call(bookingTools, 'wingguy_check_availability', args);
    }
    if (name === 'replied_since') {
      if (!person.email) return { ok: false, text: 'No email address on file for this person - the mailbox cannot be checked.' };
      return call(mailTools, 'wingguy_lead_replied_since', { lead_email: person.email, since_iso: input.since_iso });
    }
    if (name === 'read_email') {
      return call(mailTools, 'wingguy_read_message', { message_id: input.message_id });
    }
    if (name === 'push_draft') {
      if (!person.email) return { ok: false, text: 'No email address on file for this person - a draft cannot be addressed. Give the coach the wording to paste instead.' };
      const args = {
        to: [{ email: person.email, ...(person.name ? { name: person.name } : {}) }],
        subject: String(input.subject || ''),
        html_body: String(input.html_body || ''),
      };
      if (input.reply_to_message_id) args.reply_to_message_id = String(input.reply_to_message_id);
      if (input.resend_ok === true) args.resend_ok = true;
      return call(mailTools, 'wingguy_create_draft', args);
    }
    return { ok: false, text: `unknown tool ${name}` };
  };
}

// What the screen shows under the answer: which sources it came from / what it did.
const SOURCE_LABEL = {
  calendar: 'calendar (live)',
  check_availability: 'calendar (live)',
  replied_since: 'mailbox (live)',
  read_email: 'mailbox (live)',
  push_draft: 'draft pushed to your mailbox',
};

/**
 * Answer one question about one person (and, on the coach's say-so, push a draft).
 * @param {Object} p
 * @param {Object} p.coach       clientService record (clientId, timezone, anthropicApiKey, managedClaudeKey, clientName)
 * @param {Object} p.person      { name, email, linkedin } - linkedin = profile URL, shown beside any draft
 * @param {Array}  p.messages    running text conversation [{role:'user'|'assistant', content:string}], last = the question
 * @param {Object} [p.deps]      test seams: llm (Anthropic client), mailTools, bookingTools, dossierText, rulesText, assets
 * @returns {{ok:boolean, reply?:string, sources?:string[], proposal?:{kind:'park', date:string, why?:string}, blocked?:boolean, error?:string, model?:string}}
 */
async function answerAboutPerson({ coach, person, messages, deps = {} }) {
  const clientId = coach && coach.clientId;
  if (!clientId) return { ok: false, error: 'no_client' };
  const p = {
    name: String((person && person.name) || '').trim(),
    email: String((person && person.email) || '').trim().toLowerCase(),
    linkedin: /^https?:\/\/(www\.)?linkedin\.com\//i.test(String((person && person.linkedin) || '')) ? String(person.linkedin).trim() : '',
  };
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

  // The coach's voice for any draft: the rendered rulebook, best-effort (an answer-only turn
  // works without it; a draft written without it would not sound like them, so say so).
  let rulesText = deps.rulesText;
  if (rulesText == null) {
    try {
      const r = await require('./wingguyRulesStore').renderRulesBlock({ tenantId: clientId, contexts: RULEBOOK_CONTEXTS });
      rulesText = (r && r.text) || '';
    } catch (e) {
      logger.warn(`followupsAsk: rulebook unavailable for ${clientId}: ${e && e.message}`);
      rulesText = '';
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
    { type: 'text', text: SYSTEM_RULES },
    {
      type: 'text',
      text: rulesText
        ? `THE COACH'S RULEBOOK (voice and house style for any wording you write):\n\n${rulesText}`
        : 'THE COACH\'S RULEBOOK could not be loaded this turn. If asked to draft, write plainly in the coach\'s voice as the story shows it and say the rulebook was unavailable.',
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
    { type: 'text', text: `THE PERSON: ${p.name || p.email}${p.email ? ` <${p.email}>` : ' (no email address on file - LinkedIn only)'}${p.linkedin ? `\nLINKEDIN PROFILE: ${p.linkedin}` : ''}\nTHE COACH: ${coach.clientName || clientId}\n${todayLine(coach.timezone || coach.timeZone)}\n\nSTORED STORY (built by the overnight pass; ground truth for everything up to its build date):\n${dossierText}`, cache_control: { type: 'ephemeral' } },
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
        if (r.ok && SOURCE_LABEL[tu.name]) sources.add(SOURCE_LABEL[tu.name]);
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
  // Asset placeholders (Guy, 2026-09-11, Heinna's card): the rulebook has the model write library
  // links as {{asset:key}} - the email push door resolves those, but a LinkedIn draft is COPIED
  // off the card, so the real URL has to be there. Same resolver the push door uses; an unknown
  // key stays visible on purpose (noticed beats silently dropped).
  // Park proposals are checked before the card is drawn (a wrong date must not be one click away).
  const parked = checkParkProposals(await resolveAssetPlaceholders(text, clientId, deps), coach.timezone || coach.timeZone);
  return { ok: true, reply: normaliseDashes(parked.text), sources: [...sources], model: MODEL_ID, ...(parked.proposal ? { proposal: parked.proposal } : {}) };
}

async function resolveAssetPlaceholders(text, clientId, deps = {}) {
  const s = String(text || '');
  if (!/\{\{\s*asset:/.test(s)) return s;
  let assets = deps.assets;
  if (assets == null) {
    try { assets = await require('./wingguyRulesStore').getAssets({ tenantId: clientId }); }
    catch (e) { logger.warn(`followupsAsk: asset library unavailable for ${clientId}: ${e && e.message}`); return s; }
  }
  const { detectAssets } = deps.mailModule || require('./wingguyMailMcp');
  return detectAssets(s, assets || []).html;
}

module.exports = { answerAboutPerson, normaliseDashes, todayLine, todayYmd, checkParkProposals, buildTools, MODEL_ID };
