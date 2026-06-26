#!/usr/bin/env node
/**
 * Nylas WRITE test (Guy = client 0). Proves we can CREATE a calendar event AND email an EXTERNAL guest
 * through the same per-tenant grant the read path already uses (services/calendarProvider.js reads via
 * the same grant). Creates ONE clearly-labelled test event on the coach's calendar with notify on.
 *
 *   node scripts/nylas-write-test.js --guest taniaadelewilson@gmail.com   (create + invite)
 *   node scripts/nylas-write-test.js --delete <eventId>                   (clean it up afterwards)
 *
 * ⚠ This WRITES to the real calendar and EMAILS the guest. The title says it's a test; delete after.
 * Run on Render (one-off job) where NYLAS_API_KEY + the grant live. Resolves the grant from the coach's
 * Airtable record (coach.nylasGrantId), exactly like nylas-check.js.
 */

try { require('dotenv').config({ path: '.env.local' }); } catch (_) { /* optional */ }
try { require('dotenv').config(); } catch (_) { /* optional */ }

const COACH = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
function arg(flag, def) { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : def; }

async function main() {
  const apiKey = process.env.NYLAS_API_KEY;
  const apiUri = (process.env.NYLAS_API_URI || 'https://api.us.nylas.com').replace(/\/$/, '');
  if (!apiKey) { console.error('\n   ❌ NYLAS_API_KEY not set\n'); process.exit(1); }

  const clientService = require('../services/clientService');
  const coach = await clientService.getClientById(COACH);
  if (!coach) { console.error(`\n   ❌ coach ${COACH} not found\n`); process.exit(1); }
  const grantId = coach.nylasGrantId || process.env.NYLAS_GRANT_ID;
  const calendarId = coach.nylasCalendarId || process.env.NYLAS_CALENDAR_ID || 'primary';
  if (!grantId) { console.error('\n   ❌ no nylasGrantId for coach (and NYLAS_GRANT_ID unset)\n'); process.exit(1); }

  console.log('\n=== Nylas WRITE test ===');
  console.log(`   coach     : ${COACH}`);
  console.log(`   grant     : ${String(grantId).slice(0, 10)}…`);
  console.log(`   calendar  : ${calendarId}`);

  // ---- delete mode (cleanup) ----
  const delId = arg('--delete', null);
  if (delId) {
    const u = new URL(`${apiUri}/v3/grants/${grantId}/events/${encodeURIComponent(delId)}`);
    u.searchParams.set('calendar_id', calendarId);
    u.searchParams.set('notify_participants', 'true');
    const res = await fetch(u.toString(), { method: 'DELETE', headers: { Authorization: `Bearer ${apiKey}` } });
    console.log(`\n   DELETE ${delId} → HTTP ${res.status}`);
    console.log(`   ${(await res.text()).slice(0, 300)}\n`);
    process.exit(res.ok ? 0 : 1);
  }

  // ---- create mode (the actual test) ----
  const guest = arg('--guest', 'taniaadelewilson@gmail.com');
  const startSec = Math.floor(Date.now() / 1000) + 3 * 24 * 3600; // ~3 days out
  const endSec = startSec + 30 * 60;

  const u = new URL(`${apiUri}/v3/grants/${grantId}/events`);
  u.searchParams.set('calendar_id', calendarId);
  u.searchParams.set('notify_participants', 'true'); // <-- the bit that emails the guest
  const body = {
    title: 'Wingguy WRITE TEST — please ignore (will be deleted)',
    description: 'Automated test that Wingguy can create a calendar event and email an external guest. Safe to ignore.',
    when: { start_time: startSec, end_time: endSec },
    participants: [{ email: guest, name: 'Test Guest' }],
  };

  console.log(`   guest     : ${guest}`);
  console.log(`   when      : ${new Date(startSec * 1000).toISOString()} (30 min)\n`);

  const res = await fetch(u.toString(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`   CREATE → HTTP ${res.status}`);
  if (!res.ok) {
    console.error(`   ❌ write failed: ${text.slice(0, 400)}`);
    if (res.status === 403) console.error('   → grant is likely READ-ONLY. Reconnect the calendar requesting calendar WRITE scope, then re-run.');
    process.exit(1);
  }
  let json = {}; try { json = JSON.parse(text); } catch (_) { /* leave empty */ }
  const ev = json.data || json;
  console.log(`\n   ✅ EVENT CREATED via Nylas. id=${ev.id}`);
  console.log(`      title       : ${ev.title}`);
  console.log(`      participants: ${JSON.stringify(ev.participants || [])}`);
  console.log('\n   → CHECK: (1) the event on Guy\'s calendar, (2) the invite email in the guest\'s inbox.');
  console.log(`   → CLEAN UP: node scripts/nylas-write-test.js --delete ${ev.id}\n`);
}

main().catch((err) => { console.error('FATAL:', err.message, err.stack); process.exit(1); });
