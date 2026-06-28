// services/wingguyChat.js
// Wingguy Slice 2 BIG half — the tool-using CHAT agent (2026-06-27). ONE place owns the agent loop
// so the route and the cloud test exercise the SAME code path. Guy chats with it in the LinkedIn
// panel; it checks his real calendar (check_availability), books (book_meeting → proven Nylas write),
// and keeps a LinkedIn message draft ready to send (propose_message). Stateless: the caller passes
// the running `messages` array each turn (including prior tool blocks).
//
// Model = Sonnet 4.6 by default (WINGGUY_DRAFT_MODEL_ID), consistent with the rest of Wingguy.
// `deps` lets the test inject stubs (e.g. a no-op book) so it can prove the brain without creating
// real events.

const { getAnthropicClient } = require('../config/anthropicClient');
const { WINGGUY_VOICE, WINGGUY_AGENT_INSTRUCTIONS } = require('./../config/wingguyTemplates');
const { getBookingPrefs } = require('../config/wingguyBookingPrefs');
const wingguyCalendar = require('./wingguyCalendar');

const MODEL_ID = process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-4-6';
const CHAT_MAX_TOKENS = 1500;
const MAX_TOOL_ITERATIONS = 8;     // safety cap on the agent loop
const AVAIL_MAX_DAYS = 14;         // bound the availability tool result (tokens) — ~2 working weeks
const AVAIL_MAX_SLOTS_PER_DAY = 8;

const AGENT_TOOLS = [
  {
    name: 'check_availability',
    description: 'Look at Guy\'s real calendar and return open meeting slots (timezone-correct for both Guy and the lead). Call this before suggesting or booking times. Returns days, each with "meetingCount" (how many meetings Guy already has that day — prefer the lowest) and "freeSlots"; each slot has "time" (ISO start — pass to book_meeting), "display" (Guy\'s time) and "leadDisplay" (the lead\'s time).',
    input_schema: {
      type: 'object',
      properties: {
        rangeHint: { type: 'string', description: 'Optional note about what Guy asked for, e.g. "next week" or "mornings only". Informational; you still filter the returned days yourself.' },
      },
    },
  },
  {
    name: 'book_meeting',
    description: 'Create the real calendar invite and email the lead the standard invite (Guy\'s Zoom + reminders are added automatically). ONLY call this after Guy has explicitly confirmed the specific date and time in chat. Use a "time" value returned by check_availability as startISO.',
    input_schema: {
      type: 'object',
      properties: {
        startISO: { type: 'string', description: 'The meeting start as an ISO timestamp — use a slot\'s "time" from check_availability.' },
        durationMins: { type: 'number', description: 'Optional meeting length in minutes; omit to use Guy\'s default.' },
      },
      required: ['startISO'],
    },
  },
  {
    name: 'propose_message',
    description: 'Set the LinkedIn message draft that Guy will edit/accept and send to the lead. Call this whenever you have a message for Guy to send (offering times, confirming a booking, etc.). Plain text only — no markdown.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The LinkedIn message text, in Guy\'s voice, ready to send.' },
      },
      required: ['message'],
    },
  },
];

// Compact, grounded context for the agent. `buildProfileBlock` / `buildConversationBlock` are passed
// in so the formatting stays identical to the rest of Wingguy (the route owns those helpers).
function buildContext({ profileBlock, convoBlock, leadEmail, coachName, prefs, campaignTemplate }) {
  const tplBlock = campaignTemplate && campaignTemplate.instructions
    ? `CAMPAIGN TEMPLATE — "${campaignTemplate.label || campaignTemplate.id}" (use this for the opener / warm-reply message; it's Guy's real structure & voice — match its beats and sign-off):\n${campaignTemplate.instructions}\n\n`
    : '';
  return (
    `CONTEXT FOR THIS CHAT (you are helping Guy with this lead):\n\n` +
    `${profileBlock ? `LEAD PROFILE:\n${profileBlock}\n\n` : ''}` +
    `${convoBlock ? `LINKEDIN CONVERSATION SO FAR (oldest first):\n${convoBlock}\n\n` : ''}` +
    `${tplBlock}` +
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

// Run one chat turn (which may involve several tool round-trips) to completion.
// Returns { ok, reply, draft, booked, messages, model }.
async function runWingguyChatTurn({ coach, profile = {}, conversation = [], messages = [], leadEmail, profileBlock = '', convoBlock = '', campaignTemplate = null, deps = {} }) {
  const client = deps.client || getAnthropicClient();
  const getAvailability = deps.getAvailabilityForCoach || wingguyCalendar.getAvailabilityForCoach;
  const bookMeeting = deps.createBookingEvent || wingguyCalendar.createBookingEvent;
  const prefs = getBookingPrefs(coach.clientId);

  const system = [
    { type: 'text', text: WINGGUY_VOICE },
    { type: 'text', text: WINGGUY_AGENT_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: buildContext({ profileBlock, convoBlock, leadEmail, coachName: coach.clientName, prefs, campaignTemplate }) },
  ];

  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  let currentDraft = null;
  let bookedEvent = null;

  const runTool = async (name, input) => {
    if (name === 'check_availability') {
      const avail = await getAvailability(coach.clientId, profile.location || '');
      const eMin = hhmmToMin(prefs.earliestStart) ?? 0;
      const lMin = hhmmToMin(prefs.lastStart) ?? 24 * 60;
      const days = (avail.days || [])
        .map((d) => ({ ...d, freeSlots: (d.freeSlots || []).filter((s) => withinBounds(s, eMin, lMin)) }))
        .filter((d) => d.freeSlots.length)
        .slice(0, AVAIL_MAX_DAYS)
        .map((d) => ({ ...d, freeSlots: d.freeSlots.slice(0, AVAIL_MAX_SLOTS_PER_DAY) }));
      return { yourTimezone: avail.yourTimezone, leadTimezone: avail.leadTimezone, days };
    }
    if (name === 'book_meeting') {
      if (!leadEmail) return { ok: false, error: 'No lead email on file — ask Guy to add the lead\'s email before booking.' };
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

module.exports = { runWingguyChatTurn, AGENT_TOOLS };
