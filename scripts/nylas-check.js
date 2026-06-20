#!/usr/bin/env node
/**
 * Nylas calendar dogfood check (Guy = client 0). READ-ONLY: fetches the coach's calendar through
 * the SAME swappable seam the Fathom splitter uses (services/calendarProvider.js), forced to the
 * Nylas backend, and prints what comes back. Writes nothing; flips nothing; touches no meeting data.
 *
 * Proves, in the prod environment, that:
 *   - NYLAS_API_KEY + NYLAS_GRANT_ID are configured and the grant is still alive,
 *   - Nylas returns the coach's real events, mapped into the Google-shaped form the filters expect.
 *
 *   node scripts/nylas-check.js [--days N]   (default: last 5 days)
 *
 * Run on Render (one-off job) where the Nylas env + Airtable creds live. This does NOT require
 * CALENDAR_PROVIDER to be set globally — it forces Nylas just for this read, so the live splitter
 * stays on Google until we deliberately flip it.
 */

try { require('dotenv').config({ path: '.env.local' }); } catch (_) { /* optional */ }
try { require('dotenv').config(); } catch (_) { /* optional */ }

// Default mode forces the Nylas backend for THIS process only (isolated; live behaviour unchanged).
// Pass --live to NOT force it, so the provider reflects the coach's REAL Airtable setting
// (`Calendar Provider`) — use this to confirm a flip actually took effect end-to-end.
const LIVE_MODE = process.argv.includes('--live');
if (!LIVE_MODE) process.env.CALENDAR_PROVIDER = 'nylas';

const COACH = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
}

async function main() {
  const days = Math.max(1, parseInt(argVal('--days', '5'), 10) || 5);

  console.log('\n=== Nylas calendar check (read-only) ===');
  console.log(`   coach         : ${COACH}`);
  console.log(`   NYLAS_API_KEY : ${process.env.NYLAS_API_KEY ? 'set (hidden)' : 'NOT SET'}`);
  console.log(`   NYLAS_GRANT_ID: ${process.env.NYLAS_GRANT_ID || '(unset — will try coach.nylasGrantId)'}`);
  console.log(`   NYLAS_API_URI : ${process.env.NYLAS_API_URI || 'https://api.us.nylas.com (default)'}`);
  if (!process.env.NYLAS_API_KEY) {
    console.error('\n   ❌ NYLAS_API_KEY not set — add it on Render, then re-run.\n');
    process.exit(1);
  }

  const clientService = require('../services/clientService');
  const { getMeetingsInWindow, activeProvider } = require('../services/calendarProvider');

  const coach = await clientService.getClientById(COACH);
  if (!coach) { console.error(`\n   ❌ coach ${COACH} not found\n`); process.exit(1); }
  console.log(`   selfEmail     : ${coach.googleCalendarEmail || coach.calendarEmail || '(none)'}`);
  console.log(`   provider      : ${activeProvider(coach)}`);

  const now = new Date();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000); // include today + a bit ahead
  console.log(`   window        : ${start.toISOString()} → ${end.toISOString()}\n`);

  const r = await getMeetingsInWindow(coach, start, end);
  if (r.error) {
    console.error(`   ❌ Nylas read failed (provider=${r.provider}): ${r.error}\n`);
    process.exit(1);
  }
  const events = r.events || [];
  console.log(`   ✅ Nylas returned ${events.length} event(s) (provider=${r.provider}):\n`);
  events
    .slice()
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .forEach((ev) => {
      const att = (ev.attendees || []).length;
      const url = ev.htmlLink || ev.location || '';
      console.log(`   • ${ev.start}  "${(ev.summary || '').slice(0, 50)}"  attendees=${att}${url ? `  url=${String(url).slice(0, 40)}` : ''}`);
    });

  console.log(`\n   ${events.length > 0 ? '✅ Calendar read via Nylas WORKS on prod.' : '⚠️  Connected, but no events in window — try a wider --days.'}\n`);
}

main().catch((err) => { console.error('FATAL:', err.message, err.stack); process.exit(1); });
