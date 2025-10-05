# Run ID Propagation Fix - October 5, 2025

## Problem Summary

The system was creating Job Tracking records with one Run ID, but then trying to update them using a different Run ID, causing "Job tracking record not found" errors.

### Root Cause

The parent Run ID from the smart-resume script was **not being passed** to the individual client processing endpoints (lead_scoring, post_scoring, post_harvesting). Each endpoint was generating its own new Run ID instead of using the parent's Run ID.

### Example of the Problem

1. Smart-resume creates Job Tracking record with Run ID: `251005-061843`
2. Smart-resume triggers lead scoring for client "Guy-Wilson"
3. Lead scoring endpoint generates a NEW Run ID: `251005-061846` (different timestamp)
4. System tries to update Job Tracking record using `251005-061846`
5. Error: "Job tracking record not found for 251005-061846" (because it was created with `251005-061843`)

## The Fix

### Changes Made

1. **smart-resume-client-by-client.js** - Updated to pass `runId` parameter when calling operations:
   - Added `runId: normalizedRunId` to operation parameters
   - This ensures the parent Run ID is available for all downstream processes

2. **triggerOperation function** - Updated to include parentRunId in API calls:
   - Lead scoring: Added `&parentRunId=${params.runId}` to GET request URL
   - Post harvesting: Added `&parentRunId=${params.runId}` to POST request URL
   - Post scoring: Added `parentRunId: params.runId` to POST request body

3. **Existing endpoints** - Already properly configured:
   - `/run-batch-score-v2` - Already extracts and uses `parentRunId` from query parameters
   - `/run-post-batch-score-v2` - Already extracts and uses `parentRunId` from body/query

### How It Works Now

1. Smart-resume generates Run ID: `251005-061843`
2. Creates Job Tracking record with Run ID: `251005-061843`
3. Triggers lead scoring with `parentRunId=251005-061843`
4. Lead scoring endpoint uses the parentRunId instead of generating a new one
5. All Client Run Results records created with Run ID: `251005-061843-ClientName`
6. Final Job Tracking update searches for `251005-061843` ✓ Found!

## Testing

To test this fix:

1. Trigger a smart-resume run:
   ```
   curl -X GET "https://pb-webhook-server-staging.onrender.com/smart-resume-client-by-client?stream=1&secret=YOUR_SECRET"
   ```

2. Check the logs for:
   - Initial Run ID creation (e.g., `251005-061843`)
   - "Using parent run ID as-is" messages showing the same Run ID is being reused
   - No more "Job tracking record not found" errors

3. Verify in Airtable:
   - Job Tracking table has one record with the Run ID
   - Client Run Results table has records with `RunID-ClientName` format
   - All records use the same base Run ID

## Benefits

- **Consistent tracking**: All records in a single run use the same base Run ID
- **No duplicate records**: Prevents creation of orphaned Job Tracking records
- **Proper updates**: Updates find the correct records every time
- **Clear audit trail**: Easy to trace all client results back to the parent job

## Files Modified

- `scripts/smart-resume-client-by-client.js` - Pass Run ID to operations
- Committed with message: "fix: pass parent Run ID through smart-resume chain to prevent tracking record mismatches"

## Related Issues Fixed

This fix addresses:
- "Job tracking record not found" errors
- "Cannot read properties of undefined (reading 'toLowerCase')" errors (from previous fix)
- Orphaned or missing tracking records
- Inconsistent Run ID usage across the system
