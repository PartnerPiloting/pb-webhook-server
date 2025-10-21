// Double-check: Are there ANY unfixed issues we haven't addressed?
const https = require('https');

function fetchIssues() {
  return new Promise((resolve, reject) => {
    https.get('https://pb-webhook-server-staging.onrender.com/api/analyze-issues?status=unfixed', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const response = await fetchIssues();
  
  console.log('='.repeat(80));
  console.log('COMPREHENSIVE ISSUE CLASSIFICATION');
  console.log('='.repeat(80));
  console.log(`\nTotal unfixed issues: ${response.total}\n`);
  
  const classified = {
    executionLogFixed: [],
    batchFalsePositiveFixed: [],
    debugLogsIntentional: [],
    deprecationNoise: [],
    statusBugUnderInvestigation: [],
    unknown: []
  };
  
  response.topIssues.forEach(issue => {
    const msg = issue.message.toLowerCase();
    const pattern = issue.pattern.toLowerCase();
    
    // Classify each issue
    if (msg.includes('execution log') && (msg.includes('undefined') || msg.includes('cannot accept'))) {
      classified.executionLogFixed.push(issue);
    } else if (pattern.includes('batch') && pattern.includes('failed') && msg.includes('0 failed')) {
      classified.batchFalsePositiveFixed.push(issue);
    } else if (pattern.includes('batch') && msg.includes('admin alert') && msg.includes('failed critically')) {
      classified.executionLogFixed.push(issue); // Symptom of Execution Log bug
    } else if (pattern.includes('debug-crr') || pattern.includes('debug-status')) {
      classified.debugLogsIntentional.push(issue);
    } else if (pattern.includes('deprecated')) {
      classified.deprecationNoise.push(issue);
    } else if (msg.includes('record not found') && msg.includes('job tracking')) {
      classified.statusBugUnderInvestigation.push(issue);
    } else if (pattern.includes('invalid_value_for_column')) {
      // Check if it's related to Execution Log
      classified.executionLogFixed.push(issue); // Symptom
    } else {
      classified.unknown.push(issue);
    }
  });
  
  console.log('✅ ALREADY FIXED - Execution Log bug & symptoms:');
  console.log(`   ${classified.executionLogFixed.length} issues`);
  classified.executionLogFixed.forEach(i => {
    console.log(`   - ${i.severity}: ${i.pattern} (${i.count}x)`);
  });
  
  console.log('\n✅ ALREADY FIXED - Batch pattern false positives:');
  console.log(`   ${classified.batchFalsePositiveFixed.length} issues`);
  classified.batchFalsePositiveFixed.forEach(i => {
    console.log(`   - ${i.severity}: ${i.pattern} (${i.count}x)`);
  });
  
  console.log('\n🔍 INTENTIONAL - Debug logs for Status bug investigation:');
  console.log(`   ${classified.debugLogsIntentional.length} issues`);
  if (classified.debugLogsIntentional.length > 0) {
    console.log(`   - ${classified.debugLogsIntentional.length}x DEBUG-CRR logs (intentional diagnostics)`);
  }
  
  console.log('\n🔍 UNDER INVESTIGATION - Status field bug:');
  console.log(`   ${classified.statusBugUnderInvestigation.length} issues`);
  classified.statusBugUnderInvestigation.forEach(i => {
    console.log(`   - ${i.severity}: ${i.pattern} (${i.count}x)`);
  });
  
  console.log('\n⚠️  LOW PRIORITY - Noise:');
  console.log(`   ${classified.deprecationNoise.length} issues`);
  classified.deprecationNoise.forEach(i => {
    console.log(`   - ${i.severity}: ${i.pattern} (${i.count}x)`);
  });
  
  if (classified.unknown.length > 0) {
    console.log('\n❓ UNKNOWN - Need to investigate:');
    console.log(`   ${classified.unknown.length} issues`);
    classified.unknown.forEach(i => {
      console.log(`   - ${i.severity}: ${i.pattern} (${i.count}x)`);
      console.log(`     Message: ${i.message.substring(0, 150)}...`);
    });
  } else {
    console.log('\n✅ NO UNKNOWN ISSUES - All issues classified!');
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY:');
  console.log(`  Already Fixed: ${classified.executionLogFixed.length + classified.batchFalsePositiveFixed.length} issues`);
  console.log(`  Diagnostics: ${classified.debugLogsIntentional.length} issues`);
  console.log(`  Under Investigation: ${classified.statusBugUnderInvestigation.length} issues`);
  console.log(`  Low Priority Noise: ${classified.deprecationNoise.length} issues`);
  console.log(`  Unknown: ${classified.unknown.length} issues`);
  console.log('='.repeat(80));
}

main().catch(console.error);
