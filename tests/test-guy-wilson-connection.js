// test-guy-wilson-connection.js
// Script to test Guy Wilson client connection and data structure
require('dotenv').config();

const Airtable = require('airtable');
const clientService = require('./services/clientService');
const { getClientBase } = require('./config/airtableClient');

async function testGuyWilsonConnection() {
  try {
    console.log('🔍 Testing Guy Wilson client connection');
    
    // 1. Get client data
    const clientId = 'Guy-Wilson';
    console.log(`👤 Fetching client data for ID: ${clientId}`);
    const client = await clientService.getClientById(clientId);
    
    if (!client) {
      console.error('❌ Client not found in Clients table');
      return;
    }
    
    // 2. Display client data
    console.log('\n📋 Client Data:');
    console.log(`   - Client Name: ${client.clientName}`);
    console.log(`   - Client ID: ${client.clientId}`);
    console.log(`   - Status: ${client.status}`);
    console.log(`   - Airtable Base ID: ${client.airtableBaseId}`);
    console.log(`   - Service Level: ${client.serviceLevel}`);
    
    // 3. Try to connect to the client's Airtable base
    console.log('\n🔌 Testing connection to client Airtable base');
    try {
      const clientBase = await getClientBase(clientId);
      console.log('✅ Successfully connected to client base');
      
      // 4. Check for Leads table
      console.log('\n📊 Testing access to Leads table');
      try {
        const leadsCount = await clientBase('Leads').select({
          maxRecords: 5,
          filterByFormula: `{Scoring Status} = "To Be Scored"`
        }).all();
        
        console.log(`✅ Successfully accessed Leads table. Found ${leadsCount.length} leads with "To Be Scored" status`);
        
        if (leadsCount.length > 0) {
          console.log('\n🔎 Sample lead data:');
          const sampleLead = leadsCount[0];
          const leadId = sampleLead.id;
          const leadFields = Object.keys(sampleLead.fields);
          
          console.log(`   - Lead ID: ${leadId}`);
          console.log(`   - Fields available: ${leadFields.length}`);
          console.log(`   - Has "Scoring Status": ${leadFields.includes('Scoring Status')}`);
          console.log(`   - Has "Profile Full JSON": ${leadFields.includes('Profile Full JSON')}`);
          
          // Check if JSON parsing works
          if (leadFields.includes('Profile Full JSON')) {
            try {
              const profileJson = JSON.parse(sampleLead.get('Profile Full JSON') || '{}');
              console.log(`   - Profile JSON parsed successfully`);
              console.log(`   - Has "about" field: ${Boolean(profileJson.about)}`);
              console.log(`   - Has "summary" field: ${Boolean(profileJson.summary)}`);
              console.log(`   - Has "linkedinDescription" field: ${Boolean(profileJson.linkedinDescription)}`);
              console.log(`   - Has "experience" field: ${Boolean(profileJson.experience)}`);
            } catch (jsonError) {
              console.error(`   ❌ Error parsing Profile Full JSON: ${jsonError.message}`);
            }
          }
        }
      } catch (leadsError) {
        console.error(`❌ Error accessing Leads table: ${leadsError.message}`);
      }
    } catch (baseError) {
      console.error(`❌ Error connecting to client base: ${baseError.message}`);
    }
    
  } catch (error) {
    console.error('❌ Error in test script:', error.message);
  }
}

// Run the test
testGuyWilsonConnection();