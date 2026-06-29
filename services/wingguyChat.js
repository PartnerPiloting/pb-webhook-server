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
    name: 'propose_times',
    description: 'Use THIS (not propose_message) whenever you are offering the lead one or more meeting times. Pass intro + outro text in Guy\'s voice, plus slotTimes = the chosen slots\' "time" ISO values from check_availability. The system SORTS them earliest-first, DROPS any outside Guy\'s booking hours or in his lunch hold, formats them in the lead\'s timezone, and assembles the final message — so you don\'t format or order the list yourself. If it reports it dropped slots and too few remain, pick replacement slots and call again. If the lead\'s timezone differs from Guy\'s, note that in your intro/outro.',
    input_schema: {
      type: 'object',
      properties: {
        intro: { type: 'string', description: 'Opening line(s) before the times, in Guy\'s voice.' },
        slotTimes: { type: 'array', items: { type: 'string' }, description: 'ISO start times chosen from check_availability (the slot "time" field).' },
        outro: { type: 'string', description: 'Closing line(s) after the times, e.g. "Just let me know what suits and I\'ll send a Zoom link."' },
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
  const prefs = getBookingPrefs(coach.clientId);

  const system = [
    { type: 'text', text: WINGGUY_VOICE },
    { type: 'text', text: WINGGUY_AGENT_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: buildContext({ profileBlock, convoBlock, leadEmail, coachName: coach.clientName, prefs, campaignTemplate }) },
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
        // soft lunch hold is stripped HERE too (not just in propose_times) so the model never even sees a coach-lunch slot as free
        .map((d) => ({ ...d, freeSlots: (d.freeSlots || []).filter((s) => withinBounds(s, eMin, lMin) && !inLunch(s.time, aTz, prefs, aLen)) }))
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
        if (inLunch(iso, tz, prefs, len)) { dropped.push({ iso, why: 'lunch hold' }); continue; }
        kept.push(iso);
      }
      const ordered = [...new Set(kept)].sort((a, b) => Date.parse(a) - Date.parse(b)); // earliest-first, deduped
      if (!ordered.length) {
        return { ok: false, error: 'None of those slots are valid (all outside your hours / in lunch). Pick different slots from check_availability.', dropped };
      }
      const bullets = ordered.map((iso) => `- ${fmtSlot(iso, leadTz)}`).join('\n');
      const intro = String(input.intro || '').trim();
      const outro = String(input.outro || '').trim();
      currentDraft = [intro, bullets, outro].filter(Boolean).join('\n\n');
      return { ok: true, offered: ordered.length, dropped };
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

module.exports = { runWingguyChatTurn, AGENT_TOOLS, inLunch };
