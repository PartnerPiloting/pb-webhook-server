# Run ID Standardization Fix

## Problem Identified

When examining errors related to "Job tracking record not found", I found an inconsistency in how run IDs were handled across different services:

1. `unifiedJobTrackingRepository.js` called `unifiedRunIdService.convertToStandardFormat()` but this function wasn't actually performing any format standardization - it simply returned the original runId unchanged.

2. Other services like `airtableService.js` used their own logic to extract base run IDs, which could lead to inconsistencies.

## Solution Implemented

1. Updated `unifiedRunIdService.js`:
   - Enhanced `convertToStandardFormat()` to actually standardize run IDs to the YYMMDD-HHMMSS format
   - Improved `getBaseRunIdFromClientRunId()` to validate that extracted parts look like a date and time

2. Updated `airtableService.js` to use the unified service:
   - Replaced custom run ID extraction with calls to the unified service
   - Ensures consistent run ID handling throughout the system

3. Updated `airtableServiceSimple.js`:
   - Added standardization of run IDs when querying job tracking records

## Expected Outcome

- Job tracking records will be consistently found across all services
- "Job tracking record not found" errors should be greatly reduced
- All services now use the same standardized run ID format

This fix addresses the root cause of the issue rather than just treating the symptoms, ensuring all parts of the application handle run IDs consistently.