# Fix Run Record Duplication in Client Run Results Table

## Bug Description
Fixed a critical issue in the Client Run Results table where new records were being created during the update process instead of finding and updating existing ones. This caused multiple run records to appear in the "Running" state when they should have been updating a single record through the process lifecycle.

## Root Cause
In the `updateClientRun()` function, when it couldn't find a matching record using the standardized run ID, it would create a new record instead of reporting an error. This created multiple records for what should have been a single process run.

## Fix
- Modified `updateClientRun()` to throw an error when a record isn't found instead of creating a new one
- This makes the problem visible rather than silently creating multiple records

## Testing
- Verify that client operations properly reuse a single run record
- Confirm that only one record per client appears in the Client Run Results table
- Check that the record properly transitions from "Running" to "Completed"

This fix prevents further record duplication while maintaining backward compatibility with existing records.