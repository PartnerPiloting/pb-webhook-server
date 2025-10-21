/**
 * mark-issue-fixed.js
 * 
 * Utility to mark Production Issues as FIXED with details
 * 
 * Usage: node mark-issue-fixed.js <pattern> <commitHash> "<fix notes>"
 * Example: node mark-issue-fixed.js "at scoreChunk" "6203483" "Fixed batch scoring crash by passing runId string instead of logger object"
 */

const Airtable = require('airtable');
require('dotenv').config();

const MASTER_CLIENTS_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

if (!MASTER_CLIENTS_BASE_ID || !AIRTABLE_API_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   - MASTER_CLIENTS_BASE_ID');
  console.error('   - AIRTABLE_API_KEY');
  process.exit(1);
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(MASTER_CLIENTS_BASE_ID);

/**
 * Mark issues matching a pattern as FIXED
 * @param {string} searchPattern - Text to search for in Error Message field
 * @param {string} commitHash - Git commit hash of the fix
 * @param {string} fixNotes - Description of what was fixed
 */
async function markIssuesFixed(searchPattern, commitHash, fixNotes) {
  console.log('\n🔍 Searching for issues matching pattern:', searchPattern);
  
  try {
    // Find all records matching the pattern
    const records = await base('Production Issues')
      .select({
        filterByFormula: `AND(
          SEARCH("${searchPattern}", {Error Message}) > 0,
          {Status} != "FIXED"
        )`
      })
      .all();
    
    if (records.length === 0) {
      console.log('⚠️  No unfixed issues found matching that pattern');
      return;
    }
    
    console.log(`📋 Found ${records.length} issue(s) to mark as FIXED:\n`);
    
    // Show what will be updated
    records.forEach((record, index) => {
      const timestamp = record.get('Timestamp');
      const message = record.get('Error Message') || '';
      const severity = record.get('Severity');
      console.log(`${index + 1}. [${severity}] ${timestamp}`);
      console.log(`   ${message.substring(0, 100)}...`);
    });
    
    console.log('\n✅ Marking as FIXED...');
    
    // Update all matching records
    const updates = records.map(record => ({
      id: record.id,
      fields: {
        'Status': 'FIXED',
        'Fixed Time': new Date().toISOString(),
        'Fix Notes': fixNotes,
        'Fix Commit': commitHash
      }
    }));
    
    // Airtable allows max 10 updates at once
    for (let i = 0; i < updates.length; i += 10) {
      const batch = updates.slice(i, i + 10);
      await base('Production Issues').update(batch);
    }
    
    console.log(`\n✅ Successfully marked ${records.length} issue(s) as FIXED`);
    console.log(`   Status: FIXED`);
    console.log(`   Fixed Time: ${new Date().toISOString()}`);
    console.log(`   Fix Commit: ${commitHash}`);
    console.log(`   Fix Notes: ${fixNotes}`);
    
  } catch (error) {
    console.error('❌ Error updating issues:', error.message);
    process.exit(1);
  }
}

// CLI interface
const args = process.argv.slice(2);

if (args.length < 3) {
  console.log(`
Usage: node mark-issue-fixed.js <pattern> <commitHash> "<fix notes>"

Arguments:
  pattern     - Text to search for in Error Message (e.g., "at scoreChunk")
  commitHash  - Git commit hash (e.g., "6203483")
  fixNotes    - Description of fix (quoted string)

Example:
  node mark-issue-fixed.js "at scoreChunk" "6203483" "Fixed batch scoring crash by passing runId string instead of logger object"

This will:
  1. Find all Production Issues with Status != FIXED matching the pattern
  2. Update them with:
     - Status: FIXED
     - Fixed Time: current timestamp
     - Fix Commit: provided commit hash
     - Fix Notes: provided description
`);
  process.exit(1);
}

const [pattern, commitHash, fixNotes] = args;

markIssuesFixed(pattern, commitHash, fixNotes)
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
