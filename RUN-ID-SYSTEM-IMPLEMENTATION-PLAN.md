# Run ID System: History, Issues, and Implementation Plan

## Historical Context

### Original Implementation
The system was initially designed with a simple run ID system following a pattern like `SR-YYMMDD-NNN-TXXX-SY`. This worked fine for single-tenant operations where only one client's data was processed at a time.

### Multi-Tenant Adaptation
As the system evolved to support multiple clients simultaneously:
1. Client suffixes were added to run IDs (`-CCLIENTID`)
2. The logic was patched in various places to handle these suffixed IDs
3. Different modules implemented their own handling of client suffixes

### Problems Encountered
We've observed three major categories of issues:

1. **Lead Scoring Issues**:
   - Duplicate run records appeared in Airtable
   - Some updates to run metrics were lost
   - Run records were created but not properly updated

2. **Post Harvesting Issues**:
   - Double client suffixes appeared (`8MSTBAfqMzuXPvgB3-CGuy-Wilson-CGuy-Wilson`)
   - Post counts weren't properly attributed to the right run records
   - Multiple run records were created for the same processing job

3. **Potential Post Scoring Issues**:
   - Likely to encounter similar problems when implemented
   - Risk of ineffective metrics tracking
   - Potential for duplicate or orphaned records

### Current Patches
We've implemented several fixes:
1. Created `utils/runIdUtils.js` with helper functions
2. Added `recordCache.js` to prevent duplicate record creation
3. Improved the `addClientSuffix` function to prevent double suffixes
4. Updated `getBaseRunId` to better handle various formats

However, these are treating symptoms rather than addressing the core architecture issue.

## Core Problems

1. **Inconsistent Run ID Handling**: Different parts of the system manipulate run IDs in different ways
2. **String Manipulation Risks**: Direct string operations are error-prone
3. **No Central Authority**: There's no single source of truth for run ID operations
4. **Limited Tracking**: No comprehensive tracking of run ID to record ID mappings
5. **No Type Safety**: Run IDs are treated as simple strings without validation

## Proposed Solution: Run ID Service

### Core Components

#### 1. `services/runIdService.js` - Central Manager

```javascript
const runIdUtils = require('../utils/runIdUtils');
const { v4: uuidv4 } = require('uuid');

// In-memory cache for run records
const runRecordCache = {
  // runId-clientId -> { recordId, baseId, clientId, timestamp, metadata }
};

// Sequence counter for run IDs
let sequenceCounter = 1;

/**
 * Get the next sequence number for run IDs (with rollover at 1000)
 */
function getNextSequence() {
  const seq = sequenceCounter.toString().padStart(3, '0');
  sequenceCounter = (sequenceCounter % 999) + 1;
  return seq;
}

/**
 * Generate a new standardized run ID
 */
function generateRunId(clientId, taskId = null, stepId = null) {
  // Generate date part YYMMDD
  const now = new Date();
  const datePart = [
    now.getFullYear().toString().slice(2),
    (now.getMonth() + 1).toString().padStart(2, '0'),
    now.getDate().toString().padStart(2, '0')
  ].join('');
  
  // Generate sequence part
  const sequencePart = getNextSequence();
  
  // Assemble base ID
  let baseId = `SR-${datePart}-${sequencePart}`;
  if (taskId) baseId += `-T${taskId}`;
  if (stepId) baseId += `-S${stepId}`;
  
  // Add client suffix
  return normalizeRunId(baseId, clientId);
}

/**
 * Create a consistent run ID format for any input
 */
function normalizeRunId(runId, clientId) {
  if (!runId) return null;
  if (!clientId) return runId;
  
  const baseId = runIdUtils.getBaseRunId(runId);
  return `${baseId}-C${clientId}`;
}

/**
 * Register a run record mapping
 */
function registerRunRecord(runId, clientId, recordId, metadata = {}) {
  const normalizedId = normalizeRunId(runId, clientId);
  const key = `${normalizedId}-${clientId}`;
  
  runRecordCache[key] = {
    recordId,
    baseId: runIdUtils.getBaseRunId(normalizedId),
    clientId,
    timestamp: new Date().toISOString(),
    metadata
  };
  
  console.log(`[runIdService] Registered record ${recordId} for run ${normalizedId} (client ${clientId})`);
  return normalizedId;
}

/**
 * Get the record ID for a run
 */
function getRunRecordId(runId, clientId) {
  const normalizedId = normalizeRunId(runId, clientId);
  const key = `${normalizedId}-${clientId}`;
  
  if (runRecordCache[key]) {
    console.log(`[runIdService] Found cached record ${runRecordCache[key].recordId} for run ${normalizedId}`);
    return runRecordCache[key].recordId;
  }
  
  console.log(`[runIdService] No record found for run ${normalizedId}`);
  return null;
}

/**
 * Clear cache entries
 */
function clearCache(runId = null, clientId = null) {
  if (!runId && !clientId) {
    // Clear all
    Object.keys(runRecordCache).forEach(key => delete runRecordCache[key]);
    console.log('[runIdService] Cleared all run record cache entries');
    return;
  }
  
  if (runId && clientId) {
    // Clear specific entry
    const normalizedId = normalizeRunId(runId, clientId);
    const key = `${normalizedId}-${clientId}`;
    delete runRecordCache[key];
    console.log(`[runIdService] Cleared cache for run ${normalizedId} (client ${clientId})`);
    return;
  }
  
  // Clear by client
  if (clientId) {
    Object.keys(runRecordCache)
      .filter(key => key.endsWith(`-${clientId}`))
      .forEach(key => delete runRecordCache[key]);
    console.log(`[runIdService] Cleared all cache entries for client ${clientId}`);
  }
}

/**
 * Register an Apify run ID with our system
 */
function registerApifyRunId(apifyRunId, clientId) {
  return normalizeRunId(apifyRunId, clientId);
}

module.exports = {
  generateRunId,
  normalizeRunId,
  registerRunRecord,
  getRunRecordId,
  clearCache,
  registerApifyRunId
};
```

#### 2. Modified `services/airtableService.js`

Key changes needed:
- Replace direct run ID manipulation with calls to runIdService
- Update createClientRunRecord to use runIdService for consistent IDs
- Update updateClientRun to use runIdService for record lookup
- Update completeClientRun to use consistent IDs

#### 3. Modified `routes/apifyProcessRoutes.js` & `routes/apifyWebhookRoutes.js` 

Key changes needed:
- Use runIdService.normalizeRunId instead of direct string manipulation
- Use runIdService.registerApifyRunId when handling Apify run IDs
- Ensure consistent run ID format throughout the post harvesting flow

#### 4. Comprehensive Test Suite

Create tests that verify:
- Run ID normalization works for all formats
- Record lookup works correctly
- Cache behaves as expected
- All previous bugs are fixed

## Implementation Plan

### Phase 1: Core Service (Day 1)
1. Implement runIdService.js
2. Create tests for the service
3. Update recordCache.js to use runIdService

### Phase 2: Lead Scoring Integration (Day 1)
1. Update airtableService.js to use runIdService
2. Update batchScorer.js to use normalized run IDs
3. Test lead scoring flow end-to-end

### Phase 3: Post Harvesting Integration (Day 2)
1. Update apifyProcessRoutes.js to use runIdService
2. Update apifyWebhookRoutes.js to use normalized run IDs
3. Test post harvesting flow end-to-end

### Phase 4: Documentation & Cleanup (Day 2)
1. Add JSDoc comments to all functions
2. Create examples in the documentation
3. Update RUN-ID-ARCHITECTURE-PROPOSAL.md with implementation details

## Benefits

1. **Single Source of Truth**: One service manages all run ID operations
2. **Consistent IDs**: All run IDs follow the same format
3. **Reduced Bugs**: No more direct string manipulation
4. **Better Tracking**: Complete tracking of run ID to record mappings
5. **Future-Proof**: Easy to extend for new features

## Conclusion

This implementation addresses the core architectural issue rather than just treating symptoms. It will provide a robust foundation for all current and future features that rely on run IDs, significantly reducing the debugging time and effort required to maintain the system.

The changes are focused and minimize risk while providing significant benefits for stability and maintainability.

## Implementation Status

The implementation has been completed successfully. See `RUN-ID-IMPLEMENTATION-SUMMARY.md` for details on the implementation, key improvements, and next steps.