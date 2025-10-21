const Airtable = require('airtable');
require('dotenv').config();

const MASTER_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID;
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(MASTER_BASE_ID);

async function checkTable() {
  console.log('Querying Production Issues table in base:', MASTER_BASE_ID);
  
  const records = await base('Production Issues').select({ maxRecords: 20 }).all();
  
  console.log(`\nFound ${records.length} records in Production Issues table\n`);
  
  if (records.length === 0) {
    console.log('✅ TABLE IS EMPTY (matches your Airtable UI)');
  } else {
    console.log('❌ TABLE HAS RECORDS (does NOT match your empty UI):');
    records.forEach(r => {
      console.log(`  - ${r.id}: Run ${r.fields['Run ID']}, ${r.fields.Severity}`);
    });
  }
}

checkTable().catch(e => console.error('Error:', e.message));
