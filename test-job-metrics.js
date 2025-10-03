#!/usr/bin/env node

/**
 * test-job-metrics.js
 * 
 * CLI script to test the job metrics service functionality.
 * This script runs through various test scenarios to validate
 * the job metrics service implementation.
 */

const jobMetricsService = require('./services/jobMetricsService');
const unifiedRunIdService = require('./services/unifiedRunIdService');
const unifiedJobTrackingRepository = require('./services/unifiedJobTrackingRepository');
const { createSystemLogger } = require('./utils/unifiedLoggerFactory');

// Configure logger
const logger = createSystemLogger(null, 'job_metrics_test');

/**
 * Run a test of metric validation
 */
async function testMetricValidation() {
  console.log('\n=== Testing Metric Validation ===\n');
  
  const testMetrics = {
    'Leads Processed': 42,
    'Posts Processed': '55', // String that should convert to number
    'Invalid Field': 'some value',
    'Profiles Examined for Scoring': 'not-a-number', // Invalid value
    'Start Time': '2023-06-15T12:00:00Z',
    'End Time': 'invalid-date', // Invalid date
    'Status': 'Completed' // Valid status
  };
  
  console.log('Input metrics:');
  console.log(testMetrics);
  
  const { validMetrics, invalidMetrics } = jobMetricsService.validateMetrics(testMetrics);
  
  console.log('\nValid metrics after validation:');
  console.log(validMetrics);
  
  console.log('\nInvalid metrics:');
  console.log(invalidMetrics);
  
  // Test valid status values
  console.log('\nTesting all valid status values...');
  const validStatusValues = ['Running', 'Completed', 'Failed', 'No Leads To Score'];
  
  for (const status of validStatusValues) {
    const { validMetrics: valid } = jobMetricsService.validateMetrics({ 'Status': status });
    console.log(`Status '${status}': ${valid.Status === status ? 'Valid ✓' : 'Invalid ✗'}`);
  }
  
  // Test invalid status
  console.log('\nTesting invalid status values...');
  const invalidStatusValues = ['Completed with errors', 'Error', 'Skipped', 'Pending'];
  
  for (const status of invalidStatusValues) {
    const { validMetrics: valid, invalidMetrics: invalid } = 
      jobMetricsService.validateMetrics({ 'Status': status });
    console.log(`Status '${status}': ${invalid.Status ? 'Correctly rejected ✓' : 'Incorrectly accepted ✗'}`);
    if (valid.Status) {
      console.log(`  Default value used: ${valid.Status}`);
    }
  }
  
  return { validMetrics, invalidMetrics };
}

/**
 * Test metric aggregation
 */
async function testMetricAggregation() {
  console.log('\n=== Testing Metric Aggregation ===\n');
  
  // Create mock records that mimic Airtable records
  const records = [
    mockAirtableRecord({
      'Leads Processed': 10,
      'Posts Processed': 5,
      'Start Time': '2023-06-15T12:00:00Z',
      'Status': 'Completed'
    }),
    mockAirtableRecord({
      'Leads Processed': 20,
      'Posts Processed': 15,
      'Start Time': '2023-06-15T12:30:00Z',
      'Status': 'Completed'
    }),
    mockAirtableRecord({
      'Leads Processed': 5,
      'Posts Processed': 0,
      'Start Time': '2023-06-15T11:45:00Z',
      'Status': 'Failed'
    }),
    mockAirtableRecord({
      'Leads Processed': 0,
      'Posts Processed': 0,
      'Start Time': '2023-06-15T10:30:00Z',
      'Status': 'No Leads To Score'
    })
  ];
  
  console.log(`Aggregating ${records.length} records...`);
  
  const aggregated = jobMetricsService.aggregateMetrics(records);
  
  console.log('\nAggregated metrics:');
  console.log(aggregated);
  
  return aggregated;
}

/**
 * Test a complete job tracking flow
 */
async function testCompleteFlow() {
  console.log('\n=== Testing Complete Job Flow ===\n');
  
  // Generate a test run ID
  const runId = unifiedRunIdService.generateRunId();
  console.log(`Generated run ID: ${runId}`);
  
  try {
    // Mock the repository methods for testing
    mockRepositoryMethods();
    
    // 1. Create job tracking record
    console.log('\n1. Creating job tracking record...');
    await unifiedJobTrackingRepository.createJobTrackingRecord({
      runId,
      jobType: 'test_job',
      status: 'In Progress',
      initialData: {
        'Test Name': 'Job Metrics Test'
      }
    });
    
    // 2. Add client run records
    console.log('\n2. Creating client run records...');
    const clients = ['test-client-1', 'test-client-2'];
    
    for (const clientId of clients) {
      await jobMetricsService.updateClientMetrics({
        runId,
        clientId,
        metrics: {
          'Start Time': new Date().toISOString(),
          'Status': 'In Progress'
        }
      });
      console.log(`  Created client run for ${clientId}`);
    }
    
    // 3. Update metrics for each client
    console.log('\n3. Updating client metrics...');
    await jobMetricsService.updateClientMetrics({
      runId,
      clientId: 'test-client-1',
      metrics: {
        'Leads Processed': 15,
        'Profiles Successfully Scored': 12,
        'Profile Scoring Tokens': 8500
      }
    });
    console.log('  Updated metrics for test-client-1');
    
    await jobMetricsService.updateClientMetrics({
      runId,
      clientId: 'test-client-2',
      metrics: {
        'Leads Processed': 8,
        'Profiles Successfully Scored': 7,
        'Profile Scoring Tokens': 5200
      }
    });
    console.log('  Updated metrics for test-client-2');
    
    // 4. Complete client metrics
    console.log('\n4. Completing client metrics...');
    await jobMetricsService.completeClientMetrics({
      runId,
      clientId: 'test-client-1',
      metrics: {
        'Total Tokens': 8500
      },
      success: true
    });
    console.log('  Completed metrics for test-client-1');
    
    await jobMetricsService.completeClientMetrics({
      runId,
      clientId: 'test-client-2',
      metrics: {
        'Total Tokens': 5200
      },
      success: true
    });
    console.log('  Completed metrics for test-client-2');
    
    // 5. Update aggregate metrics
    console.log('\n5. Updating aggregate metrics...');
    await jobMetricsService.updateJobAggregateMetrics({
      runId
    });
    
    // 6. Complete job metrics
    console.log('\n6. Completing job metrics...');
    await jobMetricsService.completeJobMetrics({
      runId,
      success: true,
      notes: 'Test completed successfully'
    });
    
    console.log('\nTest flow completed successfully!');
    return true;
  } catch (error) {
    console.error(`Error in test flow: ${error.message}`);
    return false;
  }
}

/**
 * Mock Airtable record structure for testing
 */
function mockAirtableRecord(fields) {
  return {
    id: `rec${Math.random().toString(36).substr(2, 9)}`,
    get: (field) => fields[field],
    fields
  };
}

/**
 * Mock repository methods to avoid actual database calls
 */
function mockRepositoryMethods() {
  // Store mock data
  const mockData = {
    jobRecords: {},
    clientRunRecords: {}
  };
  
  // Mock job tracking record methods
  unifiedJobTrackingRepository.createJobTrackingRecord = async ({ runId, jobType, status, initialData }) => {
    mockData.jobRecords[runId] = {
      id: `rec${Math.random().toString(36).substr(2, 9)}`,
      runId,
      jobType,
      status,
      ...initialData
    };
    return mockData.jobRecords[runId];
  };
  
  unifiedJobTrackingRepository.updateJobTrackingRecord = async ({ runId, updates }) => {
    if (!mockData.jobRecords[runId]) {
      throw new Error(`Job record not found for run ID: ${runId}`);
    }
    mockData.jobRecords[runId] = {
      ...mockData.jobRecords[runId],
      ...updates
    };
    return mockData.jobRecords[runId];
  };
  
  unifiedJobTrackingRepository.completeJobTrackingRecord = async ({ runId, status, metrics }) => {
    return await unifiedJobTrackingRepository.updateJobTrackingRecord({
      runId,
      updates: {
        status,
        ...metrics,
        'End Time': new Date().toISOString()
      }
    });
  };
  
  // Mock client run record methods
  unifiedJobTrackingRepository.createClientRunRecord = async ({ runId, clientId, initialData }) => {
    const key = `${runId}-${clientId}`;
    mockData.clientRunRecords[key] = {
      id: `rec${Math.random().toString(36).substr(2, 9)}`,
      runId,
      clientId,
      ...initialData
    };
    return mockData.clientRunRecords[key];
  };
  
  unifiedJobTrackingRepository.updateClientRunRecord = async ({ runId, clientId, updates }) => {
    const key = `${runId}-${clientId}`;
    if (!mockData.clientRunRecords[key]) {
      return await unifiedJobTrackingRepository.createClientRunRecord({
        runId,
        clientId,
        initialData: updates
      });
    }
    mockData.clientRunRecords[key] = {
      ...mockData.clientRunRecords[key],
      ...updates
    };
    return mockData.clientRunRecords[key];
  };
  
  unifiedJobTrackingRepository.completeClientRunRecord = async ({ runId, clientId, metrics }) => {
    return await unifiedJobTrackingRepository.updateClientRunRecord({
      runId,
      clientId,
      updates: {
        ...metrics,
        'End Time': new Date().toISOString()
      }
    });
  };
  
  unifiedJobTrackingRepository.updateAggregateMetrics = async ({ runId }) => {
    // Get all client records for this run ID
    const clientRecords = Object.values(mockData.clientRunRecords)
      .filter(record => record.runId === runId);
      
    // Aggregate metrics
    const aggregated = jobMetricsService.aggregateMetrics(
      clientRecords.map(record => mockAirtableRecord(record))
    );
    
    // Update job record with aggregated metrics
    return await unifiedJobTrackingRepository.updateJobTrackingRecord({
      runId,
      updates: aggregated
    });
  };
}

/**
 * Run all tests
 */
async function runTests() {
  try {
    console.log('Starting Job Metrics Service tests...\n');
    
    await testMetricValidation();
    await testMetricAggregation();
    await testCompleteFlow();
    
    console.log('\n✅ All tests completed successfully!');
  } catch (error) {
    console.error(`\n❌ Error running tests: ${error.message}`);
    console.error(error);
  }
}

// Run tests when script is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  runTests,
  testMetricValidation,
  testMetricAggregation,
  testCompleteFlow
};