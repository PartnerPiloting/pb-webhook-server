# Comprehensive Fix for Run Record Duplication

## Problem
Our system was creating duplicate run records in Airtable instead of finding and updating existing ones. This was causing:

1. Multiple "Running" records for the same client and run
2. Inconsistent run ID formats across related records
3. Fragmented metrics that weren't properly aggregated

## Root Cause
The issue had several components:

1. **Insufficient Airtable Searching**: When a service couldn't find a record in the cache, it immediately created a new one instead of searching Airtable first.

2. **ID Format Inconsistency**: Different parts of the system were generating run IDs in different formats:
   - Standard format: `SR-250924-001-T3304-S1-CDean-Hobin`
   - Random string format: `OYkC0ZbuWPOvwkLid-Dean-Hobin-Dean-Hobin`

3. **Client ID Prefix Inconsistency**: Some run IDs had a "C" prefix for client IDs while others didn't.

4. **Incomplete Cache Registration**: Found records weren't being registered with all possible ID formats.

## Comprehensive Solution
Our solution addresses all aspects of the issue:

1. **Thorough Airtable Searching**: Before creating a new record, we now search for any existing record using multiple possible ID formats.

2. **Multiple ID Format Support**: We check for all variations:
   - Original run ID
   - Normalized run ID
   - Base run ID without client suffix
   - Version with "C" prefix
   - Version with client name appended

3. **Improved Caching**: Found records are registered in the cache with both original and normalized IDs.

4. **Smart Record Selection**: When multiple records are found, we use the most recent one and log a warning.

## Expected Impact
1. No more duplicate records for the same run/client
2. More accurate metrics aggregation
3. Proper record updating instead of new record creation
4. Backward compatibility with existing records in various formats

## Implementation Details
The implementation uses a more robust search formula that checks for all possible run ID formats:

```javascript
// Build a list of all possible run ID formats to check
const possibleRunIds = [runId, normalizedRunId, baseRunId, `${baseRunId}-C${strippedClientId}`];
if (!runId.includes(clientId)) possibleRunIds.push(`${runId}-${clientId}`);

// Build OR formula for all possible run IDs
const formulaParts = uniqueRunIds.map(id => `{Run ID} = '${id}'`);
const formula = `AND(OR(${formulaParts.join(',')}), {Client ID} = '${clientId}')`;
```

This ensures we find any existing record regardless of which ID format was used to create it.