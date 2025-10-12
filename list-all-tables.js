// Simple script to list ALL tables in Master Clients Base
const Airtable = require('airtable');
require('dotenv').config();

const baseId = process.env.MASTER_CLIENTS_BASE_ID;
console.log('Checking base:', baseId);

// Unfortunately Airtable API doesn't let you list tables programmatically
// You need to manually check your base schema

console.log('\n🔍 MANUAL CHECK NEEDED:');
console.log('1. Go to https://airtable.com/');
console.log('2. Open Master Clients Base');
console.log('3. Look at ALL table tabs at the top');
console.log('4. Tell me EVERY table name you see');
console.log('\nSpecifically - are there TWO tables with "Production" or "Issues" in the name?');
