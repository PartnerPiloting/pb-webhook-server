# Run ID System Refactoring Handover

## Project Overview

We're refactoring the run ID system in the PB webhook server to simplify the business logic and provide a single source of truth for all run ID operations. The refactoring follows a "clean break" approach, replacing two competing implementations (`runIdService.js` and `unifiedRunIdService.js`) with a new unified `runIdSystem.js`.

## Current State

### Completed Work

1. **Created the new implementation**:
   - Implemented `runIdSystem.js` with all core functionality
   - Added comprehensive tests
   - Implemented client run record management functions

2. **Updated core service files**:
   - `jobTracking.js`: Replaced all instances of `validateRunId` and `normalizeRunId`
   - `apiAndJobRoutes.js`: Updated import and all method calls
   - `apifyRunsService.js`: Already used the new system
   - `jobMetricsService.js`: Updated import and `convertToStandardFormat` usage
   - `leadService.js`: Updated import (no direct method usages)
   - `jobOrchestrationService.js`: Updated import and `generateTimestampRunId` usage
   - `airtableServiceSimple.js`: Updated import and `convertToStandardFormat` usage
   - `airtableService.js`: Updated all references to run ID services including:
     - Import statements
     - `normalizeRunId` → `validateAndStandardizeRunId`
     - `getRunRecordId` → `getRunRecordId` (new implementation)
     - `registerRunRecord` → `registerRunRecord` (new implementation)
   - `recordCache.js`: Updated to use the new system

### Work In Progress

Currently working on updating `jobTrackingErrorHandling.js` to use the new system.

### Pending Work

1. **Continue refactoring core service files**:
   - Complete updates to `jobTrackingErrorHandling.js`
   - Check `runRecordAdapter.js` (not `runRecordAdapterSimple.js`)
   - Check `runRecordServiceV2.js`
   - Check `unifiedJobTrackingRepository.js`

2. **Refactor API routes and controllers**:
   - Update any remaining API routes that handle run IDs

3. **Refactor utility functions and helpers**:
   - Check and update `utils/runIdGenerator.js`
   - Check and update `utils/paramValidator.js`

4. **Create tests to verify refactoring**:
   - Develop comprehensive tests for the new system
   - Ensure all edge cases are covered

5. **Remove old run ID services**:
   - Delete `services/runIdService.js` and `services/unifiedRunIdService.js` once all references are updated

## Technical Details

### New API Reference

The new `runIdSystem.js` provides the following functions:

#### Core ID Generation and Manipulation
- `generateRunId()`: Creates a new timestamp-based run ID (YYMMDD-HHMMSS)
- `createClientRunId(baseRunId, clientId)`: Creates a client-specific run ID
- `getBaseRunId(clientRunId)`: Extracts the base run ID from a client run ID
- `getClientId(clientRunId)`: Extracts the client ID from a client run ID
- `validateRunId(runId)`: Validates a run ID format
- `validateAndStandardizeRunId(runId)`: Validates and normalizes run ID formats

#### Job Tracking Record Operations
- `createJobTrackingRecord(runId, jobTrackingTable, data)`: Creates a new job tracking record
- `findJobTrackingRecord(runId, jobTrackingTable)`: Finds a job tracking record
- `updateJobTrackingRecord(runId, jobTrackingTable, data)`: Updates a job tracking record

#### Client Run Record Operations
- `getRunRecordId(runId, clientId)`: Gets a cached client run record ID
- `registerRunRecord(runId, clientId, recordId)`: Registers a client run record ID

#### Cache Management
- `clearCache(runId)`: Clears cached record IDs

### Refactoring Patterns

When updating files, follow these patterns:

1. **Import statements**:
   ```javascript
   // Before
   const runIdService = require('./unifiedRunIdService');
   // After
   const runIdSystem = require('./runIdSystem');
   ```

2. **Run ID generation**:
   ```javascript
   // Before
   const runId = unifiedRunIdService.generateTimestampRunId();
   // After
   const runId = runIdSystem.generateRunId();
   ```

3. **Client run ID creation**:
   ```javascript
   // Before
   const clientRunId = unifiedRunIdService.addClientSuffix(baseRunId, clientId);
   // After
   const clientRunId = runIdSystem.createClientRunId(baseRunId, clientId);
   ```

4. **Run ID normalization**:
   ```javascript
   // Before
   const standardRunId = unifiedRunIdService.normalizeRunId(runId, source);
   // After
   const standardRunId = runIdSystem.validateAndStandardizeRunId(runId);
   ```

5. **Base run ID extraction**:
   ```javascript
   // Before
   const baseRunId = unifiedRunIdService.getBaseRunIdFromClientRunId(clientRunId);
   // After
   const baseRunId = runIdSystem.getBaseRunId(clientRunId);
   ```

6. **Client run record operations**:
   ```javascript
   // Before
   const recordId = runIdService.getRunRecordId(runId, clientId);
   runIdService.registerRunRecord(runId, clientId, recordId);
   // After
   const recordId = runIdSystem.getRunRecordId(runId, clientId);
   runIdSystem.registerRunRecord(runId, clientId, recordId);
   ```

### Testing Considerations

The new system should be thoroughly tested to ensure:
- Run IDs are correctly generated in the standard format
- Client run IDs are properly created and parsed
- Job tracking records are correctly created and found
- Client run record IDs are properly cached and retrieved

## Next Steps

1. Continue the refactoring of remaining files
2. Implement comprehensive tests
3. Verify the system works correctly with integration tests
4. Remove the old services once all references are updated

## References

- `RUN-ID-SYSTEM-REFACTORING.md`: Original requirements document
- `RUN-ID-SYSTEM-IMPLEMENTATION-GUIDE.md`: Detailed implementation guide
- `RUN-ID-SYSTEM-MIGRATION-PLAN.md`: Migration plan for the refactoring
- `services/runIdSystem.js`: New implementation
- `tests/runIdSystem.test.js`: Tests for the new system