#!/usr/bin/env node
/**
 * Cleanup script: Delete "Record not found" errors from Production Issues and Stack Traces
 * These are false errors caused by the Run ID lookup mismatch bug (now fixed in commit 1939c80)
 */

require('dotenv').config();
const { getMasterClientsBase } = require('./config/airtableClient');

async function cleanupRecordNotFoundErrors() {
  console.log('\n🧹 Cleaning up "Record not found" errors from Production Issues and Stack Traces\n');
  console.log('These errors were caused by the Run ID mismatch bug (fixed in commit 1939c80)\n');
  
  try {
    const masterBase = getMasterClientsBase();
    
    // Step 1: Find and delete from Production Issues table
    console.log('Step 1: Scanning Production Issues table...\n');
    
    const productionIssues = await masterBase('Production Issues')
      .select({
        filterByFormula: `AND(
          OR(
            FIND('Client run record not found', {Error Message}),
            FIND('Record not found for 251012-', {Error Message})
          ),
          FIND('jobTracking.js', {Stack Trace})
        )`,
        fields: ['Issue ID', 'Run ID', 'Error Message', 'Timestamp', 'Client ID', 'Pattern Matched']
      })
      .all();
    
    console.log(`Found ${productionIssues.length} Production Issues to delete:\n`);
    
    productionIssues.forEach((record, i) => {
      console.log(`${i + 1}. Issue ID: ${record.get('Issue ID') || record.id}`);
      console.log(`   Run ID: ${record.get('Run ID')}`);
      console.log(`   Client: ${record.get('Client ID')}`);
      console.log(`   Pattern: ${record.get('Pattern Matched')}`);
      console.log(`   Timestamp: ${record.get('Timestamp')}`);
      console.log(`   Message: ${record.get('Error Message')?.substring(0, 80)}...`);
      console.log('');
    });
    
    if (productionIssues.length > 0) {
      console.log(`Deleting ${productionIssues.length} Production Issues records...`);
      
      // Delete in batches of 10 (Airtable limit)
      for (let i = 0; i < productionIssues.length; i += 10) {
        const batch = productionIssues.slice(i, i + 10);
        const ids = batch.map(r => r.id);
        await masterBase('Production Issues').destroy(ids);
        console.log(`  Deleted batch ${Math.floor(i / 10) + 1} (${ids.length} records)`);
      }
      
      console.log(`✅ Deleted ${productionIssues.length} Production Issues records\n`);
    } else {
      console.log('✅ No Production Issues records to delete\n');
    }
    
    // Step 2: Find and delete from Stack Traces table
    console.log('\nStep 2: Scanning Stack Traces table...\n');
    
    const stackTraces = await masterBase('Stack Traces')
      .select({
        filterByFormula: `AND(
          OR(
            FIND('Client run record not found', {Error Message}),
            {Run ID} = '251012-005615',
            {Run ID} = '251012-010957'
          ),
          FIND('JobTracking.updateClientRun', {Stack Trace})
        )`,
        fields: ['Timestamp', 'Run ID', 'Client ID', 'Error Message', 'Created At']
      })
      .all();
    
    console.log(`Found ${stackTraces.length} Stack Traces to delete:\n`);
    
    stackTraces.forEach((record, i) => {
      console.log(`${i + 1}. Timestamp: ${record.get('Timestamp')}`);
      console.log(`   Run ID: ${record.get('Run ID')}`);
      console.log(`   Client: ${record.get('Client ID')}`);
      console.log(`   Created: ${record.get('Created At')}`);
      console.log(`   Message: ${record.get('Error Message')?.substring(0, 80)}...`);
      console.log('');
    });
    
    if (stackTraces.length > 0) {
      console.log(`Deleting ${stackTraces.length} Stack Traces records...`);
      
      // Delete in batches of 10
      for (let i = 0; i < stackTraces.length; i += 10) {
        const batch = stackTraces.slice(i, i + 10);
        const ids = batch.map(r => r.id);
        await masterBase('Stack Traces').destroy(ids);
        console.log(`  Deleted batch ${Math.floor(i / 10) + 1} (${ids.length} records)`);
      }
      
      console.log(`✅ Deleted ${stackTraces.length} Stack Traces records\n`);
    } else {
      console.log('✅ No Stack Traces records to delete\n');
    }
    
    // Summary
    console.log('\n📊 CLEANUP SUMMARY:');
    console.log(`   Production Issues deleted: ${productionIssues.length}`);
    console.log(`   Stack Traces deleted: ${stackTraces.length}`);
    console.log(`   Total records deleted: ${productionIssues.length + stackTraces.length}`);
    console.log('\n✅ Cleanup complete! These were false errors from the Run ID mismatch bug.');
    console.log('   Bug fixed in commit 1939c80\n');
    
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run cleanup
cleanupRecordNotFoundErrors()
  .then(() => {
    console.log('Done! ✅\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
