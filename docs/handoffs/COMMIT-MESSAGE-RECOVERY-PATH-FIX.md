# Fix run record creation failures with client name fallback

## Issue
Run records were failing to be created because of missing clientName values in recovery paths. The error "clientName is not defined" would occur when trying to recover from a missing run record scenario.

## Changes Made
1. Added 'run_record_recovery' to the allowedSources array in createClientRunRecord
2. Enhanced updateRunRecord function in runRecordServiceV2.js to include recovery path similar to completeRunRecord
3. Both functions now use clientId as a fallback value for clientName when creating recovery records

## How to Test
1. Monitor logs for "clientName is not defined" errors
2. They should no longer occur as we now provide a fallback value

## Dependencies
No new dependencies added. This fix addresses the run record creation issues identified in the handover document.