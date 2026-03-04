#!/usr/bin/env node

/**
 * Diagnostic script to verify Client Run Results table is being updated
 * 
 * Checks:
 * 1. Recent Smart Resume runs from Job Tracking
 * 2. Client Run Results for those runs - do they exist? Are they updated?
 * 3. Progress Log content (indicates operations wrote completion data)
 * 4. Run ID format consistency
 * 
 * Run: node scripts/diagnose-client-run-results.js
 * Or with a specific run ID: node scripts/diagnose-client-run-results.js 260304-020121
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Check env before loading Airtable (which throws if not configured)
if (!process.env.AIRTABLE_API_KEY || !process.env.MASTER_CLIENTS_BASE_ID) {
  console.error('ERROR: AIRTABLE_API_KEY and MASTER_CLIENTS_BASE_ID must be set (e.g. in .env)');
  console.error('Run from project root with: node scripts/diagnose-client-run-results.js');
  process.exit(1);
}

const { getMasterClientsBase } = require('../config/airtableClient');
const { MASTER_TABLES, CLIENT_RUN_FIELDS, JOB_TRACKING_FIELDS } = require('../constants/airtableUnifiedConstants');
const runIdSystem = require('../services/runIdSystem');

async function main() {
  const runIdArg = process.argv[2]; // Optional: specific run ID to check
  
  console.log('='.repeat(80));
  console.log('CLIENT RUN RESULTS DIAGNOSTIC');
  console.log('='.repeat(80));
  console.log('');
  console.log('This script verifies that the Client Run Results table is being updated');
  console.log('when Smart Resume triggers jobs (lead scoring, post scoring, etc.)');
  console.log('');

  const masterBase = getMasterClientsBase();

  // 1. Get recent Smart Resume runs from Job Tracking
  console.log('1. Recent Smart Resume runs (Job Tracking table):');
  try {
    const jobRecords = await masterBase(MASTER_TABLES.JOB_TRACKING).select({
      filterByFormula: runIdArg 
        ? `FIND('${runIdArg}', {${JOB_TRACKING_FIELDS.RUN_ID}}) > 0`
        : '{Stream} >= 1',
      sort: [{ field: 'Last Updated', direction: 'desc' }],
      maxRecords: runIdArg ? 5 : 10
    }).firstPage();

    if (!jobRecords || jobRecords.length === 0) {
      console.log('   ⚠️  No Job Tracking records found');
      if (runIdArg) {
        console.log(`   Try without run ID to see recent runs, or check if ${runIdArg} exists`);
      }
      return;
    }

    console.log(`   Found ${jobRecords.length} run(s):`);
    const runsToCheck = [];
    for (const rec of jobRecords) {
      const runId = rec.get(JOB_TRACKING_FIELDS.RUN_ID);
      const stream = rec.get(JOB_TRACKING_FIELDS.STREAM);
      const status = rec.get(JOB_TRACKING_FIELDS.STATUS);
      const systemNotes = rec.get(JOB_TRACKING_FIELDS.SYSTEM_NOTES) || '';
      const lastUpdated = rec.get('Last Updated') || rec._rawJson?.createdTime;
      console.log(`   - ${runId} (Stream ${stream}, Status: ${status || 'N/A'})`);
      runsToCheck.push({ runId, stream, status });
    }
    console.log('');
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    return;
  }

  // 2. For the most recent run (or specified run), get Client Run Results
  const targetRunId = runIdArg || (await getMostRecentSmartResumeRunId(masterBase));
  if (!targetRunId) {
    console.log('   Could not determine run ID to check');
    return;
  }

  console.log(`2. Client Run Results for run: ${targetRunId}`);
  console.log('   (Looking for records where Run ID starts with this base ID)');
  console.log('');

  try {
    // Client Run Results use format: YYMMDD-HHMMSS-ClientName
    // So we search for Run ID containing the base
    const baseRunId = runIdSystem.getBaseRunId(targetRunId) || targetRunId;
    const formula = `FIND('${baseRunId}', {${CLIENT_RUN_FIELDS.RUN_ID}}) > 0`;
    
    const crrRecords = await masterBase(MASTER_TABLES.CLIENT_RUN_RESULTS).select({
      filterByFormula: formula,
      maxRecords: 50
    }).firstPage();

    if (!crrRecords || crrRecords.length === 0) {
      console.log('   ❌ NO Client Run Results found for this run!');
      console.log('   This suggests Client Run records are NOT being created or updated.');
      console.log('');
      console.log('   Possible causes:');
      console.log('   - Smart Resume createClientRun is failing');
      console.log('   - Run ID format mismatch between JobTracking and operations');
      console.log('   - Operations running in standalone mode (no clientRunId passed)');
      return;
    }

    console.log(`   ✅ Found ${crrRecords.length} Client Run Result(s):`);
    console.log('');

    let withProgressLog = 0;
    let withMetrics = 0;
    const issues = [];

    for (const rec of crrRecords) {
      const runId = rec.get(CLIENT_RUN_FIELDS.RUN_ID);
      const clientId = rec.get(CLIENT_RUN_FIELDS.CLIENT_ID);
      const clientName = rec.get(CLIENT_RUN_FIELDS.CLIENT_NAME);
      const progressLog = rec.get(CLIENT_RUN_FIELDS.PROGRESS_LOG) || '';
      const systemNotes = rec.get(CLIENT_RUN_FIELDS.SYSTEM_NOTES) || '';
      const profilesScored = rec.get(CLIENT_RUN_FIELDS.PROFILES_SCORED);
      const postsScored = rec.get(CLIENT_RUN_FIELDS.POSTS_SCORED);
      const profileTokens = rec.get(CLIENT_RUN_FIELDS.PROFILE_SCORING_TOKENS);
      const postTokens = rec.get(CLIENT_RUN_FIELDS.POST_SCORING_TOKENS);

      const hasProgressLog = progressLog && progressLog.trim().length > 0;
      const hasMetrics = (profilesScored != null && profilesScored > 0) || 
                        (postsScored != null && postsScored > 0) ||
                        (profileTokens != null && profileTokens > 0) ||
                        (postTokens != null && postTokens > 0);

      if (hasProgressLog) withProgressLog++;
      if (hasMetrics) withMetrics++;

      const status = hasProgressLog ? '✅ Updated' : '⚠️ Empty';
      console.log(`   ${clientName || clientId} (${clientId}):`);
      console.log(`      Run ID: ${runId}`);
      console.log(`      Status: ${status}`);
      if (hasProgressLog) {
        const lines = progressLog.trim().split('\n');
        const lastLines = lines.slice(-3);
        console.log(`      Progress Log (last 3 lines):`);
        lastLines.forEach(l => console.log(`        ${l.substring(0, 80)}${l.length > 80 ? '...' : ''}`));
      } else {
        issues.push(`${clientName || clientId}: No Progress Log - operations may not have updated`);
      }
      console.log(`      Profiles Scored: ${profilesScored ?? 'N/A'} | Posts Scored: ${postsScored ?? 'N/A'}`);
      console.log('');
    }

    // 3. Summary
    console.log('3. Summary:');
    console.log(`   Total records: ${crrRecords.length}`);
    console.log(`   With Progress Log (updated by operations): ${withProgressLog}/${crrRecords.length}`);
    console.log(`   With metrics (profiles/posts scored): ${withMetrics}/${crrRecords.length}`);
    console.log('');

    if (withProgressLog === 0 && crrRecords.length > 0) {
      console.log('   ❌ ISSUE: Records exist but NONE have Progress Log content.');
      console.log('   Operations (lead_scoring, post_scoring, etc.) are NOT updating Client Run Results.');
      console.log('');
      console.log('   Check:');
      console.log('   - Are jobs receiving clientRunId from Smart Resume?');
      console.log('   - Is runRecordService.checkRunRecordExists finding the records?');
      console.log('   - Any "Cannot update non-existent record" errors in Render logs?');
    } else if (withProgressLog < crrRecords.length) {
      console.log(`   ⚠️  Partial: ${crrRecords.length - withProgressLog} record(s) not yet updated by operations.`);
      console.log('   Jobs may still be running, or some operations failed.');
    } else {
      console.log('   ✅ Client Run Results ARE being updated correctly.');
    }

  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    console.log(err.stack);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('DIAGNOSIS COMPLETE');
  console.log('='.repeat(80));
}

async function getMostRecentSmartResumeRunId(masterBase) {
  try {
    const records = await masterBase(MASTER_TABLES.JOB_TRACKING).select({
      filterByFormula: '{Stream} >= 1',
      sort: [{ field: 'Last Updated', direction: 'desc' }],
      maxRecords: 1
    }).firstPage();
    return records?.[0]?.get(JOB_TRACKING_FIELDS.RUN_ID) || null;
  } catch {
    return null;
  }
}

main().catch(err => {
  console.error('Diagnostic failed:', err.message);
  process.exit(1);
});
