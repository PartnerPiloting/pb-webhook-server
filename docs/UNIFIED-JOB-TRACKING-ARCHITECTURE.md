# Unified Job Tracking Architecture

This document provides an overview of the unified job tracking architecture implemented to standardize run ID handling, job tracking operations, error recovery, and metrics aggregation.

## Components

The unified job tracking architecture consists of four main components:

1. **Unified Run ID Service**
   - Standardizes run ID formats
   - Provides validation and conversion functions
   - Generates new run IDs in standard format

2. **Unified Job Tracking Repository**
   - Centralizes all job tracking database operations
   - Provides consistent CRUD operations for job records
   - Handles relationships between job tracking and client run records

3. **Job Tracking Error Handling**
   - Standardizes error handling for job tracking operations
   - Provides recovery strategies for common error scenarios
   - Ensures consistent logging of errors

4. **Job Metrics Service**
   - Validates and normalizes metrics data
   - Aggregates metrics from multiple client records
   - Ensures consistent metrics tracking across the system

## Architecture Diagram

```
┌─────────────────────┐     ┌─────────────────────┐
│                     │     │                     │
│   API Endpoints     │     │   Batch Processes   │
│                     │     │                     │
└────────┬────────────┘     └─────────┬───────────┘
         │                            │
         │                            │
         ▼                            ▼
┌─────────────────────────────────────────────────┐
│                                                 │
│            Unified Run ID Service               │
│                                                 │
└───────────────────────┬─────────────────────────┘
                        │
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│                                                 │
│         Unified Job Tracking Repository         │
│                                                 │
└───────────────────────┬─────────────────────────┘
                        │
         ┌──────────────┴──────────────┐
         │                             │
         ▼                             ▼
┌─────────────────────┐     ┌─────────────────────┐
│                     │     │                     │
│ Job Tracking Error  │     │  Job Metrics        │
│ Handling            │     │  Service            │
│                     │     │                     │
└─────────────────────┘     └─────────────────────┘
```

## Key Features

### Run ID Standardization

- All run IDs standardized to `YYMMDD-HHMMSS` format
- Support for legacy formats with automatic detection and conversion
- Optional client suffixes handled consistently

### Centralized Job Tracking

- Single repository for all job tracking operations
- Consistent error handling and recovery strategies
- Enforced relationships between related records

### Metrics Aggregation

- Validation and normalization of metrics data
- Smart aggregation based on metric type (sum, min, max, last)
- Consistent tracking of client-specific and job-level metrics

### Error Recovery

- Standardized approach to error handling
- Recovery strategies for common failure scenarios
- Consistent logging and reporting of errors

## Implementation Details

### Unified Run ID Service

```javascript
// Generate a new run ID
const runId = unifiedRunIdService.generateRunId();

// Convert a legacy format to standard format
const standardRunId = unifiedRunIdService.convertToStandardFormat(legacyId);

// Check if a run ID is valid
const isValid = unifiedRunIdService.isValidRunId(runId);
```

### Unified Job Tracking Repository

```javascript
// Create a new job tracking record
await unifiedJobTrackingRepository.createJobTrackingRecord({
  runId,
  jobType: 'batch_scoring',
  status: 'In Progress'
});

// Update a job tracking record
await unifiedJobTrackingRepository.updateJobTrackingRecord({
  runId,
  updates: { status: 'Completed' }
});

// Create a client run record
await unifiedJobTrackingRepository.createClientRunRecord({
  runId,
  clientId,
  initialData: { status: 'In Progress' }
});
```

### Job Metrics Service

```javascript
// Update client metrics
await jobMetricsService.updateClientMetrics({
  runId,
  clientId,
  metrics: {
    'Leads Processed': 10,
    'Profiles Successfully Scored': 8
  }
});

// Complete client metrics
await jobMetricsService.completeClientMetrics({
  runId,
  clientId,
  metrics: finalMetrics,
  success: true
});

// Update job aggregate metrics
await jobMetricsService.updateJobAggregateMetrics({ runId });

// Complete job metrics
await jobMetricsService.completeJobMetrics({
  runId,
  success: true,
  notes: 'Job completed successfully'
});
```

## Integration

For detailed integration instructions, see:

- [Job Metrics Implementation Guide](./JOB-METRICS-IMPLEMENTATION-GUIDE.md)
- [Job Metrics Integration Plan](./JOB-METRICS-INTEGRATION-PLAN.md)

## Benefits

1. **Consistency**: Standardized approach to job tracking across the system
2. **Reliability**: Robust error handling and recovery strategies
3. **Maintainability**: Centralized code for common operations
4. **Visibility**: Improved metrics tracking and reporting
5. **Scalability**: Better support for multi-tenant operations

## Future Enhancements

1. Real-time metrics dashboard
2. Advanced error recovery strategies
3. Predictive job failure detection
4. Enhanced performance monitoring