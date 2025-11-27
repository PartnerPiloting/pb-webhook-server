require('dotenv').config();
const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_CLIENTS_BASE_ID);

base('Clients').select({
  filterByFormula: '{Client ID} = "Brendon-Campbell"',
  fields: ['Client Name', 'Client ID', 'Status', 'Airtable Base ID', 'Processing Stream']
}).firstPage().then(records => {
  if (records.length === 0) {
    console.log('❌ Brendon-Campbell NOT FOUND in Clients table');
  } else {
    const r = records[0];
    console.log('✅ FOUND Brendon-Campbell:');
    console.log('  Client Name:', r.get('Client Name'));
    console.log('  Client ID:', r.get('Client ID'));
    console.log('  Status:', r.get('Status'));
    console.log('  Airtable Base ID:', r.get('Airtable Base ID'));
    console.log('  Processing Stream:', r.get('Processing Stream'));
  }
  
  // Also check all clients
  console.log('\n📊 ALL CLIENTS:');
  return base('Clients').select({ fields: ['Client Name', 'Client ID', 'Status'] }).all();
}).then(allRecords => {
  allRecords.forEach(r => {
    console.log(`  - ${r.get('Client Name')} (${r.get('Client ID')}): ${r.get('Status')}`);
  });
}).catch(e => console.error('ERROR:', e.message));
