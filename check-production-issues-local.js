require('dotenv').config();
const ProductionIssueService = require('./services/productionIssueService');

const service = new ProductionIssueService();

console.log('=' .repeat(80));
console.log('CHECKING PRODUCTION ISSUES TABLE (via Service)');
console.log('=' .repeat(80));

async function checkIssues() {
  try {
    // Get all recent issues (last 100)
    const records = await service.getProductionIssues({ limit: 100 });
    
    if (records.length === 0) {
      console.log('\n❌ NO ERRORS FOUND in Production Issues table');
      console.log('\nThis means:');
      console.log('  1. Either no errors have occurred yet');
      console.log('  2. OR errors are NOT being logged to the table (Phase 1 incomplete)');
      console.log('\n💡 Check if the error logging service is working.');
      return;
    }
    
    // Filter to last 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const recentRecords = records.filter(r => {
      const timestamp = r.get('Timestamp');
      if (!timestamp) return false;
      return new Date(timestamp) > twoHoursAgo;
    });
    
    if (recentRecords.length === 0) {
      console.log(`\n⚠️  Found ${records.length} total errors, but NONE in the last 2 hours`);
      console.log(`\nMost recent error was at: ${records[0].get('Timestamp')}`);
      return;
    }
    
    console.log(`\n✅ Found ${recentRecords.length} errors in the last 2 hours (${records.length} total):\n`);
    console.log('=' .repeat(80));
    
    recentRecords.forEach((record, i) => {
      console.log(`\n${i + 1}. [${record.get('Status') || 'NEW'}] ${record.get('Error Type') || 'Unknown Type'}`);
      console.log(`   Severity: ${record.get('Severity') || 'N/A'}`);
      
      const msg = record.get('Error Message') || 'N/A';
      console.log(`   Message: ${msg.length > 100 ? msg.substring(0, 100) + '...' : msg}`);
      
      console.log(`   Client: ${record.get('Client ID') || 'N/A'}`);
      console.log(`   Run ID: ${record.get('Run ID') || 'N/A'}`);
      console.log(`   File: ${record.get('File Path') || 'N/A'}`);
      console.log(`   Function: ${record.get('Function Name') || 'N/A'}`);
      console.log(`   Time: ${record.get('Timestamp') || 'N/A'}`);
      console.log(`   Record ID: ${record.id}`);
    });
    
    console.log('\n' + '=' .repeat(80));
    console.log(`\n📊 SUMMARY:`);
    console.log(`   Recent errors (2h): ${recentRecords.length}`);
    console.log(`   Total errors: ${records.length}`);
    
    // Group by error type
    const byType = {};
    recentRecords.forEach(record => {
      const type = record.get('Error Type') || 'Unknown';
      byType[type] = (byType[type] || 0) + 1;
    });
    
    if (Object.keys(byType).length > 0) {
      console.log(`\n   By Error Type:`);
      Object.entries(byType).forEach(([type, count]) => {
        console.log(`   - ${type}: ${count}`);
      });
    }
    
    // Group by severity
    const bySeverity = {};
    recentRecords.forEach(record => {
      const severity = record.get('Severity') || 'Unknown';
      bySeverity[severity] = (bySeverity[severity] || 0) + 1;
    });
    
    if (Object.keys(bySeverity).length > 0) {
      console.log(`\n   By Severity:`);
      Object.entries(bySeverity).forEach(([severity, count]) => {
        console.log(`   - ${severity}: ${count}`);
      });
    }
    
    // Group by Run ID
    const byRunId = {};
    recentRecords.forEach(record => {
      const runId = record.get('Run ID') || 'Unknown';
      byRunId[runId] = (byRunId[runId] || 0) + 1;
    });
    
    if (Object.keys(byRunId).length > 0) {
      console.log(`\n   By Run ID:`);
      Object.entries(byRunId).forEach(([runId, count]) => {
        console.log(`   - ${runId}: ${count}`);
      });
    }
    
    console.log('\n' + '=' .repeat(80));
    
    // Show what we expected to see from the Render log
    console.log('\n📋 EXPECTED ERRORS from Render log 251008-130924-Guy-Wilson:');
    console.log('   1. Airtable Field Error: "Unknown field name: Errors" (3 occurrences)');
    console.log('   2. Logger Initialization: "Cannot access logger before initialization" (1 occurrence)');
    console.log('\n   Expected total: 2-3 distinct errors');
    
    if (recentRecords.length >= 2) {
      console.log('\n   ✅ Error count matches expectations!');
    } else {
      console.log('\n   ⚠️  Error count is less than expected - some errors may not be logged');
    }
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('\nStack:', error.stack);
  }
}

checkIssues();
