/**
 * scripts/onboard-new-client.js
 * 
 * Automated client onboarding script for multi-tenant lead management system.
 * 
 * Prerequisites:
 *   1. "Template - Client Leads" base exists in Airtable (cleaned template)
 *   2. New client base has been duplicated from template in Airtable UI
 * 
 * What this script does:
 *   1. Validates the new client base structure
 *   2. Creates client record in Master Clients table
 *   3. Runs validation tests
 *   4. Reports results
 * 
 * Usage:
 *   node scripts/onboard-new-client.js --interactive
 *   OR
 *   node scripts/onboard-new-client.js \
 *     --base-id appXXXXXXXXXXXXX \
 *     --client-id "John-Smith" \
 *     --client-name "John Smith" \
 *     --email "john@example.com" \
 *     --first-name "John" \
 *     --wp-user-id 123 \
 *     --service-level 1 \
 *     --post-access yes
 */

require('dotenv').config();
const Airtable = require('airtable');
const readline = require('readline');

// Import existing services
const { initializeClientsBase } = require('../services/clientService');

// Required tables in client base
const REQUIRED_TABLES = [
  'Leads',
  'LinkedIn Posts',
  'Connections'
  // Note: 'Credentials' is optional (legacy PhantomBuster messaging only)
];

// Configuration tables that should have data
const CONFIG_TABLES = [
  'Scoring Attributes',
  'Post Scoring Attributes',
  'Post Scoring Instructions'
];

// Create readline interface for interactive mode
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

/**
 * Validate that a base has the required structure
 */
async function validateBaseStructure(baseId) {
  console.log('\n🔍 Validating base structure...');
  
  const base = new Airtable({ 
    apiKey: process.env.AIRTABLE_API_KEY 
  }).base(baseId);

  const results = {
    valid: true,
    errors: [],
    warnings: []
  };

  // Check required tables
  for (const tableName of REQUIRED_TABLES) {
    try {
      const records = await base(tableName).select({ maxRecords: 1 }).firstPage();
      
      if (records.length > 0) {
        results.warnings.push(`${tableName} table has ${records.length} record(s) - should be empty`);
      } else {
        console.log(`   ✅ ${tableName} - empty (correct)`);
      }
    } catch (error) {
      results.valid = false;
      results.errors.push(`Required table "${tableName}" not found`);
      console.log(`   ❌ ${tableName} - NOT FOUND`);
    }
  }

  // Check configuration tables
  for (const tableName of CONFIG_TABLES) {
    try {
      const records = await base(tableName).select().all();
      
      if (records.length === 0) {
        results.warnings.push(`${tableName} is empty - scoring may not work`);
        console.log(`   ⚠️  ${tableName} - empty (should have records)`);
      } else {
        console.log(`   ✅ ${tableName} - ${records.length} records (correct)`);
      }
    } catch (error) {
      results.warnings.push(`Configuration table "${tableName}" not found`);
      console.log(`   ⚠️  ${tableName} - NOT FOUND`);
    }
  }

  return results;
}

/**
 * Create client record in Master Clients table
 */
async function createClientRecord(options) {
  console.log('\n📝 Creating client record in Master Clients table...');
  
  const {
    baseId,
    clientId,
    clientName,
    clientFirstName,
    clientEmail,
    wpUserId,
    serviceLevel = 1,
    postAccessEnabled = false
  } = options;

  const masterBase = initializeClientsBase();

  // Check if client already exists
  const existingRecords = await masterBase('Clients').select({
    filterByFormula: `{Client ID} = '${clientId}'`
  }).firstPage();

  if (existingRecords.length > 0) {
    throw new Error(`Client "${clientId}" already exists in Master Clients table`);
  }

  // Create new client record
  const record = await masterBase('Clients').create({
    'Client ID': clientId,
    'Client Name': clientName,
    'Airtable Base ID': baseId,
    'Status': 'Active',
    'Service Level': serviceLevel,
    'Client First Name': clientFirstName || clientName.split(' ')[0],
    'Client Email Address': clientEmail,
    'WordPress User ID': wpUserId ? parseInt(wpUserId) : null,
    
    // Post access control (for Apify post scraping)
    'Post Access Enabled': postAccessEnabled ? 'Yes' : null,
    
    // Default token limits
    'Profile Scoring Token Limit': 5000,
    'Post Scoring Token Limit': 3000,
    
    // Default floor values
    'Primary Floor': 70,
    'Secondary Floor': 50,
    'Minimum Floor': 30,
    'Floor Strategy': 'Progressive',
    
    // Default post harvesting settings
    'Posts Daily Target': 0,
    'Leads Batch Size for Post Collection': 20,
    'Max Post Batches Per Day Guardrail': 10,
    
    'Comment': `Onboarded via script on ${new Date().toISOString()}`
  });

  console.log(`   ✅ Created client record: ${record.id}`);
  return record;
}

/**
 * Run basic validation tests on the new client
 */
async function runValidationTests(clientId, baseId) {
  console.log('\n🧪 Running validation tests...');
  
  const { getClientById, getClientBase } = require('../services/clientService');
  const { getClientBase: getClientBaseAlt } = require('../config/airtableClient');

  try {
    // Test 1: Retrieve client from master table
    const client = await getClientById(clientId);
    if (!client) {
      console.log('   ❌ Test 1 Failed: Client not found via getClientById');
      return false;
    }
    console.log('   ✅ Test 1: Client retrieved from Master Clients table');

    // Test 2: Base ID matches
    if (client.airtableBaseId !== baseId) {
      console.log(`   ❌ Test 2 Failed: Base ID mismatch (expected ${baseId}, got ${client.airtableBaseId})`);
      return false;
    }
    console.log('   ✅ Test 2: Base ID matches');

    // Test 3: Can connect to client base
    const clientBase = await getClientBaseAlt(clientId);
    if (!clientBase) {
      console.log('   ❌ Test 3 Failed: Cannot connect to client base');
      return false;
    }
    console.log('   ✅ Test 3: Connected to client base');

    // Test 4: Can access Leads table
    const testRecords = await clientBase('Leads').select({ maxRecords: 1 }).firstPage();
    console.log('   ✅ Test 4: Leads table accessible');

    // Test 5: Scoring attributes exist
    const scoringAttrs = await clientBase('Scoring Attributes').select().all();
    if (scoringAttrs.length === 0) {
      console.log('   ⚠️  Test 5 Warning: No scoring attributes found');
    } else {
      console.log(`   ✅ Test 5: ${scoringAttrs.length} scoring attributes found`);
    }

    return true;

  } catch (error) {
    console.log(`   ❌ Validation test failed: ${error.message}`);
    return false;
  }
}

/**
 * Interactive mode - prompt user for all required information
 */
async function interactiveMode() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║          🚀 CLIENT ONBOARDING WIZARD 🚀                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('📋 Prerequisites:');
  console.log('   1. ✅ You have duplicated "Template - Client Leads" in Airtable');
  console.log('   2. ✅ You have the new base ID ready\n');

  const proceed = await question('Ready to proceed? (yes/no): ');
  if (proceed.toLowerCase() !== 'yes' && proceed.toLowerCase() !== 'y') {
    console.log('\n👋 Onboarding cancelled.');
    rl.close();
    process.exit(0);
  }

  console.log('\n📝 Please provide the following information:\n');

  const baseId = await question('New Airtable Base ID (starts with "app"): ');
  const clientName = await question('Client Full Name (e.g., "John Smith"): ');
  const clientId = await question('Client ID (e.g., "John-Smith"): ');
  const clientEmail = await question('Client Email Address: ');
  const clientFirstName = await question('Client First Name (or press Enter to use first word of name): ');
  const wpUserId = await question('WordPress User ID (or press Enter to skip): ');
  const serviceLevel = await question('Service Level (1=Basic, 2=Plus Post Scoring, 3=Plus Harvesting) [default: 1]: ');
  const postAccessEnabled = await question('Enable Post Access for Apify? (yes/no) [default: no]: ');

  const options = {
    baseId: baseId.trim(),
    clientName: clientName.trim(),
    clientId: clientId.trim(),
    clientEmail: clientEmail.trim(),
    clientFirstName: clientFirstName.trim() || clientName.trim().split(' ')[0],
    wpUserId: wpUserId.trim() || null,
    serviceLevel: parseInt(serviceLevel) || 1,
    postAccessEnabled: postAccessEnabled.toLowerCase() === 'yes' || postAccessEnabled.toLowerCase() === 'y'
  };

  return options;
}

/**
 * Main onboarding function
 */
async function onboardClient(options) {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 STARTING CLIENT ONBOARDING');
  console.log('='.repeat(70));
  
  console.log('\n📊 Client Details:');
  console.log(`   Client Name: ${options.clientName}`);
  console.log(`   Client ID: ${options.clientId}`);
  console.log(`   Email: ${options.clientEmail}`);
  console.log(`   Base ID: ${options.baseId}`);
  console.log(`   Service Level: ${options.serviceLevel}`);
  console.log(`   Post Access Enabled: ${options.postAccessEnabled ? 'Yes' : 'No'}`);
  if (options.wpUserId) {
    console.log(`   WordPress User ID: ${options.wpUserId}`);
  }

  try {
    // Step 1: Validate base structure
    const validation = await validateBaseStructure(options.baseId);
    
    if (!validation.valid) {
      console.log('\n❌ Base validation failed:');
      validation.errors.forEach(err => console.log(`   • ${err}`));
      throw new Error('Base structure validation failed');
    }

    if (validation.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      validation.warnings.forEach(warn => console.log(`   • ${warn}`));
    }

    // Step 2: Create client record
    const clientRecord = await createClientRecord(options);

    // Step 3: Run validation tests
    const testsPass = await runValidationTests(options.clientId, options.baseId);

    if (!testsPass) {
      console.log('\n⚠️  Some validation tests failed, but client was created.');
      console.log('   You may need to investigate configuration issues.');
    }

    // Success!
    console.log('\n' + '='.repeat(70));
    console.log('✅ CLIENT ONBOARDING COMPLETE!');
    console.log('='.repeat(70));
    console.log('\n📋 Summary:');
    console.log(`   Client ID: ${options.clientId}`);
    console.log(`   Client Name: ${options.clientName}`);
    console.log(`   Base ID: ${options.baseId}`);
    console.log(`   Master Record ID: ${clientRecord.id}`);
    console.log(`   Status: Active`);
    console.log('\n🎉 Next steps:');
    console.log('   1. Client can now log in to the system');
    console.log('   2. Configure LinkedIn credentials in Credentials table');
    console.log('   3. Start importing leads');
    console.log('   4. Run initial scoring batch\n');

    return {
      success: true,
      clientId: options.clientId,
      recordId: clientRecord.id,
      baseId: options.baseId
    };

  } catch (error) {
    console.log('\n' + '='.repeat(70));
    console.log('❌ ONBOARDING FAILED');
    console.log('='.repeat(70));
    console.log(`\nError: ${error.message}\n`);
    
    if (error.stack) {
      console.log('Stack trace:');
      console.log(error.stack);
    }
    
    throw error;
  }
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--interactive') || args.includes('-i')) {
    return { mode: 'interactive' };
  }

  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];
    
    const keyMap = {
      'base-id': 'baseId',
      'client-id': 'clientId',
      'client-name': 'clientName',
      'email': 'clientEmail',
      'first-name': 'clientFirstName',
      'wp-user-id': 'wpUserId',
      'service-level': 'serviceLevel',
      'post-access': 'postAccessEnabled'
    };
    
    if (keyMap[key]) {
      options[keyMap[key]] = value;
    }
  }

  // Validate required fields
  const required = ['baseId', 'clientId', 'clientName', 'clientEmail'];
  const missing = required.filter(field => !options[field]);
  
  if (missing.length > 0) {
    console.error(`\n❌ Error: Missing required arguments: ${missing.join(', ')}\n`);
    showHelp();
    process.exit(1);
  }

  return { mode: 'direct', options };
}

function showHelp() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║          CLIENT ONBOARDING SCRIPT                          ║
╚════════════════════════════════════════════════════════════╝

USAGE:
  Interactive Mode (recommended):
    node scripts/onboard-new-client.js --interactive

  Direct Mode:
    node scripts/onboard-new-client.js \\
      --base-id <base-id> \\
      --client-id <client-id> \\
      --client-name <name> \\
      --email <email> \\
      [--first-name <first-name>] \\
      [--wp-user-id <id>] \\
      [--service-level <1-3>] \
      [--post-access <yes|no>]

REQUIRED ARGUMENTS:
  --base-id         New client's Airtable base ID (starts with "app")
  --client-id       Unique client identifier (e.g., "John-Smith")
  --client-name     Client's full name (e.g., "John Smith")
  --email           Client's email address

OPTIONAL ARGUMENTS:
  --first-name      Client's first name (default: first word of name)
  --wp-user-id      WordPress user ID for integration
  --service-level   Service tier: 1=Basic, 2=+Posts, 3=+Harvesting (default: 1)
  --post-access     Enable Apify post scraping: yes or no (default: no)

EXAMPLES:
  # Interactive mode
  node scripts/onboard-new-client.js --interactive

  # Direct mode
  node scripts/onboard-new-client.js \\
    --base-id appABC123XYZ456 \\
    --client-id "Jane-Doe" \\
    --client-name "Jane Doe" \\
    --email "jane@example.com" \\
    --service-level 2 \\
    --post-access yes

PREREQUISITES:
  1. Duplicate "Template - Client Leads" base in Airtable UI
  2. Copy the new base ID
  3. Run this script

WHAT THIS SCRIPT DOES:
  ✅ Validates base structure
  ✅ Creates client record in Master Clients table
  ✅ Sets default configuration values
  ✅ Runs validation tests
  ✅ Reports results
`);
}

// Main execution
async function main() {
  const parsed = parseArgs();
  
  try {
    let options;
    
    if (parsed.mode === 'interactive') {
      options = await interactiveMode();
      rl.close();
    } else {
      options = parsed.options;
    }

    const result = await onboardClient(options);
    process.exit(0);

  } catch (error) {
    console.error('\n💥 Fatal error:', error.message);
    if (rl) rl.close();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { onboardClient, validateBaseStructure };
