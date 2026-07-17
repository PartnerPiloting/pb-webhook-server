/**
 * Wingguy booking MCP tools — the "ONE BOOKING DOOR" (2026-07-06).
 *
 * WHY: claude.ai chats used to book through the raw calendar connector, which knows nothing about
 * Guy's rules — that door produced the 9:00am booking and contributed to the Rebecca/Mary Anne
 * double-book. These three tools expose the SAME proven machinery the extension panel uses
 * (services/wingguyCalendar.js: filterAvailability + checkProposedTime + bookMeetingGuarded), so a
 * chat booking gets every code guarantee: booking-hours bounds, lunch hold, no past/too-soon slots,
 * the daily meeting cap, the clash guard, and the manual-HOLD semantics.
 *
 * One definition, BOTH transports (same pattern as services/wingguyRulesMcp.js):
 *   - the SDK server (services/mcpRecallServer.js → /mcp2/:token, claude.ai)
 *   - the legacy hand-rolled endpoint (routes/recallWebhookRoutes.js → /mcp/:token, Claude Code)
 *
 * Step-1 auth posture: tenant hard-wired to the coach client behind the existing connector token.
 */

const { z } = require('zod');
const { DateTime } = require('luxon');
const wingguyCalendar = require('./wingguyCalendar');
const { getBookingPrefs } = require('../config/wingguyBookingPrefs');
// NOTE: coachingClientLookupService + clientService are required LAZILY inside runBookMeeting —
// their Airtable config crashes at module load when env vars are absent (local test runs).

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

// ---------------------------------------------------------------------------
// Executors — return { text, isError? }
// ---------------------------------------------------------------------------

async function runCheckAvailability({ lead_location, include_lunch, include_soon, include_weekends, include_far_weeks } = {}, tenant = TENANT) {
  const prefs = getBookingPrefs(tenant);
  const avail = await wingguyCalendar.getAvailabilityForCoach(tenant, lead_location || '');
  const filtered = wingguyCalendar.filterAvailability(avail, prefs, {
    includeLunch: !!include_lunch,
    includeSoon: !!include_soon,
    includeWeekends: !!include_weekends,
    includeFarWeeks: !!include_far_weeks,
  });
  const win = filtered.window || wingguyCalendar.offerWindowInfo(filtered.yourTimezone || 'Australia/Brisbane');
  const windowLine = `TODAY IS ${win.today} (${win.timezone}). This week = ${win.thisWeek}; next week = ${win.nextWeek}; later days are FALLBACK WEEKS. Resolve every relative date phrase ("next week", "Tuesday") against this anchor — never guess today's date.`;
  if (!filtered.days.length) {
    return { text: `${windowLine}\n\nNo offerable slots in the scan window (after the coach's rules: notice period, hours, lunch, weekdays-only). Widen with include_soon / include_weekends only if the coach explicitly asked.` };
  }
  // Slots before the coach's preferred day start are legal but AT-A-PINCH only — mark them so a
  // chat model applies the "10:00+ first" rule without holding it in its head.
  const coachTz = filtered.yourTimezone || 'Australia/Brisbane';
  const prefMin = wingguyCalendar.hhmmToMin(prefs.preferredStart);
  const pinch = (s) => (prefMin != null && wingguyCalendar.minutesInTz(s.time, coachTz) < prefMin) ? ' ⚠ AT-A-PINCH (before preferred 10:00 start — offer only if later times can\'t fill the options)' : '';
  // Daily load is a PREFERENCE, not a cap (Guy 2026-07-10, after the hard version emptied next
  // week): busy days stay offerable, flagged — stacking them beats spilling into a fallback week.
  const busy = (d) => d.busyDay ? ` ⚠ BUSY DAY — already ${d.meetingCount} meetings (at/over his preferred ${prefs.maxMeetingsPerDay}/day): still offerable and BETTER than a fallback week, but prefer lighter days first and tell the coach how loaded it is` : '';
  const lines = filtered.days.map((d) =>
    `${d.date} (${d.day}, ${d.meetingCount || 0} meetings)${busy(d)}${d.fallbackWeek ? ' ⚠ FALLBACK WEEK — beyond next week; use ONLY to top up when the nearer days (including busy ones) can\'t fill the options, and never call these "next week"' : ''}:\n` +
    d.freeSlots.map((s) => `  - label="${s.label}" (coach: ${s.display}) time=${s.time}${pinch(s)}`).join('\n'));
  return {
    text:
      `${windowLine}\n\n` +
      `Offerable slots (coach rules already applied: hours, lunch, notice, weekdays). ` +
      `Coach timezone: ${filtered.yourTimezone}; lead timezone: ${filtered.leadTimezone}. ` +
      // Where the lead is based, or a loud flag that we're guessing — the coach must ALWAYS hear
      // which one it is (Guy 2026-07-13; the silent assume-coach's-tz fallback is the trap).
      (filtered.leadTzDetected
        ? `Lead is based in "${filtered.leadLocation}" — ALWAYS tell the coach where the lead is based when you present times. `
        : `⚠ Lead location ${filtered.leadLocation ? `"${filtered.leadLocation}" NOT recognised` : 'NOT provided'} — lead timezone is ASSUMED to be the coach's. Tell the coach this plainly and confirm where the lead is based before offering times. `) +
      `Each "label" is EXACTLY how that slot reads in the LEAD's timezone — pick slots by label, then use that slot's "time" ISO for booking. NEVER build an ISO yourself. ` +
      (filtered.leadTimezone && filtered.leadTimezone !== filtered.yourTimezone
        ? `The lead's timezone DIFFERS from the coach's: when you write these times into a message, add ONE line under the list — "(all times are ${wingguyCalendar.tzCity(filtered.leadTimezone)} time)" — never a marker on every line, and never leave converted times unlabelled. `
        : '') +
      `Prefer the least-busy days and vary the time of day across the options.\n\n` +
      lines.join('\n'),
  };
}

// "What's on my calendar?" — the read-only counterpart to check_availability. Routes through the
// SAME provider seam as booking (google | nylas | zoho), so every tenant can ask this inside Wingguy
// rather than needing a separate calendar connector in their Claude (impossible for Zoho anyway).
async function runListEvents({ range, date, end_date } = {}, tenant = TENANT) {
  const r = await wingguyCalendar.listEventsForCoach(tenant, { range, date, endDate: end_date });
  const tz = r.timezone || 'Australia/Brisbane';
  if (!r.ok) return { text: `Couldn't read the calendar${r.provider ? ` (${r.provider})` : ''}: ${r.error}`, isError: true };

  const win = wingguyCalendar.offerWindowInfo(tz);
  const anchor = `TODAY IS ${win.today} (${win.timezone}). This week = ${win.thisWeek}; next week = ${win.nextWeek}. Resolve every relative date phrase against this anchor — never guess today's date.`;
  const span = r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`;
  if (!r.events.length) return { text: `${anchor}\n\nNothing scheduled for ${span}.` };

  // Group into the coach's local days, in time order.
  const byDate = new Map();
  for (const ev of r.events) {
    const d = wingguyCalendar.dateStrInTz(ev.start, tz);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(ev);
  }
  const blocks = [...byDate.entries()].map(([d, list]) => {
    const heading = DateTime.fromISO(`${d}T00:00`, { zone: tz }).toFormat('cccc d LLL');
    const lines = list.map((ev) => {
      const guests = (ev.attendees || [])
        .filter((a) => !a.self && (a.email || a.displayName))
        .map((a) => a.displayName || a.email);
      const who = guests.length
        ? ` — with ${guests.slice(0, 4).join(', ')}${guests.length > 4 ? ` +${guests.length - 4} more` : ''}`
        : '';
      const from = wingguyCalendar.timeOnlyInTz(ev.start, tz);
      const to = wingguyCalendar.timeOnlyInTz(ev.end, tz);
      return `  - ${from}–${to}  ${ev.summary || '(No title)'}${who}`;
    });
    return `${heading} (${list.length} ${list.length === 1 ? 'event' : 'events'}):\n${lines.join('\n')}`;
  });
  return {
    text:
      `${anchor}\n\n` +
      `The coach's calendar for ${span}, read live from their own calendar (${r.provider}). All times are ${tz}.\n\n` +
      `${blocks.join('\n\n')}\n\n` +
      `These are what's BOOKED — for when they're FREE to offer a lead, use wingguy_check_availability (it applies their booking rules).`,
  };
}

async function runCheckTime({ date, time, side, lead_location, duration_mins } = {}, tenant = TENANT) {
  const prefs = getBookingPrefs(tenant);
  const r = await wingguyCalendar.checkProposedTime(tenant, {
    date, time, side: side || 'coach', leadLocation: lead_location || '', durationMins: duration_mins,
  });
  if (!r.ok) return { text: `Error: ${r.error}`, isError: true };
  const tz = r.yourTimezone || 'Australia/Brisbane';
  const eMin = wingguyCalendar.hhmmToMin(prefs.earliestStart);
  const lMin = wingguyCalendar.hhmmToMin(prefs.lastStart);
  const cMin = wingguyCalendar.minutesInTz(r.startISO, tz);
  const withinHours = (eMin == null || lMin == null || cMin == null) ? true : (cMin >= eMin && cMin <= lMin);
  const hitsLunch = wingguyCalendar.inLunch(r.startISO, tz, prefs, r.durationMins);
  const flags = [];
  if (!withinHours) flags.push('OUTSIDE the coach\'s booking hours — flag it and get an explicit yes before booking');
  if (hitsLunch) flags.push('hits the coach\'s lunch hold — flag it');
  if (r.clashes.length) flags.push(`CLASHES with: ${r.clashes.map((c) => `${c.summary} (${c.display})`).join('; ')}`);
  return {
    text:
      `startISO=${r.startISO} (pass THIS to wingguy_book_meeting — never build your own)\n` +
      `Coach: ${r.display} · Lead: ${r.leadDisplay} · ${r.durationMins} mins\n` +
      (flags.length ? `⚠ ${flags.join('\n⚠ ')}` : 'Free, within hours, no flags.'),
  };
}

async function runBookMeeting({ start_iso, duration_mins, lead_name, lead_email, lead_linkedin, confirm_double_book } = {}, tenant = TENANT) {
  const name = String(lead_name || '').trim();
  if (!name) return { text: 'Error: lead_name is required (it titles the invite and matches any HOLD events).', isError: true };

  const clientService = require('./clientService');
  const { lookupLeadContactByName } = require('./coachingClientLookupService');
  const coach = await clientService.getClientById(tenant);
  if (!coach) return { text: `Server config error: coach client "${tenant}" not found.`, isError: true };

  // Resolve the invite email: an explicit lead_email wins; otherwise the CRM by name.
  let email = String(lead_email || '').trim();
  let emailSource = 'given';
  let linkedin = String(lead_linkedin || '').trim();
  if (!email) {
    const found = await lookupLeadContactByName(name, { clientId: tenant });
    if (!found.lead || !found.lead.email) {
      const alts = (found.matches || []).map((m) => m.leadName).filter(Boolean).slice(0, 5);
      return {
        text: `No CRM email found for "${name}"${alts.length ? ` (close matches: ${alts.join(', ')})` : ''}. Ask the coach for the lead's email (or fix the name) — the invite needs a guest address.`,
        isError: true,
      };
    }
    email = found.lead.email;
    emailSource = `CRM (${found.lead.leadName})`;
    if (!linkedin) linkedin = found.lead.linkedinProfileUrl || '';
  }

  const result = await wingguyCalendar.bookMeetingGuarded(coach, {
    startISO: start_iso,
    durationMins: duration_mins,
    leadEmail: email,
    leadName: name,
    leadLinkedIn: linkedin,
    confirmDoubleBook: !!confirm_double_book,
  });
  if (!result.ok) return { text: `NOT booked. ${result.error}`, isError: true };
  return {
    text:
      `Booked: "${result.title}" — start ${result.start} (${result.durationMins} mins), invite emailed to ${email} [email source: ${emailSource}].\n` +
      `Now restate the exact date+time to the human in the COACH's timezone AND the lead's, so a wrong-hour booking is caught immediately.`,
  };
}

// ---------------------------------------------------------------------------
// Definitions — one source of truth for names/descriptions/schemas
// ---------------------------------------------------------------------------

const SOON_DESC = 'Set true ONLY when the coach explicitly asks for today/tomorrow — normally everything before the day after tomorrow is withheld (his one-clear-day rule). Past times never appear regardless.';
const LUNCH_DESC = 'Set true ONLY when the coach explicitly wants a lunch-time meeting — otherwise his lunch hold is stripped.';
const WEEKEND_DESC = 'Set true ONLY when the coach explicitly wants a weekend meeting — weekdays-only is enforced otherwise.';
const FAR_WEEKS_DESC = 'Set true ONLY when the coach explicitly wants times beyond next week (e.g. "book them for when I\'m back from holidays") — normally the window is THIS week + NEXT week, with later days appearing only as flagged fallbacks when the near window can\'t fill the options.';

const RANGE_DESC = 'Which window to list: "today" (default), "tomorrow", "this_week" (Mon-Sun of the current week), or "next_week". Use this for relative phrases — it resolves them in the coach\'s OWN timezone, so never work out the dates yourself. For anything else, pass explicit date / end_date instead.';

const TOOL_DEFS = [
  {
    name: 'wingguy_list_events',
    description: 'What is actually ON the coach\'s calendar for a day or a range ("what\'s on today?", "what does my week look like?", "am I free Thursday afternoon?", "what\'s my next meeting?"). Reads their real calendar live, whichever provider they use (Google, Nylas or Zoho) — so this is the RIGHT tool for the coach\'s own diary, and works for every client. This shows what is BOOKED; to find times to OFFER A LEAD use wingguy_check_availability instead (that one applies their booking rules). Read-only — it never changes anything. Defaults to today.',
    zodSchema: {
      range: z.enum(['today', 'tomorrow', 'this_week', 'next_week']).optional().describe(RANGE_DESC),
      date: z.string().optional().describe('Explicit calendar date to list, YYYY-MM-DD. Overrides `range`. Use only when the coach named a specific date.'),
      end_date: z.string().optional().describe('Optional inclusive END of an explicit range, YYYY-MM-DD — use WITH `date` to list several days (e.g. date=2026-07-20, end_date=2026-07-24).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        range: { type: 'string', enum: ['today', 'tomorrow', 'this_week', 'next_week'], description: RANGE_DESC },
        date: { type: 'string', description: 'Explicit calendar date to list, YYYY-MM-DD. Overrides `range`. Use only when the coach named a specific date.' },
        end_date: { type: 'string', description: 'Optional inclusive END of an explicit range, YYYY-MM-DD — use WITH `date` to list several days.' },
      },
    },
    run: runListEvents,
  },
  {
    name: 'wingguy_check_availability',
    description: 'The coach\'s REAL offerable slots with all his booking rules already enforced in code (hours, lunch hold, notice period, nothing in the past). ALWAYS use this — never the raw calendar — when finding times to offer a lead. The result opens with TODAY + this-week/next-week boundaries — resolve "next week" and every relative date phrase against that anchor, never a guess. Days at/over the coach\'s preferred daily load are flagged BUSY DAY (still offerable — prefer lighter days, and stack a busy near day BEFORE any FALLBACK WEEK day). Returns each slot with a "label" (exactly how it reads in the lead\'s timezone) and a "time" ISO to pass to wingguy_book_meeting. Pick by label; never do timezone math yourself.',
    zodSchema: {
      lead_location: z.string().optional().describe('The lead\'s location as written on LinkedIn (e.g. "Newcastle, New South Wales") — drives the lead-timezone labels. Omit if unknown (coach timezone assumed).'),
      include_lunch: z.boolean().optional().describe(LUNCH_DESC),
      include_soon: z.boolean().optional().describe(SOON_DESC),
      include_weekends: z.boolean().optional().describe(WEEKEND_DESC),
      include_far_weeks: z.boolean().optional().describe(FAR_WEEKS_DESC),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        lead_location: { type: 'string', description: 'The lead\'s location as written on LinkedIn (e.g. "Newcastle, New South Wales") — drives the lead-timezone labels. Omit if unknown (coach timezone assumed).' },
        include_lunch: { type: 'boolean', description: LUNCH_DESC },
        include_soon: { type: 'boolean', description: SOON_DESC },
        include_weekends: { type: 'boolean', description: WEEKEND_DESC },
        include_far_weeks: { type: 'boolean', description: FAR_WEEKS_DESC },
      },
    },
    run: runCheckAvailability,
  },
  {
    name: 'wingguy_check_time',
    description: 'Verify a SPECIFIC proposed time (the coach or the lead named one) — converts the wall-clock date+time in the right timezone to a correct startISO, and reports clashes, off-hours, and lunch flags. NEVER build an ISO or do timezone/DST math yourself — this tool owns that. Use its startISO for wingguy_book_meeting, and surface any flags to the human before booking.',
    zodSchema: {
      date: z.string().describe('Calendar date, YYYY-MM-DD'),
      time: z.string().describe('Clock time, e.g. "14:00" or "2:15pm"'),
      side: z.enum(['coach', 'lead']).optional().describe('"coach" if the time was given in the coach\'s timezone (default), "lead" if in the lead\'s'),
      lead_location: z.string().optional().describe('The lead\'s LinkedIn location — needed when side="lead" or for the lead-side display'),
      duration_mins: z.number().optional().describe('Meeting length in minutes; omit for the coach\'s default'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Calendar date, YYYY-MM-DD' },
        time: { type: 'string', description: 'Clock time, e.g. "14:00" or "2:15pm"' },
        side: { type: 'string', enum: ['coach', 'lead'], description: '"coach" if the time was given in the coach\'s timezone (default), "lead" if in the lead\'s' },
        lead_location: { type: 'string', description: 'The lead\'s LinkedIn location — needed when side="lead" or for the lead-side display' },
        duration_mins: { type: 'number', description: 'Meeting length in minutes; omit for the coach\'s default' },
      },
      required: ['date', 'time'],
    },
    run: runCheckTime,
  },
  {
    name: 'wingguy_book_meeting',
    description: 'Create the real calendar invite through the coach\'s proven booking machinery (standing Zoom room, his invite layout, reminders, guest emailed automatically). ALWAYS use this — never raw calendar event creation — to book a lead. ONLY call after the human explicitly confirmed the exact date+time in chat. Pass a startISO from wingguy_check_availability (a slot\'s "time") or wingguy_check_time — never hand-built. Refuses clashing times (including slots HELD for another lead) unless confirm_double_book is true after the human\'s explicit OK. Looks up the invite email in the CRM by lead_name unless lead_email is given.',
    zodSchema: {
      start_iso: z.string().describe('Meeting start ISO — from wingguy_check_availability (slot "time") or wingguy_check_time (startISO). Never build this yourself.'),
      lead_name: z.string().describe('The lead\'s full name as in the CRM — titles the invite and drives the CRM email lookup'),
      lead_email: z.string().optional().describe('Invite email. Omit to look it up in the CRM by lead_name; pass explicitly when the lead gave a different address in the thread.'),
      lead_linkedin: z.string().optional().describe('The lead\'s PUBLIC LinkedIn URL for the invite description (looked up from CRM if omitted)'),
      duration_mins: z.number().optional().describe('Meeting length in minutes; omit for the coach\'s default'),
      confirm_double_book: z.boolean().optional().describe('Set true ONLY after the human has explicitly OK\'d booking over a reported clash. Normally omit — the tool refuses clashes and tells you what they are.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        start_iso: { type: 'string', description: 'Meeting start ISO — from wingguy_check_availability (slot "time") or wingguy_check_time (startISO). Never build this yourself.' },
        lead_name: { type: 'string', description: 'The lead\'s full name as in the CRM — titles the invite and drives the CRM email lookup' },
        lead_email: { type: 'string', description: 'Invite email. Omit to look it up in the CRM by lead_name; pass explicitly when the lead gave a different address in the thread.' },
        lead_linkedin: { type: 'string', description: 'The lead\'s PUBLIC LinkedIn URL for the invite description (looked up from CRM if omitted)' },
        duration_mins: { type: 'number', description: 'Meeting length in minutes; omit for the coach\'s default' },
        confirm_double_book: { type: 'boolean', description: 'Set true ONLY after the human has explicitly OK\'d booking over a reported clash. Normally omit — the tool refuses clashes and tells you what they are.' },
      },
      required: ['start_iso', 'lead_name'],
    },
    run: runBookMeeting,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters (same shape as wingguyRulesMcp)
// ---------------------------------------------------------------------------

/** SDK server (the /mcp2 path): register all booking tools on an McpServer instance.
 *  `tenant` scopes every executor to the caller's client (per-request; defaults to Guy). */
function registerWingguyBookingTools(server, tenant = TENANT) {
  for (const def of TOOL_DEFS) {
    server.registerTool(
      def.name,
      { title: def.name.replace(/_/g, ' '), description: def.description, inputSchema: def.zodSchema },
      async (args) => {
        try {
          const out = await def.run(args || {}, tenant);
          return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
        } catch (e) {
          return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
        }
      },
    );
  }
}

/** Legacy endpoint (the /mcp path): tools/list entries. */
function legacyToolList() {
  return TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, inputSchema: d.jsonSchema }));
}

/** Legacy endpoint: dispatch a tools/call. Returns the result payload, or null if not ours. */
async function legacyToolCall(toolName, args, tenant = TENANT) {
  const def = TOOL_DEFS.find((d) => d.name === toolName);
  if (!def) return null;
  try {
    const out = await def.run(args || {}, tenant);
    return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
}

module.exports = { registerWingguyBookingTools, legacyToolList, legacyToolCall, TOOL_DEFS };
