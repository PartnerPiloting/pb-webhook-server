# Job Metrics Service Integration Plan

This document outlines the plan for integrating the new Job Metrics Service throughout the codebase, replacing direct Airtable access with a more robust and consistent metrics tracking system.

## Status Value Standardization

### Allowed Status Values
The following are the **ONLY** valid status values to be used:

1. `Running` - Process is actively running
2. `Completed` - Process completed successfully (even with some errors)
3. `Failed` - Process encountered critical errors and could not complete
4. `No Leads To Score` - Process found no data to process

### Status Value Mapping

| Original Status | Standardized Status | Notes |
|-----------------|---------------------|-------|
| `Running` | `Running` | No change |
| `Success` | `Completed` | Changed to standard term |
| `Completed` | `Completed` | No change |
| `Completed with errors` | `Completed` | Use System Notes for error details |
| `Error` | `Failed` | Changed to standard term |
| `Failed` | `Failed` | No change |
| `No leads to process` | `No Leads To Score` | Changed to standard term |
| `Skipped` | `No Leads To Score` | Changed to standard term |

## Implementation Phases

### Phase 1: Core Batch Processing Integration

1. **Update `batchScorer.js`**
   - Replace direct Airtable calls for metrics tracking
   - Add proper error handling with metrics completion
   - Ensure consistent run ID usage throughout

2. **Update `singleScorer.js`**
   - Replace direct metrics tracking
   - Add metrics for individual lead scoring
   - Ensure token usage is properly tracked

### Phase 2: Webhook and API Integration

3. **Update `routes/webhookHandlers.js`**
   - Add metrics tracking for incoming webhook data
   - Track profile updates and incoming leads

4. **Update `routes/apiAndJobRoutes.js`**
   - Add metrics tracking for API-initiated scoring
   - Ensure consistent run ID generation for API requests

### Phase 3: Apify and External Integration

5. **Update `routes/apifyWebhookRoutes.js`**
   - Add metrics tracking for Apify post harvesting
   - Track post counts and processing status

6. **Update background jobs**
   - Add metrics tracking for scheduled jobs
   - Ensure consistent run ID usage for periodic tasks

## Code Changes Required

### In `batchScorer.js`

```javascript
// Replace:
await trackingBase('Client Run Results').create({
  'Client Name': client.name,
  'Run ID': runId,
  'Leads Processed': processedCount,
  // ...other fields
});

// With:
await jobMetricsService.updateClientMetrics({
  runId,
  clientId: client.id,
  metrics: {
    'Leads Processed': processedCount,
    // ...other fields
  },
  options: { logger }
});

// And at the end of processing:
await jobMetricsService.completeClientMetrics({
  runId,
  clientId: client.id,
  metrics: finalMetrics,
  success: !hasErrors,
  options: { logger }
});

// After all clients are processed:
await jobMetricsService.completeJobMetrics({
  runId,
  success: overallSuccess,
  notes: `Batch scoring completed for ${clientIds.length} clients`,
  options: { logger: systemLogger }
});
```

### In `singleScorer.js`

```javascript
// Add metrics tracking for single lead scoring:
const initialMetrics = {
  'Leads Processed': 1,
  'Profiles Examined for Scoring': 1,
  'Start Time': new Date().toISOString()
};

await jobMetricsService.updateClientMetrics({
  runId,
  clientId,
  metrics: initialMetrics,
  options: { logger }
});

// After scoring:
const finalMetrics = {
  'Profiles Successfully Scored': result.success ? 1 : 0,
  'Profile Scoring Tokens': result.tokenUsage || 0
};

await jobMetricsService.updateClientMetrics({
  runId,
  clientId,
  metrics: finalMetrics,
  options: { logger }
});
```

### In `routes/apiAndJobRoutes.js`

```javascript
// Generate run ID for API-initiated requests:
const runId = unifiedRunIdService.generateRunId();

// Initialize job tracking:
await unifiedJobTrackingRepository.createJobTrackingRecord({
  runId,
  jobType: 'api_request',
  status: 'In Progress',
  initialData: { 
    'Endpoint': req.path,
    'Client ID': clientId
  }
});

// Track metrics from API calls:
await jobMetricsService.updateClientMetrics({
  runId,
  clientId,
  metrics: resultMetrics,
  options: { logger }
});

// Complete API job:
await jobMetricsService.completeJobMetrics({
  runId,
  success: true,
  notes: 'API request completed successfully',
  options: { logger }
});
```

## Testing Strategy

1. **Unit Testing**
   - Test each integration point with mock data
   - Verify metrics are properly validated and normalized

2. **Integration Testing**
   - Test full job flows with multiple clients
   - Verify metrics aggregation works correctly

3. **Error Recovery Testing**
   - Introduce failures and verify metrics are still completed
   - Test recovery from missing records and other edge cases

4. **Status Value Testing**
   - Verify all status values are standardized
   - Check that mappings work correctly

## Verification Process

1. Run the status consistency verification script:
   ```bash
   node scripts/verify-status-consistency.js
   ```

2. Run the job metrics test script:
   ```bash
   node test-job-metrics.js
   ```

3. Check production logs for any status-related errors:
   ```bash
   node check-today-logs.js | grep -i "status"
   ```

## Rollout Plan

1. **Development Environment**
   - Implement changes in a feature branch
   - Run unit and integration tests

2. **Staging Environment**
   - Deploy to staging and verify with real data
   - Monitor for any issues or performance impacts

3. **Production Environment**
   - Gradual rollout, starting with lowest-impact integrations
   - Monitor closely and be ready to roll back if issues arise

## Success Metrics

1. **Consistency**: No mismatched or missing metrics between related tables
2. **Reliability**: No failed jobs without proper metrics recording
3. **Performance**: No significant increase in job processing time
4. **Data Quality**: Improved accuracy of aggregated metrics

## Follow-up Tasks

1. Create a dashboard for viewing job metrics
2. Implement alerts based on metrics thresholds
3. Add additional metrics as needed for specific client requirements

## Resources Required

1. Developer time: Estimated 3-5 days for full implementation
2. Testing time: 1-2 days for comprehensive testing
3. Monitoring: Set up specific alerts for the transition period

## Conclusion

By systematically replacing direct Airtable access with the Job Metrics Service, we will achieve more consistent, reliable, and robust metrics tracking throughout the system. This will improve the accuracy of client reporting and provide better visibility into system performance.