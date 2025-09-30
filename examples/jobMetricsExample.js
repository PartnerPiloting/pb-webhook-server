/**
 * examples/jobMetricsExample.js
 * 
 * Example usage of the job metrics service for tracking batch operations
 */

const jobMetricsService = require('../services/jobMetricsService');
const { StructuredLogger } = require('../utils/structuredLogger');
const unifiedRunIdService = require('../services/unifiedRunIdService');

// Create system-level logger
const logger = new StructuredLogger('SYSTEM', null, 'metrics_example');

/**
 * Example function demonstrating how to use job metrics service
 * in a batch processing scenario
 */
async function exampleBatchProcess() {
  // Generate a run ID for this job
  const runId = unifiedRunIdService.generateRunId();
  logger.info(`Starting batch process with run ID: ${runId}`);
  
  // Example client IDs
  const clientIds = ['client1', 'client2', 'client3'];
  
  // Simulate processing each client
  for (const clientId of clientIds) {
    const clientLogger = new StructuredLogger('CLIENT', clientId, 'metrics_example');
    clientLogger.info(`Processing client ${clientId}`);
    
    try {
      // Initialize client metrics at start of processing
      await jobMetricsService.updateClientMetrics({
        runId,
        clientId,
        metrics: {
          'Start Time': new Date().toISOString(),
          'Status': 'In Progress'
        },
        options: { logger: clientLogger }
      });
      
      // Simulate some work and collect metrics
      const simulatedMetrics = await simulateClientProcessing(clientId);
      
      // Update with interim metrics
      await jobMetricsService.updateClientMetrics({
        runId,
        clientId,
        metrics: simulatedMetrics,
        options: { logger: clientLogger }
      });
      
      // Complete the client processing with final metrics
      await jobMetricsService.completeClientMetrics({
        runId,
        clientId,
        metrics: {
          ...simulatedMetrics,
          'Total Tokens': simulatedMetrics['Profile Scoring Tokens'] + simulatedMetrics['Post Scoring Tokens']
        },
        success: true,
        options: { logger: clientLogger }
      });
      
      clientLogger.info(`Completed processing client ${clientId}`);
    } catch (error) {
      clientLogger.error(`Error processing client ${clientId}: ${error.message}`);
      
      // Even on error, complete the metrics
      await jobMetricsService.completeClientMetrics({
        runId,
        clientId,
        metrics: {},
        success: false,
        options: { logger: clientLogger }
      });
    }
    
    // After each client, update the job-level aggregate metrics
    await jobMetricsService.updateJobAggregateMetrics({
      runId,
      options: { logger }
    });
  }
  
  // Complete the job with final metrics and notes
  await jobMetricsService.completeJobMetrics({
    runId,
    success: true,
    notes: `Successfully processed ${clientIds.length} clients`,
    options: { logger }
  });
  
  logger.info(`Completed batch process with run ID: ${runId}`);
  return runId;
}

/**
 * Simulate processing a client and return metrics
 * @param {string} clientId - Client ID
 * @returns {Promise<Object>} - Simulated metrics
 */
async function simulateClientProcessing(clientId) {
  // Simulate processing delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Generate some simulated metrics based on client ID
  const leadCount = 10 + (clientId.charCodeAt(clientId.length - 1) % 10);
  const postCount = 5 + (clientId.charCodeAt(0) % 10);
  const successRate = 0.8 + (Math.random() * 0.2);
  
  return {
    'Leads Processed': leadCount,
    'Profiles Examined for Scoring': leadCount,
    'Profiles Successfully Scored': Math.floor(leadCount * successRate),
    'Posts Processed': postCount,
    'Posts Examined for Scoring': postCount,
    'Posts Successfully Scored': Math.floor(postCount * successRate),
    'Profile Scoring Tokens': leadCount * 1000,
    'Post Scoring Tokens': postCount * 500
  };
}

/**
 * Run the example when executed directly
 */
if (require.main === module) {
  exampleBatchProcess()
    .then(runId => {
      console.log(`Example completed successfully with run ID: ${runId}`);
      process.exit(0);
    })
    .catch(error => {
      console.error(`Example failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { exampleBatchProcess };