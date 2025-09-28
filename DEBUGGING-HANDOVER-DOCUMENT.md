# Debugging Handover: Airtable Authorization Errors

## Current Status & Context
We've implemented comprehensive debugging code to identify the root cause of "You are not authorized to perform this operation" errors occurring in the webhook server. These errors appear when the system attempts to access client-specific Airtable bases, particularly during run record checks.

The debugging code has been committed to the `clean-architecture-fixes` branch and focuses on tracing the entire execution flow from client ID resolution through base connection to record queries.

## Files Modified
1. `services/runRecordAdapterSimple.js` - Added detailed logging in `checkRunRecordExists` function
2. `config/airtableClient.js` - Enhanced debug in `getClientBase` and `createBaseInstance`
3. `services/clientService.js` - Added tracing to client resolution
4. `routes/apifyProcessRoutes.js` - Added field verification and structured logging
5. `debug-field-names.js` (new) - Created diagnostic tool for field name verification

## Initial Analysis
The most likely causes for these authorization errors are:
1. Field name mismatches between code expectations and actual Airtable schema
2. Table name inconsistencies across client bases
3. API key permission issues
4. Incorrect client base resolution

## Next Steps for Debugging

### 1. Run the affected process to reproduce the error
```bash
# If you're testing locally
npm run dev:api

# Then trigger the webhook or process that causes the error
# For example, accessing the apify/process-client endpoint:
curl -X POST "http://localhost:3001/api/apify/process-client" \
  -H "Content-Type: application/json" \
  -H "x-client-id: [CLIENT_ID]" \
  -H "Authorization: Bearer [SECRET]" \
  -d '{"processAll":false}'
```

### 2. Run the field name verification script
```bash
# Run against the client ID that's experiencing errors
node debug-field-names.js [CLIENT_ID]

# Take note of any field name or table name mismatches reported
```

### 3. Collect and analyze debug logs
Look for entries with the `[DEBUG-EXTREME]` prefix, specifically:
- Client resolution: `getClientById CALLED with clientId=...`
- Base connection: `createBaseInstance CALLED with baseId=...`
- Query execution: `Running query with formula: {Run ID} = '...'`
- Record fields: `Record fields available: ...`
- Error details: `ERROR in exact match: ...`

## Common Issues & Solutions

### Field name mismatches
**Symptoms in logs:**
```
[DEBUG-EXTREME] ERROR in exact match: Could not find field 'Run ID' in table
```

**Solution:**
Update the field name constants in the code to match what's actually in Airtable:
```javascript
// Edit constants/airtableSchema.js or relevant file
module.exports = {
  // Update field name to match what's in Airtable
  RUN_ID_FIELD: 'Correct Field Name',
  // ...other fields
};
```

### Table name mismatches
**Symptoms in logs:**
```
[DEBUG-EXTREME] ERROR: Could not find table 'Client Run Results'
```

**Solution:**
Check for the correct table name in the client's base and update constants:
```javascript
// Edit constants/airtableSchema.js or relevant file
module.exports = {
  // Update table name to match what's in Airtable
  CLIENT_RUN_RESULTS_TABLE: 'Correct Table Name',
  // ...other tables
};
```

### API key issues
**Symptoms in logs:**
```
[DEBUG-EXTREME] ERROR: UNAUTHORIZED_CLIENT Authentication failure
```

**Solution:**
1. Check the API key in your `.env` file
2. Verify the key has proper permissions for all bases
3. Regenerate the API key if necessary

### Client resolution issues
**Symptoms in logs:**
```
[DEBUG-EXTREME] ERROR: Client not found: [CLIENT_ID]
```

**Solution:**
1. Verify the client exists in the master base
2. Check the client ID being passed in requests
3. Review `clientService.js` cache behavior

## Architecture Reference

### Multi-tenant Data Flow
1. Client ID is provided in API request header `x-client-id`
2. `clientService.getClientById(clientId)` resolves client details
3. `airtableClient.getClientBase(clientId)` gets client-specific base connection
4. Operations execute against client-specific base

### Key Table & Field Patterns
- **Client Run Results**: Tracks job execution
  - Run ID: Unique job identifier
  - Status: Current state of job
  
- **Leads**: Stores lead profiles
  - LinkedIn Profile URL: Source for harvesting
  - Posts Harvest Status: Processing state
  
- **Posts**: Stores collected LinkedIn posts
  - Lead Record ID: Links post to lead
  - Post URL: Unique post identifier

## Testing Your Fix

After identifying and implementing a fix:
1. Run the process again with the same client ID
2. Verify no authorization errors occur in logs
3. Check that records are being correctly found and updated
4. Create a commit with a descriptive message

## Commit Message Template
```
# Fix: [Concise Description of Issue]

## Issue Description
[Describe what was found in the debug logs]

## Changes Made
[List specific changes made]

## Testing
[Describe how the fix was verified]
```

## Final Notes
- All debug code is prefixed with `[DEBUG-EXTREME]`
- After fixing the issue, consider removing debug code or making it conditional
- This is likely a systemic issue, so the fix may need to be applied across multiple clients

The comprehensive debugging added should provide clear visibility into exactly where and why the authorization failures are occurring.