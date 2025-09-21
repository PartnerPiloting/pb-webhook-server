#!/usr/bin/env node

// Quick test of client-by-client workflow
require('dotenv').config();

async function test() {
    console.log('🧪 Testing client-by-client workflow...');
    
    const { getActiveClientsByStream } = require('./services/clientService');
    const clients = await getActiveClientsByStream(1);
    
    console.log(`Found ${clients.length} clients on stream 1:`);
    clients.forEach(c => console.log(`  - ${c.clientName} (Level: ${c.serviceLevel})`));
    
    console.log('\n✅ Client filtering works! Now you have two options:');
    console.log('1. Use scripts/fire-and-forget-batch-processing.js (all operations for all clients)');
    console.log('2. Use scripts/simple-client-by-client.js (client-by-client workflow)');
}

test().catch(console.error);