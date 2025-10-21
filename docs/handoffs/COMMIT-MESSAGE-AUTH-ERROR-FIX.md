# Fix "You are not authorized" errors in apifyWebhookRoutes.js

## Root Issue
Fixed critical bug in the run record lookup process where client records were being
searched in the master base rather than in each client's individual base.

## Changes
- Modified `checkRunRecordExists` in `runRecordAdapterSimple.js` to use 
  client-specific bases (via `getClientBase`) instead of the master base
- Simplified queries to remove unnecessary Client ID conditions
- Fixed syntax errors in error handling blocks

## Impact
This fix resolves the "You are not authorized to perform this operation" errors
that occurred during webhook processing. The system can now properly find run records
in client-specific bases and update metrics accordingly.

Closes #xxx (replace with relevant issue number if applicable)