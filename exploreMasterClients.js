const Airtable = require('airtable');
require('dotenv').config();

const MASTER_CLIENTS_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

console.log('🔍 Exploring Master Clients Base...');
console.log('Base ID:', MASTER_CLIENTS_BASE_ID);

if (!MASTER_CLIENTS_BASE_ID || !AIRTABLE_API_KEY) {
  console.error('❌ Missing environment variables:');
  console.error('  MASTER_CLIENTS_BASE_ID:', !!MASTER_CLIENTS_BASE_ID);
  console.error('  AIRTABLE_API_KEY:', !!AIRTABLE_API_KEY);
  process.exit(1);
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(MASTER_CLIENTS_BASE_ID);

async function exploreClientsTable() {
  console.log('\n🔍 Trying different table names...');
  
  const possibleTableNames = ['Clients', 'Client', 'Master Clients', 'tblClients'];
  
  for (const tableName of possibleTableNames) {
    try {
      console.log(`\n📋 Trying table: "${tableName}"`);
      
      // Get first few records to see all available fields
      const records = await base(tableName).select({ 
        maxRecords: 3
      }).all();
      
      if (records.length === 0) {
        console.log(`⚠️  No records found in ${tableName} table`);
        continue;
      }
      
      console.log(`✅ Found ${records.length} sample records in "${tableName}"`);
      
      // Get all unique field names from all records
      const allFields = new Set();
      records.forEach(record => {
        Object.keys(record.fields).forEach(field => allFields.add(field));
      });
      
      const sortedFields = Array.from(allFields).sort();
      
      console.log(`\n📋 ALL FIELD NAMES IN ${tableName} TABLE:`);
      console.log('='.repeat(60));
      
      sortedFields.forEach((fieldName, index) => {
        const sampleValue = records[0].get(fieldName);
        const type = Array.isArray(sampleValue) ? 'Array' : typeof sampleValue;
        const preview = sampleValue ? String(sampleValue).substring(0, 30) + (String(sampleValue).length > 30 ? '...' : '') : 'null';
        console.log(`${index + 1}. "${fieldName}" (${type}) = ${preview}`);
      });
      
      console.log('\n🔍 SEARCHING FOR TOKEN/LIMIT FIELDS...');
      const tokenFields = sortedFields.filter(field => {
        const fieldLower = field.toLowerCase();
        return fieldLower.includes('token') || 
               fieldLower.includes('limit') ||
               fieldLower.includes('max') ||
               fieldLower.includes('profile') ||
               fieldLower.includes('post') ||
               fieldLower.includes('scoring') ||
               fieldLower.includes('budget');
      });
      
      if (tokenFields.length > 0) {
        console.log('\n🎯 POTENTIAL TOKEN/LIMIT FIELDS FOUND:');
        tokenFields.forEach(field => {
          const sampleValue = records[0].get(field);
          console.log(`  • "${field}" = ${sampleValue}`);
        });
      } else {
        console.log('\n⚠️  No obvious token/limit fields found');
        console.log('💡 The new fields might not be populated yet or have different names');
      }
      
      console.log('\n📝 SAMPLE CLIENT RECORD:');
      console.log('Client Name:', records[0].get('Client Name') || records[0].get('Name') || 'Unknown');
      
      // If we found a working table, stop here
      return;
      
    } catch (error) {
      console.error(`❌ Error reading table "${tableName}":`, error.message);
    }
  }
  
  console.log('\n❌ Could not access any table in the Master Clients base');
  console.log('💡 This might be a permissions issue or the table names might be different');
}

exploreClientsTable();
