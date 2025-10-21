# Run ID System Migration Plan

This document outlines the steps needed to migrate from the current dual run ID services to the new simplified `runIdSystem.js` service.

## Overview

We will take a "clean break" approach to this migration, meaning we will replace all usages of the old services at once rather than gradually migrating. This ensures a consistent implementation throughout the codebase.

## Steps

### 1. Create the New System

- [x] Create `services/runIdSystem.js` with all required functionality
- [x] Implement comprehensive unit tests in `tests/runIdSystem.test.js`

### 2. Identify All Usage Points

We need to find all places in the codebase that use the current run ID services:

```bash
# Find all imports of the old services
grep -r "require.*runIdService\|require.*unifiedRunIdService" --include="*.js" .

# Find all uses of key functions
grep -r "normalizeRunId\|generateRunId\|createClientRunId\|registerRunRecord" --include="*.js" .
```

### 3. Replace in Core Services

Replace usages in these critical services first:

- [ ] `services/apifyRunsService.js` (partial implementation complete)
- [ ] `services/jobTrackingService.js`
- [ ] `services/runRecordService.js`
- [ ] `batchScorer.js`
- [ ] `services/airtable/jobTrackingRepository.js`
- [ ] `services/airtable/runRecordRepository.js`

#### Key Function Mappings

| Old Function | New Function | Notes |
|-------------|--------------|-------|
| `generateRunId` | `generateRunId` | Direct replacement |
| `normalizeRunId` | Multiple functions | Logic flow needed (see apifyRunsService.js example) |
| `registerRunRecord` | `createJobTrackingRecord` | Different parameter order |
| `getRunRecordId` | `findJobTrackingRecord` | Returns record object instead of just ID |
| `stripClientSuffix` | `getBaseRunId` | Direct replacement |

### 4. Update API Endpoints

Replace usages in these API endpoints:

- [ ] `routes/apiAndJobRoutes.js`
- [ ] `routes/apifyWebhookRoutes.js`
- [ ] `routes/webhookHandlers.js`

### 5. Update Utility Functions

Replace usages in any utility functions:

- [ ] `utils/runIdUtils.js` (may need to be removed completely)
- [ ] `utils/parameterValidator.js` (for run ID validation)

### 6. Update Testing Scripts

Replace usages in testing and debugging scripts:

- [ ] `test-*.js` files that use run ID services
- [ ] `check-*.js` files that use run ID services

### 7. Remove Old Services

Once all references have been updated:

- [ ] Delete `services/runIdService.js`
- [ ] Delete `services/unifiedRunIdService.js`

### 8. Comprehensive Testing

- [ ] Run all unit tests
- [ ] Test each critical path in development environment
- [ ] Verify no "Job tracking record not found" errors
- [ ] Test API endpoints to ensure proper ID handling

## Implementation Guidelines

### 1. Replace Import Statements

```javascript
// Old:
const runIdService = require('./services/runIdService');
// or 
const unifiedRunIdService = require('./services/unifiedRunIdService');

// New:
const runIdSystem = require('./services/runIdSystem');
```

### 2. Replace Function Calls

#### Simple ID Generation

```javascript
// Old:
const runId = runIdService.generateRunId(clientId);

// New:
const baseRunId = runIdSystem.generateRunId();
const runId = runIdSystem.createClientRunId(baseRunId, clientId);
```

#### Run ID Normalization (Complex)

The old `normalizeRunId` function had complex behavior. Replace it with this decision flow:

```javascript
// Old:
const normalizedRunId = runIdService.normalizeRunId(runId, clientId);

// New:
let normalizedRunId;
if (runIdSystem.getClientId(runId) === clientId) {
    // Already has correct client ID
    normalizedRunId = runId;
} else if (runIdSystem.getClientId(runId)) {
    // Has a different client ID, extract base and add correct one
    const baseRunId = runIdSystem.getBaseRunId(runId);
    normalizedRunId = runIdSystem.createClientRunId(baseRunId, clientId);
} else {
    // No client ID, add it
    normalizedRunId = runIdSystem.createClientRunId(runId, clientId);
}
```

#### Job Record Operations

```javascript
// Old:
runIdService.registerRunRecord(runId, clientId, recordId);
const recordId = runIdService.getRunRecordId(runId, clientId);

// New:
const record = await runIdSystem.createJobTrackingRecord(runId, jobTrackingTable, { clientId });
const record = await runIdSystem.findJobTrackingRecord(runId, jobTrackingTable);
const recordId = record ? record.id : null;
```

## Timeline

1. Initial implementation: 1-2 days
2. Core services migration: 2-3 days
3. API endpoint updates: 1-2 days
4. Testing and validation: 2-3 days

Total estimated time: 1-2 weeks

## Risks and Mitigations

1. **Risk**: Job tracking records not found after migration
   **Mitigation**: Ensure consistent base run ID extraction in all lookups

2. **Risk**: Client-specific operations fail
   **Mitigation**: Test with multiple clients before deployment

3. **Risk**: Cache inconsistencies
   **Mitigation**: Add monitoring for cache hits/misses during initial deployment