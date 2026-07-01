// services/wingguyChat.js
// Wingguy Slice 2 BIG half — the tool-using CHAT agent (2026-06-27). ONE place owns the agent loop
// so the route and the cloud test exercise the SAME code path. Guy chats with it in the LinkedIn
// panel; it checks his real calendar (check_availability), books (book_meeting → proven Nylas write),
// and keeps a LinkedIn message draft ready to send (propose_message). Stateless: the caller passes
// the running `messages` array each turn (including prior tool blocks).
//
// Model = Sonnet 5 by default (WINGGUY_DRAFT_MODEL_ID), with thinking DISABLED (CHAT_THINKING below).
// History (2026-07-01): the first 2026-06-30 swap to `claude-sonnet-5` broke the panel — Sonnet 5 thinks by
// default, and with tools + the small CHAT_MAX_TOKENS the turn returned no reply/no draft ("(No response —
// try rephrasing)"). Fix = disable thinking (this agentic booking chat is latency-sensitive and drafts/books
// rather than deep-reasons) + a firmer two-step confirm-before-booking instruction (Sonnet 5 is more eager).
// Verified on Sonnet 5 via the cloud test (scripts/wingguy-chat-test.js): full drafts, correct tool use, and
// the confirm-first flow holds. Fall back to `claude-sonnet-4-6` via WINGGUY_DRAFT_MODEL_ID if ever needed.
// `deps` lets the test inject stubs (e.g. a no-op book) so it can prove the brain without creating
// real events.

const { getAnthropicClient } = require('../config/anthropicClient');
const { WINGGUY_VOICE, WINGGUY_AGENT_INSTRUCTIONS } = require('./../config/wingguyTemplates');
const { getBookingPrefs } = require('../config/wingguyBookingPrefs');
const { getVoicePrefs } = require('../config/wingguyVoicePrefs');
const wingguyCalendar = require('./wingguyCalendar');

const MODEL_ID = process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-5';
// Disable thinking for this agentic booking chat: it's latency-sensitive (interactive panel) and the tool
// loop drafts/books rather than deep-reasons. Also the seam that makes thinking-by-default models (Sonnet 5)
// usable here without the empty-turn failure. Harmless on Sonnet 4.6 (no default thinking).
const CHAT_THINKING = { type: 'disabled' };
const CHAT_MAX_TOKENS = 1500;
const MAX_TOOL_ITERATIONS = 8;     // safety cap on the agent loop
const AVAIL_MAX_DAYS = 14;         // bound the availability tool result (tokens) — ~2 working weeks
const AVAIL_MAX_SLOTS_PER_DAY = 8;

const AGENT_TOOLS = [
  {
    name: 'check_availability',
    description: 'Look at Guy\'s real calendar and return open meeting slots (timezone-correct for both Guy and the lead). Call this before suggesting or booking times. Returns days, each with "meetingCount" (how many meetings Guy already has that day — prefer the lowest) and "freeSlots"; each slot has "time" (ISO start — pass to book_meeting), "display" (Guy\'s time) and "leadDisplay" (the lead\'s time). Guy\'s lunch (12:00–12:45) is held back by default and won\'t appear.',
    input_schema: {
      type: 'object',
      properties: {
        rangeHint: { type: 'string', description: 'Optional note about what Guy asked for, e.g. "next week" or "mornings only". Informational; you still filter the returned days yourself.' },
        includeLunch: { type: 'boolean', description: 'Set true ONLY when Guy explicitly wants a lunch-time meeting — then the held-back 12:00–12:45 slots are included. Leave unset/false otherwise.' },
      },
    },
  },
  {
    name: 'book_meeting',
    description: 'Create the real calendar invite and email the lead the standard invite (Guy\'s Zoom + reminders are added automatically). ONLY call this after Guy has explicitly confirmed the specific date and time in chat. Use an ISO start that came from check_availability (a slot\'s "time") OR from check_time (its "startISO") — never build the ISO yourself. If the time CLASHES with an existing meeting, this tool refuses unless you pass confirmDoubleBook:true — so first tell Guy about the clash, get his explicit yes, then re-call with confirmDoubleBook:true.',
    input_schema: {
      type: 'object',
      properties: {
        startISO: { type: 'string', description: 'The meeting start as an ISO timestamp — a slot\'s "time" from check_availability or "startISO" from check_time.' },
        durationMins: { type: 'number', description: 'Optional meeting length in minutes; omit to use Guy\'s default.' },
        confirmDoubleBook: { type: 'boolean', description: 'Set true ONLY after Guy has explicitly OK\'d booking over an existing meeting. Leave false/omitted normally — the tool will refuse a clashing time and tell you what it clashes with so you can ask Guy first.' },
      },
      required: ['startISO'],
    },
  },
  {
    name: 'check_time',
    description: 'Verify a SPECIFIC time Guy (or the lead) proposed — including off-grid times (e.g. 2:15) or times you didn\'t offer. Pass the calendar date + a clock time + whose timezone it\'s in; the system converts it correctly (never do timezone math yourself), then reports both-side display strings and any CLASH with an existing meeting. Use this whenever Guy names a particular time rather than picking one of your offered slots, THEN confirm with him before book_meeting. A clash does NOT block booking (Guy can choose to double-book) — it just must be surfaced.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'The calendar date in YYYY-MM-DD (work it out from the conversation / check_availability days).' },
        time: { type: 'string', description: 'The clock time, e.g. "14:00" or "2:15pm".' },
        side: { type: 'string', enum: ['coach', 'lead'], description: '"coach" if the time is in Guy\'s timezone (default), "lead" if Guy gave it in the lead\'s timezone.' },
        durationMins: { type: 'number', description: 'Optional meeting length in minutes; omit to use Guy\'s default.' },
      },
      required: ['date', 'time'],
    },
  },
  {
    name: 'propose_times',
    description: 'Use THIS (not propose_message) whenever you are offering the lead one or more meeting times. Pass intro + outro text in Guy\'s voice, plus slotTimes = the chosen slots\' "time" ISO values from check_availability. The system SORTS them earliest-first, DROPS any outside Guy\'s booking hours or in his lunch hold, formats them in the lead\'s timezone, and assembles the final message — so you don\'t format or order the list yourself. If it reports it dropped slots and too few remain, pick replacement slots and call again. If the lead\'s timezone differs from Guy\'s, note that in your intro/outro.',
    input_schema: {
      type: 'object',
      properties: {
        intro: { type: 'string', description: 'Opening line(s) before the times, in Guy\'s voice.' },
        slotTimes: { type: 'array', items: { type: 'string' }, description: 'ISO start times chosen from check_availability (the slot "time" field).' },
        outro: { type: 'string', description: 'Closing line(s) after the times, e.g. "Just let me know what suits and I\'ll send a Zoom link."' },
        includeLunch: { type: 'boolean', description: 'Set true ONLY when Guy explicitly wants to offer a lunch-time slot — otherwise lunch (12:00–12:45) is dropped from the list.' },
      },
      required: ['slotTimes'],
    },
  },
  {
    name: 'propose_message',
    description: 'Set the LinkedIn message draft Guy will edit/accept and send — for any SINGLE message (thanks opener, warm-reply follow-up, a reply, the post-booking "invite\'s on its way" confirmation). For OFFERING TIMES use propose_times instead. Plain text only — no markdown.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The LinkedIn message text, in Guy\'s voice, ready to send.' },
      },
      required: ['message'],
    },
  },
];

// Pick the exact sign-off line for THIS draft (CODE — deterministic; the model just uses it verbatim).
// Default to the FULL tagline ("(I know a) Guy"); drop to the plain name ("Guy") only when the coach's
// PREVIOUS message in this thread was itself signed off plain (they'd already trimmed the tagline). This
// matches Guy's "trimming is easy, re-adding is laborious → err fuller" rule. Tenant-agnostic: the names
// and tagline all come from the per-tenant voice prefs — nothing hardcoded here.
function chooseSignoff(conversation, coachName, vp) {
  const full = vp.signoffTagline ? `${vp.signoffTagline} ${vp.signoffName}` : vp.signoffName;
  if (!vp.signoffTagline) return full;                    // no tagline configured → always the plain name
  const first = String(coachName || vp.signoffName || '').trim().split(/\s+/)[0].toLowerCase();
  const coachMsgs = (Array.isArray(conversation) ? conversation : [])
    .filter((m) => m && m.text && String(m.sender || '').toLowerCase().includes(first));
  if (!coachMsgs.length) return full;                     // no prior coach message → default to the tagline
  const tail = String(coachMsgs[coachMsgs.length - 1].text || '').toLowerCase().slice(-60);
  if (tail.includes(vp.signoffTagline.toLowerCase())) return full;         // prev used the tagline → keep it
  if (tail.includes(vp.signoffName.toLowerCase())) return vp.signoffName;   // prev signed plain → stay plain
  return full;                                            // prev had no clear sign-off → err fuller
}

// Compact, grounded context for the agent. `buildProfileBlock` / `buildConversationBlock` are passed
// in so the formatting stays identical to the rest of Wingguy (the route owns those helpers).
function buildContext({ profileBlock, convoBlock, leadEmail, coachName, prefs, campaignTemplate, voice }) {
  const tplBlock = campaignTemplate && campaignTemplate.instructions
    ? `CAMPAIGN TEMPLATE — "${campaignTemplate.label || campaignTemplate.id}" (use this for the opener / warm-reply message; it's Guy's real structure & voice — match its beats and sign-off):\n${campaignTemplate.instructions}\n\n`
    : '';
  // Greeting + sign-off house style. Values come from the per-tenant voice prefs; the sign-off string is
  // already decided in code (chooseSignoff) so the model just uses it verbatim.
  const who = (coachName || 'Guy Wilson').split(/\s+/)[0];
  const voiceBlock = voice ? (
    `GREETING & SIGN-OFF — ${who}'s house style (keep it; the human trims it on a given message if they don't want it):\n` +
    (voice.greetWithFirstName
      ? `- OPEN every message with a warm greeting that uses the LEAD'S FIRST NAME, fitting the moment: "Hi <First>," on a first/cold touch; "Great, <First> —" / "Perfect, <First> —" / "Thanks, <First> —" when replying to something they said. Always work their first name in — people like seeing their name.\n`
      : '') +
    `- SIGN OFF with EXACTLY this closing line: "${voice.signoff}". Use it verbatim as the last line; do not add or drop the tagline yourself — that choice is already made for you.\n` +
    `- When you OFFER TIMES (propose_times), put the greeting in the intro; the sign-off is appended automatically, so DON'T put a sign-off in the outro.\n\n`
  ) : '';
  return (
    `CONTEXT FOR THIS CHAT (you are helping Guy with this lead):\n\n` +
    `${profileBlock ? `LEAD PROFILE:\n${profileBlock}\n\n` : ''}` +
    `${convoBlock ? `LINKEDIN CONVERSATION SO FAR (oldest first):\n${convoBlock}\n\n` : ''}` +
    `${tplBlock}` +
    `${voiceBlock}` +
    `LEAD EMAIL FOR THE INVITE: ${leadEmail ? leadEmail : '(not on file — ask Guy to add it before booking)'}\n` +
    `COACH NAME: ${coachName || 'Guy Wilson'}\n` +
    `GUY'S BOOKING PREFERENCES (JSON): ${JSON.stringify(prefs)}`
  );
}

// Minutes-since-midnight from "9:30" / "09:30" (prefs) or a display string like "9:00 am" / "9:00 AM-9:30 AM".
function hhmmToMin(s) { const m = String(s || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function minFromDisplay(s) {
  const m = String(s || '').match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let h = (+m[1]) % 12; if (/pm/i.test(m[3])) h += 12;
  return h * 60 + (+m[2]);
}
// HARD bounds: never surface slots before earliestStart or after lastStart (the agent doesn't reliably
// hold the soft floor on its own — enforce it on the data so a sub-9:30 / post-16:30 slot can't be offered).
function withinBounds(slot, eMin, lMin) {
  const m = minFromDisplay(slot.display);
  return m == null ? true : (m >= eMin && m <= lMin);
}
// Minutes-since-midnight of an ISO instant IN a given timezone (for coach-hours/lunch checks).
function minutesInTz(iso, tz) {
  const s = new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  return hhmmToMin(s);
}
// True if a slot START overlaps the coach's SOFT lunch hold, checked in the COACH's timezone.
// Centralised so check_availability (don't even offer the slot) and propose_times (backstop) agree —
// the bug was that only the backstop applied it, so a coach-noon slot could be surfaced and offered.
function inLunch(iso, tz, prefs, len) {
  if (!(prefs && prefs.lunch && prefs.lunch.soft)) return false;
  const lunchStart = hhmmToMin(prefs.lunch.start);
  if (lunchStart == null) return false;
  const lunchEnd = lunchStart + ((prefs.lunch && prefs.lunch.durationMins) || 0);
  const cMin = minutesInTz(iso, tz);
  if (cMin == null) return false;
  return cMin < lunchEnd && (cMin + (len || 0)) > lunchStart;
}
// Format a slot for the LinkedIn message in the lead's timezone, Guy's style: "Wed 1 July, 1:30 pm".
function fmtSlot(iso, tz) {
  const d = new Date(iso);
  const wd = d.toLocaleString('en-AU', { weekday: 'short', timeZone: tz });
  const day = d.toLocaleString('en-AU', { day: 'numeric', timeZone: tz });
  const mo = d.toLocaleString('en-AU', { month: 'long', timeZone: tz });
  const tm = d.toLocaleString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).toLowerCase();
  return `${wd} ${day} ${mo}, ${tm}`;
}

// Run one chat turn (which may involve several tool round-trips) to completion.
// Returns { ok, reply, draft, booked, messages, model }.
async function runWingguyChatTurn({ coach, profile = {}, conversation = [], messages = [], leadEmail, profileBlock = '', convoBlock = '', campaignTemplate = null, deps = {} }) {
  const client = deps.client || getAnthropicClient();
  const getAvailability = deps.getAvailabilityForCoach || wingguyCalendar.getAvailabilityForCoach;
  const bookMeeting = deps.createBookingEvent || wingguyCalendar.createBookingEvent;
  const checkProposedTime = deps.checkProposedTime || wingguyCalendar.checkProposedTime;
  const getClashesForISO = deps.getClashesForISO || wingguyCalendar.getClashesForISO;
  const prefs = getBookingPrefs(coach.clientId);
  // Per-tenant greeting + sign-off house style (VARIABLE), with the exact sign-off decided in code
  // (CODE) from this thread's previous coach message. The behaviour (RULE) is generic; only the values
  // are per-tenant, so this is multi-tenant-ready — see config/wingguyVoicePrefs.js.
  const vp = getVoicePrefs(coach.clientId);
  const voice = { greetWithFirstName: vp.greetWithFirstName, signoff: chooseSignoff(conversation, coach.clientName, vp), name: vp.signoffName };

  const system = [
    { type: 'text', text: WINGGUY_VOICE },
    { type: 'text', text: WINGGUY_AGENT_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: buildContext({ profileBlock, convoBlock, leadEmail, coachName: coach.clientName, prefs, campaignTemplate, voice }) },
  ];

  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  let currentDraft = null;
  let bookedEvent = null;
  let availTz = {}; // { yourTimezone, leadTimezone } captured from check_availability, used by propose_times

  const runTool = async (name, input) => {
    if (name === 'check_availability') {
      const avail = await getAvailability(coach.clientId, profile.location || '');
      availTz = { yourTimezone: avail.yourTimezone, leadTimezone: avail.leadTimezone };
      const eMin = hhmmToMin(prefs.earliestStart) ?? 0;
      const lMin = hhmmToMin(prefs.lastStart) ?? 24 * 60;
      const aTz = avail.yourTimezone || 'Australia/Brisbane';
      const aLen = prefs.meetingLengthMins || 30;
      const days = (avail.days || [])
        // soft lunch hold is stripped HERE too (not just in propose_times) so the model never even sees a coach-lunch
        // slot as free — UNLESS Guy explicitly asked for a lunch-time meeting (input.includeLunch), then surface them.
        .map((d) => ({ ...d, freeSlots: (d.freeSlots || []).filter((s) => withinBounds(s, eMin, lMin) && (input.includeLunch || !inLunch(s.time, aTz, prefs, aLen))) }))
        .filter((d) => d.freeSlots.length)
        .slice(0, AVAIL_MAX_DAYS)
        .map((d) => ({ ...d, freeSlots: d.freeSlots.slice(0, AVAIL_MAX_SLOTS_PER_DAY) }));
      return { yourTimezone: avail.yourTimezone, leadTimezone: avail.leadTimezone, days };
    }
    if (name === 'propose_times') {
      // CODE-OWNED time list: enforce order + Guy's hours + soft lunch-skip + lead-timezone formatting,
      // so none of those depend on the model getting it right.
      const tz = availTz.yourTimezone || 'Australia/Brisbane';
      const leadTz = availTz.leadTimezone || tz;
      const eMin = hhmmToMin(prefs.earliestStart) ?? 0;
      const lMin = hhmmToMin(prefs.lastStart) ?? 24 * 60;
      const len = prefs.meetingLengthMins || 30;
      const dropped = [];
      const kept = [];
      for (const iso of (Array.isArray(input.slotTimes) ? input.slotTimes : [])) {
        if (isNaN(Date.parse(iso))) { dropped.push({ iso, why: 'invalid' }); continue; }
        const cMin = minutesInTz(iso, tz);
        if (cMin == null || cMin < eMin || cMin > lMin) { dropped.push({ iso, why: 'outside your booking hours' }); continue; }
        if (!input.includeLunch && inLunch(iso, tz, prefs, len)) { dropped.push({ iso, why: 'lunch hold' }); continue; }
        kept.push(iso);
      }
      const ordered = [...new Set(kept)].sort((a, b) => Date.parse(a) - Date.parse(b)); // earliest-first, deduped
      if (!ordered.length) {
        return { ok: false, error: 'None of those slots are valid (all outside your hours / in lunch). Pick different slots from check_availability.', dropped };
      }
      const bullets = ordered.map((iso) => `- ${fmtSlot(iso, leadTz)}`).join('\n');
      const intro = String(input.intro || '').trim();
      let outro = String(input.outro || '').trim();
      // Code owns the sign-off on a times message (the model composes intro/outro but often omits it, or
      // adds the wrong variant). Strip any trailing sign-off line the model tacked on, then append the
      // tenant's chosen sign-off (chooseSignoff already decided tagline vs plain).
      if (voice && voice.name) {
        const esc = voice.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const parts = outro.split('\n');
        while (parts.length) {
          const last = parts[parts.length - 1].trim();
          if (last === '' || (last.length <= 18 && new RegExp('\\b' + esc + '\\b', 'i').test(last))) { parts.pop(); continue; }
          break;
        }
        outro = parts.join('\n').trim();
      }
      currentDraft = [intro, bullets, outro].filter(Boolean).join('\n\n') + (voice && voice.signoff ? `\n\n${voice.signoff}` : '');
      return { ok: true, offered: ordered.length, dropped };
    }
    if (name === 'check_time') {
      const r = await checkProposedTime(coach.clientId, {
        date: input.date,
        time: input.time,
        side: input.side || 'coach',
        leadLocation: profile.location || '',
        durationMins: input.durationMins,
      });
      if (!r.ok) return r;
      // Soft, overridable flags (bounds + lunch are Guy's prefs, not hard rules) — surfaced so the
      // agent can warn, NOT to block.
      const tz = r.yourTimezone || 'Australia/Brisbane';
      const eMin = hhmmToMin(prefs.earliestStart);
      const lMin = hhmmToMin(prefs.lastStart);
      const cMin = minutesInTz(r.startISO, tz);
      const withinHours = (eMin == null || lMin == null || cMin == null) ? true : (cMin >= eMin && cMin <= lMin);
      const hitsLunch = inLunch(r.startISO, tz, prefs, r.durationMins);
      return {
        ok: true,
        startISO: r.startISO,
        durationMins: r.durationMins,
        display: r.display,
        leadDisplay: r.leadDisplay,
        free: r.clashes.length === 0,
        clashes: r.clashes,
        withinHours,
        hitsLunch,
      };
    }
    if (name === 'book_meeting') {
      if (!leadEmail) return { ok: false, error: 'No lead email on file — ask Guy to add the lead\'s email before booking.' };
      // No-ACCIDENTAL-double-book guard (the one thing code still enforces): refuse a clashing time
      // unless Guy has explicitly OK'd it (confirmDoubleBook). Conscious double-booking is allowed.
      if (!input.confirmDoubleBook) {
        const clashes = await getClashesForISO(coach.clientId, input.startISO, input.durationMins);
        if (clashes.length) {
          return {
            ok: false,
            clash: true,
            clashes,
            error: `That time clashes with: ${clashes.map((c) => `${c.summary} (${c.display})`).join('; ')}. Tell Guy and, if he still wants it, re-call book_meeting with confirmDoubleBook:true.`,
          };
        }
      }
      const result = await bookMeeting(coach, {
        startISO: input.startISO,
        durationMins: input.durationMins,
        leadEmail,
        leadName: profile.name || '',
        leadLinkedIn: profile.profileUrl || '',
      });
      if (result.ok) bookedEvent = result;
      return result;
    }
    if (name === 'propose_message') {
      currentDraft = String((input && input.message) || '').trim();
      return { ok: true };
    }
    return { ok: false, error: `unknown tool ${name}` };
  };

  let assistantText = '';
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: CHAT_MAX_TOKENS,
      thinking: CHAT_THINKING,
      system,
      tools: AGENT_TOOLS,
      messages: convo,
    });

    if (response.stop_reason === 'refusal') {
      return { ok: false, error: 'Claude declined the request.' };
    }

    convo.push({ role: 'assistant', content: response.content });
    assistantText = (response.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const toolUses = (response.content || []).filter((b) => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !toolUses.length) break;

    const toolResults = [];
    for (const tu of toolUses) {
      let result;
      try {
        result = await runTool(tu.name, tu.input || {});
      } catch (e) {
        result = { ok: false, error: e.message };
      }
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    convo.push({ role: 'user', content: toolResults });
  }

  return { ok: true, reply: assistantText, draft: currentDraft, booked: bookedEvent, messages: convo, model: MODEL_ID };
}

module.exports = { runWingguyChatTurn, AGENT_TOOLS, inLunch };
