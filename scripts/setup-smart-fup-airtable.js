/**
 * Smart Follow-Up Airtable Setup Script
 * 
 * This script sets up the required Airtable infrastructure for Smart Follow-Up v1:
 * 1. Creates the "Smart FUP State" table in the Master Clients base
 * 2. Adds new fields to the Client Master table
 * 
 * Run with: node scripts/setup-smart-fup-airtable.js
 * 
 * Prerequisites:
 * - AIRTABLE_API_KEY environment variable set
 * - MASTER_CLIENTS_BASE_ID environment variable set
 * 
 * Note: Airtable's API doesn't support creating tables programmatically.
 * This script will:
 * - Verify connection
 * - Add fields to existing Client Master table
 * - Output instructions for manual table creation
 */

require('dotenv').config();
const Airtable = require('airtable');

// ============================================
// FIELD DEFINITIONS (Reference for codebase)
// ============================================

/**
 * Smart FUP State Table Fields
 * Table Name: "Smart FUP State"
 * 
 * ACTUAL AIRTABLE SETUP (as created Feb 2026):
 */
const SMART_FUP_STATE_FIELDS = {
  // Primary field (text, not link - Airtable limitation)
  CLIENT_ID: 'Client ID',           // Single line text - Primary field
  
  // Lead identification
  LEAD_ID: 'Lead ID',               // Single line text - Airtable record ID
  LEAD_EMAIL: 'Lead Email',         // Email - for Fathom matching
  LEAD_LINKEDIN: 'Lead LinkedIn Profile', // URL - quick access for messaging
  
  // AI generation metadata
  GENERATED_TIME: 'Generated Time', // Date with time - when AI last ran
  
  // User's follow-up date (cached from Leads table for MIN sorting - Decision 17)
  USER_FUP_DATE: 'User FUP Date',   // Date - cached copy from Leads table
  
  // AI outputs
  STORY: 'Story',                   // Long text - AI-generated summary
  PRIORITY: 'Priority',             // Single select: High / Medium / Low
  SUGGESTED_MESSAGE: 'Suggested Message', // Long text - AI-generated
  RECOMMENDED_CHANNEL: 'Recommended Channel', // Single select: LinkedIn / Email / None
  WAITING_ON: 'Waiting On',         // Single select: User / Lead / None
  
  // AI follow-up date suggestion (Decision 14, refined in Decision 17)
  AI_SUGGESTED_FUP_DATE: 'AI Suggested FUP Date', // Date - AI's recommended follow-up date
  AI_DATE_REASONING: 'AI Date Reasoning', // Long text - why AI suggested this date
  
  // Notes change detection (Decision 17)
  LAST_PROCESSED_NOTES_LENGTH: 'Last Processed Notes Length', // Number - chars processed
  
  // Fathom data
  FATHOM_TRANSCRIPTS: 'Fathom Transcripts', // Long text - synced transcripts
};

/**
 * Priority options for Smart FUP State
 */
const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];

/**
 * Channel options for Smart FUP State
 */
const CHANNEL_OPTIONS = ['LinkedIn', 'Email', 'None'];

/**
 * Waiting On options for Smart FUP State (capitalized)
 */
const WAITING_ON_OPTIONS = ['User', 'Lead', 'None'];

/**
 * New fields added to Client Master table
 */
const CLIENT_MASTER_NEW_FIELDS = {
  CLIENT_TYPE: 'Client Type',       // Single select with descriptions
  FUP_AI_INSTRUCTIONS: 'FUP AI Instructions', // Long text
  FATHOM_API_KEY: 'Fathom API Key', // Text (optional)
};

/**
 * Client Type options (use first letter for logic)
 * Format: "X - Description"
 */
const CLIENT_TYPE_OPTIONS = [
  'A - Partner Selection',
  'B - Client Acquisition', 
  'C - Mixed (per lead)'
];

/**
 * Helper to extract client type letter from option value
 * e.g., "A - Partner Selection" => "A"
 */
function getClientTypeLetter(optionValue) {
  return optionValue ? optionValue.charAt(0).toUpperCase() : null;
}

// ============================================
// SETUP FUNCTIONS
// ============================================

async function verifyConnection() {
  console.log('\n📡 Verifying Airtable connection...');
  
  if (!process.env.AIRTABLE_API_KEY) {
    throw new Error('AIRTABLE_API_KEY not set');
  }
  if (!process.env.MASTER_CLIENTS_BASE_ID) {
    throw new Error('MASTER_CLIENTS_BASE_ID not set');
  }
  
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
    .base(process.env.MASTER_CLIENTS_BASE_ID);
  
  // Try to read from Client Master to verify connection
  try {
    const records = await base('Client Master').select({ maxRecords: 1 }).firstPage();
    console.log('✅ Connected to Airtable successfully');
    console.log(`   Base ID: ${process.env.MASTER_CLIENTS_BASE_ID}`);
    return base;
  } catch (error) {
    throw new Error(`Failed to connect to Airtable: ${error.message}`);
  }
}

async function checkIfTableExists(base, tableName) {
  try {
    await base(tableName).select({ maxRecords: 1 }).firstPage();
    return true;
  } catch (error) {
    if (error.message.includes('Could not find table')) {
      return false;
    }
    throw error;
  }
}

function printManualTableInstructions() {
  console.log('\n' + '='.repeat(60));
  console.log('📋 MANUAL STEP REQUIRED: Create "Smart FUP State" Table');
  console.log('='.repeat(60));
  console.log('\nAirtable API does not support creating tables programmatically.');
  console.log('Please create the table manually with these fields:\n');
  
  console.log('Table Name: Smart FUP State\n');
  console.log('Fields:');
  console.log('─'.repeat(50));
  console.log(`1.  ${SMART_FUP_STATE_FIELDS.CLIENT_ID.padEnd(25)} | Link to Client Master`);
  console.log(`2.  ${SMART_FUP_STATE_FIELDS.LEAD_ID.padEnd(25)} | Single line text`);
  console.log(`3.  ${SMART_FUP_STATE_FIELDS.LEAD_EMAIL.padEnd(25)} | Email`);
  console.log(`4.  ${SMART_FUP_STATE_FIELDS.LEAD_LINKEDIN.padEnd(25)} | URL`);
  console.log(`5.  ${SMART_FUP_STATE_FIELDS.GENERATED_DATE.padEnd(25)} | Date`);
  console.log(`6.  ${SMART_FUP_STATE_FIELDS.STORY.padEnd(25)} | Long text`);
  console.log(`7.  ${SMART_FUP_STATE_FIELDS.PRIORITY.padEnd(25)} | Single select (${PRIORITY_OPTIONS.join(', ')})`);
  console.log(`8.  ${SMART_FUP_STATE_FIELDS.SUGGESTED_MESSAGE.padEnd(25)} | Long text`);
  console.log(`9.  ${SMART_FUP_STATE_FIELDS.RECOMMENDED_CHANNEL.padEnd(25)} | Single select (${CHANNEL_OPTIONS.join(', ')})`);
  console.log(`10. ${SMART_FUP_STATE_FIELDS.WAITING_ON.padEnd(25)} | Single select (${WAITING_ON_OPTIONS.join(', ')})`);
  console.log(`11. ${SMART_FUP_STATE_FIELDS.FATHOM_TRANSCRIPTS.padEnd(25)} | Long text`);
  console.log('─'.repeat(50));
}

function printClientMasterFieldInstructions() {
  console.log('\n' + '='.repeat(60));
  console.log('📋 MANUAL STEP: Add Fields to "Client Master" Table');
  console.log('='.repeat(60));
  console.log('\nAdd these fields to your existing Client Master table:\n');
  
  console.log('Fields:');
  console.log('─'.repeat(50));
  console.log(`1. ${CLIENT_MASTER_NEW_FIELDS.CLIENT_TYPE.padEnd(20)} | Single select (${CLIENT_TYPE_OPTIONS.join(', ')}) - Default: A`);
  console.log(`2. ${CLIENT_MASTER_NEW_FIELDS.AI_INSTRUCTIONS.padEnd(20)} | Long text`);
  console.log(`3. ${CLIENT_MASTER_NEW_FIELDS.FATHOM_API_KEY.padEnd(20)} | Single line text (optional)`);
  console.log('─'.repeat(50));
}

async function run() {
  console.log('🚀 Smart Follow-Up Airtable Setup');
  console.log('================================\n');
  
  try {
    // Verify connection
    const base = await verifyConnection();
    
    // Check if Smart FUP State table exists
    const tableExists = await checkIfTableExists(base, 'Smart FUP State');
    
    if (tableExists) {
      console.log('\n✅ "Smart FUP State" table already exists');
    } else {
      printManualTableInstructions();
    }
    
    // Instructions for Client Master fields
    printClientMasterFieldInstructions();
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📌 FIELD CONSTANTS FOR CODE');
    console.log('='.repeat(60));
    console.log('\nThese constants are exported from this file for use in code:\n');
    console.log('- SMART_FUP_STATE_FIELDS');
    console.log('- CLIENT_MASTER_NEW_FIELDS');
    console.log('- PRIORITY_OPTIONS');
    console.log('- CHANNEL_OPTIONS');
    console.log('- WAITING_ON_OPTIONS');
    console.log('- CLIENT_TYPE_OPTIONS');
    
    console.log('\n✅ Setup script complete!');
    console.log('   After creating the table/fields manually, run this script again to verify.\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Export for use in other modules
module.exports = {
  SMART_FUP_STATE_FIELDS,
  CLIENT_MASTER_NEW_FIELDS,
  PRIORITY_OPTIONS,
  CHANNEL_OPTIONS,
  WAITING_ON_OPTIONS,
  CLIENT_TYPE_OPTIONS,
  getClientTypeLetter,
};

// Run if called directly
if (require.main === module) {
  run();
}
