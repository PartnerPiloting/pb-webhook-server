// test-metrics-updates.js
// A script to test the metrics update system across different processes

require('dotenv').config();
const { StructuredLogger } = require('./utils/structuredLogger');
const logger = new StructuredLogger('SYSTEM', 'metrics-test', 'metrics_test');
const runIdUtils = require('./utils/runIdUtils');
const { safeUpdateMetrics } = require('./services/runRecordAdapterSimple');

// Generate a unique test run ID
const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').substring(0, 14);
const baseRunId = `test-metrics-${timestamp}`;

// Test client ID - update this with an actual client ID from your system
const TEST_CLIENT_ID = 'recbJkWbQqLMiPXtK'; // Update with a real client ID

// Test all three process types
async function runTests() {
  logger.info('=== METRICS UPDATE SYSTEM TEST ===');
  logger.info(`Base Run ID: ${baseRunId}`);
  
  try {
    // Test 1: Lead Scoring Metrics
    await testLeadScoringMetrics();
    
    // Test 2: Post Harvesting Metrics
    await testPostHarvestingMetrics();
    
    // Test 3: Post Scoring Metrics
    await testPostScoringMetrics();
    
    // Test 4: Error Handling
    await testErrorHandling();
    
    logger.info('✅ All tests completed');
  } catch (error) {
    logger.error(`❌ Test suite error: ${error.message}`);
  }
}

async function testLeadScoringMetrics() {
  logger.info('\n=== TEST: Lead Scoring Metrics ===');
  const runId = `${baseRunId}-lead`;
  const clientRunId = runIdUtils.addClientSuffix(runId, TEST_CLIENT_ID);
  
  logger.info(`Run ID: ${clientRunId}`);
  
  try {
    // Define test metrics
    const metrics = {
      'Profiles Examined for Scoring': 100,
      'Profiles Successfully Scored': 95,
      'Profile Scoring Tokens': 250000,
      'Status': 'Running'
    };
    
    // Update metrics
    const result = await safeUpdateMetrics({
      runId: clientRunId,
      clientId: TEST_CLIENT_ID,
      processType: 'lead_scoring',
      metrics,
      options: {
        isStandalone: false,
        logger,
        source: 'metrics_test'
      }
    });
    
    logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
    return result;
  } catch (error) {
    logger.error(`❌ Lead scoring metrics test failed: ${error.message}`);
    throw error;
  }
}

async function testPostHarvestingMetrics() {
  logger.info('\n=== TEST: Post Harvesting Metrics ===');
  const runId = `${baseRunId}-harvest`;
  const clientRunId = runIdUtils.addClientSuffix(runId, TEST_CLIENT_ID);
  
  logger.info(`Run ID: ${clientRunId}`);
  
  try {
    // Define test metrics
    const metrics = {
      'Total Posts Harvested': 50,
      'Apify API Costs': 0.15,
      'Profiles Submitted for Post Harvesting': 10,
      'Apify Run ID': 'apify-test-run-id'
    };
    
    // Update metrics
    const result = await safeUpdateMetrics({
      runId: clientRunId,
      clientId: TEST_CLIENT_ID,
      processType: 'post_harvesting',
      metrics,
      options: {
        isStandalone: false,
        logger,
        source: 'metrics_test'
      }
    });
    
    logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
    return result;
  } catch (error) {
    logger.error(`❌ Post harvesting metrics test failed: ${error.message}`);
    throw error;
  }
}

async function testPostScoringMetrics() {
  logger.info('\n=== TEST: Post Scoring Metrics ===');
  const runId = `${baseRunId}-post`;
  const clientRunId = runIdUtils.addClientSuffix(runId, TEST_CLIENT_ID);
  
  logger.info(`Run ID: ${clientRunId}`);
  
  try {
    // Define test metrics
    const metrics = {
      'Posts Examined for Scoring': 75,
      'Posts Successfully Scored': 70,
      'Post Scoring Tokens': 180000,
      'Post Scoring Last Run Time': '10m 30s'
    };
    
    // Update metrics
    const result = await safeUpdateMetrics({
      runId: clientRunId,
      clientId: TEST_CLIENT_ID,
      processType: 'post_scoring',
      metrics,
      options: {
        isStandalone: false,
        logger,
        source: 'metrics_test'
      }
    });
    
    logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
    return result;
  } catch (error) {
    logger.error(`❌ Post scoring metrics test failed: ${error.message}`);
    throw error;
  }
}

async function testErrorHandling() {
  logger.info('\n=== TEST: Error Handling ===');
  
  // Test 1: Invalid Client ID
  logger.info('Test: Invalid Client ID');
  try {
    const result = await safeUpdateMetrics({
      runId: `${baseRunId}-error`,
      clientId: 'invalid-client-id',
      processType: 'lead_scoring',
      metrics: { 'Test': 'Value' },
      options: { logger }
    });
    
    logger.info(`Result with invalid client ID: ${JSON.stringify(result, null, 2)}`);
  } catch (error) {
    logger.error(`❌ Error handling test failed (invalid client): ${error.message}`);
  }
  
  // Test 2: Non-existent Run ID
  logger.info('Test: Non-existent Run ID');
  try {
    const result = await safeUpdateMetrics({
      runId: 'non-existent-run-id',
      clientId: TEST_CLIENT_ID,
      processType: 'lead_scoring',
      metrics: { 'Test': 'Value' },
      options: { logger }
    });
    
    logger.info(`Result with non-existent run ID: ${JSON.stringify(result, null, 2)}`);
  } catch (error) {
    logger.error(`❌ Error handling test failed (non-existent run): ${error.message}`);
  }
  
  // Test 3: Invalid field value
  logger.info('Test: Invalid Field Value');
  try {
    const result = await safeUpdateMetrics({
      runId: `${baseRunId}-lead`,
      clientId: TEST_CLIENT_ID,
      processType: 'lead_scoring',
      metrics: { 
        'Invalid Field Name': 'This field does not exist',
        // Include a valid field too
        'Status': 'Completed'
      },
      options: { logger }
    });
    
    logger.info(`Result with invalid field: ${JSON.stringify(result, null, 2)}`);
  } catch (error) {
    logger.error(`❌ Error handling test failed (invalid field): ${error.message}`);
  }
  
  // Test 4: Standalone mode
  logger.info('Test: Standalone Mode');
  try {
    const result = await safeUpdateMetrics({
      runId: `${baseRunId}-standalone`,
      clientId: TEST_CLIENT_ID,
      processType: 'lead_scoring',
      metrics: { 'Status': 'Completed' },
      options: { 
        isStandalone: true,
        logger
      }
    });
    
    logger.info(`Result in standalone mode: ${JSON.stringify(result, null, 2)}`);
  } catch (error) {
    logger.error(`❌ Error handling test failed (standalone mode): ${error.message}`);
  }
}

// Run the tests
runTests()
  .then(() => {
    logger.info('Test script completed');
    process.exit(0);
  })
  .catch(error => {
    logger.error(`Test script failed: ${error.message}`);
    process.exit(1);
  });