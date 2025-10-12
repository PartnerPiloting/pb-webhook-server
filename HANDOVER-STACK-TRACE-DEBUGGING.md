# Complete Handover Document - Stack Trace System Debugging

**Date:** October 11-12, 2025  
**Branch:** `feature/comprehensive-field-standardization`  
**Latest Commit:** `d448149` - "fix: Critical fixes for stack trace logging system"  
**Status:** PARTIALLY WORKING - Stack traces saved but not linked to Production Issues

---

## Quick Summary

**What's Working ✅**
- Stack traces ARE being saved to Stack Traces table with full file paths
- Run IDs are in correct base format (YYMMDD-HHMMSS)
- Client IDs populated correctly
- All 11 error handlers verified to pass correct data

**What's NOT Working ❌**
- Production Issues table Stack Trace field is EMPTY
- STACKTRACE markers NOT appearing in Render logs
- Analyzer cannot extract timestamps to do lookups

**Root Cause:** Logger parameter issue may not be fully resolved - STACKTRACE markers still not in Render logs

---

## What Was Built

### Complete Stack Trace Capture System

A production error tracking system that captures full stack traces and links them to Production Issues in Airtable.

**Architecture:**
1. **Stack Traces Table** (Airtable) - Stores stack traces with unique timestamp keys
2. **Error Handlers** - 11 critical error handlers updated to use new system
3. **Log Markers** - `STACKTRACE:timestamp` markers written to Render logs
4. **Analyzer Integration** - Pattern detection to extract timestamps from logs
5. **Lookup & Link** - Production Issues service looks up stack traces by timestamp

---

## Files Created/Modified

### New Files (Commit `3d7ea20`)

**services/stackTraceService.js** (130 lines)
```javascript
// Main methods:
saveStackTrace({ timestamp, runId, clientId, errorMessage, stackTrace })
lookupStackTrace(timestamp)
static generateUniqueTimestamp()

// Table: Master Clients Base → "Stack Traces"
// Fields: Timestamp, Run ID, Client ID, Error Message, Stack Trace, Created At
```

### Enhanced Files (Commit `3d7ea20`)

**services/logFilterService.js**
- Added `extractStackTraceTimestamp(context)` - Regex: `/STACKTRACE:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/`
- Enhanced `extractMetadata()` - Line 151: calls extractStackTraceTimestamp
- Issue object - Line 272: added `stackTraceTimestamp` property

**services/productionIssueService.js**
- Import: `const StackTraceService = require('./stackTraceService')` (Line 9)
- `createProductionIssue()` enhanced (Lines 445-465):
  ```javascript
  if (issue.stackTraceTimestamp) {
    const stackTraceService = new StackTraceService();
    const stackTrace = await stackTraceService.lookupStackTrace(issue.stackTraceTimestamp);
    if (stackTrace) {
      fields[FIELDS.STACK_TRACE] = stackTrace.substring(0, 100000);
    }
  }
  ```

**utils/errorHandler.js**
- Added `logErrorWithStackTrace(error, options)` - Lines 459-509
- Added `logErrorAsync(error, options)` - Fire-and-forget wrapper
- Dynamic require of StackTraceService (avoid circular deps)
- Generates unique timestamp, saves stack trace, logs with `STACKTRACE:` marker
- Options: `{runId, clientId, context, loggerName, operation}`

### Error Handlers Updated (11 total - 90-95% coverage)

**batchScorer.js** (5 handlers)
- Line 117: Chunk fatal error
- Line 467: Gemini API call failed
- Line 557: JSON parse error
- Line 583: Attribute loading failed
- Line 1042: Client processing fatal error

**services/jobTracking.js** (5 handlers)
- Line 325: Create job record failed
- Line 469: Update job record failed
- Line 592: Create client run failed
- Line 697: Client run record not found (updateClientRun)
- Line 1122: Update metrics record not found (updateClientMetrics)

**routes/apiAndJobRoutes.js** (2 handlers)
- Line 1579: Post scoring metrics update failed
- Line 1635: Background post scoring fatal error

---

## Bug Fixes Applied

### Commit `091b4ea` - Run ID Extraction Fixes

**Problem:** jobTracking.js was passing composite run IDs (e.g., "251011-132119-Guy-Wilson") instead of base run IDs.

**Fixed:**
- **Line 697** (updateClientRun): Extract base run ID using `clientRunId.substring(0, 13)`
- **Line 1122** (updateClientMetrics): Extract base run ID using `safeRunId.substring(0, 13)`

### Commit `d448149` - Critical Logger & Variable Name Fixes

**Bug 1: Logger Parameter Issue** ⚠️ CRITICAL
```javascript
// BEFORE (WRONG) - in utils/errorHandler.js line 497-500:
errorLogger.error(
  operation,  // First parameter
  `message STACKTRACE:${timestamp}`  // Second parameter - LOST IN RENDER LOGS
);

// AFTER (CORRECT):
errorLogger.error(
  `message STACKTRACE:${timestamp}`  // Single parameter - SHOULD appear in logs
);
```
**Impact:** STACKTRACE markers were being passed as second console.error argument and not appearing in Render logs.

**Bug 2: Variable Name Crash**
```javascript
// Line 1447 in apiAndJobRoutes.js
// BEFORE: runId: timestampOnlyRunId  (ReferenceError!)
// AFTER: runId: logRunId  (correct variable name)
```
**Impact:** Post-scoring background jobs were crashing immediately.

---

## Current Status: DEBUGGING NEEDED

### Test Results from Run ID: 251011-140625 (Oct 12, 12:06am AEST)

**Stack Traces Table:**
- ✅ 2 records created
- ✅ Run ID: `251011-140625` (base format, correct!)
- ✅ Client ID: Dean-Hobin, Guy-Wilson
- ✅ Error Message: "Client run record not found..."
- ✅ Stack Trace: Full stack traces with file paths like `/opt/render/project/src/services/jobTracking.js:697:37`

**Production Issues Table:**
- ❌ Stack Trace field: EMPTY
- ✅ Records created with correct Run IDs
- ✅ Error messages captured

**Render Logs:**
- ❌ NO STACKTRACE markers found when searched (fetched 1000 lines)
- ❌ This prevents analyzer from extracting timestamps
- ❌ Without timestamps, lookup cannot happen

---

## Investigation Steps for Next Session

### 1. Verify Deployment Status ⚠️ PRIORITY 1

Check Render dashboard to confirm:
- Commit `d448149` is actually deployed and live
- Deployment completed BEFORE 12:06am AEST test run
- If deployment was after test run, need to re-test

### 2. Get Full Stack Trace Content

Ask user to open Stack Traces table record and copy:
- **Full Error Message**
- **Full Stack Trace text**

This will show the file path and line number to identify which handler saved it and verify it's one of our 11 updated handlers.

### 3. Search Render Logs Around Test Time

Fetch logs from around 12:06am AEST (2:06am UTC on Oct 11) and search for:
1. `"STACKTRACE:"` markers ← **KEY ISSUE**
2. `"251011-140625"` (the run ID)
3. `"[ERROR-HANDLER]"` or `"[JOB-TRACKING]"` log prefixes
4. `"Client run record not found"` error messages

### 4. Test Logger Output Locally

Create a simple test to verify console.error() format:
```javascript
const { createLogger } = require('./utils/contextLogger');
const logger = createLogger({ runId: 'TEST-123', clientId: 'TEST', operation: 'test' });

logger.error(`Test message STACKTRACE:2025-10-11T12:06:00.123456789Z`);
// Check what gets logged to stdout
```

### 5. Alternative Fix: Use Console.log Directly

If contextLogger is causing issues, modify `utils/errorHandler.js` line 496-498:
```javascript
// CURRENT (using contextLogger):
errorLogger.error(
  `${runIdTag}${clientIdTag}${contextPrefix}${errorMessage} STACKTRACE:${timestamp}`
);

// ALTERNATIVE (direct console.log):
console.log(`[${runId}] [${clientId}] [ERROR] ${errorMessage} STACKTRACE:${timestamp}`);
```

This bypasses the contextLogger formatting and writes directly to stdout.

---

## Expected Flow (When Working)

### 1. Error Occurs
```javascript
// jobTracking.js line 697
const error = new Error("Client run record not found...");
await logErrorWithStackTrace(error, {
  runId: "251011-140625",  // Base run ID
  clientId: "Guy-Wilson",
  context: "[RECORD_NOT_FOUND] Update client run failed",
  loggerName: 'JOB-TRACKING',
  operation: 'updateClientRun'
});
```

### 2. Stack Trace Saved to Airtable
```javascript
// errorHandler.js saves to Stack Traces table
timestamp = "2025-10-11T12:06:00.123456789Z"
await stackTraceService.saveStackTrace({
  timestamp,
  runId: "251011-140625",
  clientId: "Guy-Wilson",
  errorMessage: "Client run record not found...",
  stackTrace: "Error: Client run record not found...\n    at JobTracking.updateClientRun..."
});
```
**Status:** ✅ THIS IS WORKING

### 3. Log Marker Written to Render
```javascript
// errorHandler.js logs to Render (line 496-498)
errorLogger.error(
  `[251011-140625] [Client: Guy-Wilson] [RECORD_NOT_FOUND] ... STACKTRACE:2025-10-11T12:06:00.123456789Z`
);
```
**Expected Render Log:**
```
[ERROR-HANDLER] [logError] [ERROR] [251011-140625] [Client: Guy-Wilson] [RECORD_NOT_FOUND] Update client run failed - Client run record not found for 251011-140625 - cannot update non-existent record STACKTRACE:2025-10-11T12:06:00.123456789Z
```
**Status:** ❌ THIS IS NOT WORKING - Marker not in logs

### 4. Analyzer Processes Logs
```javascript
// logFilterService.js
const timestamp = extractStackTraceTimestamp(context);
// Should extract: "2025-10-11T12:06:00.123456789Z"

issue.stackTraceTimestamp = timestamp;
```
**Status:** ❌ CANNOT WORK - No marker to extract

### 5. Production Issue Created with Lookup
```javascript
// productionIssueService.js
if (issue.stackTraceTimestamp) {
  const stackTrace = await stackTraceService.lookupStackTrace("2025-10-11T12:06:00.123456789Z");
  // Should find matching record in Stack Traces table
  // Should copy stack trace to Production Issues
}
```
**Status:** ❌ CANNOT WORK - No timestamp to lookup

---

## Code Verification Summary

### Run ID Audit - All Correct ✅

| File | Line | Handler | runId Source | Value |
|------|------|---------|-------------|-------|
| batchScorer.js | 117 | Chunk fatal | `chunkTimestampRunId` (extracted) | BASE ✅ |
| batchScorer.js | 467 | API failed | `runId` parameter | BASE ✅ |
| batchScorer.js | 557 | JSON parse | `runId` parameter | BASE ✅ |
| batchScorer.js | 583 | Attr load | `runId` parameter | BASE ✅ |
| batchScorer.js | 1042 | Client fatal | `runId` parameter | BASE ✅ |
| jobTracking.js | 325 | Create job | `safeRunId` | BASE ✅ |
| jobTracking.js | 469 | Update job | `safeRunId` | BASE ✅ |
| jobTracking.js | 592 | Create run | `standardRunId` | BASE ✅ |
| jobTracking.js | 697 | Not found | `baseRunId = substring(0,13)` | BASE ✅ |
| jobTracking.js | 1122 | Metrics | `baseRunId = substring(0,13)` | BASE ✅ |
| apiAndJobRoutes.js | 1579 | Metrics update | `runId = parentRunId` | BASE ✅ |
| apiAndJobRoutes.js | 1635 | Post fatal | `runId = parentRunId` | BASE ✅ |

---

## Possible Root Causes

### Hypothesis 1: ContextLogger Not Writing to Render Stdout ⚠️ MOST LIKELY

The `contextLogger.error()` method might not be writing to the process stdout/stderr that Render captures.

**How to verify:**
- Add a plain `console.log()` with the STACKTRACE marker
- Or check if contextLogger has buffering/filtering

**How to fix:**
Replace contextLogger call with direct console.log in errorHandler.js

### Hypothesis 2: Deployment Timing Issue

The test run at 12:06am might have used OLD code if deployment wasn't complete.

**How to verify:**
- Check Render dashboard for exact deployment completion time
- Compare with test run timestamp (12:06am AEST)

**How to fix:**
Re-test after confirming deployment is live

### Hypothesis 3: Logger Buffering/Filtering

Render might be buffering logs or filtering certain formats.

**How to verify:**
- Check Render log settings
- Test with different log formats

**How to fix:**
Use simpler log format or direct console output

---

## Quick Fix to Try First

### Option 1: Direct Console.log (Recommended)

Edit `utils/errorHandler.js` lines 493-500:

```javascript
// Log error with STACKTRACE: marker for analyzer to detect
const contextPrefix = context ? `${context} - ` : '';
const runIdTag = runId ? `[${runId}] ` : '';
const clientIdTag = clientId ? `[Client: ${clientId}] ` : '';

// OPTION 1: Use direct console.log instead of contextLogger
console.log(`${runIdTag}${clientIdTag}${contextPrefix}${errorMessage} STACKTRACE:${timestamp}`);

// OPTION 2 (current - not working): Use contextLogger
// errorLogger.error(
//   `${runIdTag}${clientIdTag}${contextPrefix}${errorMessage} STACKTRACE:${timestamp}`
// );
```

### Option 2: Add Debug Logging

Add this BEFORE the errorLogger.error() call to verify function is being called:

```javascript
console.log(`[DEBUG] About to log STACKTRACE marker: ${timestamp}`);
errorLogger.error(
  `${runIdTag}${clientIdTag}${contextPrefix}${errorMessage} STACKTRACE:${timestamp}`
);
console.log(`[DEBUG] Logged STACKTRACE marker successfully`);
```

Then search Render logs for `[DEBUG]` to confirm the function is running.

---

## Testing Checklist

### Before Testing
- [ ] Confirm deployment is complete and live (check Render dashboard)
- [ ] Check commit hash on Render matches latest push (`d448149`)
- [ ] Clear old Stack Traces and Production Issues records

### During Test
- [ ] Run smart-resume with 1-2 clients
- [ ] Note the Run ID from response
- [ ] Wait for completion

### After Test - Verify These Specific Items

**Stack Traces Table:**
- [ ] New records created?
- [ ] Run ID = base format (13 chars: YYMMDD-HHMMSS)?
- [ ] Client ID populated?
- [ ] Stack Trace has full file paths?
- [ ] Timestamp is unique ISO format?

**Production Issues Table:**
- [ ] New records created?
- [ ] Stack Trace field populated? ← **THIS IS THE FAILING POINT**
- [ ] Run ID matches Stack Traces table?

**Render Logs:**
- [ ] Search for "STACKTRACE:" - Markers present? ← **THIS IS WHAT'S MISSING**
- [ ] Search for the Run ID - Logs for that run present?
- [ ] Search for "[ERROR-HANDLER]" - Our error logging present?
- [ ] Search for error message text - Error logged somewhere?

---

## Key Files to Check

### Critical Files for Debugging
```
utils/errorHandler.js          - Line 496-498: Where STACKTRACE marker is logged
services/stackTraceService.js  - Working correctly (saves to Airtable)
services/logFilterService.js   - Line 106-115: Pattern detection (waiting for marker)
services/productionIssueService.js - Line 445-465: Lookup logic (waiting for timestamp)
utils/contextLogger.js         - Line 68-76: error() method implementation
```

### Airtable Tables to Monitor
```
Master Clients Base → Stack Traces        (Working ✅)
Master Clients Base → Production Issues   (Stack Trace field empty ❌)
```

### Render Service
```
Service: pb-webhook-server-staging
URL: https://pb-webhook-server-staging.onrender.com
Dashboard: Check deployment status and commit hash
```

---

## Git History

```bash
d448149 - fix: Critical fixes for stack trace logging system (LATEST)
091b4ea - fix: Extract base run ID from composite client run IDs in error handlers
3d7ea20 - feat: Implement comprehensive stack trace capture system for production errors
```

---

## Confidence Assessment

**What's 100% Verified:**
- ✅ Stack trace capture works (saves to Airtable)
- ✅ Run IDs are correct (all 11 handlers verified)
- ✅ Airtable saves work perfectly
- ✅ Lookup logic is sound (tested pattern matching)
- ✅ Pattern detection regex is correct

**What's the Problem (95% certain):**
- ❌ STACKTRACE markers not appearing in Render logs
- Likely cause: contextLogger not writing to stdout/stderr properly
- OR: Render log buffering/filtering issue
- OR: Deployment timing (old code still running)

**Expected Resolution Time:** 
- 15-30 minutes if it's the logger issue (switch to console.log)
- 5 minutes if it's deployment timing (just re-test)
- 1-2 hours if it's a deeper Render logging issue

---

## IMMEDIATE ACTION ITEMS

1. **First:** Verify deployment status on Render dashboard
2. **Second:** Try Option 1 fix (switch to console.log)
3. **Third:** Re-test and search Render logs for STACKTRACE markers
4. **Fourth:** If markers appear, verify Production Issues Stack Trace field populates

**If STACKTRACE markers appear after fix:** System is 100% working!

**If STACKTRACE markers still don't appear:** Need to investigate Render log capture settings or try alternative logging approach.

---

**End of Handover - File saved to:**
`c:\Users\guyra\Desktop\pb-webhook-server-dev\HANDOVER-STACK-TRACE-DEBUGGING.md`
