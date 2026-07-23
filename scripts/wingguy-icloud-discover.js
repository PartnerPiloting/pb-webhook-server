/**
 * Resolve the CalDAV calendar-collection URLs on an iCloud account — the one-time setup step for
 * adding an iCloud calendar as a Wingguy read-grant (or primary). Apple has NO OAuth: the client
 * generates an APP-SPECIFIC PASSWORD at appleid.apple.com (needs 2FA), then we discover the URLs.
 *
 * Secrets come from ENV (never argv — argv shows in the process list):
 *   ICLOUD_APPLE_ID       the Apple ID (email)
 *   ICLOUD_APP_PASSWORD   the app-specific password (format xxxx-xxxx-xxxx-xxxx)
 *
 * Usage (locally or as a Render one-off job):
 *   ICLOUD_APPLE_ID=you@icloud.com ICLOUD_APP_PASSWORD=abcd-efgh-ijkl-mnop \
 *     node scripts/wingguy-icloud-discover.js
 *
 * Prints every calendar collection with its URL, and a ready-to-paste `Calendar Read Grants` JSON
 * snippet. Pick the calendar(s) you want unioned into availability and drop the array into the
 * client's `Calendar Read Grants` field (add it with scripts/add-calendar-read-grants-field.js).
 * READ-ONLY: this only lists calendars, it never writes anything.
 */

require('dotenv').config();
const { discoverICloudCalendars } = require('../services/calendarProvider');

const appleId = process.env.ICLOUD_APPLE_ID || '';
const appPassword = process.env.ICLOUD_APP_PASSWORD || '';

(async () => {
  if (!appleId || !appPassword) {
    console.error('Set ICLOUD_APPLE_ID and ICLOUD_APP_PASSWORD in the environment (not argv).');
    process.exit(1);
  }
  const coach = { appleId, appPassword };
  console.log(`Discovering iCloud calendars for ${appleId} ...\n`);
  let cals;
  try {
    cals = await discoverICloudCalendars(coach);
  } catch (e) {
    console.error(`!! discovery failed: ${e.message}`);
    process.exit(1);
  }
  if (!cals.length) { console.log('No VEVENT calendar collections found.'); process.exit(0); }

  console.log(`${cals.length} calendar collection(s):`);
  for (const c of cals) {
    console.log(`  - name: ${c.name || '(unnamed)'}`);
    console.log(`    url:  ${c.url}`);
  }

  // A read-grant that reads ALL of them (edit calendarUrls down to just the ones you want as busy
  // sources — usually the personal calendar, not birthdays/holidays subscriptions).
  const grant = {
    provider: 'icloud',
    label: 'iCloud',
    appleId,
    appPassword: '<paste the app-specific password here>',
    calendarUrls: cals.map((c) => c.url),
  };
  console.log('\nPaste this array into the client\'s `Calendar Read Grants` field (trim calendarUrls');
  console.log('to the calendars you actually want as busy sources, and fill in appPassword):\n');
  console.log(JSON.stringify([grant], null, 2));
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
