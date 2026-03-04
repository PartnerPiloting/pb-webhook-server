#!/usr/bin/env node

/**
 * Diagnostic script to verify Client Run Results table is being updated
 * 
 * Run: node scripts/diagnose-client-run-results.js
 * Or with a specific run ID: node scripts/diagnose-client-run-results.js 260304-020121
 * 
 * Online: GET /debug-client-run-results (auth: Bearer PB_WEBHOOK_SECRET)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Check env before loading Airtable (which throws if not configured)
if (!process.env.AIRTABLE_API_KEY || !process.env.MASTER_CLIENTS_BASE_ID) {
  console.error('ERROR: AIRTABLE_API_KEY and MASTER_CLIENTS_BASE_ID must be set (e.g. in .env)');
  console.error('Run from project root with: node scripts/diagnose-client-run-results.js');
  process.exit(1);
}

const { runDiagnostic } = require('../services/diagnoseClientRunResultsService');

async function main() {
  const runIdArg = process.argv[2] || null;

  console.log('='.repeat(80));
  console.log('CLIENT RUN RESULTS DIAGNOSTIC');
  console.log('='.repeat(80));
  console.log('');

  const result = await runDiagnostic(runIdArg);

  if (result.jobTracking.runs?.length > 0) {
    console.log('1. Recent Smart Resume runs:');
    result.jobTracking.runs.forEach(r => {
      console.log(`   - ${r.runId} (Stream ${r.stream}, Status: ${r.status})`);
    });
    console.log('');
  }

  if (result.jobTracking.error) {
    console.log(`   ❌ Job Tracking error: ${result.jobTracking.error}`);
    return;
  }

  if (result.clientRunResults.runId) {
    console.log(`2. Client Run Results for run: ${result.clientRunResults.runId}`);
    console.log('');
  }

  if (result.clientRunResults.error) {
    console.log(`   ❌ Error: ${result.clientRunResults.error}`);
    return;
  }

  const records = result.clientRunResults.records || [];
  if (records.length === 0) {
    console.log('   ❌ NO Client Run Results found!');
    console.log('   Possible causes: createClientRun failing, run ID mismatch, or standalone mode');
    return;
  }

  console.log(`   ✅ Found ${records.length} record(s):`);
  records.forEach(r => {
    const status = r.hasProgressLog ? '✅ Updated' : '⚠️ Empty';
    console.log(`   - ${r.clientName || r.clientId}: ${status}`);
    if (r.hasProgressLog && r.progressLogPreview) {
      r.progressLogPreview.split('\n').forEach(l => console.log(`     ${l.substring(0, 76)}`));
    }
  });
  console.log('');

  const summary = result.clientRunResults.summary || {};
  console.log('3. Summary:');
  console.log(`   Total: ${summary.total} | With Progress Log: ${summary.withProgressLog}/${summary.total} | With metrics: ${summary.withMetrics}`);
  console.log('');
  console.log(`   ${result.message}`);
  console.log('');
  console.log('='.repeat(80));
}

main().catch(err => {
  console.error('Diagnostic failed:', err.message);
  process.exit(1);
});
