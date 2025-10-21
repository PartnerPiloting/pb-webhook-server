# Fix "You are not authorized" errors in apifyProcessRoutes.js

## Root Issue
Fixed similar authorization error in apifyProcessRoutes.js where the system was directly
querying the client base instead of using the improved checkRunRecordExists function.

## Changes
- Modified apifyProcessRoutes.js to use runRecordService.checkRunRecordExists instead of
  directly querying the Airtable base
- Added proper client base handling to ensure consistent record checking
- Preserved the original record fetching for metrics updates

## Impact
This fix resolves the remaining "You are not authorized to perform this operation" errors
in the [apify/process-client] logs. The system now consistently uses the right approach
for checking run record existence.