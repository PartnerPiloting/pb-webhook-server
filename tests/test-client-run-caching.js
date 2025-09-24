// tests/test-client-run-caching.js
// Test script to verify that client run record caching works correctly

require('dotenv').config();
const airtableService = require('../services/airtableService');
const recordCache = require('../services/recordCache');

// Test constants
const TEST_RUN_ID = `TEST-${Date.now()}`;
const TEST_CLIENT_ID = 'test-client';
const TEST_CLIENT_NAME = 'Test Client';

async function runTest() {
  console.log('\n=== Client Run Record Caching Test ===\n');
  console.log(`Using test run ID: ${TEST_RUN_ID}`);
  console.log(`Using test client ID: ${TEST_CLIENT_ID}`);
  
  try {
    // Step 1: Create a client run record
    console.log('\nStep 1: Creating initial client run record...');
    const record1 = await airtableService.createClientRunRecord(TEST_RUN_ID, TEST_CLIENT_ID, TEST_CLIENT_NAME);
    console.log(`Created record with ID: ${record1.id}`);
    
    // Check if it was cached
    const cachedId1 = recordCache.getClientRunRecordId(TEST_RUN_ID, TEST_CLIENT_ID);
    console.log(`Cached record ID: ${cachedId1 || 'not cached'}`);
    
    if (cachedId1 === record1.id) {
      console.log('✅ Record ID was correctly cached');
    } else {
      console.log('❌ Record ID was not cached correctly');
    }
    
    // Step 2: Try to create the same record again
    console.log('\nStep 2: Attempting to create the same record again...');
    const record2 = await airtableService.createClientRunRecord(TEST_RUN_ID, TEST_CLIENT_ID, TEST_CLIENT_NAME);
    console.log(`Retrieved record with ID: ${record2.id}`);
    
    if (record2.id === record1.id) {
      console.log('✅ Same record was returned (duplicate prevented)');
    } else {
      console.log('❌ Different record was created (duplicate not prevented)');
    }
    
    // Step 3: Clear cache and try again
    console.log('\nStep 3: Clearing cache and trying again...');
    recordCache.clearClientRunCache(TEST_RUN_ID, TEST_CLIENT_ID);
    
    const record3 = await airtableService.createClientRunRecord(TEST_RUN_ID, TEST_CLIENT_ID, TEST_CLIENT_NAME);
    console.log(`Retrieved record with ID: ${record3.id}`);
    
    if (record3.id === record1.id) {
      console.log('✅ Same record was found via database lookup (duplicate prevented)');
    } else {
      console.log('❌ Different record was created (duplicate not prevented)');
    }
    
    // Step 4: Update the client run record
    console.log('\nStep 4: Updating the client run record...');
    const updates = {
      'Total Posts Harvested': 10,
      'System Notes': 'Test update'
    };
    
    const updatedRecord = await airtableService.updateClientRun(TEST_RUN_ID, TEST_CLIENT_ID, updates);
    console.log(`Updated record with ID: ${updatedRecord.id}`);
    
    if (updatedRecord.id === record1.id) {
      console.log('✅ Same record was updated (no duplicate created)');
    } else {
      console.log('❌ Different record was updated (potential issue)');
    }
    
    // Step 5: Complete the client run
    console.log('\nStep 5: Completing the client run...');
    const completedRecord = await airtableService.completeClientRun(TEST_RUN_ID, TEST_CLIENT_ID, true, 'Test completed');
    
    if (completedRecord.id === record1.id) {
      console.log('✅ Same record was completed (no duplicate created)');
    } else {
      console.log('❌ Different record was completed (potential issue)');
    }
    
    console.log('\n=== Test Completed Successfully ===');
    
  } catch (error) {
    console.error('TEST ERROR:', error.message);
    console.error(error);
  }
}

// Run the test
runTest().catch(err => console.error('Unhandled error in test:', err));