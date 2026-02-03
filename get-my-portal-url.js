/**
 * Get Your Portal URL
 * 
 * This script helps you get or generate a portal access URL for testing.
 * 
 * Usage:
 *   node get-my-portal-url.js [clientId]
 * 
 * Examples:
 *   node get-my-portal-url.js              # Uses Guy-Wilson by default
 *   node get-my-portal-url.js brendon-guy  # For a specific client
 */

require('dotenv').config();
const Airtable = require('airtable');
const crypto = require('crypto');

const STAGING_FRONTEND_URL = 'https://pb-webhook-server-staging.vercel.app';
const STAGING_BACKEND_URL = 'https://pb-webhook-server-staging.onrender.com';

async function getPortalUrl(clientId = 'Guy-Wilson') {
  console.log('🔐 Portal URL Generator\n');
  
  // Check required env vars
  const apiKey = process.env.AIRTABLE_API_KEY;
  const masterBaseId = process.env.MASTER_CLIENTS_BASE_ID;
  const devKey = process.env.PORTAL_DEV_KEY || process.env.PB_WEBHOOK_SECRET;
  
  if (!apiKey || !masterBaseId) {
    console.log('❌ Missing AIRTABLE_API_KEY or MASTER_CLIENTS_BASE_ID');
    console.log('\n📋 ALTERNATIVE: Use devKey mode (works without Airtable lookup)\n');
    
    if (devKey) {
      const devUrl = `${STAGING_FRONTEND_URL}/?client=${clientId}&devKey=${devKey}`;
      console.log('✅ DevKey URL (for development/testing):');
      console.log(`   ${devUrl}\n`);
    } else {
      console.log('❌ No PB_WEBHOOK_SECRET found either. Please set your environment variables.');
    }
    return;
  }
  
  // Look up client in Airtable
  const base = new Airtable({ apiKey }).base(masterBaseId);
  
  try {
    console.log(`🔍 Looking up client: ${clientId}`);
    
    const records = await base('Clients')
      .select({
        filterByFormula: `OR({Client ID} = '${clientId}', LOWER({Client ID}) = LOWER('${clientId}'))`,
        maxRecords: 1
      })
      .firstPage();
    
    if (records.length === 0) {
      console.log(`❌ Client "${clientId}" not found in Airtable`);
      
      // Show devKey alternative
      if (devKey) {
        console.log('\n📋 ALTERNATIVE: Use devKey mode:');
        const devUrl = `${STAGING_FRONTEND_URL}/?client=${clientId}&devKey=${devKey}`;
        console.log(`   ${devUrl}\n`);
      }
      return;
    }
    
    const client = records[0];
    const clientName = client.get('Client Name') || clientId;
    const portalToken = client.get('Portal Token');
    const status = client.get('Status');
    
    console.log(`✅ Found client: ${clientName} (Status: ${status})\n`);
    
    // Option 1: Token-based URL (if token exists)
    if (portalToken) {
      const tokenUrl = `${STAGING_FRONTEND_URL}/?token=${portalToken}`;
      console.log('🔑 OPTION 1 - Token URL (recommended):');
      console.log(`   ${tokenUrl}\n`);
    } else {
      console.log('⚠️  No portal token found for this client.');
      console.log('   Run the admin token generator to create one.\n');
    }
    
    // Option 2: DevKey URL (for testing)
    if (devKey) {
      const devUrl = `${STAGING_FRONTEND_URL}/?client=${clientId}&devKey=${devKey}`;
      console.log('🔧 OPTION 2 - DevKey URL (for development):');
      console.log(`   ${devUrl}\n`);
    }
    
    // Option 3: Generate new token
    console.log('🆕 OPTION 3 - Generate new token?');
    console.log('   Run: node get-my-portal-url.js --generate ' + clientId);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (devKey) {
      console.log('\n📋 FALLBACK: Use devKey mode:');
      const devUrl = `${STAGING_FRONTEND_URL}/?client=${clientId}&devKey=${devKey}`;
      console.log(`   ${devUrl}\n`);
    }
  }
}

async function generateToken(clientId) {
  console.log('🔐 Generating new portal token...\n');
  
  const apiKey = process.env.AIRTABLE_API_KEY;
  const masterBaseId = process.env.MASTER_CLIENTS_BASE_ID;
  
  if (!apiKey || !masterBaseId) {
    console.log('❌ Missing AIRTABLE_API_KEY or MASTER_CLIENTS_BASE_ID');
    return;
  }
  
  const base = new Airtable({ apiKey }).base(masterBaseId);
  
  try {
    const records = await base('Clients')
      .select({
        filterByFormula: `OR({Client ID} = '${clientId}', LOWER({Client ID}) = LOWER('${clientId}'))`,
        maxRecords: 1
      })
      .firstPage();
    
    if (records.length === 0) {
      console.log(`❌ Client "${clientId}" not found`);
      return;
    }
    
    const client = records[0];
    const clientName = client.get('Client Name') || clientId;
    
    // Generate secure token
    const newToken = crypto.randomBytes(18).toString('base64url');
    
    // Update Airtable
    await base('Clients').update(client.id, {
      'Portal Token': newToken
    });
    
    const tokenUrl = `${STAGING_FRONTEND_URL}/?token=${newToken}`;
    
    console.log(`✅ New token generated for ${clientName}!\n`);
    console.log('🔑 Your new portal URL:');
    console.log(`   ${tokenUrl}\n`);
    console.log('⚠️  Save this URL - your old link will no longer work.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Parse command line
const args = process.argv.slice(2);
const generateMode = args.includes('--generate');
const clientId = args.filter(a => !a.startsWith('--'))[0] || 'Guy-Wilson';

if (generateMode) {
  generateToken(clientId);
} else {
  getPortalUrl(clientId);
}
