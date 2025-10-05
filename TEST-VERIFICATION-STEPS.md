# Test Verification Steps for Field Standardization Fix

## Background
We've consolidated all Airtable field constants into `airtableUnifiedConstants.js` as the single source of truth, eliminating the use of `airtableFields.js`. This should fix the "toLowerCase" error and field name mismatches.

## Steps to Test

### 1. Run a Test with Smart Resume Feature
```
curl -X GET "https://pb-webhook-server-staging.onrender.com/smart-resume-client-by-client?stream=1"
```

### 2. Check the Render Logs
- The error `Cannot read properties of undefined (reading 'toLowerCase')` should no longer appear
- The errors about unknown field names like "Apify Run ID" should be fixed

### 3. Check the Client Run Records
- Log into Airtable
- Check the Client Run Results table in the Master Clients base
- Verify that new run records are being created correctly with the proper field names

### 4. Check Job Tracking Records
- Verify that the Job Tracking table in the Master Clients base is being updated correctly
- Check that status fields are being updated properly

## Expected Results
- No more "toLowerCase" errors in the logs
- No more "Unknown field name" errors
- Successful completion of run records for clients

## Troubleshooting
If you still see errors:
1. Restart the server to ensure it's using the updated code
2. Check the error message for any specific field names that might still be mismatched
3. Verify that the airtableUnifiedConstants.js file has all the needed constants

## Implementation Notes
- We've added extra safeguards around the status field handling
- All imports now use airtableUnifiedConstants.js
- We've added fallback values to prevent null reference errors

Once you've confirmed everything is working correctly, we can safely remove the deprecated airtableFields.js file.