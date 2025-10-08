// Simple script to check Production Issues table on Render staging
// No local env needed - calls the debug endpoint on staging server

const https = require('https');

const STAGING_URL = 'https://pb-webhook-server-staging.onrender.com';

// You can pass the debug key as an argument or it will prompt for it
const DEBUG_KEY = process.argv[2] || process.env.DEBUG_API_KEY;

if (!DEBUG_KEY) {
  console.error('\n❌ ERROR: DEBUG_API_KEY required');
  console.error('\nUsage: node check-production-issues-staging.js <DEBUG_API_KEY>');
  console.error('   OR: Set DEBUG_API_KEY environment variable');
  process.exit(1);
}

// Function to make HTTP request
function makeRequest(path, debugKey) {
  return new Promise((resolve, reject) => {
    const url = `${STAGING_URL}${path}`;
    console.log(`\nFetching: ${url}\n`);
    
    const options = {
      headers: {
        'x-debug-key': debugKey
      }
    };
    
    https.get(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function checkProductionIssues() {
  try {
    console.log('=' .repeat(80));
    console.log('CHECKING PRODUCTION ISSUES TABLE ON STAGING');
    console.log('=' .repeat(80));
    
    // Get recent production issues (last 2 hours by default)
    const hours = 2;
    const result = await makeRequest(`/debug-production-issues?hours=${hours}`, DEBUG_KEY);
    
    if (!result.issues || result.issues.length === 0) {
      console.log(`\n❌ NO ERRORS FOUND in Production Issues table from the last ${hours} hours`);
      console.log(`\n   Total errors in database: ${result.summary?.totalInDatabase || 0}`);
      console.log('\nThis means:');
      console.log('  1. Either no errors occurred in the last 2 hours');
      console.log('  2. OR errors are NOT being logged to the table (Phase 1 incomplete)');
      console.log('\n💡 Expected errors from Render log:');
      if (result.expected) {
        result.expected.errors.forEach(err => console.log(`   ${err}`));
        console.log(`\n   Expected total: ${result.expected.expectedTotal}`);
      }
      return;
    }
    
    console.log(`\n✅ Found ${result.issues.length} errors in the last ${hours} hours`);
    console.log(`   (Total in database: ${result.summary.totalInDatabase})\n`);
    console.log('=' .repeat(80));
    
    result.issues.forEach((issue, i) => {
      console.log(`\n${i + 1}. [${issue.Status || 'NEW'}] ${issue['Error Type'] || 'Unknown Type'}`);
      console.log(`   Severity: ${issue.Severity || 'N/A'}`);
      
      const msg = issue['Error Message'] || 'N/A';
      console.log(`   Message: ${msg.length > 120 ? msg.substring(0, 120) + '...' : msg}`);
      
      console.log(`   Client: ${issue['Client ID'] || 'N/A'}`);
      console.log(`   Run ID: ${issue['Run ID'] || 'N/A'}`);
      console.log(`   File: ${issue['File Path'] || 'N/A'}`);
      console.log(`   Function: ${issue['Function Name'] || 'N/A'}`);
      console.log(`   Time: ${issue.Timestamp || 'N/A'}`);
      console.log(`   Record ID: ${issue.id || 'N/A'}`);
    });
    
    console.log('\n' + '=' .repeat(80));
    console.log(`\n📊 SUMMARY:`);
    console.log(`   Recent errors (${hours}h): ${result.issues.length}`);
    console.log(`   Total in database: ${result.summary.totalInDatabase}`);
    
    if (result.summary.byType && Object.keys(result.summary.byType).length > 0) {
      console.log(`\n   By Error Type:`);
      Object.entries(result.summary.byType).forEach(([type, count]) => {
        console.log(`   - ${type}: ${count}`);
      });
    }
    
    if (result.summary.bySeverity && Object.keys(result.summary.bySeverity).length > 0) {
      console.log(`\n   By Severity:`);
      Object.entries(result.summary.bySeverity).forEach(([severity, count]) => {
        console.log(`   - ${severity}: ${count}`);
      });
    }
    
    if (result.summary.byRunId && Object.keys(result.summary.byRunId).length > 0) {
      console.log(`\n   By Run ID:`);
      Object.entries(result.summary.byRunId).forEach(([runId, count]) => {
        console.log(`   - ${runId}: ${count}`);
      });
    }
    
    console.log('\n' + '=' .repeat(80));
    
    // Show what we expected
    if (result.expected) {
      console.log('\n📋 EXPECTED ERRORS:');
      console.log(`   ${result.expected.message}`);
      result.expected.errors.forEach(err => console.log(`   ${err}`));
      console.log(`\n   Expected total: ${result.expected.expectedTotal}`);
      
      if (result.issues.length >= 2) {
        console.log('\n   ✅ Error count matches or exceeds expectations!');
      } else {
        console.log('\n   ⚠️  Error count is less than expected - some errors may not be logged');
      }
    }
    
    console.log('\n' + '=' .repeat(80));
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('\nPossible issues:');
    console.error('  1. Staging server is down');
    console.error('  2. DEBUG_API_KEY is incorrect');
    console.error('  3. Endpoint not deployed yet (commit and deploy first)');
  }
}

// Run the check
checkProductionIssues();
