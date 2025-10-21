# Fix: Add Comprehensive Debugging for Field and Authentication Issues

## Issue Description
We're encountering persistent "You are not authorized to perform this operation" errors in Airtable API calls, particularly in the multi-tenant environment where client-specific bases are accessed. Despite previous fixes to use client-specific bases, the errors continue to appear in logs. This suggests potential issues with:

1. Field name mismatches in Airtable tables
2. Table name inconsistencies across client bases
3. API key permission issues
4. Incorrect client base resolution

## Changes Made

### 1. Enhanced Debugging in runRecordAdapterSimple.js
- Added extensive `[DEBUG-EXTREME]` logging throughout the checkRunRecordExists function
- Added field name verification to log available fields in found records
- Added full error stack traces for Airtable query failures
- Added request/response logging for API calls

### 2. Improved Client Base Resolution Tracing
- Added detailed logging in airtableClient.js:getClientBase and createBaseInstance
- Added API key usage tracking (first few characters only, for security)
- Added base connection success/failure reporting

### 3. Added Field Name Verification in apifyProcessRoutes.js
- Added explicit table name and field name logging
- Enhanced error context in run record handling
- Added StructuredLogger integration for better tracing

### 4. Created Field Name Verification Utility
- Added `debug-field-names.js` diagnostic script to check field names across client bases
- Implemented similar field name detection to catch potential mismatches
- Added table existence verification

## Testing Strategy
1. Deploy these changes to the development environment
2. Monitor logs with attention to `[DEBUG-EXTREME]` prefix
3. Run the field verification script against affected clients
4. Check for patterns in authorization errors
5. Verify actual table/field names against expected values

## Potential Follow-up Fixes
- Fix any field name mismatches identified in debugging
- Update client base schema if inconsistent across clients
- Review API key permissions and potential token expiration
- Implement more robust error recovery for field mismatches

## Notes
These debugging changes are intended to be temporary and should be removed or disabled once the root cause is identified and fixed. The verbose logging may impact performance slightly but is necessary for proper diagnosis.