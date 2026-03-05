#!/usr/bin/env node
/**
 * Smart Follow-Up Sweep - Test Harness
 *
 * Proves the backend can complete a small batch of leads synchronously.
 * Run: node scripts/smart-fup-sweep-test/index.js
 *
 * Uses limit=2 so each run finishes in ~1-2 min (well within timeouts).
 * No async, no background - just run and return.
 */

require('dotenv').config();

const BATCH_SIZE = 2;
const CLIENT_ID = process.env.SMART_FUP_TEST_CLIENT_ID || 'Guy-Wilson';

async function main() {
  console.log('========================================');
  console.log('Smart FUP Sweep - Test Harness');
  console.log('========================================');
  console.log(`Client: ${CLIENT_ID}`);
  console.log(`Batch size: ${BATCH_SIZE} leads`);
  console.log('Mode: SYNCHRONOUS (no background, no async)');
  console.log('----------------------------------------');

  const start = Date.now();
  const { runSweep } = require('../../services/smartFollowUpService');

  try {
    console.log('\n[1/2] Starting sweep...');
    const results = await runSweep({
      clientId: CLIENT_ID,
      dryRun: false,
      limit: BATCH_SIZE,
      forceAll: false,
      onProgress: null,
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const total = results.totalProcessed ?? 0;
    const created = results.totalCreated ?? 0;
    const updated = results.totalUpdated ?? 0;
    const errors = results.clients?.flatMap((c) => c.errors || []) || [];

    console.log('\n[2/2] Sweep complete.');
    console.log('----------------------------------------');
    console.log(`Processed: ${total} leads`);
    console.log(`Created: ${created}, Updated: ${updated}`);
    console.log(`Time: ${elapsed}s`);
    if (errors.length > 0) {
      console.log(`Errors: ${errors.length}`);
      errors.forEach((e, i) => console.log(`  ${i + 1}. ${e.leadName || e.leadId}: ${e.error}`));
    } else {
      console.log('Errors: 0');
    }
    console.log('----------------------------------------');

    if (results.error) {
      console.log(`FAIL: ${results.error}`);
      process.exit(1);
    }
    if (total === 0) {
      console.log('FAIL: No leads processed (check MASTER_CLIENTS_BASE_ID, AIRTABLE_API_KEY, GCP env)');
      process.exit(1);
    }
    console.log('PASS: Backend completed synchronously.');
    console.log('========================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n----------------------------------------');
    console.error('FAIL:', err.message);
    if (err.stack) console.error(err.stack);
    console.error('----------------------------------------\n');
    process.exit(1);
  }
}

main();
