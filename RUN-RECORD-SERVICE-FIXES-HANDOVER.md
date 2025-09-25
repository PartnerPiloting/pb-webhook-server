# Handover Document: Run Record Service Fixes

## Issues Addressed
During this session, we fixed two critical issues with the Run Record Service:

1. **Duplicate Client Run Records**
2. **Missing Run IDs in Job Tracking Table**

## System Overview
The application uses a multi-tenant architecture with a centralized run tracking system that monitors job execution and client-specific operations:

- **Job Tracking Table**: Records high-level runs with metrics across all clients
- **Client Run Results Table**: Records client-specific runs with client-specific metrics
- **Run Record Service**: Centralized service implementing the Single Creation Point pattern

## Issue 1: Duplicate Client Run Records

### Problem
Multiple client run records were being created with the same timestamp but different run IDs, all stuck in "Running" status.

### Root Cause
- Inconsistent run ID normalization across the system
- Insufficient duplicate detection that only checked for exact run ID matches
- No check for runs with the same base timestamp

### Solution
1. Enhanced the duplicate detection in `createClientRunRecord` to check:
   - Records in the in-memory registry
   - Records with matching base run ID (timestamp portion)
   - Records with exact run ID match

2. Implementation Details:
```javascript
// Check for existing record in the registry
const registryKey = `${standardRunId}:${clientId}`;
if (runRecordRegistry.has(registryKey)) {
  throw new Error(`Client run record already exists in registry...`);
}

// Look up by base run ID first (without client suffix)
const baseRunId = runIdService.stripClientSuffix(standardRunId);
const baseIdQuery = `AND(FIND('${baseRunId}', {Run ID}) > 0, {Client ID} = '${clientId}')`;

const baseMatches = await base(CLIENT_RUN_RESULTS_TABLE).select({
  filterByFormula: baseIdQuery,
  maxRecords: 10 // Check more records to catch all variants
}).firstPage();

if (baseMatches && baseMatches.length > 0) {
  // Found records with matching base ID and client
  const existingRecord = baseMatches[0];
  // Register this record to prevent future duplication attempts
  runIdService.registerRunRecord(existingId, clientId, existingRecord.id);
  runRecordRegistry.set(registryKey, existingRecord);
  
  throw new Error(`Client run record already exists for this timestamp...`);
}
```

## Issue 2: Missing Run IDs in Job Tracking Table

### Problem
Some records in the Job Tracking table were being created without Run IDs, making it difficult to correlate job records with client run records.

### Root Cause
- The `getBaseRunId` function in runIdUtils was returning an empty string for non-standard formats
- The `createJobTrackingRecord` function wasn't validating or repairing malformed run IDs
- The `stripClientSuffix` function in runIdService wasn't handling edge cases properly

### Solution

1. Enhanced runIdUtils.js:
```javascript
function getBaseRunId(runId) {
  if (!runId) return '';
  
  // Check for null, undefined, or other non-string values
  if (typeof runId !== 'string') {
    console.error(`[runIdUtils] ERROR: Non-string runId provided to getBaseRunId: ${runId}`);
    return '';
  }
  
  // First try our standard format
  const match = runId.match(TIMESTAMP_RUN_ID_REGEX);
  if (match) {
    return match[1]; // Return just the timestamp part (YYMMDD-HHMMSS)
  }
  
  // If not in our standard format, check if it's already a base ID (YYMMDD-HHMMSS)
  if (/^\d{6}-\d{6}$/.test(runId)) {
    return runId; // It's already in base format
  }
  
  // If it's not our format, log a warning but return the original runId to prevent data loss
  console.warn(`[runIdUtils] WARNING: Encountered non-standard run ID format: ${runId}`);
  return runId;
}
```

2. Improved airtableService.js:
```javascript
async function createJobTrackingRecord(runId, stream) {
  // Handle null or invalid run ID
  if (!runId) {
    console.error(`Airtable Service ERROR: Attempting to create job tracking with invalid runId: ${runId}`);
    // Generate a valid runId if none provided
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(2, 14);
    runId = `${timestamp.substring(0, 6)}-${timestamp.substring(6, 12)}`;
  }
  
  // Strip client suffix from runId to get the base run ID for tracking
  let baseRunId = runIdUtils.stripClientSuffix(runId);
  
  // Format check - ensure baseRunId matches expected pattern
  const runIdPattern = /^(\d{6}-\d{6})$/;
  if (!runIdPattern.test(baseRunId)) {
    // Try to repair the format if possible
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(2, 14);
    baseRunId = `${timestamp.substring(0, 6)}-${timestamp.substring(6, 12)}`;
  }
  
  // Create record with proper Run ID
  const records = await base(JOB_TRACKING_TABLE).create([
    {
      fields: {
        'Run ID': baseRunId, // Use the base run ID without client suffix
        // ...other fields...
      }
    }
  ]);
}
```

3. Updated runIdService.js:
```javascript
function stripClientSuffix(runId) {
  if (!runId || typeof runId !== 'string') {
    console.error(`[runIdService] ERROR: Invalid runId provided to stripClientSuffix: ${runId}`);
    return runId;
  }
  
  // Use the runIdUtils implementation which is more robust
  const utils = require('../utils/runIdUtils');
  const baseRunId = utils.stripClientSuffix(runId);
  
  // If the baseRunId is empty but runId isn't, something went wrong
  // Return the original to prevent data loss
  if (!baseRunId && runId) {
    console.error(`[runIdService] WARNING: stripClientSuffix failed for ${runId}, returning original`);
    return runId;
  }
  
  return baseRunId;
}
```

## System Architecture

The run record management system consists of the following components:

1. **runRecordServiceV2.js**: Core service implementing the Single Creation Point pattern
   - Contains functions for creating and managing job and client run records
   - Maintains the in-memory registry of active records
   - Implements duplicate detection and prevention

2. **runRecordAdapter.js**: Adapter that maps the old interface to the new V2 service
   - Used by API endpoints and older code that expects the original interface
   - Applies additional validation and access control

3. **runIdService.js**: Service for managing run IDs
   - Normalizes run IDs to a standard format
   - Strips client suffixes for consistent comparison
   - Caches record mappings to improve performance

4. **runIdUtils.js**: Utility functions for run ID manipulation
   - Pattern matching for run ID formats
   - Base run ID extraction
   - Client suffix management

5. **airtableService.js**: Legacy service for Airtable operations
   - Still used by some parts of the system for direct table access
   - Contains the createJobTrackingRecord function used by batch processes

## Run ID Format

The system uses a standardized run ID format:
- **Base Run ID**: `YYMMDD-HHMMSS` (e.g., `250926-124530`)
- **Client-specific Run ID**: `YYMMDD-HHMMSS-ClientID` (e.g., `250926-124530-Dean-Hobin`)

For consistent operation:
1. Job Tracking records should always use the Base Run ID
2. Client Run Records should use the Client-specific Run ID
3. The system should normalize between formats as needed

## Key Components Modified

1. **services/runRecordServiceV2.js**:
   - Enhanced duplicate detection in `createClientRunRecord`
   - Fixed Job Record creation to ensure proper Run ID format
   - Improved error handling for invalid run IDs

2. **services/runIdService.js**:
   - Added robust `stripClientSuffix` function
   - Improved run ID normalization

3. **utils/runIdUtils.js**:
   - Enhanced `getBaseRunId` to handle edge cases
   - Updated to preserve original IDs when format is unknown

4. **services/airtableService.js**:
   - Added validation in `createJobTrackingRecord`
   - Implemented format repair for malformed run IDs

## Testing and Validation

To validate the fixes:
1. Monitor the Client Run Results table for duplicate records
2. Check Job Tracking records to ensure they all have Run IDs
3. Test with unusual run ID formats to ensure graceful handling
4. Check log output for any warnings about malformed run IDs

## Future Improvements

1. **Full Deprecation of airtableService**: Move all run record operations to the runRecordService
2. **Enhanced Logging**: Add more detailed logs for run ID operations
3. **Run ID Format Validation**: Add client-side validation before submission
4. **Automated Testing**: Create test cases for various run ID scenarios
5. **Migration Script**: Clean up any existing records with missing Run IDs

## Commit History

1. "Fix Run Record duplicate records and missing Run IDs"
   - Enhanced duplicate detection in createClientRunRecord
   - Added stripClientSuffix function to runIdService.js
   - Fixed Job Record creation to properly set Run ID field
   - Updated adapter to normalize run IDs consistently

2. "Fix missing Run IDs in Job Tracking table"
   - Enhanced runIdUtils to better handle non-standard Run ID formats
   - Improved airtableService.createJobTrackingRecord to always generate valid Run IDs
   - Updated runIdService to use more robust runIdUtils implementation