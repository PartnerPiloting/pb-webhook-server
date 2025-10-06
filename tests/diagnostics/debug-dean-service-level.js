const { getAllActiveClients } = require('./services/clientService');

async function checkDeanServiceLevel() {
  try {
    console.log('🔍 Checking Dean Hobin service level configuration...');
    
    const activeClients = await getAllActiveClients();
    console.log(`Found ${activeClients.length} active clients total`);
    
    const deanClient = activeClients.find(c => c.clientId === 'Dean-Hobin' || c.clientName?.includes('Dean'));
    
    if (!deanClient) {
      console.log('❌ Dean Hobin not found in active clients list');
      console.log('Available clients:', activeClients.map(c => ({ id: c.clientId, name: c.clientName, status: c.status })));
      return;
    }
    
    console.log('✅ Found Dean Hobin client:');
    console.log('  Client ID:', deanClient.clientId);
    console.log('  Client Name:', deanClient.clientName);
    console.log('  Status:', deanClient.status);
    console.log('  Service Level (raw):', deanClient.serviceLevel);
    console.log('  Service Level (parsed):', Number(deanClient.serviceLevel));
    console.log('  Airtable Base ID:', deanClient.airtableBaseId);
    
    // Check if service level >= 2
    const serviceLevel = Number(deanClient.serviceLevel);
    console.log(`\n🎯 Service level check: ${serviceLevel} >= 2? ${serviceLevel >= 2 ? 'YES ✅' : 'NO ❌'}`);
    
    // Check other level 2+ clients for comparison
    const level2Clients = activeClients.filter(c => Number(c.serviceLevel) >= 2);
    console.log(`\n📊 All level ≥ 2 clients (${level2Clients.length}):`);
    level2Clients.forEach(c => {
      console.log(`  - ${c.clientId} (${c.clientName}): Level ${c.serviceLevel}`);
    });
    
  } catch (error) {
    console.error('❌ Error checking Dean service level:', error.message);
  }
}

checkDeanServiceLevel();