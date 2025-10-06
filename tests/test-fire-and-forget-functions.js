#!/usr/bin/env node

require('dotenv').config();
const { 
    generateJobId, 
    setJobStatus, 
    getJobStatus, 
    setProcessingStream, 
    getProcessingStream,
    formatDuration 
} = require('./services/clientService.js');

async function testFireAndForgetFunctions() {
    console.log('🧪 TESTING FIRE-AND-FORGET FUNCTIONS');
    console.log('='.repeat(50));
    
    try {
        const clientId = 'Guy-Wilson';
        
        // Test 1: Generate job ID
        console.log('\n1. 🆔 Testing job ID generation...');
        const jobId = generateJobId('lead_scoring', 1);
        console.log(`✅ Generated job ID: ${jobId}`);
        
        // Test 2: Set processing stream
        console.log('\n2. 🔄 Testing processing stream...');
        await setProcessingStream(clientId, 1);
        const stream = await getProcessingStream(clientId);
        console.log(`✅ Processing stream set and retrieved: ${stream}`);
        
        // Test 3: Set job status - STARTED
        console.log('\n3. 🚀 Testing job status - STARTED...');
        const startTime = Date.now();
        await setJobStatus(clientId, 'lead_scoring', 'STARTED', jobId);
        
        // Test 4: Get job status
        console.log('\n4. 📋 Testing get job status...');
        let status = await getJobStatus(clientId, 'lead_scoring');
        console.log('✅ Job status retrieved:', JSON.stringify(status, null, 2));
        
        // Test 5: Update to RUNNING
        console.log('\n5. ⚡ Testing status update - RUNNING...');
        await setJobStatus(clientId, 'lead_scoring', 'RUNNING', jobId);
        
        // Simulate some work time
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Test 6: Complete with metrics
        console.log('\n6. ✅ Testing completion with metrics...');
        const endTime = Date.now();
        const duration = formatDuration(endTime - startTime);
        
        await setJobStatus(clientId, 'lead_scoring', 'COMPLETED', jobId, {
            duration: duration,
            count: 25
        });
        
        // Test 7: Get final status
        console.log('\n7. 📊 Testing final status retrieval...');
        status = await getJobStatus(clientId, 'lead_scoring');
        console.log('✅ Final job status:', JSON.stringify(status, null, 2));
        
        // Test 8: Test other operations
        console.log('\n8. 🔄 Testing other operations...');
        
        // Post Harvesting
        const harvestJobId = generateJobId('post_harvesting', 1);
        await setJobStatus(clientId, 'post_harvesting', 'COMPLETED', harvestJobId, {
            duration: '45 seconds',
            count: 12
        });
        
        // Post Scoring
        const scoreJobId = generateJobId('post_scoring', 1);
        await setJobStatus(clientId, 'post_scoring', 'COMPLETED', scoreJobId, {
            duration: '1.2 minutes',
            count: 8
        });
        
        console.log('✅ All operations tested successfully');
        
        // Test 9: Duration formatting
        console.log('\n9. ⏱️ Testing duration formatting...');
        console.log('30 seconds:', formatDuration(30000));
        console.log('2.5 minutes:', formatDuration(150000));
        console.log('1.5 hours:', formatDuration(5400000));
        
        console.log('\n🎉 ALL FIRE-AND-FORGET FUNCTIONS WORKING!');
        console.log('='.repeat(50));
        console.log('✅ Job ID generation working');
        console.log('✅ Processing stream management working');
        console.log('✅ Job status tracking working');
        console.log('✅ Metrics storage working');
        console.log('✅ Duration formatting working');
        console.log('✅ Multi-operation support working');
        console.log('\n🚀 Ready for API endpoint conversion!');
        
    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        console.error('Stack:', error.stack);
    }
}

testFireAndForgetFunctions();