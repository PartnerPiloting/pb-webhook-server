/**
 * iCloud WRITE probe — the deliberate create+delete test that verifies the one thing a client's
 * normal use never exercises: does a PUT to iCloud CalDAV actually WORK, and (the decisive question)
 * does an event with an ATTENDEE line actually EMAIL the invite via iCloud's server-side iTIP
 * scheduling? (Same trap as Unipile's notify-defaults-false.) See the iCloud VERIFY-LIVE block in
 * services/calendarProvider.js.
 *
 * ⚠ THIS WRITES TO A REAL iCloud CALENDAR (creates a test event, then deletes it). On a client's
 * PERSONAL calendar, get their explicit OK first. Requires --confirm to actually run.
 *
 * Secrets from ENV (never argv):
 *   ICLOUD_APPLE_ID       Apple ID (email) — also used as the ORGANIZER on the invite
 *   ICLOUD_APP_PASSWORD   app-specific password
 *
 * Args:
 *   --write-url=<collection URL>   the calendar collection to PUT into (from wingguy-icloud-discover.js)
 *   --guest=<email>                external attendee to invite (use an inbox you can check)
 *   --tz=<IANA>                    coach timezone (default Australia/Brisbane)
 *   --confirm                      actually create+delete (omit for a dry-run description)
 *   --keep                         create but DON'T delete (so you can eyeball it in the UI)
 *
 * Example:
 *   ICLOUD_APPLE_ID=you@icloud.com ICLOUD_APP_PASSWORD=abcd-efgh-ijkl-mnop \
 *     node scripts/wingguy-icloud-write-probe.js \
 *       --write-url="https://p52-caldav.icloud.com/123/calendars/home/" \
 *       --guest=you+test@gmail.com --confirm
 */

require('dotenv').config();
const { createCalendarEvent, deleteCalendarEvent } = require('../services/calendarProvider');

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
}
const has = (name) => process.argv.includes(`--${name}`);

const appleId = process.env.ICLOUD_APPLE_ID || '';
const appPassword = process.env.ICLOUD_APP_PASSWORD || '';
const writeUrl = arg('write-url', '');
const guest = arg('guest', '');
const tz = arg('tz', 'Australia/Brisbane');
const confirm = has('confirm');
const keep = has('keep');

(async () => {
  if (!appleId || !appPassword) { console.error('Set ICLOUD_APPLE_ID + ICLOUD_APP_PASSWORD in env.'); process.exit(1); }
  if (!writeUrl) { console.error('Missing --write-url=<collection URL> (see wingguy-icloud-discover.js).'); process.exit(1); }
  if (!guest) { console.error('Missing --guest=<email> (an inbox you can check for the invite).'); process.exit(1); }

  // A short slot tomorrow at 09:00 in the coach tz.
  const { DateTime } = require('luxon');
  const start = DateTime.now().setZone(tz).plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  const end = start.plus({ minutes: 15 });
  const coach = { appleId, appPassword, calendarWriteUrl: writeUrl, googleCalendarEmail: appleId, timezone: tz };
  const details = {
    title: 'Wingguy iCloud write probe (safe to ignore)',
    description: 'Automated Wingguy test event. Created then deleted by wingguy-icloud-write-probe.js.',
    location: 'https://example.com/wingguy-test',
    startISO: start.toUTC().toISO(),
    endISO: end.toUTC().toISO(),
    attendees: [{ email: guest, name: 'Wingguy Test Guest' }],
  };

  console.log(`Probe plan:`);
  console.log(`  account : ${appleId}`);
  console.log(`  calendar: ${writeUrl}`);
  console.log(`  when    : ${start.toFormat('ccc dd LLL, HH:mm')} ${tz} (15 min)`);
  console.log(`  invite  : ${guest}`);
  console.log(`  delete  : ${keep ? 'NO (--keep)' : 'yes, immediately after create'}`);
  if (!confirm) {
    console.log('\nDRY RUN — re-run with --confirm to actually create (and delete) the event.');
    process.exit(0);
  }

  console.log('\nCreating ...');
  const c = await createCalendarEvent(coach, details);
  console.log('  create result:', JSON.stringify(c));
  if (!c.ok) { console.error('!! create failed — stopping (nothing to clean up).'); process.exit(1); }

  console.log(`\n>>> CHECK NOW: did ${guest} receive an invite email, and does the event show on the iCloud calendar? <<<`);

  if (keep) { console.log('\n--keep set: leaving the event in place. Delete it manually when done.'); process.exit(0); }

  console.log('\nDeleting ...');
  const d = await deleteCalendarEvent(coach, c.eventId);
  console.log('  delete result:', JSON.stringify(d));
  console.log(d.ok ? '\nProbe complete — event created and removed.' : '\n!! DELETE FAILED — remove the test event manually.');
  process.exit(d.ok ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
