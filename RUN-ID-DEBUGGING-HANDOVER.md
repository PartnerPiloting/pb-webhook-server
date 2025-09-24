# Run ID System Debugging Handover

## Current Issue Summary
We're experiencing consistent issues with duplicate client run records being created in the Airtable database. When the system processes multiple clients, it should:

1. Create a record for each client at the start of processing
2. Update those same records with metrics as processing continues
3. Mark them as "Completed" when done

However, we're seeing multiple records being created for each client with the same start time (8:55am) despite having different timestamps in their Run IDs:
- 250924-225535-Dean-Hobin
- 250924-225543-Dean-Hobin
- 250924-225543-Guy-Wilson
- 250924-225627-Guy-Wilson

## Work Completed

### Enhanced Debugging Implementation
We've added comprehensive debugging to identify exactly why the system is failing to find existing records:

1. **In `updateClientRun` function:**
   - Added three-tier search strategy with detailed logging:
     1. Search for RUNNING records by client ID
     2. Search for exact Run ID match
     3. Search for any records with this client ID as fallback
   - Added logging of all search parameters, queries, and results
   - Added full record field logging when records are found or created

2. **In `createClientRunRecord` function:**
   - Added timestamp extraction debugging
   - Added detailed logging of record creation parameters
   - Added logging of the exact Start Time being set

3. **In `normalizeRunId` function:**
   - Added step-by-step debugging of timestamp extraction logic
   - Added logging of regex tests and decision points
   - Added clear error messages for failure conditions

### Key Areas to Investigate

Based on our code analysis, we've identified several potential causes:

1. **Start Time Field Setting:** The system sets Start Time to `new Date().toISOString()` rather than extracting the timestamp from the Run ID
2. **Run ID Format Inconsistency:** The system may fail to correctly parse or match existing Run IDs
3. **Record Lookup Logic:** The `updateClientRun` function only checks for "Running" records, not records with specific Run IDs first
4. **Caching Issues:** The in-memory cache may not be preserving record IDs between operations

## Next Steps

When the enhanced debugging is deployed:

1. **Review Logs During Processing:**
   - Look for "SEARCH ATTEMPT" logs to see each search strategy
   - Check "SEARCH RESULTS" logs to see what was found/not found
   - Note "RECORD NOT FOUND" messages that trigger creation of new records
   - Pay attention to the extraction of timestamps from Run IDs

2. **Specific Data Points to Look For:**
   - Are the Run IDs being correctly normalized between operations?
   - Is the system finding existing records but not recognizing them?
   - Are there timing/race conditions between record creation and lookups?
   - Is the Start Time field being set differently than the timestamp in the Run ID?

3. **Likely Fixes to Consider:**
   - Change the Start Time field to use the timestamp from the Run ID
   - Update the search strategy to prioritize Run ID exact matches
   - Implement record deduplication based on client ID and start time
   - Ensure consistent timestamp handling throughout the codebase

## How to Use Enhanced Debugging

The new debug messages follow this pattern:

```
Airtable Service: SEARCH ATTEMPT 1 - Looking for RUNNING records
Airtable Service: Query: AND({Client ID} = 'Dean-Hobin', {Status} = 'Running')
...
Airtable Service: SEARCH RESULTS 1 - Found 0 records
...
Airtable Service: SEARCH ATTEMPT 2 - Looking for exact Run ID match 
Airtable Service: Query: AND({Run ID} = '250924-225535-Dean-Hobin', {Client ID} = 'Dean-Hobin')
...
```

Focus on any logs showing:
- "SEARCH FAILED" - These indicate lookup failures
- "CREATE DEBUG" - These show the details of new record creation
- "[runIdService] DEBUG" - These show Run ID parsing decisions

## Final Recommendations

Once we identify the exact failure point, the most likely solution will involve:

1. Updating `createClientRunRecord` to use the timestamp from the Run ID for the Start Time field
2. Modifying `updateClientRun` to prioritize exact Run ID matches before falling back to "Running" status
3. Ensuring consistent timestamp handling in the `normalizeRunId` function

The immediate priority is identifying the exact point of failure in the record lookup process to implement a targeted fix.