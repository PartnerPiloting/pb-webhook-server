#!/usr/bin/env node
/**
 * Cleanup script to run on RENDER (has env vars)
 * Deletes "Record not found" errors caused by Run ID mismatch bug (fixed in 1939c80)
 * 
 * To run on Render:
 * 1. SSH into Render or use the Shell
 * 2. Run: node cleanup-record-not-found-errors-render.js
 */

const Airtable = require('airtable');

// FAIL LOUDLY if environment variables not set
if (!process.env.MASTER_CLIENTS_BASE_ID) {
  throw new Error('FATAL: MASTER_CLIENTS_BASE_ID environment variable not set');
}
if (!process.env.AIRTABLE_API_KEY) {
  throw new Error('FATAL: AIRTABLE_API_KEY environment variable not set');
}

const MASTER_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID;
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(MASTER_BASE_ID);

async function cleanup() {
  console.log('\n🧹 Cleaning up "Record not found" errors\n');
  
  // Step 1: Production Issues
  console.log('Step 1: Production Issues...\n');
  
  const issues = await base('Production Issues')
    .select({
      filterByFormula: `AND(
        OR(
          FIND('Client run record not found', {Error Message}),
          FIND('Record not found for 251012-', {Error Message})
        ),
        FIND('jobTracking.js', {Stack Trace})
      )`
    })
    .all();
  
  console.log(`Found ${issues.length} records to delete\n`);
  
  if (issues.length > 0) {
    for (let i = 0; i < issues.length; i += 10) {
      const batch = issues.slice(i, i + 10);
      await base('Production Issues').destroy(batch.map(r => r.id));
      console.log(`Deleted batch ${Math.floor(i / 10) + 1}`);
    }
  }
  
  // Step 2: Stack Traces
  console.log('\n\nStep 2: Stack Traces...\n');
  
  const traces = await base('Stack Traces')
    .select({
      filterByFormula: `AND(
        FIND('Client run record not found', {Error Message}),
        FIND('updateClientRun', {Stack Trace})
      )`
    })
    .all();
  
  console.log(`Found ${traces.length} records to delete\n`);
  
  if (traces.length > 0) {
    for (let i = 0; i < traces.length; i += 10) {
      const batch = traces.slice(i, i + 10);
      await base('Stack Traces').destroy(batch.map(r => r.id));
      console.log(`Deleted batch ${Math.floor(i / 10) + 1}`);
    }
  }
  
  console.log(`\n✅ Done! Deleted ${issues.length + traces.length} total records\n`);
}

cleanup().catch(console.error);
