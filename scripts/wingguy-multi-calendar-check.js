// Read-only prod check for multi-calendar read scope + all-day handling (2026-07-17).
//   node scripts/wingguy-multi-calendar-check.js [clientId]
// Defaults to Guy-Wilson. Run as a Render one-off job against prod (see reference_render_jobs_exec).
// Exercises, against the tenant's REAL account, with NO writes:
//   1. the roster's multi-calendar fields (Calendar Read IDs / Calendar Write ID)
//   2. listCalendars through the provider seam (nylas/zoho; google says list-by-hand)
//   3. the availability pipeline (slot/day counts — compare before/after an opt-in flip)
//   4. the listing path incl. all-day events (the one surface that shows them)
require('dotenv').config();
const { getCoachCalendarInfo, getAvailabilityForCoach, listEventsForCoach } = require('../services/wingguyCalendar');
const { listCalendars } = require('../services/calendarProvider');

const tenant = process.argv[2] || 'Guy-Wilson';

(async () => {
  console.log(`tenant = ${tenant}\n`);

  console.log('=== 1. roster calendar fields ===');
  const info = await getCoachCalendarInfo(tenant);
  const provider = info.calendarEmail ? 'google' : (info.calendarProvider || (info.nylasGrantId ? 'nylas' : 'google'));
  console.log(`provider = ${provider}, timezone = ${info.timezone}`);
  console.log(`Calendar Read IDs = ${info.calendarReadIds || '(blank -> default calendar only)'}`);
  console.log(`Calendar Write ID = ${info.calendarWriteId || '(blank -> provider default)'}`);

  console.log('\n=== 2. listCalendars via the seam ===');
  const cals = await listCalendars({
    calendarProvider: provider,
    nylasGrantId: info.nylasGrantId,
    googleCalendarEmail: info.calendarEmail || '',
    calendarProviderToken: info.calendarProviderToken,
    calendarProviderDomain: info.calendarProviderDomain,
    timezone: info.timezone,
  });
  if (cals.error) console.log(`(${cals.provider}) ${cals.error}`);
  else for (const c of cals.calendars) console.log(`  - ${c.id}  "${c.name}"${c.isDefault ? ' [DEFAULT]' : ''}${c.readOnly ? ' [read-only]' : ''}`);

  console.log('\n=== 3. availability pipeline (summary only) ===');
  try {
    const avail = await getAvailabilityForCoach(tenant, '');
    const days = avail.days || [];
    const slots = days.reduce((n, d) => n + (d.freeSlots || []).length, 0);
    console.log(`${days.length} day(s) with data, ${slots} free slot(s) total`);
    for (const d of days.slice(0, 5)) console.log(`  ${d.date} (${d.day}): ${d.meetingCount} meeting(s), ${(d.freeSlots || []).length} free slot(s)`);
  } catch (e) {
    console.log(`availability read failed: ${e.message}`);
  }

  console.log('\n=== 4. listing incl. all-day (this_week) ===');
  const list = await listEventsForCoach(tenant, { range: 'this_week' });
  if (!list.ok) console.log(`list failed: ${list.error}`);
  else {
    console.log(`${list.events.length} event(s) ${list.startDate} -> ${list.endDate} via ${list.provider}`);
    for (const ev of list.events) {
      console.log(`  - ${ev.allDay ? '[ALL-DAY] ' : ''}${ev.start} -> ${ev.end}  ${ev.summary}${ev.calendarId ? `  (cal ${String(ev.calendarId).slice(0, 18)}…)` : ''}`);
    }
  }

  console.log('\n=== DONE (read-only) ===');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
