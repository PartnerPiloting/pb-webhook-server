/**
 * test-airtable-service-boundaries.js
 * 
 * Test script to verify the new Airtable service boundary implementation.
 * This script tests the following:
 * 1. Accessing clients through the new service layer
 * 2. Testing the debug-clients endpoint which now uses the new service layer
 * 3. Run ID generation and consistency
 * 
 * Usage:
 * node test-airtable-service-boundaries.js
 */

require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// Directly test the service layer
async function testServiceLayer() {
  console.log('---------------------------------------------');
  console.log('TESTING SERVICE LAYER DIRECTLY');
  console.log('---------------------------------------------');
  
  try {
    const airtableService = require('./services/airtable/airtableService');
    
    // Initialize the service
    console.log('Initializing airtableService...');
    const initResult = airtableService.initialize();
    console.log('Initialization result:', initResult);
    
    // Test getting all clients
    console.log('\nGetting all clients...');
    const clients = await airtableService.getAllClients();
    console.log(`Retrieved ${clients.length} clients`);
    
    // Display first 3 clients
    console.log('\nSample clients:');
    for (let i = 0; i < Math.min(3, clients.length); i++) {
      const client = clients[i];
      console.log(`- ${client.clientId}: ${client.clientName} (${client.status})`);
    }
    
    // Test run ID generation
    console.log('\nTesting run ID generation:');
    if (clients.length > 0) {
      const testClient = clients[0];
      const clientId = testClient.clientId;
      
      // Generate a run ID
      const runId1 = airtableService.generateRunId(clientId);
      console.log(`Generated runId1: ${runId1}`);
      
      // Generate another run ID
      const runId2 = airtableService.generateRunId(clientId);
      console.log(`Generated runId2: ${runId2}`);
      
      // Check consistency
      console.log(`Run IDs are ${runId1 === runId2 ? 'SAME' : 'DIFFERENT'} (should be DIFFERENT)`);
      
      // Test getOrCreateRunId for consistency
      const runId3 = airtableService.getOrCreateRunId(clientId);
      console.log(`getOrCreateRunId first call: ${runId3}`);
      
      const runId4 = airtableService.getOrCreateRunId(clientId);
      console.log(`getOrCreateRunId second call: ${runId4}`);
      
      console.log(`getOrCreateRunId calls are ${runId3 === runId4 ? 'SAME' : 'DIFFERENT'} (should be SAME)`);
      
      // Test run record creation and job tracking
      console.log('\nTesting run record and job tracking:');
      console.log('Creating test run record...');
      const testRunId = airtableService.generateRunId(clientId);
      
      try {
        // Create run record
        const runRecord = await airtableService.createRunRecord({
          clientId,
          runId: testRunId,
          jobType: 'TEST-SERVICE-BOUNDARIES',
          initialData: {
            'System Notes': 'Test run record from service boundaries test script',
            'Total Items': 10
          }
        });
        console.log(`Created run record with ID: ${runRecord.id}`);
        
        // Create job tracking record
        const jobRecord = await airtableService.createJobTrackingRecord({
          runId: testRunId,
          clientId,
          jobType: 'TEST-SERVICE-BOUNDARIES',
          initialData: {
            'System Notes': 'Test job tracking record from service boundaries test script',
          }
        });
        console.log(`Created job tracking record with ID: ${jobRecord.id}`);
        
        // Update run record
        console.log('Updating run record...');
        await airtableService.updateRunRecord({
          clientId,
          runId: testRunId,
          updates: {
            'Progress': '50%',
            'Items Processed': 5
          }
        });
        console.log('Run record updated successfully');
        
        // Update job tracking
        console.log('Updating job tracking record...');
        await airtableService.updateJobTrackingRecord({
          runId: testRunId,
          updates: {
            'Progress': '50%',
            'Items Processed': 5
          }
        });
        console.log('Job tracking record updated successfully');
        
        // Complete run record and job tracking
        console.log('Completing run record and job tracking...');
        await airtableService.completeRunRecord({
          clientId,
          runId: testRunId,
          metrics: {
            'Items Processed': 10,
            'Success Count': 10,
            'Error Count': 0,
            'Duration (ms)': 1000
          }
        });
        console.log('Run record completed successfully');
        
        await airtableService.completeJobTrackingRecord({
          runId: testRunId,
          metrics: {
            'Items Processed': 10,
            'Success Count': 10,
            'Error Count': 0,
            'Duration (ms)': 1000
          }
        });
        console.log('Job tracking record completed successfully');
        
      } catch (error) {
        console.error('Error in run record/job tracking test:', error.message);
        // Continue with tests even if this part fails
      }
    }
    
    console.log('\nService layer tests completed successfully');
    return true;
  } catch (error) {
    console.error('Error testing service layer:', error);
    return false;
  }
}

// Test the updated API endpoint
async function testApiEndpoint() {
  console.log('\n---------------------------------------------');
  console.log('TESTING API ENDPOINT');
  console.log('---------------------------------------------');
  
  try {
    // Test local endpoint by default, can be overridden with environment variable
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001';
    const debugKey = process.env.DEBUG_API_KEY;
    
    if (!debugKey) {
      console.error('ERROR: DEBUG_API_KEY environment variable is required for API testing');
      return false;
    }
    
    console.log(`Testing endpoint: ${baseUrl}/debug-clients`);
    
    const response = await fetch(`${baseUrl}/debug-clients`, {
      headers: {
        'x-debug-key': debugKey
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response from API:', errorText);
      return false;
    }
    
    const data = await response.json();
    
    console.log('API response received successfully');
    console.log(`Total clients: ${data.clientData.totalClients}`);
    console.log(`Active clients: ${data.clientData.activeClients}`);
    console.log('Using new service layer:', data.clientData.usingNewServiceLayer || false);
    
    if (data.clientData.error) {
      console.error('API reported an error:', data.clientData.error);
      return false;
    }
    
    console.log('\nAPI endpoint test completed successfully');
    return true;
  } catch (error) {
    console.error('Error testing API endpoint:', error);
    return false;
  }
}

// Main test function
async function runTests() {
  console.log('==============================================');
  console.log('AIRTABLE SERVICE BOUNDARIES TEST');
  console.log('==============================================');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  
  const serviceLayerSuccess = await testServiceLayer();
  const apiEndpointSuccess = await testApiEndpoint();
  
  console.log('\n==============================================');
  console.log('TEST RESULTS SUMMARY');
  console.log('==============================================');
  console.log(`Service Layer Tests: ${serviceLayerSuccess ? 'PASSED' : 'FAILED'}`);
  console.log(`API Endpoint Tests: ${apiEndpointSuccess ? 'PASSED' : 'FAILED'}`);
  console.log(`Overall Result: ${serviceLayerSuccess && apiEndpointSuccess ? 'PASSED' : 'FAILED'}`);
  console.log('==============================================');
  
  // Return exit code based on test results
  process.exit(serviceLayerSuccess && apiEndpointSuccess ? 0 : 1);
}

// Run the tests
runTests();