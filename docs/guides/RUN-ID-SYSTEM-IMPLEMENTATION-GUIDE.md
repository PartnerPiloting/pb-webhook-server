# Run ID System Refactoring Implementation Guide

This document provides a detailed guide for implementing the run ID system refactoring across the entire codebase. It shows specific examples of how to refactor each common pattern found in the existing code.

## Table of Contents
1. [Import Replacement](#import-replacement)
2. [Function Mapping](#function-mapping)
3. [Run ID Generation](#run-id-generation)
4. [Run ID Normalization](#run-id-normalization)
5. [Record Creation and Lookup](#record-creation-and-lookup)
6. [Client-Specific Operations](#client-specific-operations)
7. [Edge Cases and Special Patterns](#edge-cases-and-special-patterns)
8. [Testing](#testing)

## Import Replacement

Replace all imports of the old services with the new `runIdSystem` service.

### Before:
```javascript
const runIdService = require('./services/runIdService');
// or 
const unifiedRunIdService = require('./services/unifiedRunIdService');
// or
const runIdService = require('./runIdService');
```

### After:
```javascript
const runIdSystem = require('./services/runIdSystem');
```

## Function Mapping

This table maps old functions to their new equivalents:

| Old Function | New Function | Notes |
|--------------|--------------|-------|
| `generateRunId` | `generateRunId` | Direct replacement |
| `generateTimestampRunId` | `generateRunId` | Direct replacement |
| `normalizeRunId` | `getBaseRunId` | May need additional logic (see below) |
| `addClientSuffix` | `createClientRunId` | Direct replacement |
| `stripClientSuffix` | `getBaseRunId` | Direct replacement |
| `extractClientId` | `getClientId` | Direct replacement |
| `registerRunRecord` | `createJobTrackingRecord` | Different parameters |
| `getRunRecordId` | `findJobTrackingRecord` | Returns record object instead of just ID |
| `getCachedRecordId` | (n/a) | Caching is automatic in new system |
| `validateRunId` | `validateRunId` | Similar but with clearer errors |

## Run ID Generation

### Before:
```javascript
// With client ID embedded in call
const runId = runIdService.generateRunId(clientId);

// Or with a separate generation and client suffix
const baseId = unifiedRunIdService.generateTimestampRunId();
const clientRunId = unifiedRunIdService.addClientSuffix(baseId, clientId);
```

### After:
```javascript
// Generate a base ID first
const baseRunId = runIdSystem.generateRunId();

// Add client ID only when needed
const clientRunId = runIdSystem.createClientRunId(baseRunId, clientId);
```

## Run ID Normalization

The old `normalizeRunId` function had complex behavior that handled multiple cases. Replace it with this decision flow:

### Before:
```javascript
const normalizedRunId = runIdService.normalizeRunId(runId, clientId);
// or
const normalizedRunId = unifiedRunIdService.normalizeRunId(runId, clientId, source);
```

### After:
```javascript
// Simple case - just get the base run ID (no client ID needed)
const baseRunId = runIdSystem.getBaseRunId(runId);

// When client ID checking/adding is needed:
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

## Record Creation and Lookup

### Before:
```javascript
// Create a record mapping
runIdService.registerRunRecord(runId, clientId, recordId);

// Later, look up the record ID
const recordId = runIdService.getRunRecordId(runId, clientId);
```

### After:
```javascript
// Create a job tracking record
const jobRecord = await runIdSystem.createJobTrackingRecord(runId, jobTrackingTable, { 
  clientId, 
  status: 'pending',
  // other fields as needed
});

// Later, look up the record
const record = await runIdSystem.findJobTrackingRecord(runId, jobTrackingTable);
const recordId = record ? record.id : null;
```

## Client-Specific Operations

### Before:
```javascript
// Extract client ID from a run ID
const extractedClientId = runIdService.extractClientId(clientRunId);
// or
const extractedClientId = unifiedRunIdService.getClientIdFromClientRunId(clientRunId);

// Strip client suffix to get base run ID
const baseRunId = runIdService.stripClientSuffix(clientRunId);
// or
const baseRunId = unifiedRunIdService.getBaseRunIdFromClientRunId(clientRunId);
```

### After:
```javascript
// Extract client ID from a run ID
const extractedClientId = runIdSystem.getClientId(clientRunId);

// Get base run ID from a client run ID
const baseRunId = runIdSystem.getBaseRunId(clientRunId);
```

## Edge Cases and Special Patterns

### 1. Caching Record IDs

The new system handles caching internally. You don't need to explicitly cache or retrieve cached values.

#### Before:
```javascript
// Cache a record ID for later use
runIdService.cacheRecordId(runId, recordId);
// Later get the cached record ID
const cachedId = runIdService.getCachedRecordId(runId);
```

#### After:
```javascript
// The system automatically caches records when you create or find them
// Just use the regular find method - it will use cache when available
const record = await runIdSystem.findJobTrackingRecord(runId, jobTrackingTable);
```

### 2. Format Detection and Conversion

The new system eliminates the need for format detection and conversion. It handles run IDs of any supported format automatically.

#### Before:
```javascript
const format = runIdService.detectRunIdFormat(runId);
if (format) {
  const standardFormat = runIdService.convertToStandardFormat(runId);
  // Use standardFormat
}
```

#### After:
```javascript
// Simply use getBaseRunId which handles all format conversions automatically
const standardRunId = runIdSystem.getBaseRunId(runId);
```

### 3. Validation

The new system provides improved validation.

#### Before:
```javascript
try {
  runIdService.validateRunId(runId, 'functionName');
  // Run ID is valid
} catch (error) {
  // Handle invalid run ID
}
```

#### After:
```javascript
try {
  runIdSystem.validateRunId(runId);
  // Run ID is valid
} catch (error) {
  // Handle invalid run ID with clearer error messages
}
```

## Testing

After refactoring, use these testing patterns to verify everything works correctly:

1. **Generate and validate run IDs**:
```javascript
const runId = runIdSystem.generateRunId();
console.log(`Generated run ID: ${runId}`);
// Should output a timestamp-based ID in format YYMMDD-HHMMSS
```

2. **Create and test client-specific run IDs**:
```javascript
const baseRunId = runIdSystem.generateRunId();
const clientRunId = runIdSystem.createClientRunId(baseRunId, 'TestClient');
console.log(`Client run ID: ${clientRunId}`);
// Should output the base ID with client suffix: YYMMDD-HHMMSS-TestClient

// Test extraction
const extractedBaseId = runIdSystem.getBaseRunId(clientRunId);
const extractedClientId = runIdSystem.getClientId(clientRunId);
console.log(`Extracted base ID: ${extractedBaseId}`);
console.log(`Extracted client ID: ${extractedClientId}`);
// Should match original values
```

3. **Test record creation and lookup**:
```javascript
// Create a record
const runId = runIdSystem.generateRunId();
await runIdSystem.createJobTrackingRecord(runId, jobTrackingTable, { status: 'test' });

// Find it
const record = await runIdSystem.findJobTrackingRecord(runId, jobTrackingTable);
console.log(`Found record: ${record ? 'yes' : 'no'}`);
// Should output "yes"

// Test with client run ID (should still find the same record)
const clientRunId = runIdSystem.createClientRunId(runId, 'TestClient');
const recordViaClient = await runIdSystem.findJobTrackingRecord(clientRunId, jobTrackingTable);
console.log(`Found record via client run ID: ${recordViaClient ? 'yes' : 'no'}`);
// Should output "yes"
```

## Common Refactoring Pitfalls

1. **Forgetting parameter order changes**: The new API may have different parameter orders in some functions.

2. **Missing client ID logic**: Some places might assume client ID manipulation that now needs to be explicit.

3. **Assuming return values**: The new system returns different values in some cases (e.g., record objects instead of just IDs).

4. **Not updating all occurrences**: Make sure to update all imports and function calls, including in test files.

5. **Missing database table parameters**: The new API requires explicit table parameters for record operations.

## Conclusion

Following this guide will help ensure a smooth transition to the new run ID system. Remember to test thoroughly after each change to catch any issues early.

After all refactoring is complete, don't forget to delete the old `runIdService.js` and `unifiedRunIdService.js` files to prevent anyone from accidentally using them in the future.