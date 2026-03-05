#!/usr/bin/env node
/**
 * Smart FUP Sweep - API Test
 *
 * Hits the sweep-test endpoint (sync, limit=2) to prove the backend works.
 * Run after deploying to Render:
 *
 *   PB_WEBHOOK_SECRET=your_secret node scripts/smart-fup-sweep-test/run-api-test.js
 *
 * Or against local server (npm start in another terminal):
 *
 *   API_BASE=http://localhost:3001 PB_WEBHOOK_SECRET=your_secret node scripts/smart-fup-sweep-test/run-api-test.js
 */

require('dotenv').config();

const BASE = process.env.API_BASE || 'https://pb-webhook-server.onrender.com';
const SECRET = process.env.PB_WEBHOOK_SECRET;
const CLIENT_ID = process.env.SMART_FUP_TEST_CLIENT_ID || 'Guy-Wilson';

if (!SECRET) {
  console.error('Error: PB_WEBHOOK_SECRET required');
  process.exit(1);
}

const url = `${BASE.replace(/\/$/, '')}/api/smart-followup/sweep-test?limit=2&clientId=${encodeURIComponent(CLIENT_ID)}`;

async function main() {
  console.log('========================================');
  console.log('Smart FUP Sweep - API Test');
  console.log('========================================');
  console.log(`URL: ${url}`);
  console.log('----------------------------------------');

  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${SECRET}` },
      signal: AbortSignal.timeout(120000), // 2 min
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const data = await res.json();

    if (!res.ok) {
      console.error(`HTTP ${res.status}:`, data.error || data.message || 'Unknown');
      process.exit(1);
    }

    if (!data.ok || !data.pass) {
      console.error('FAIL:', data.error || data.message || 'Unknown');
      process.exit(1);
    }

    console.log(`\nProcessed: ${data.processed} leads`);
    console.log(`Created: ${data.created}, Updated: ${data.updated}`);
    console.log(`Time: ${elapsed}s`);
    console.log(`Errors: ${data.errorCount || 0}`);
    console.log('----------------------------------------');
    console.log('PASS: Backend completed synchronously.');
    console.log('========================================\n');
    process.exit(0);
  } catch (err) {
    console.error('FAIL:', err.message);
    process.exit(1);
  }
}

main();
