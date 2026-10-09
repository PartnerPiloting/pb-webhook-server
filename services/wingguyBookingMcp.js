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
const leadBookingLink = require('./wingguyLeadBookingLink');
const { resolveLeadTimezone } = require('./leadLocationResolver');
const { getBookingPrefs } = require('../config/wingguyBookingPrefs');
// NOTE: coachingClientLookupService + clientService are required LAZILY inside runBookMeeting —
// their Airtable config crashes at module load when env vars are absent (local test runs).

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

// ---------------------------------------------------------------------------
// Executors — return { text, isError? }
// ---------------------------------------------------------------------------

async function runCheckAvailability({ lead_location, include_lunch, include_soon, include_weekends, include_far_weeks, lead_booking_link, not_before } = {}, tenant = TENANT, deps = {}) {
  const prefs = getBookingPrefs(tenant);
  const avail = await wingguyCalendar.getAvailabilityForCoach(tenant, lead_location || '');
  // A stated earliest date ("away for the next 1.5 weeks", "after the 20th") outranks the nearness
  // rule: everything before it goes, and later weeks are plain days, not fallbacks.
  const notBefore = /^\d{4}-\d{2}-\d{2}$/.test(String(not_before || '')) ? String(not_before) : '';
  let filtered = wingguyCalendar.filterAvailability(avail, prefs, {
    includeLunch: !!include_lunch,
    includeSoon: !!include_soon,
    includeWeekends: !!include_weekends,
    includeFarWeeks: !!include_far_weeks || !!notBefore,
  });
  if (notBefore) filtered = { ...filtered, days: filtered.days.filter((d) => String(d.date) >= notBefore) };
  const win = filtered.window || wingguyCalendar.offerWindowInfo(filtered.yourTimezone || 'Australia/Brisbane');
  const windowLine = `TODAY IS ${win.today} (${win.timezone}). This week = ${win.thisWeek}; next week = ${win.nextWeek}; later days are FALLBACK WEEKS. Resolve every relative date phrase ("next week", "Tuesday") against this anchor — never guess today's date.`
    + (notBefore ? ` Days before ${notBefore} were removed because the lead is not available until then (not_before).` : '');
  // The lead handed over a booking link (Candace, 2026-09-15): read the free slots THEIR page
  // shows and keep only the times BOTH sides can make. The link never becomes the booking door -
  // wingguy_book_meeting still sends the coach's own invite; the link only says WHEN.
  let leadLinkLine = '';
  let leadSlotCount = -1;
  if (lead_booking_link) {
    const reader = deps.readBookingLink || leadBookingLink.readBookingLink;
    const coachTz = filtered.yourTimezone || 'Australia/Brisbane';
    const lead = await reader(lead_booking_link, { timezone: coachTz, rangeStart: notBefore || undefined });
    // "Calendly" / "TidyCal" / "booking" - from the reader when it says, else from the link itself.
    const label = leadBookingLink.providerLabel(lead.provider || leadBookingLink.parseBookingLink(lead_booking_link).provider);
    if (lead.ok) {
      leadSlotCount = lead.slots.length;
      const coachMins = prefs.meetingLengthMins || 30;
      filtered = leadBookingLink.intersectAvailability(filtered, lead, { meetingMins: coachMins });
      // The lead's page may offer shorter slots than the coach books (TidyCal 15-minute islands, Sam
      // Trattles 2026-10-09). A match then means the lead is free at that START; the invite keeps the
      // coach's usual length, and the coach hears the lead's page is set shorter so he can decide.
      const slotNote = filtered.leadSlotsShorter
        ? ` The lead's page offers ${filtered.leadSlotMins}-minute slots, shorter than the coach's usual ${coachMins} minutes: a slot below means the lead is free at that START time. The invite still goes out at the coach's usual length - tell the coach the lead's page is set to ${filtered.leadSlotMins} minutes so he can decide whether to mention it.`
        : '';
      leadLinkLine = `LEAD'S OWN CALENDAR READ: ${lead.ownerName || 'the lead'}'s ${label} page ("${lead.eventName || 'booking'}", ${lead.durationMins} min) offered ${lead.slots.length} slots in the scan window.${slotNote} The slots below are ONLY the times BOTH are free. The lead handed over a booking link, so do NOT send them a list of options - pick ONE (lightest day, mid-morning first) and book it with wingguy_book_meeting after the coach confirms, then tell the lead it is booked. If the coach would rather book through the lead's page by hand, name the same slot.`;
    } else {
      // The give-up path (Sam Trattles, 2026-10-09): an unreadable link means the coach's OWN times
      // go out, in the normal list. The draft never promises the lead a booking through their page -
      // the coach's own invite is the one booking door, and a promise to use their link leaves the
      // coach booking by hand on a page Wingguy cannot see.
      leadLinkLine = `⚠ Could not read the lead's ${label} link (${lead.reason}). The slots below are the COACH'S ONLY. Tell the coach plainly that the lead's ${label} link could not be read, then offer the coach's own times from the list below exactly as usual (the normal list of options with its timezone line). NEVER tell the lead the coach will book through their link or page - the coach's own invite is the only booking door.`;
    }
  }
  if (!filtered.days.length) {
    const why = leadLinkLine && leadLinkLine.startsWith('LEAD')
      ? `No time in the scan window where BOTH the coach and the lead are free (the lead's page offered ${leadSlotCount === 0 ? 'nothing' : 'slots, none matching the coach\'s'}). Widen with include_lunch / include_soon only if the coach asks; otherwise tell the coach and let them pick a side to bend.`
      : `No offerable slots in the scan window (after the coach's rules: notice period, hours, lunch, weekdays-only). Widen with include_soon / include_weekends only if the coach explicitly asked.`;
    return { text: `${windowLine}\n\n${leadLinkLine ? `${leadLinkLine}\n\n` : ''}${why}` };
  }
  // Slots before the coach's preferred day start are legal but AT-A-PINCH only — mark them so a
  // chat model applies the "10:00+ first" rule without holding it in its head.
  const coachTz = filtered.yourTimezone || 'Australia/Brisbane';
  const prefMin = wingguyCalendar.hhmmToMin(prefs.preferredStart);
  const pinch = (s) => (prefMin != null && wingguyCalendar.minutesInTz(s.time, coachTz) < prefMin) ? ' ⚠ AT-A-PINCH (before preferred 10:00 start — offer only if later times can\'t fill the options)' : '';
  // Daily load is a PREFERENCE, not a cap (Guy 2026-07-10, after the hard version emptied next
  // week): busy days stay offerable, flagged — stacking them beats spilling into a fallback week.
  const busy = (d) => d.busyDay ? ` ⚠ BUSY DAY — already ${d.meetingCount} meetings (at/over his preferred ${prefs.maxMeetingsPerDay}/day): still offerable and BETTER than a fallback week, but prefer lighter days first and tell the coach how loaded it is` : '';
  // Per-DATE real-clock comparison (Farhad, 2026-09-03: "lead timezone DIFFERS" was said off the
  // IANA names alone, so a September Sydney slot — same clock as Brisbane until 4 October — got an
  // hour added by the chat). The names can differ while the clocks match, and a daylight-saving
  // change can sit inside the window, so every day line states which it is and the summary below
  // says same / differs / changes-inside-window from the data, never from the names.
  const leadTz = filtered.leadTimezone || coachTz;
  const tzNamesDiffer = !!(filtered.leadTimezone && filtered.leadTimezone !== coachTz);
  const dayGap = (d) => (d.freeSlots.length ? wingguyCalendar.clockGapMins(d.freeSlots[0].time, coachTz, leadTz) : 0);
  const gaps = filtered.days.map(dayGap);
  const anyDiff = gaps.some((g) => g !== 0);
  const allDiff = gaps.length > 0 && gaps.every((g) => g !== 0);
  const clocks = (d) => (tzNamesDiffer ? ` · CLOCKS: ${wingguyCalendar.clockGapLabel(dayGap(d), coachTz, leadTz)}` : '');
  const leadCity = wingguyCalendar.tzCity(leadTz);
  const coachCity = wingguyCalendar.tzCity(coachTz);
  const firstDiff = filtered.days.find((d) => dayGap(d) !== 0);
  const firstSame = filtered.days.find((d) => dayGap(d) === 0);
  const clockNote = !tzNamesDiffer
    ? ''
    : !anyDiff
      ? `SAME CLOCK: ${leadCity} and ${coachCity} read IDENTICALLY on every date below — the lead's timezone name differs from the coach's, but there is no daylight-saving gap in this window. Each slot's label and its "coach:" time are the same. Show ONE time, never a second time in brackets, never a conversion, and never add an hour from memory. Still tell the coach where the lead is based, and keep the single "(all times are ${leadCity} time)" line under any list. `
      : allDiff
        ? `The lead's clock DIFFERS from the coach's on every date below (${wingguyCalendar.clockGapLabel(gaps[0], coachTz, leadTz)}). Take the lead's time from each slot's label and the coach's from its "coach:" value — never convert yourself. When you write these times into a message, add ONE line under the list — "(all times are ${leadCity} time)" — never a marker on every line, and never leave converted times unlabelled. `
        : `⚠ DAYLIGHT-SAVING CHANGE INSIDE THIS WINDOW: ${leadCity} and ${coachCity} read the same on some dates below and differ on others (same clock on ${firstSame ? firstSame.date : '?'}; ${wingguyCalendar.clockGapLabel(firstDiff ? dayGap(firstDiff) : 0, coachTz, leadTz)} on ${firstDiff ? firstDiff.date : '?'}). Each day line below says CLOCKS: which — trust that per date, never assume one gap applies to the whole window. Take the lead's time from each slot's label and the coach's from its "coach:" value; on a same-clock date show ONE time. Add ONE "(all times are ${leadCity} time)" line under any list. `;
  const lines = filtered.days.map((d) =>
    `${d.date} (${d.day}, ${d.meetingCount || 0} meetings)${clocks(d)}${busy(d)}${d.fallbackWeek ? ' ⚠ FALLBACK WEEK — beyond next week; use ONLY to top up when the nearer days (including busy ones) can\'t fill the options, and never call these "next week"' : ''}:\n` +
    d.freeSlots.map((s) => `  - label="${s.label}" (coach: ${s.display}) time=${s.time}${pinch(s)}`).join('\n'));
  return {
    text:
      `${windowLine}\n\n` +
      (leadLinkLine ? `${leadLinkLine}\n\n` : '') +
      `Offerable slots (coach rules already applied: hours, lunch, notice, weekdays). ` +
      `Coach timezone: ${filtered.yourTimezone}; lead timezone: ${filtered.leadTimezone}. ` +
      // Where the lead is based, or a loud flag that we're guessing — the coach must ALWAYS hear
      // which one it is (Guy 2026-07-13; the silent assume-coach's-tz fallback is the trap).
      (filtered.leadTzDetected
        ? `Lead is based in "${filtered.leadLocation}" — ALWAYS tell the coach where the lead is based when you present times. ` +
          (filtered.leadTzAssumedNote ? `Note: ${filtered.leadTzAssumedNote}. ` : '')
        : (filtered.leadTzCandidates && filtered.leadTzCandidates.length)
          ? `⚠ Lead location "${filtered.leadLocation}" is AMBIGUOUS — could be ${filtered.leadTzCandidates.map((c) => `${c.place} (${c.timezone})`).join(' or ')}. ASK the coach which one (and save it to the lead's record) before offering times; until then the labels below assume the coach's own timezone. `
          : `⚠ Lead location ${filtered.leadLocation ? `"${filtered.leadLocation}" NOT recognised` : 'NOT provided'} — lead timezone is ASSUMED to be the coach's. Do NOT put any of these times into a message or draft yet: tell the coach plainly that the lead's location is unknown, ask where they're based (or suggest asking whoever introduced them), save it with wingguy_update_lead, then re-run this check. A time offered on a guessed clock to a warm lead is the expensive mistake. `) +
      `Each "label" is EXACTLY how that slot reads in the LEAD's timezone — pick slots by label, then use that slot's "time" ISO for booking. NEVER build an ISO yourself. ` +
      clockNote +
      `Prefer the least-busy days and vary the time of day across the options.\n\n` +
      lines.join('\n'),
  };
}

// "What's on my calendar?" — the read-only counterpart to check_availability. Routes through the
// SAME provider seam as booking (google | nylas | zoho), so every tenant can ask this inside Wingguy
// rather than needing a separate calendar connector in their Claude (impossible for Zoho anyway).
//
// Call run sheet (Guy 2026-09-28): a coach can keep a "how a first call should flow" page as the
// `call_run_sheet` asset. When it exists, the diary carries it as the first thing to relay, so
// "prep me for today's meetings" opens with the link. No asset = no line; a store hiccup never
// blocks the diary.
const RUN_SHEET_KEY = 'call_run_sheet';

async function runSheetLine(tenant, deps = {}) {
  try {
    const getAssets = deps.getAssets || require('./wingguyRulesStore').getAssets;
    const rows = await getAssets({ tenantId: tenant });
    const a = (rows || []).find((x) => x.asset_key === RUN_SHEET_KEY && x.status !== 'retired' && x.url);
    return a
      ? `CALL RUN SHEET: ${a.url} - when prepping meetings, put this link as the VERY FIRST line of the prep ` +
        `("Your call run sheet: <link>"), before any meeting. Skip it for a plain "what's on today?".\n\n`
      : '';
  } catch (_) {
    return '';
  }
}

async function runListEvents({ range, date, end_date } = {}, tenant = TENANT, deps = {}) {
  const r = await wingguyCalendar.listEventsForCoach(tenant, { range, date, endDate: end_date });
  const tz = r.timezone || 'Australia/Brisbane';
  if (!r.ok) return { text: `Couldn't read the calendar${r.provider ? ` (${r.provider})` : ''}: ${r.error}`, isError: true };

  const win = wingguyCalendar.offerWindowInfo(tz);
  const anchor = `TODAY IS ${win.today} (${win.timezone}). This week = ${win.thisWeek}; next week = ${win.nextWeek}. Resolve every relative date phrase against this anchor — never guess today's date.`;
  const span = r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`;
  if (!r.events.length) return { text: `${anchor}\n\nNothing scheduled for ${span}.` };

  // Group by the days the coach ASKED for, listing every event that OVERLAPS each day — not by the
  // event's start date. A multi-day event (a trip, house-sitting, leave) is genuinely "on" every day
  // it covers, and grouping by start date would file it under a day outside the window entirely.
  const days = [];
  for (let d = DateTime.fromISO(`${r.startDate}T00:00`, { zone: tz }), last = DateTime.fromISO(`${r.endDate}T00:00`, { zone: tz });
    d <= last; d = d.plus({ days: 1 })) days.push(d);

  const line = (ev) => {
    const guests = (ev.attendees || [])
      .filter((a) => !a.self && (a.email || a.displayName))
      .map((a) => a.displayName || a.email);
    const who = guests.length
      ? ` — with ${guests.slice(0, 4).join(', ')}${guests.length > 4 ? ` +${guests.length - 4} more` : ''}`
      : '';
    // Same local day → a normal timed meeting. Spanning days → say so explicitly, because a
    // time-only display ("10:00 am–10:00 am") hides that the end is days away and reads as nonsense.
    const sDay = wingguyCalendar.dateStrInTz(ev.start, tz);
    const eDay = wingguyCalendar.dateStrInTz(ev.end, tz);
    // An event ending at EXACTLY midnight belongs to the day before it — an evening block
    // ("Dinner, 5:30pm–12:00am") is a same-day event, not a multi-day one.
    const endsAtMidnight = new Date(ev.end).getTime() === DateTime.fromISO(`${eDay}T00:00`, { zone: tz }).toMillis();
    const eDayEff = endsAtMidnight ? DateTime.fromISO(`${eDay}T00:00`, { zone: tz }).minus({ days: 1 }).toISODate() : eDay;
    // A true all-day event spans local midnights (exclusive end) — times are meaningless, say the
    // day(s) instead of a nonsense "12:00 am–12:00 am".
    const when = ev.allDay
      ? (sDay === eDayEff
        ? 'ALL-DAY'
        : `ALL-DAY (${DateTime.fromISO(sDay, { zone: tz }).toFormat('d LLL')} → ${DateTime.fromISO(eDayEff, { zone: tz }).toFormat('d LLL')})`)
      : sDay === eDayEff
        ? `${wingguyCalendar.timeOnlyInTz(ev.start, tz)}–${wingguyCalendar.timeOnlyInTz(ev.end, tz)}`
        : `ALL-DAY/MULTI-DAY (runs ${DateTime.fromISO(sDay, { zone: tz }).toFormat('d LLL')} ${wingguyCalendar.timeOnlyInTz(ev.start, tz)} → ${DateTime.fromISO(eDay, { zone: tz }).toFormat('d LLL')} ${wingguyCalendar.timeOnlyInTz(ev.end, tz)})`;
    return `  - ${when}  ${ev.summary || '(No title)'}${who}`;
  };

  const blocks = days.map((day) => {
    const dayStart = day.toMillis();
    const dayEnd = day.plus({ days: 1 }).toMillis();
    const list = r.events.filter((ev) => {
      const s = new Date(ev.start).getTime();
      const e = new Date(ev.end).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
      return s < dayEnd && (e > dayStart || e === s); // overlaps this day (zero-length: starts in it)
    });
    const heading = day.toFormat('cccc d LLL');
    if (!list.length) return `${heading}: nothing scheduled.`;
    return `${heading} (${list.length} ${list.length === 1 ? 'event' : 'events'}):\n${list.map(line).join('\n')}`;
  });
  return {
    text:
      `${anchor}\n\n` +
      (await runSheetLine(tenant, deps)) +
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
  // A missing/unrecognised location used to make the Lead display silently echo the coach's clock,
  // which read as "the clocks are identical" — never let that pass as a real conversion.
  if (!r.leadTzDetected) {
    const why = (r.leadTzCandidates && r.leadTzCandidates.length)
      ? `location "${lead_location}" is AMBIGUOUS — could be ${r.leadTzCandidates.map((c) => `${c.place} (${c.timezone})`).join(' or ')}. Ask the coach WHICH one`
      : `location ${lead_location ? `"${lead_location}" not recognised` : 'not provided'}. Ask where the lead is based`;
    flags.push(`lead timezone UNKNOWN (${why}) — NEVER tell the human the clocks match. Record the answer with wingguy_update_lead, then re-check before writing any lead-facing time`);
  } else if (r.leadTzAssumedNote) {
    flags.push(r.leadTzAssumedNote);
  }
  // Real-clock line for THIS date (Farhad, 2026-09-03): a Sydney lead in September is on the same
  // clock as Brisbane, and "Coach: 10:00 am · Lead: 10:00 am" alone did not stop the chat adding an
  // hour from memory. Say it in words, from the data.
  const gap = wingguyCalendar.clockGapMins(r.startISO, tz, r.leadTimezone);
  const clockLine = (r.leadTzDetected && r.leadTimezone && r.leadTimezone !== tz)
    ? (gap === 0
      ? `Clocks on this date: SAME — ${wingguyCalendar.tzCity(r.leadTimezone)} and ${wingguyCalendar.tzCity(tz)} read identically (no daylight-saving gap on ${date}). Say ONE time; do not convert or add an hour.\n`
      : `Clocks on this date: ${wingguyCalendar.clockGapLabel(gap, tz, r.leadTimezone)} — use the Coach and Lead values above exactly; never convert yourself.\n`)
    : '';
  return {
    text:
      `startISO=${r.startISO} (pass THIS to wingguy_book_meeting — never build your own)\n` +
      `Coach: ${r.display} · Lead: ${r.leadTzDetected ? r.leadDisplay : 'UNKNOWN (no recognised location — no lead-side time exists)'} · ${r.durationMins} mins\n` +
      clockLine +
      (flags.length ? `⚠ ${flags.join('\n⚠ ')}` : 'Free, within hours, no flags.'),
  };
}

async function runBookMeeting({ start_iso, duration_mins, lead_name, lead_email, lead_linkedin, lead_location, confirm_double_book, meeting_link } = {}, tenant = TENANT) {
  const name = String(lead_name || '').trim();
  if (!name) return { text: 'Error: lead_name is required (it titles the invite and matches any HOLD events).', isError: true };
  const linkOverride = String(meeting_link || '').trim();
  if (linkOverride && !/^https?:\/\/\S+$/i.test(linkOverride)) {
    return { text: 'Error: meeting_link must be a full http(s) URL exactly as the human pasted it. If they named a platform but no link, ask them to paste the link.', isError: true };
  }

  const clientService = require('./clientService');
  const { lookupLeadContactByName } = require('./coachingClientLookupService');
  const coach = await clientService.getClientById(tenant);
  if (!coach) return { text: `Server config error: coach client "${tenant}" not found.`, isError: true };

  // Resolve the invite email: an explicit lead_email wins; otherwise the CRM by name.
  let email = String(lead_email || '').trim();
  let emailSource = 'given';
  let linkedin = String(lead_linkedin || '').trim();
  let leadLocationFromCrm = '';
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
    leadLocationFromCrm = found.lead.location || '';
  }

  const result = await wingguyCalendar.bookMeetingGuarded(coach, {
    startISO: start_iso,
    durationMins: duration_mins,
    leadEmail: email,
    leadName: name,
    leadLinkedIn: linkedin,
    confirmDoubleBook: !!confirm_double_book,
    meetingLink: linkOverride || undefined,
  });
  if (!result.ok) return { text: `NOT booked. ${result.error}`, isError: true };

  // Both clocks worked out HERE, for the meeting's own date (2026-10-05): the old closing line asked
  // the chat to do the lead-side conversion itself — the one step code exists to keep away from it.
  let leadLocation = String(lead_location || '').trim() || leadLocationFromCrm;
  if (!leadLocation && emailSource === 'given') {
    try {
      const found = await lookupLeadContactByName(name, { clientId: tenant });
      leadLocation = (found.lead && found.lead.location) || '';
    } catch (_) { /* no location is reported as unknown below, never guessed */ }
  }
  const coachTz = coach.timezone || 'Australia/Brisbane';
  return {
    text:
      `Booked: "${result.title}" — ${result.durationMins} mins, invite emailed to ${email} [email source: ${emailSource}].\n` +
      `WHEN: ${clocksLine(result.start, coachTz, leadTzFor(leadLocation))}\n` +
      (linkOverride ? `Invite carries the one-off ${wingguyCalendar.meetingPlatformLabel(linkOverride)} link (${linkOverride}) instead of the coach's standing link — confirm that's the link the human meant.\n` : '') +
      `Restate the WHEN line to the human exactly as written (it was worked out in code for this date) — never convert a time yourself — so a wrong-hour booking is caught immediately.`,
  };
}

// ---------------------------------------------------------------------------
// Reschedule / cancel a booked meeting (2026-10-05)
// ---------------------------------------------------------------------------

function leadTzFor(location) {
  const r = resolveLeadTimezone(String(location || ''));
  return r.detected ? r.timezone : null;
}

// One instant on BOTH clocks, in words, from code — for the meeting's own date (daylight saving
// starts/ends between booking and meeting, so "today's" gap is never the right one).
function clocksLine(iso, coachTz, leadTz) {
  const coach = `${wingguyCalendar.formatInTz(iso, coachTz)} ${wingguyCalendar.tzCity(coachTz)} time`;
  if (!leadTz) return `${coach} · lead's clock UNKNOWN (no recognised location on file) — do not state a lead-side time; ask where they are based`;
  if (leadTz === coachTz) return `${coach} (the lead is on the same clock)`;
  const gap = wingguyCalendar.clockGapMins(iso, coachTz, leadTz);
  if (gap === 0) return `${coach} = the same time in ${wingguyCalendar.tzCity(leadTz)} (same clock on this date)`;
  return `${coach} = ${wingguyCalendar.formatInTz(iso, leadTz)} ${wingguyCalendar.tzCity(leadTz)} time (${wingguyCalendar.clockGapLabel(gap, coachTz, leadTz)} on this date)`;
}

// Who the lead is, for matching their meeting: every email we know for them (given + CRM) and
// where they're based. A name the CRM can't pin to one person stops here — never guess.
async function resolveLeadForMeeting(tenant, { lead_name, lead_email, lead_location }, deps = {}) {
  const name = String(lead_name || '').trim();
  const given = String(lead_email || '').trim();
  if (!name && !given) return { error: 'Give lead_name (and lead_email if you have it) so the meeting can be found.' };
  let found = null;
  if (name) {
    try {
      const lookup = deps.lookupLeadContactByName || require('./coachingClientLookupService').lookupLeadContactByName;
      found = await lookup(name, { clientId: tenant });
    } catch (e) {
      if (!given) return { error: `CRM lookup for "${name}" failed (${e.message}) — pass lead_email.` };
    }
  }
  const crmEmails = [...new Set(((found && found.matches) || []).map((m) => String(m.email || '').trim().toLowerCase()).filter(Boolean))];
  if (!given && crmEmails.length > 1) {
    return { error: `More than one CRM lead matches "${name}" (${crmEmails.join(', ')}). Ask the human which one and pass lead_email.` };
  }
  const emails = [...new Set([given, found && found.lead && found.lead.email].map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return { error: `No email on file for "${name}" — the meeting is matched by the lead's invite email. Ask the human for it and pass lead_email.` };
  const location = String(lead_location || '').trim() || (found && found.lead && found.lead.location) || '';
  return { name: name || (found && found.lead && found.lead.leadName) || '', emails, location };
}

function guestsOf(ev) {
  return (ev.attendees || []).filter((a) => !a.self && a.email).map((a) => a.email).join(', ');
}

function notFoundText(r, lead, date, coachTz, leadTz) {
  const who = `${lead.name || 'the lead'} (${lead.emails.join(', ')})`;
  if (r.reason === 'gone') return `NOTHING CHANGED. That event_id is no longer an upcoming meeting with ${who}. Re-run without confirm to see what is on the calendar now.`;
  if (r.reason === 'none') {
    return `NOTHING CHANGED. No upcoming meeting with ${who} found ${date ? `on ${date}` : 'in the next ~13 weeks'} on the coach's calendar (only events the lead is INVITED to count). ` +
      'Check the name, the date, or whether it was booked under another email (pass that as lead_email). Never pick a meeting yourself.';
  }
  return `NOTHING CHANGED. ${r.matches.length} upcoming meetings with ${who} match — the tool will not guess:\n` +
    r.matches.map((m) => `  - "${m.summary}" — ${clocksLine(m.start, coachTz, leadTz)} — event_id=${m.id}`).join('\n') +
    '\nAsk the human which one, then call again with that event_id (or current_date).';
}

function hoursFlags(iso, tz, prefs, len) {
  const flags = [];
  const eMin = wingguyCalendar.hhmmToMin(prefs.earliestStart);
  const lMin = wingguyCalendar.hhmmToMin(prefs.lastStart);
  const cMin = wingguyCalendar.minutesInTz(iso, tz);
  if (eMin != null && lMin != null && cMin != null && (cMin < eMin || cMin > lMin)) flags.push('the new time is OUTSIDE the coach\'s booking hours — get an explicit yes for that too');
  if (wingguyCalendar.inLunch(iso, tz, prefs, len)) flags.push('the new time hits the coach\'s lunch hold');
  if (wingguyCalendar.isWeekendInTz(iso, tz) && prefs.excludeWeekends) flags.push('the new time is on a WEEKEND');
  return flags;
}

async function loadCoach(tenant, deps) {
  const getClient = deps.getClientById || require('./clientService').getClientById;
  return getClient(tenant);
}

async function runRescheduleMeeting({ lead_name, lead_email, lead_location, current_date, new_start_iso, duration_mins, confirm, event_id, confirm_double_book } = {}, tenant = TENANT, deps = {}) {
  if (!String(new_start_iso || '').trim()) return { text: 'Error: new_start_iso is required — take it from wingguy_check_time (startISO) or wingguy_check_availability (a slot\'s time). Never build it yourself.', isError: true };
  if (confirm && !event_id) return { text: 'Error: confirm=true needs the event_id the preview showed — run without confirm first and show the human the match.', isError: true };
  const coach = await loadCoach(tenant, deps);
  if (!coach) return { text: `Server config error: coach client "${tenant}" not found.`, isError: true };
  const lead = await resolveLeadForMeeting(tenant, { lead_name, lead_email, lead_location }, deps);
  if (lead.error) return { text: `NOTHING CHANGED. ${lead.error}`, isError: true };

  const coachTz = coach.timezone || 'Australia/Brisbane';
  const leadTz = leadTzFor(lead.location);
  const prefs = getBookingPrefs(tenant);
  const resched = deps.rescheduleMeetingGuarded || wingguyCalendar.rescheduleMeetingGuarded;
  const r = await resched(coach, {
    leadEmails: lead.emails,
    leadName: lead.name,
    date: current_date || undefined,
    eventId: event_id || undefined,
    newStartISO: new_start_iso,
    durationMins: duration_mins,
    confirmDoubleBook: !!confirm_double_book,
    apply: !!confirm,
  }, deps);

  if (r.reason) return { text: notFoundText(r, lead, current_date, coachTz, leadTz), isError: true };
  if (!r.event) return { text: `NOTHING CHANGED. ${r.error}`, isError: true };
  const ev = r.event;
  const was = `WAS: ${clocksLine(r.oldStart, coachTz, leadTz)}`;
  const now = r.newStart ? `NEW: ${clocksLine(r.newStart, coachTz, leadTz)} (${r.durationMins} mins)` : '';
  if (!r.ok) return { text: `NOTHING CHANGED. ${r.error}\nMeeting: "${ev.summary}" with ${guestsOf(ev)} — event_id=${ev.id}\n${was}${now ? `\n${now}` : ''}`, isError: true };

  if (!r.applied) {
    const flags = hoursFlags(r.newStart, coachTz, prefs, r.durationMins);
    if (r.clashes.length) flags.push(`the new time CLASHES with: ${r.clashes.map((c) => `${c.summary} (${c.display})`).join('; ')} — moving there needs the human's explicit OK to double-book (then pass confirm_double_book=true)`);
    if (!leadTz) flags.push('lead timezone UNKNOWN — do not tell the human or the lead a lead-side time');
    return {
      text:
        `PREVIEW — nothing has changed yet.\n` +
        `Matched: "${ev.summary}" with ${guestsOf(ev)} — event_id=${ev.id}\n` +
        `${was}\n${now}\n` +
        (flags.length ? `⚠ ${flags.join('\n⚠ ')}\n` : '') +
        `Show the human this match and both times exactly as written. Only after they explicitly say yes, call wingguy_reschedule_meeting again with the same arguments plus confirm=true and event_id="${ev.id}". The invite is MOVED (one "updated" notice to the lead; meeting link, title and description unchanged).`,
    };
  }
  return {
    text:
      `MOVED: "${ev.summary}" (event_id=${ev.id}) — the lead's existing invite was updated, so they get one "updated" notice. Meeting link, title and description are unchanged.\n` +
      `${was}\n${now}\n` +
      `Restate the WAS and NEW lines to the human exactly as written — never convert a time yourself. Any "HOLD: ${lead.name}" events are being cleared.`,
  };
}

async function runCancelMeeting({ lead_name, lead_email, lead_location, current_date, confirm, event_id } = {}, tenant = TENANT, deps = {}) {
  if (confirm && !event_id) return { text: 'Error: confirm=true needs the event_id the preview showed — run without confirm first and show the human the match.', isError: true };
  const coach = await loadCoach(tenant, deps);
  if (!coach) return { text: `Server config error: coach client "${tenant}" not found.`, isError: true };
  const lead = await resolveLeadForMeeting(tenant, { lead_name, lead_email, lead_location }, deps);
  if (lead.error) return { text: `NOTHING CHANGED. ${lead.error}`, isError: true };

  const coachTz = coach.timezone || 'Australia/Brisbane';
  const leadTz = leadTzFor(lead.location);
  const cancel = deps.cancelMeetingGuarded || wingguyCalendar.cancelMeetingGuarded;
  const r = await cancel(coach, {
    leadEmails: lead.emails,
    leadName: lead.name,
    date: current_date || undefined,
    eventId: event_id || undefined,
    apply: !!confirm,
  }, deps);

  if (r.reason) return { text: notFoundText(r, lead, current_date, coachTz, leadTz), isError: true };
  const ev = r.event;
  const when = `WHEN: ${clocksLine(r.oldStart, coachTz, leadTz)}`;
  if (!r.ok) return { text: `NOTHING CHANGED. ${r.error}\nMeeting: "${ev.summary}" with ${guestsOf(ev)} — event_id=${ev.id}\n${when}`, isError: true };
  if (!r.applied) {
    return {
      text:
        `PREVIEW — nothing has changed yet.\n` +
        `Matched: "${ev.summary}" with ${guestsOf(ev)} — event_id=${ev.id}\n${when}\n` +
        `Show the human this match exactly as written. Only after they explicitly say yes, call wingguy_cancel_meeting again with the same arguments plus confirm=true and event_id="${ev.id}". The event is deleted from the coach's calendar.`,
    };
  }
  return {
    text:
      `CANCELLED: "${ev.summary}" (event_id=${ev.id}) is off the coach's calendar.\n${when}\n` +
      (r.notified
        ? 'The calendar sent the lead a cancellation notice.'
        : 'This calendar service does NOT reliably email the lead a cancellation — tell the coach, and offer to draft a short note to the lead.') +
      ` Any "HOLD: ${lead.name}" events are being cleared.`,
  };
}

// ---------------------------------------------------------------------------
// Definitions — one source of truth for names/descriptions/schemas
// ---------------------------------------------------------------------------

const BOOK_LOCATION_DESC = 'The lead\'s location (as on LinkedIn) - only for the confirmation line that states the time on the lead\'s clock. Omit to use the CRM\'s.';
const MOVE_NAME_DESC = 'The lead\'s full name as in the CRM - drives the CRM email lookup used to find their meeting.';
const MOVE_EMAIL_DESC = 'The lead\'s invite email. Pass it when you know it (or when the CRM name is ambiguous); the meeting is matched by this being an attendee.';
const MOVE_LOCATION_DESC = 'The lead\'s location (as on LinkedIn) - for stating times on the lead\'s clock. Omit to use the CRM\'s.';
const MOVE_DATE_DESC = 'The date the meeting is CURRENTLY on, YYYY-MM-DD in the coach\'s timezone, when known ("tomorrow\'s call" -> resolve against today). Omit to search the lead\'s upcoming meetings.';
const CONFIRM_DESC = 'Set true ONLY after the human has explicitly said yes in chat to the match and times the preview showed. Omit for the preview (which changes nothing).';
const EVENT_ID_DESC = 'Required with confirm=true: the event_id the preview showed (or the one the human chose from a list of several).';
const SOON_DESC ='Set true ONLY when the coach explicitly asks for today/tomorrow — normally everything before the day after tomorrow is withheld (his one-clear-day rule). Past times never appear regardless.';
const LUNCH_DESC = 'Set true ONLY when the coach explicitly wants a lunch-time meeting — otherwise his lunch hold is stripped.';
const WEEKEND_DESC = 'Set true ONLY when the coach explicitly wants a weekend meeting — weekdays-only is enforced otherwise.';
const FAR_WEEKS_DESC = 'Set true ONLY when the coach explicitly wants times beyond next week (e.g. "book them for when I\'m back from holidays") — normally the window is THIS week + NEXT week, with later days appearing only as flagged fallbacks when the near window can\'t fill the options.';
const LINK_DESC = "The lead's OWN booking link when they sent one (Calendly or TidyCal, e.g. https://calendly.com/name/intro or https://tidycal.com/name/consultation). The tool reads the free slots their page shows and returns ONLY the times both sides are free - then book ONE with wingguy_book_meeting rather than offering a list. Pass it whenever the thread contains one. If the link cannot be read the result says so: offer the coach's own times as usual and never promise the lead a booking through their link.";
const NOT_BEFORE_DESC = "Earliest date the lead can meet, YYYY-MM-DD, when the thread says so (\"away for the next 1.5 weeks\", \"back on the 26th\", \"after Easter\"). Work it out from TODAY in the coach's timezone. Days before it are removed and later weeks stop being fallbacks.";

const MEETING_LINK_DESC = 'ONE-OFF meeting link for THIS invite only ("book it on this link" / the lead asked for Teams instead of Zoom). Must be either a link the HUMAN pasted in this conversation, OR one of the coach\'s OWN standing links from their asset library (teams_room, meet_room, webex_room) that they have said yes to using — NEVER invent one, never use a link belonging to another lead or another person\'s invite. If the coach names a platform and no stored link for it exists, ask for the link — and offer to walk them through making a permanent one (the playbook has the recipe; store what they paste via wingguy_assets so it is never asked again). Omit for the coach\'s standing meeting room (the normal case). The coach\'s stored default is not changed.';

const RANGE_DESC = 'Which window to list: "today" (default), "tomorrow", "this_week" (Mon-Sun of the current week), or "next_week". Use this for relative phrases — it resolves them in the coach\'s OWN timezone, so never work out the dates yourself. For anything else, pass explicit date / end_date instead.';

const TOOL_DEFS = [
  {
    name: 'wingguy_list_events',
    description: 'What is actually ON the coach\'s calendar for a day or a range ("what\'s on today?", "what does my week look like?", "am I free Thursday afternoon?", "what\'s my next meeting?"). ALSO the FIRST call for the daily "prep me for today\'s meetings" / "prepare me for my 2pm" - start here to get the meetings, then call wingguy_dossier per attendee for the history, past emails and what was agreed last time (pass the attendee\'s invite email as email= too — the lookup is surer and reaches Alt Emails). That phrase means the DIARY, never the follow-up queue. If the result carries a CALL RUN SHEET line, the prep OPENS with that link. Reads their real calendar live, whichever provider they use (Google, Nylas or Zoho) — so this is the RIGHT tool for the coach\'s own diary, and works for every client. This shows what is BOOKED; to find times to OFFER A LEAD use wingguy_check_availability instead (that one applies their booking rules). Read-only — it never changes anything. Defaults to today.',
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
    description: 'The coach\'s REAL offerable slots with all his booking rules already enforced in code (hours, lunch hold, notice period, nothing in the past). ALWAYS use this — never the raw calendar — when finding times to offer a lead. The result opens with TODAY + this-week/next-week boundaries — resolve "next week" and every relative date phrase against that anchor, never a guess. Days at/over the coach\'s preferred daily load are flagged BUSY DAY (still offerable — prefer lighter days, and stack a busy near day BEFORE any FALLBACK WEEK day). Returns each slot with a "label" (exactly how it reads in the lead\'s timezone) and a "time" ISO to pass to wingguy_book_meeting. Pick by label; never do timezone math yourself. If the lead sent their OWN booking link (Calendly or TidyCal), pass it as lead_booking_link and you get only the times BOTH are free; if they named an earliest date ("back in two weeks"), pass not_before.',
    zodSchema: {
      lead_location: z.string().optional().describe('The lead\'s location as written on LinkedIn (e.g. "Newcastle, New South Wales") — drives the lead-timezone labels. Omit if unknown (coach timezone assumed).'),
      include_lunch: z.boolean().optional().describe(LUNCH_DESC),
      include_soon: z.boolean().optional().describe(SOON_DESC),
      include_weekends: z.boolean().optional().describe(WEEKEND_DESC),
      include_far_weeks: z.boolean().optional().describe(FAR_WEEKS_DESC),
      lead_booking_link: z.string().optional().describe(LINK_DESC),
      not_before: z.string().optional().describe(NOT_BEFORE_DESC),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        lead_location: { type: 'string', description: 'The lead\'s location as written on LinkedIn (e.g. "Newcastle, New South Wales") — drives the lead-timezone labels. Omit if unknown (coach timezone assumed).' },
        include_lunch: { type: 'boolean', description: LUNCH_DESC },
        include_soon: { type: 'boolean', description: SOON_DESC },
        include_weekends: { type: 'boolean', description: WEEKEND_DESC },
        include_far_weeks: { type: 'boolean', description: FAR_WEEKS_DESC },
        lead_booking_link: { type: 'string', description: LINK_DESC },
        not_before: { type: 'string', description: NOT_BEFORE_DESC },
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
    description: 'Create the real calendar invite through the coach\'s proven booking machinery (standing Zoom room, his invite layout, reminders, guest emailed automatically). ALWAYS use this — never raw calendar event creation — to book a lead. ONLY call after the human explicitly confirmed the exact date+time in chat. Pass a startISO from wingguy_check_availability (a slot\'s "time") or wingguy_check_time — never hand-built. Refuses clashing times (including slots HELD for another lead) unless confirm_double_book is true after the human\'s explicit OK. Looks up the invite email in the CRM by lead_name unless lead_email is given. If the lead asked to meet on a different platform (Teams, Meet, etc), pass the link the human pasted as meeting_link — see that parameter\'s rules.',
    zodSchema: {
      start_iso: z.string().describe('Meeting start ISO — from wingguy_check_availability (slot "time") or wingguy_check_time (startISO). Never build this yourself.'),
      lead_name: z.string().describe('The lead\'s full name as in the CRM — titles the invite and drives the CRM email lookup'),
      lead_email: z.string().optional().describe('Invite email. Omit to look it up in the CRM by lead_name; pass explicitly when the lead gave a different address in the thread.'),
      lead_linkedin: z.string().optional().describe('The lead\'s PUBLIC LinkedIn URL for the invite description (looked up from CRM if omitted)'),
      duration_mins: z.number().optional().describe('Meeting length in minutes; omit for the coach\'s default'),
      confirm_double_book: z.boolean().optional().describe('Set true ONLY after the human has explicitly OK\'d booking over a reported clash. Normally omit — the tool refuses clashes and tells you what they are.'),
      meeting_link: z.string().optional().describe(MEETING_LINK_DESC),
      lead_location: z.string().optional().describe(BOOK_LOCATION_DESC),
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
        meeting_link: { type: 'string', description: MEETING_LINK_DESC },
        lead_location: { type: 'string', description: BOOK_LOCATION_DESC },
      },
      required: ['start_iso', 'lead_name'],
    },
    run: runBookMeeting,
  },
  {
    name: 'wingguy_reschedule_meeting',
    description: 'MOVE a lead\'s ALREADY-BOOKED meeting to a new time ("move Meenakshi to next Tuesday 3pm", "push my call with X to Thursday", "X can\'t make tomorrow - she asked for Friday 2pm instead"). ALWAYS use this - never raw calendar edits, and never delete-and-rebook with wingguy_book_meeting. It MOVES the existing invite: the lead gets ONE "updated" notice and the meeting link, title and description stay exactly as they were. TWO STEPS, every time: (1) call WITHOUT confirm - it finds the lead\'s meeting (by lead_name / lead_email, narrowed by current_date when known), and returns the matched event, the OLD and NEW times on both the coach\'s and the lead\'s clock, plus any clash or off-hours flag; NOTHING changes. Show the human that match. If it finds no meeting, or more than one, it stops - ask the human, never guess or pick. (2) ONLY after the human explicitly confirms in chat, call again with the same arguments plus confirm=true and the event_id from step 1. new_start_iso must come from wingguy_check_time (startISO - for a time the lead named, side="lead" with their location) or wingguy_check_availability (a slot\'s "time") - never hand-built. Refuses a clashing new time unless confirm_double_book is true after the human\'s explicit OK. Only ever touches an event the lead is invited to - never a HOLD or anyone else\'s meeting.',
    zodSchema: {
      lead_name: z.string().describe(MOVE_NAME_DESC),
      lead_email: z.string().optional().describe(MOVE_EMAIL_DESC),
      lead_location: z.string().optional().describe(MOVE_LOCATION_DESC),
      current_date: z.string().optional().describe(MOVE_DATE_DESC),
      new_start_iso: z.string().describe('The NEW start ISO - from wingguy_check_time (startISO) or wingguy_check_availability (slot "time"). Never build this yourself.'),
      duration_mins: z.number().optional().describe('New length in minutes. Omit to keep the meeting\'s current length.'),
      confirm: z.boolean().optional().describe(CONFIRM_DESC),
      event_id: z.string().optional().describe(EVENT_ID_DESC),
      confirm_double_book: z.boolean().optional().describe('Set true ONLY after the human has explicitly OK\'d moving onto a reported clash. Normally omit.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        lead_name: { type: 'string', description: MOVE_NAME_DESC },
        lead_email: { type: 'string', description: MOVE_EMAIL_DESC },
        lead_location: { type: 'string', description: MOVE_LOCATION_DESC },
        current_date: { type: 'string', description: MOVE_DATE_DESC },
        new_start_iso: { type: 'string', description: 'The NEW start ISO - from wingguy_check_time (startISO) or wingguy_check_availability (slot "time"). Never build this yourself.' },
        duration_mins: { type: 'number', description: 'New length in minutes. Omit to keep the meeting\'s current length.' },
        confirm: { type: 'boolean', description: CONFIRM_DESC },
        event_id: { type: 'string', description: EVENT_ID_DESC },
        confirm_double_book: { type: 'boolean', description: 'Set true ONLY after the human has explicitly OK\'d moving onto a reported clash. Normally omit.' },
      },
      required: ['lead_name', 'new_start_iso'],
    },
    run: runRescheduleMeeting,
  },
  {
    name: 'wingguy_cancel_meeting',
    description: 'CANCEL a lead\'s ALREADY-BOOKED meeting ("cancel my call with X", "X has pulled out of Thursday", "take Meenakshi off my calendar"). ALWAYS use this - never raw calendar deletes - so the right event goes and nothing else does. If the lead wants a DIFFERENT time instead, use wingguy_reschedule_meeting (it moves the invite rather than cancelling). TWO STEPS, every time: (1) call WITHOUT confirm - it finds the lead\'s meeting (by lead_name / lead_email, narrowed by current_date when known) and shows it on both clocks; NOTHING changes. If it finds no meeting, or more than one, it stops - ask the human, never guess. (2) ONLY after the human explicitly confirms in chat, call again with the same arguments plus confirm=true and the event_id from step 1. Only ever touches an event the lead is invited to - never a HOLD or anyone else\'s meeting. The result says whether the calendar emailed the lead a cancellation; when it did not, offer to draft a note.',
    zodSchema: {
      lead_name: z.string().describe(MOVE_NAME_DESC),
      lead_email: z.string().optional().describe(MOVE_EMAIL_DESC),
      lead_location: z.string().optional().describe(MOVE_LOCATION_DESC),
      current_date: z.string().optional().describe(MOVE_DATE_DESC),
      confirm: z.boolean().optional().describe(CONFIRM_DESC),
      event_id: z.string().optional().describe(EVENT_ID_DESC),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        lead_name: { type: 'string', description: MOVE_NAME_DESC },
        lead_email: { type: 'string', description: MOVE_EMAIL_DESC },
        lead_location: { type: 'string', description: MOVE_LOCATION_DESC },
        current_date: { type: 'string', description: MOVE_DATE_DESC },
        confirm: { type: 'boolean', description: CONFIRM_DESC },
        event_id: { type: 'string', description: EVENT_ID_DESC },
      },
      required: ['lead_name'],
    },
    run: runCancelMeeting,
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

// Stamp every sentence a client is told to type into the description of the tool that answers it
// (content/client-phrases.json). Must run before export - see utils/clientPhrases.js for the why.
require('../utils/clientPhrases').applyClientPhrases(TOOL_DEFS);

module.exports = { registerWingguyBookingTools, legacyToolList, legacyToolCall, TOOL_DEFS, runCheckAvailability, runListEvents, runRescheduleMeeting, runCancelMeeting, clocksLine };
