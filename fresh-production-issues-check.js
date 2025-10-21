#!/usr/bin/env node
/**
 * FRESH CHECK - Production Issues Table
 * Brand new utility, no dependencies on existing code
 * Shows exactly what's in the table
 */

const Airtable = require('airtable');
require('dotenv').config();

// Read env vars fresh
const MASTER_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID;
const API_KEY = process.env.AIRTABLE_API_KEY;

console.log('\n=== FRESH PRODUCTION ISSUES CHECK ===\n');
console.log('Base ID:', MASTER_BASE_ID);
console.log('API Key:', API_KEY ? `${API_KEY.substring(0, 10)}...` : 'NOT SET');
console.log('');

if (!MASTER_BASE_ID || !API_KEY) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

async function checkProductionIssues() {
  try {
    // Create completely fresh Airtable connection
    const airtable = new Airtable({ apiKey: API_KEY });
    const base = airtable.base(MASTER_BASE_ID);
    
    console.log('📊 Querying "Production Issues" table...\n');
    
    // Query the table
    const records = await base('Production Issues')
      .select({
        maxRecords: 100,
        view: 'All Issues'
      })
      .all();
    
    console.log(`\n✅ QUERY SUCCESSFUL`);
    console.log(`📊 Found ${records.length} records\n`);
    
    if (records.length === 0) {
      console.log('✅ TABLE IS EMPTY - matches your Airtable UI!\n');
    } else {
      console.log('❌ TABLE HAS RECORDS - does NOT match your empty UI:\n');
      
      records.forEach((record, index) => {
        console.log(`${index + 1}. Record ID: ${record.id}`);
        console.log(`   Run ID: ${record.fields['Run ID'] || 'N/A'}`);
        console.log(`   Severity: ${record.fields.Severity || 'N/A'}`);
        console.log(`   Timestamp: ${record.fields.Timestamp || 'N/A'}`);
        console.log('');
      });
    }
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    if (error.statusCode) {
      console.error('Status Code:', error.statusCode);
    }
    if (error.error) {
      console.error('Airtable Error:', error.error);
    }
  }
}

checkProductionIssues();
