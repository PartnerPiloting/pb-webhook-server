# Handover Document for Next Session - Clean Architecture Fixes

## Issues Identified from Todo List

At the beginning of this chat, we identified the following issues that needed to be addressed:

1. ✅ **Fix node-fetch import error**
   - Problem: Dynamic import of node-fetch was causing compatibility issues
   - Solution: Downgraded to node-fetch v2.7.0 and changed to proper require statement
   - Status: COMPLETED

2. 🔄 **Fix authorization error in Apify process**
   - Problem: Apify process was failing due to C-prefix assumptions in run record checking
   - Solution: Removed C-prefix regex and created robust `checkRunRecordExists` function
   - Status: PARTIALLY COMPLETED (function created, needs to be implemented in Apify process)

3. ⬜ **Fix AI scoring validation error**
   - Problem: AI responses sometimes not returning valid or empty arrays of post scores
   - Solution: Need to implement validation and error handling in post scoring logic
   - Status: NOT STARTED (part of next phase implementation)

4. 🔄 **Fix client run record creation issue**
   - Problem: Run records not properly created before updates are attempted
   - Solution: Created robust record checking function that handles multiple formats
   - Status: PARTIALLY COMPLETED (function created, needs implementation across services)

5. ⬜ **Fix Post Scoring Last Run Time field validation**
   - Problem: Field validation errors for "Post Scoring Last Run Time"
   - Solution: Created `safeFieldUpdate` function to check field existence before updates
   - Status: FUNCTION CREATED (needs implementation in post scoring code)

## What We've Done So Far

We have been working on the `clean-architecture-fixes` branch of the `pb-webhook-server` repository, focusing on making several key improvements to the multi-tenant LinkedIn lead management system:

1. **Fixed Run ID Format Issues**:
   - Removed the `TIMESTAMP_RUN_ID_WITH_C_REGEX` pattern from `utils/runIdUtils.js`
   - Simplified the run ID format to use a consistent standard format: `YYMMDD-HHMMSS-{clientId}`
   - Updated `extractClientId` function to only use the standard format

2. **Added Improved Run Record Checking**:
   - Added a new `checkRunRecordExists` function in `runRecordAdapterSimple.js` that's more robust at finding existing records
   - Implemented multiple search strategies to find records even with inconsistent ID formats
   - Added better logging and error handling for record lookups

3. **Created Central Error Handling Module**:
   - Implemented `utils/errorHandler.js` with standardized error handling functions
   - Created `safeFieldUpdate` function to address field validation errors
   - Added `validateFields` to check field existence before operations
   - Implemented `getFieldCase` to solve case sensitivity issues (ID vs id)

4. **Fixed Node-Fetch Import**:
   - Changed dynamic ESM import to CommonJS require statement
   - Updated package.json to use node-fetch v2.7.0 instead of v3.3.2
   - Removed unused express-rate-limit dependency

5. **Added Diagnostic Tools**:
   - Created `harvest-guy-wilson.js` for direct post harvesting testing
   - Created `reset-stuck-jobs.js` to reset stuck job statuses
   - Created `test-guy-wilson-connection.js` to diagnose connection issues

6. **Created Documentation**:
   - Added detailed handover documents
   - Created commit message templates
   - Documented architectural decisions and fixes

## Current Issues Being Addressed

1. **Cross-Service Consistency**:
   - Need to ensure the same function (`checkRunRecordExists`) is used across lead scoring, post harvesting, and post scoring
   - Currently each service has its own implementation for checking run records:
     - Post harvesting uses a direct Airtable query with minimal error handling
     - Post scoring has inline code for record checking
     - Lead scoring uses a different approach altogether
   - We need to refactor all services to use our new robust `checkRunRecordExists` function

2. **Graceful Error Handling**:
   - Implementing consistent error handling across the system with these principles:
     - Client isolation: Errors in one client shouldn't affect others
     - Detailed logging: Each error should include context about the client, operation, and specific error
     - Fallback mechanisms: When possible, use graceful degradation instead of hard failures
     - Field validation: Check if fields exist before attempting to use them
   - The new approach should include:
     - Pre-operation validation (e.g., checking field existence)
     - Structured try/catch blocks with meaningful error messages
     - Proper error propagation with context

3. **Node-fetch Import Issue**:
   - Fixed the dynamic import of node-fetch with a proper require statement
   - Updated package.json to use node-fetch v2.7.0 instead of v3.3.2

## Changes Made That Need to Be Committed

1. **Package.json Changes**:
   - Changed node-fetch from v3.3.2 to v2.7.0
   - Removed express-rate-limit dependency

2. **Utils/appHelpers.js**:
   - Changed `const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));`
   - To: `const fetch = require('node-fetch');`

3. **Utils/runIdUtils.js**:
   - Removed `TIMESTAMP_RUN_ID_WITH_C_REGEX` constant
   - Updated `extractClientId` function to remove references to the removed regex

4. **Services/runRecordAdapterSimple.js**:
   - Added new `checkRunRecordExists` function for robust record verification
   - Added detailed logging for record lookup operations

5. **Services/airtableServiceSimple.js**:
   - Added `getBase` function to expose the base connection
   - Exported table name constants

6. **New Error Handling Module**:
   - Created `utils/errorHandler.js` with centralized error handling functions
   - Implemented `handleClientError`, `validateFields`, `safeOperation`, `safeFieldUpdate`, and `getFieldCase` functions
   - Designed to provide consistent error handling patterns across all services

7. **New Utility Scripts**:
   - `harvest-guy-wilson.js` - Direct post harvesting test script
   - `reset-stuck-jobs.js` - Tool to reset stuck job statuses
   - `test-guy-wilson-connection.js` - Diagnostic tool for client connection

8. **Documentation Files**:
   - Added various markdown files with documentation and commit messages

## Next Steps

1. **Consistency Implementation**:
   - Apply the robust `checkRunRecordExists` function across all services:
     - Update `routes/apifyWebhookRoutes.js` to use it for post harvesting
     - Update `routes/apiAndJobRoutes.js` to use it for post scoring endpoints
     - Update `batchScorer.js` to use it for lead scoring operations
   - Remove duplicate record checking code from each service
   - Create helper functions for common operations like:
     - `safeFieldUpdate(base, table, recordId, updates)` - Checks field existence before updating
     - `getFieldCase(base, table, fieldName)` - Detects proper case for field names (id vs ID)

2. **Graceful Error Handling Implementation**:
   - Create a centralized error handling module (`utils/errorHandler.js`) with:
     - `handleClientError(clientId, operation, error)` - Isolates errors to specific clients
     - `validateFields(base, table, requiredFields)` - Checks if all required fields exist
     - `safeOperation(clientId, operationFn, fallbackFn)` - Executes operations with proper error boundaries
   - Add field existence checking before operations:
     - Check if "Post Scoring Last Run Time" exists before trying to update it
     - Implement dynamic field name case detection (id vs ID)
     - Add graceful fallbacks when fields are missing

3. **Testing the Changes**:
   - Run the diagnostic scripts to verify connectivity and data structure
   - Test the post harvesting and post scoring processes with the new changes
   - Verify that run records are properly found and updated
   - Test error scenarios to ensure proper isolation and logging

3. **PR Preparation**:
   - Finalize commit messages for the changes
   - Create a comprehensive PR description that explains all the changes

## Links to Important Files in the Next Session

Be sure to check these key files when continuing the work:

- `services/runRecordAdapterSimple.js` - Contains the new `checkRunRecordExists` function
- `utils/runIdUtils.js` - Modified to remove the C-prefix pattern
- `services/airtableServiceSimple.js` - Enhanced with new utility functions
- `utils/errorHandler.js` - New centralized error handling module
- `package.json` - Updated node-fetch dependency
- `utils/appHelpers.js` - Fixed fetch import

### Key Areas to Implement Error Handling

These files should be updated to use the new error handling patterns:

1. **Post Scoring**:
   - `postBatchScorer.js` - Update to use `safeFieldUpdate` for handling missing fields
   - `routes/apiAndJobRoutes.js` - Add `safeOperation` for post scoring endpoints

2. **Post Harvesting**:
   - `routes/apifyWebhookRoutes.js` - Implement `validateFields` before operations
   - `routes/apifyProcessRoutes.js` - Add client isolation with `handleClientError`

3. **Lead Scoring**:
   - `batchScorer.js` - Update to use consistent error handling patterns
   - `singleScorer.js` - Implement field validation before updates

## Command to Run in Next Session

After pasting this handover document in the next session, you can run these to see what needs to be committed:

```bash
git status
git diff
```

And then commit and push the changes:

```bash
git add services/runRecordAdapterSimple.js utils/runIdUtils.js services/airtableServiceSimple.js utils/appHelpers.js package.json package-lock.json utils/errorHandler.js
git add harvest-guy-wilson.js reset-stuck-jobs.js test-guy-wilson-connection.js
git commit -m "fix: Standardize run ID format and implement centralized error handling"
git push origin clean-architecture-fixes
```

## Implementation Plan for Resolving All Issues

### 1. Fix Authorization Error in Apify Process (Current Progress: 50%)

The authorization error in Apify process is being addressed by:
- ✅ Removing C-prefix assumption in run ID format (completed)
- ✅ Creating robust `checkRunRecordExists` function (completed)
- ⬜ Implementing this function in `routes/apifyWebhookRoutes.js` (next step)
- ⬜ Adding proper error handling for Airtable authorization errors (next step)

Implementation example for next step:
```javascript
// In apifyWebhookRoutes.js
const { checkRunRecordExists } = require('../services/runRecordAdapterSimple');
const { handleClientError } = require('../utils/errorHandler');

// Before updating run record
const recordExists = await checkRunRecordExists({ 
  runId, 
  clientId,
  options: { source: 'apify_webhook', logger }
});

if (!recordExists) {
  return res.status(404).json({
    error: 'Run record not found',
    message: 'Please check that the run record was created before webhook processing'
  });
}
```

### 2. Fix AI Scoring Validation Error (Current Progress: 30%)

To address the issue with AI responses not being valid or empty arrays:
- ✅ Created foundation with error handling module (completed)
- ⬜ Add validation before parsing AI responses (next step)
- ⬜ Implement graceful fallback for invalid responses (next step)

Implementation example for next step:
```javascript
// In postBatchScorer.js
try {
  const rawResponse = await aiService.scoreContent(posts);
  
  // Add validation before parsing
  if (!rawResponse || typeof rawResponse !== 'object') {
    throw new Error(`AI response was invalid: ${typeof rawResponse}`);
  }
  
  // Check if response has the expected format
  if (!Array.isArray(rawResponse.postScores) || rawResponse.postScores.length === 0) {
    throw new Error(`AI response was not a valid or non-empty array of post scores`);
  }
  
  // Process valid response
  const { postScores } = rawResponse;
  // ...
} catch (error) {
  // Use handleClientError to properly log the issue
  handleClientError(clientId, 'post_scoring', error, {
    logger: clientLogger,
    includeStack: true
  });
  
  // Provide fallback or partial results if possible
  return {
    error: error.message,
    partialResults: [] // Any valid scores we might have been able to extract
  };
}
```

### 3. Fix Client Run Record Creation Issue (Current Progress: 60%)

To ensure run records are properly created before updates:
- ✅ Created `checkRunRecordExists` function with multiple search strategies (completed)
- ✅ Added proper logging for record lookup failures (completed)
- ⬜ Update all services to use this function before attempting updates (next step)
- ⬜ Implement consistent record creation/update pattern across services (next step)

### 4. Fix Post Scoring Last Run Time Field Validation (Current Progress: 40%)

To resolve field validation errors:
- ✅ Created `safeFieldUpdate` and `validateFields` functions (completed)
- ⬜ Implement in `postBatchScorer.js` to handle missing fields gracefully (next step)
- ⬜ Add field existence checking before every update operation (next step)

Implementation example for next step:
```javascript
// In postBatchScorer.js
const { safeFieldUpdate, validateFields } = require('../utils/errorHandler');

// Before batch processing
const fieldValidation = await validateFields(clientBase, config.leadsTableName, [
  config.fields.dateScored,
  config.fields.aiEvaluation,
  config.fields.relevanceScore,
  config.fields.topScoringPost
], { logger: clientLogger, clientId });

// Log any issues with fields
if (!fieldValidation.valid) {
  clientLogger.warn(`Missing required fields in ${config.leadsTableName}: ${fieldValidation.missingFields.join(', ')}`);
}

// When updating individual lead, use safe update with correct field cases
await safeFieldUpdate(
  clientBase,
  config.leadsTableName,
  recordId,
  {
    [fieldValidation.caseSensitiveFields[config.fields.relevanceScore] || config.fields.relevanceScore]: relevanceScore,
    [fieldValidation.caseSensitiveFields[config.fields.dateScored] || config.fields.dateScored]: new Date().toISOString(),
    [fieldValidation.caseSensitiveFields[config.fields.aiEvaluation] || config.fields.aiEvaluation]: aiEvaluation || ''
  },
  { clientId, logger: clientLogger, skipMissing: true }
);
```

## Implementation Plan for Cross-Service Consistency

1. **First Phase (Current Commit):**
   - Create the foundational tools: `checkRunRecordExists` and `errorHandler.js`
   - Fix immediate issues with run ID format and node-fetch imports
   - Add diagnostic tools for testing

2. **Second Phase (Next PR):**
   - Update post scoring service to use new error handling patterns:
     ```javascript
     // Example implementation in postBatchScorer.js
     const { safeFieldUpdate, validateFields } = require('../utils/errorHandler');
     
     // Before updating each lead
     const fieldValidation = await validateFields(clientBase, config.leadsTableName, 
       ['Date Posts Scored', 'Posts AI Evaluation', 'Posts Relevance Score']);
     
     // When updating a lead
     const updateResult = await safeFieldUpdate(
       clientBase,
       config.leadsTableName,
       recordId,
       {
         [config.fields.relevanceScore]: relevanceScore,
         [config.fields.dateScored]: new Date().toISOString(),
         [config.fields.aiEvaluation]: aiEvaluation || '',
         [config.fields.topScoringPost]: JSON.stringify(topScoringPost || {})
       },
       { clientId, logger: clientLogger, skipMissing: true }
     );
     ```

3. **Third Phase:**
   - Apply the same pattern to post harvesting and lead scoring
   - Ensure consistent error handling across all services
   - Add comprehensive tests for error scenarios