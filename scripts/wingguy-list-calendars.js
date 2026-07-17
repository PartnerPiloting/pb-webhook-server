// Read-only: list every calendar in a tenant's connected account, with the ids that go into the
// `Calendar Read IDs` / `Calendar Write ID` roster fields — the setup step for multi-calendar.
//   node scripts/wingguy-list-calendars.js [clientId]
// Defaults to Guy-Wilson. Run as a Render one-off job against prod (see reference_render_jobs_exec).
// Google service-account clients can't enumerate (only explicit shares are visible) — the script
// says so; list calendar emails by hand for those.
require('dotenv').config();
const { getCoachCalendarInfo } = require('../services/wingguyCalendar');
const { listCalendars } = require('../services/calendarProvider');

const tenant = process.argv[2] || 'Guy-Wilson';

(async () => {
  console.log(`tenant = ${tenant}\n`);
  const info = await getCoachCalendarInfo(tenant);
  const provider = info.calendarEmail ? 'google' : (info.calendarProvider || (info.nylasGrantId ? 'nylas' : 'google'));
  console.log(`provider = ${provider}`);
  console.log(`Calendar Read IDs (roster) = ${info.calendarReadIds || '(blank -> default calendar only)'}`);
  console.log(`Calendar Write ID (roster) = ${info.calendarWriteId || '(blank -> provider default)'}\n`);

  const coach = {
    calendarProvider: provider,
    nylasGrantId: info.nylasGrantId,
    googleCalendarEmail: info.calendarEmail || '',
    calendarProviderToken: info.calendarProviderToken,
    calendarProviderDomain: info.calendarProviderDomain,
    timezone: info.timezone,
  };
  const r = await listCalendars(coach);
  if (r.error) { console.log(`!! ${r.error}`); process.exit(0); }
  if (!r.calendars.length) { console.log('No calendars returned.'); process.exit(0); }
  console.log(`${r.calendars.length} calendar(s) on the ${r.provider} account:`);
  for (const c of r.calendars) {
    console.log(`  - id: ${c.id}`);
    console.log(`    name: ${c.name || '(unnamed)'}${c.isDefault ? '   [DEFAULT]' : ''}${c.readOnly ? '   [read-only: skipped by "all"]' : ''}`);
  }
  console.log('\nTo read them all for busy checks: set Calendar Read IDs = all');
  console.log('To pin bookings to one: set Calendar Write ID = that id');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
