# Unified Job Tracking System

This document provides an overview of the unified job tracking system implemented to standardize run ID handling, job tracking operations, error recovery, and metrics aggregation.

## Key Components

The unified job tracking system consists of four main components:

1. **Unified Run ID Service** (`services/unifiedRunIdService.js`)
   - Standardizes run ID formats
   - Provides validation and conversion functions
   - Generates new run IDs in standard format

2. **Unified Job Tracking Repository** (`services/unifiedJobTrackingRepository.js`)
   - Centralizes all job tracking database operations
   - Provides consistent CRUD operations for job records
   - Handles relationships between job tracking and client run records

3. **Job Tracking Error Handling** (`services/jobTrackingErrorHandling.js`)
   - Standardizes error handling for job tracking operations
   - Provides recovery strategies for common error scenarios
   - Ensures consistent logging of errors

4. **Job Metrics Service** (`services/jobMetricsService.js`)
   - Validates and normalizes metrics data
   - Aggregates metrics from multiple client records
   - Ensures consistent metrics tracking across the system

## Standardized Status Values

The system uses four standardized status values throughout all components:

- **Running**: Process is currently executing
- **Completed**: Process completed successfully (even with partial errors)
- **Failed**: Process encountered critical errors and couldn't complete
- **No Leads To Score**: Process found no data to process

## Key Features

1. **Standardized Run IDs**: All run IDs use the `YYMMDD-HHMMSS` format (e.g., `250930-141522`)
2. **Format Conversion**: Legacy formats are automatically converted to standard format
3. **Client Prefixing**: Support for client-specific run IDs with standard prefixing
4. **Metric Validation**: All metrics are validated against defined schemas
5. **Error Recovery**: Standard patterns for handling common error scenarios
6. **Robust Aggregation**: Smart aggregation of metrics across client records

## Implementation Testing

1. Run the verification script:
   ```
   node scripts/verify-status-consistency.js
   ```

2. Run the metrics test script:
   ```
   node test-job-metrics.js
   ```

## Integration

See the complete integration plan in `docs/JOB-METRICS-INTEGRATION-PLAN.md`.