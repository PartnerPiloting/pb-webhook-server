# Metrics Tracking Diagnostic Process

This document describes the diagnostic process we followed to identify and fix issues with metrics tracking in the PB Webhook Server. This supplements the main handover document with more in-depth technical details about how we diagnosed the problems.

## Initial Problem Statement

We observed two primary issues:

1. **Token Usage Not Recorded**: The `Post Scoring Tokens` field in Airtable was consistently showing 0.
2. **Missing Metrics Updates**: Several metrics were not being updated in Airtable during normal operation.

## Diagnostic Approach

### Phase 1: Investigating Token Usage Tracking

1. **Added Debug Logging**
   - Added logging in `postBatchScorer.js` to track the token usage values:
   ```javascript
   console.log(`[DEBUG-METRICS] - Post Scoring Tokens to be updated: ${postScoringTokens}`);
   ```

2. **Analyzed Code Flow**
   - Traced the data flow from Gemini API calls to Airtable updates
   - Found that while the `updateClientRun` function included a `Post Scoring Tokens` field, the `clientResult` object didn't have a `totalTokensUsed` property initialized

3. **Traced API Response Handling**
   - Examined how token usage was reported by the Gemini API
   - Discovered that `usageMetadata` from API responses contained token counts but wasn't being returned from `scorePostsWithGemini`

### Phase 2: Investigating Run Record Management

1. **Added Error Logging**
   - Enhanced logging in `apifyRunsService.js` to capture when run records couldn't be found:
   ```javascript
   console.log(`[APIFY_METRICS_DEBUG] Run record exists check for ${standardizedRunId}: ${recordExists ? 'YES' : 'NO'}`);
   ```

2. **Analyzed Orchestration Check**
   - Found that the `isOrchestrated` check in `apifyWebhookRoutes.js` was filtering out many runs
   - Added logging to understand when and why runs were being filtered:
   ```javascript
   console.log(`[APIFY_WEBHOOK_DEBUG] isOrchestrated: ${isOrchestrated}`);
   ```

3. **Traced Record Creation Flow**
   - Reviewed how client run records are supposed to be created
   - Found that there was no fallback for creating records if they didn't already exist

## Root Cause Analysis

### Issue 1: Token Usage Not Tracked

**Root Cause**: Missing initialization and propagation of token usage data through the processing chain.

1. `clientResult` object in `postBatchScorer.js` was missing the `totalTokensUsed` property in its initialization
2. `scorePostsWithGemini` in `postGeminiScorer.js` had token usage data but didn't return it
3. The function chain from API call to Airtable update didn't propagate token usage data

### Issue 2: Run Records Not Found

**Root Cause**: Rigid enforcement of record existence with no fallback mechanism.

1. `updateClientRun` in `airtableService.js` strictly required records to exist before updating
2. Run records were sometimes not created during process kickoff
3. The `isOrchestrated` check in `apifyWebhookRoutes.js` prevented processing many valid runs

## Solution Implementation Details

### Token Tracking Implementation

1. **Data Structure Changes**
   - Added `totalTokensUsed: 0` to `clientResult` initialization
   - Modified `processPostScoringChunk` to include `totalTokensUsed` property

2. **API Response Enhancement**
   - Modified `scorePostsWithGemini` to return a structured object with results and token usage:
   ```javascript
   return {
     results: resultArray,
     tokenUsage: {
       promptTokens: usageMetadata.promptTokenCount || 0,
       completionTokens: usageMetadata.candidatesTokenCount || 0,
       totalTokens: usageMetadata.totalTokenCount || 0
     }
   }
   ```

3. **Token Accumulation Chain**
   - Updated lead processing to track tokens per lead
   - Updated chunk processing to accumulate tokens from leads
   - Updated client processing to accumulate tokens from chunks

### Run Record Management Implementation

1. **Record Existence Check**
   - Added `checkRunRecordExists` function to verify records before updates:
   ```javascript
   async function checkRunRecordExists(runId, clientId) {
     // Check cache first
     let recordId = runIdService.getRunRecordId(standardRunId, clientId);
     if (recordId) {
       try {
         await base(CLIENT_RUN_RESULTS_TABLE).find(recordId);
         return true;
       } catch (err) {
         recordId = null;
       }
     }
     
     // Search in Airtable if not in cache
     const exactMatches = await base(CLIENT_RUN_RESULTS_TABLE).select({
       filterByFormula: exactIdQuery,
       maxRecords: 1
     }).firstPage();
     
     return (exactMatches && exactMatches.length > 0);
   }
   ```

2. **Record Creation Fallback**
   - Added code to create records if they don't exist:
   ```javascript
   if (!recordExists) {
     await airtableService.createClientRunRecord(standardizedRunId, clientId, {
       'Status': 'RUNNING',
       'Client ID': clientId,
       'System Notes': `Created during Apify webhook processing for run ${runId}`
     });
   }
   ```

3. **Orchestration Check Override**
   - Temporarily modified the orchestration check to allow all runs:
   ```javascript
   // TEMPORARILY allow ALL runs to be processed as orchestrated
   const isOrchestrated = true; // Force to true for testing
   ```

## Testing & Validation Approach

1. **Log Analysis**
   - Added logging checkpoints throughout the token tracking chain
   - Verified token counts were being accumulated correctly
   - Confirmed run records were being found or created as needed

2. **Debug API Responses**
   - Added detailed logging of Gemini API responses to verify token data
   - Verified the structure of the data being returned

3. **Airtable Verification**
   - Checked that token values were appearing in Airtable after processing
   - Verified that metrics were being updated for all runs

## Lessons Learned

1. **Consistent Data Propagation**
   - Ensure data properties are initialized and propagated through processing chains
   - Use structured returns that include metadata alongside primary results

2. **Robust Record Management**
   - Implement graceful fallbacks for when expected records don't exist
   - Add verification steps before critical operations

3. **Centralized Metrics Handling**
   - Consider a more centralized approach to metrics tracking to avoid duplication
   - Standardize how different parts of the system track and update metrics

4. **Diagnostic Logging**
   - Add structured, consistent logging for metrics updates
   - Include context information in logs to aid debugging

These learnings should inform future development to create more robust metrics tracking throughout the system.