# Job Metrics Service Implementation Guide

This document provides guidance on implementing and using the new Job Metrics Service for the PB-Webhook-Server's multi-tenant job tracking system.

## Overview

The Job Metrics Service provides robust handling of metrics collection, validation, and aggregation to ensure accurate reporting across the multi-tenant environment. It works in conjunction with the Unified Run ID Service and Job Tracking Repository to create a comprehensive solution for job tracking.

## Key Features

1. **Metrics Validation** - All metrics are validated against predefined schemas to ensure consistency
2. **Type Normalization** - Automatic conversion between string and numeric values
3. **Aggregation Logic** - Smart aggregation of metrics using sum, min, max, or last value
4. **Error Resilience** - Built-in error handling and recovery strategies
5. **Multi-tenant Support** - Client-specific metrics tracking

## Integration Instructions

### 1. Updating Client Metrics During Processing

Use the `updateClientMetrics` function to record metrics for a specific client during job execution:

```javascript
const jobMetricsService = require('./services/jobMetricsService');
const { StructuredLogger } = require('./utils/structuredLogger');

// Create a logger for the specific client
const logger = new StructuredLogger('CLIENT', clientId, 'lead_scoring');

// Update metrics during processing
await jobMetricsService.updateClientMetrics({
  runId: '230615-120000',
  clientId: clientId,
  metrics: {
    'Leads Processed': processedCount,
    'Profiles Successfully Scored': scoredCount,
    'Profile Scoring Tokens': tokensUsed
  },
  options: { logger }
});
```

### 2. Completing Client Metrics After Processing

Use the `completeClientMetrics` function to mark a client's processing as complete:

```javascript
// After processing is complete
await jobMetricsService.completeClientMetrics({
  runId: '230615-120000',
  clientId: clientId,
  metrics: {
    'Total Tokens': totalTokens,
    'Profiles Successfully Scored': finalScoredCount
  },
  success: true, // or false if there were errors
  options: { logger }
});
```

### 3. Updating Job-Level Aggregate Metrics

Use the `updateJobAggregateMetrics` function to aggregate all client metrics for a job:

```javascript
// After processing a batch of clients or at regular intervals
await jobMetricsService.updateJobAggregateMetrics({
  runId: '230615-120000',
  options: { logger: systemLogger }
});
```

### 4. Completing Job Metrics

Use the `completeJobMetrics` function to finalize a job's metrics:

```javascript
// After all clients have been processed
await jobMetricsService.completeJobMetrics({
  runId: '230615-120000',
  success: allClientsSuccessful,
  notes: 'Completed batch scoring for all clients',
  options: { logger: systemLogger }
});
```

## Integration Patterns

### Batch Scoring Integration

```javascript
// In batchScorer.js
async function processBatch(runId, clientIds, options) {
  const logger = new StructuredLogger('SYSTEM', null, 'batch_scorer');
  
  for (const clientId of clientIds) {
    const clientLogger = new StructuredLogger('CLIENT', clientId, 'lead_scoring');
    let success = true;
    
    try {
      // Initialize client metrics
      await jobMetricsService.updateClientMetrics({
        runId,
        clientId,
        metrics: {
          'Start Time': new Date().toISOString(),
          'Status': 'In Progress'
        },
        options: { logger: clientLogger }
      });
      
      // Process the client
      const result = await processClient(clientId);
      
      // Update metrics with results
      await jobMetricsService.completeClientMetrics({
        runId,
        clientId,
        metrics: result.metrics,
        success: result.success,
        options: { logger: clientLogger }
      });
    } catch (error) {
      clientLogger.error(`Error processing client ${clientId}: ${error.message}`);
      success = false;
      
      // Log failure
      await jobMetricsService.completeClientMetrics({
        runId,
        clientId,
        metrics: {},
        success: false,
        options: { logger: clientLogger }
      });
    }
  }
  
  // Complete the job and aggregate final metrics
  await jobMetricsService.completeJobMetrics({
    runId,
    success: true,
    notes: `Completed batch scoring for ${clientIds.length} clients`,
    options: { logger }
  });
}
```

### Single Lead Scoring Integration

```javascript
// In singleScorer.js
async function scoreLeadWithTracking(runId, clientId, leadId, options = {}) {
  const logger = new StructuredLogger('CLIENT', clientId, 'single_lead_scoring');
  
  try {
    // Score the lead
    const result = await scoreLeadProfile(leadId);
    
    // Update metrics
    await jobMetricsService.updateClientMetrics({
      runId,
      clientId,
      metrics: {
        'Leads Processed': 1,
        'Profiles Successfully Scored': result.success ? 1 : 0,
        'Profile Scoring Tokens': result.tokensUsed || 0
      },
      options: { logger }
    });
    
    return result;
  } catch (error) {
    logger.error(`Error scoring lead ${leadId}: ${error.message}`);
    
    // Update metrics with failure
    await jobMetricsService.updateClientMetrics({
      runId,
      clientId,
      metrics: {
        'Leads Processed': 1,
        'Profiles Successfully Scored': 0
      },
      options: { logger }
    });
    
    throw error;
  }
}
```

## Supported Metrics

The service supports the following metrics out of the box:

| Metric | Field Name | Type | Aggregation |
|--------|------------|------|------------|
| Leads Processed | `Leads Processed` | number | sum |
| Posts Processed | `Posts Processed` | number | sum |
| Profiles Examined | `Profiles Examined for Scoring` | number | sum |
| Profiles Scored | `Profiles Successfully Scored` | number | sum |
| Posts Harvested | `Total Posts Harvested` | number | sum |
| Posts Examined | `Posts Examined for Scoring` | number | sum |
| Posts Scored | `Posts Successfully Scored` | number | sum |
| Profile Tokens | `Profile Scoring Tokens` | number | sum |
| Post Tokens | `Post Scoring Tokens` | number | sum |
| Total Tokens | `Total Tokens` | number | sum |
| Start Time | `Start Time` | datetime | min |
| End Time | `End Time` | datetime | max |
| Status | `Status` | string | last |

## Best Practices

1. **Early Initialization**: Initialize client run records at the beginning of processing
2. **Regular Updates**: Update metrics as processing progresses, not just at the end
3. **Error Handling**: Always complete metrics even when errors occur
4. **Client-Specific Loggers**: Use structured loggers with client context
5. **Consistent Timing**: Always include Start Time and End Time for duration calculations

## Common Issues and Solutions

### Missing Run Records

If a client run record is missing, the service will attempt to create it when metrics are updated. This handles cases where a client was added mid-job.

### Invalid Metric Values

Invalid metric values are automatically normalized according to their type definition. The service will log warnings when this happens, but processing will continue.

### Duplicate Run IDs

The service uses the Unified Run ID Service to standardize run IDs and prevent duplicates. If duplicate run IDs are detected, they will be properly handled.

## Implementation Roadmap

1. Replace direct Airtable calls in batchScorer.js with Job Metrics Service
2. Update singleScorer.js to use Job Metrics Service for consistent tracking
3. Implement Job Metrics Service in webhookHandlers.js for incoming data
4. Add Job Metrics Service support to Apify integrations

## Migration Guide

When migrating from direct Airtable updates to the Job Metrics Service:

1. Identify all places where metrics are currently being updated
2. Replace direct Airtable calls with appropriate Job Metrics Service functions
3. Update error handling to ensure metrics are always completed, even on failure
4. Add logging to track the migration progress

## Summary

The Job Metrics Service provides a robust foundation for accurate metrics tracking across the multi-tenant environment. By standardizing how metrics are validated, normalized, and aggregated, we can ensure consistent and reliable reporting for all clients.