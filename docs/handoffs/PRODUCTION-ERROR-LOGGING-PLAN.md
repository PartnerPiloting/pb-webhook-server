# Production Error Logging to Airtable - Implementation Plan

**Created:** October 6, 2025  
**Purpose:** Design error logging system for production that enables debugging without relying on Render logs

---

## Overview

When moving to production, implement a selective error logging system that writes serious errors to Airtable with enough context to debug issues without needing to check Render logs.

---

## What Makes Error Logging Effective?

### ✅ SUFFICIENT - Can Debug Without Render Logs

To debug effectively from Airtable alone, each error log needs:

1. **Error Message** - The actual error text
2. **Stack Trace** - Where in code it happened (file path + line numbers)
3. **Timestamp** - Exact time (ISO format with timezone)
4. **Run ID** - Links to the specific job execution
5. **Client ID** - Which client was being processed
6. **Operation/Function** - What was being attempted (e.g., "scoring lead #12345")
7. **Input Data Snapshot** - The actual data that caused the error (lead profile, post data, etc.)
8. **System State** - Memory usage, active jobs count, etc.
9. **Request Context** - If from API call: endpoint, headers, body
10. **Error Code/Type** - Custom categorization (FieldError, AITimeout, AirtableRateLimit, etc.)

### ❌ INSUFFICIENT - Will Need Render Logs

You'll need to check Render logs if you only capture:
- Generic error message without stack trace
- No input data snapshot
- Missing the sequence of events leading up to error
- No context about what operation was being performed

---

## Example: Good vs. Bad Error Logs

### GOOD Airtable Error Log
```
Error: Field constant "PROFILES_SCORED" is undefined
Stack: at createValidatedObject (/app/utils/airtableFieldValidator.js:185)
       at JobTracking.updateJob (/app/services/jobTracking.js:372)
       at processClient (/app/routes/apiAndJobRoutes.js:145)
Run ID: 251006-143022
Client: recABC123 (Guy Wilson)
Operation: Updating Job Tracking after profile scoring
Input Data: {"Status":"completed","Profiles Scored":5,"endTime":"2025-10-06T14:30:45Z"}
Memory: 512MB / 1GB used
Request: POST /api/smart-resume
```

**Why it's good:** You can instantly see: wrong field name used, which client, what data, where in code, what was being attempted. Can fix without Render logs.

### BAD Airtable Error Log
```
Error: Something went wrong
Client: Guy Wilson
Time: 2:30 PM
```

**Why it's bad:** No stack trace, no input data, no context. You'd NEED Render logs to figure out what actually happened.

---

## What Qualifies as a "Serious Error"?

### ✅ LOG TO AIRTABLE (Serious - Needs Human Intervention)

**System/Infrastructure Failures:**
- Airtable API failures (can't write data, field not found, rate limits)
- AI service failures (Gemini/OpenAI both down/erroring)
- Authentication/permission failures
- Memory/resource exhaustion
- Database connection failures

**Data Integrity Issues:**
- Data corruption (missing required fields, invalid data types)
- Invalid Run IDs that break tracking
- Field name mismatches
- Record not found errors when record should exist

**Code/Logic Errors:**
- Uncaught exceptions that crash processing
- Null pointer errors
- Type errors
- Undefined function/constant errors
- Logic errors that cause incorrect results

**Business Process Failures:**
- Entire client processing failed
- Job failed to complete
- Data loss occurred
- Batch operation completely failed

### ❌ DON'T LOG TO AIRTABLE (Expected/Handled)

**Normal Business Logic:**
- Individual lead has no LinkedIn URL (skip and continue)
- Profile scoring returns low score (working as intended)
- Client has no leads to process (legitimate empty state)
- Lead already scored (skip duplicate)

**Handled Errors:**
- Validation warnings (corrected automatically)
- Retryable errors that succeeded on retry
- Expected rate limit backoffs (handled by retry logic)
- Cache misses (normal operation)

**Simple Rule:** 
If the error **stops a job** OR **loses data** OR **indicates broken code** → Log it to Airtable  
If it's **expected business logic** → Don't log to Airtable (console log is fine)

---

## Overhead Analysis

### Performance Impact (Minimal)

**Expected Error Rates After Stabilization:**
- Week 1-2 post-deployment: ~10-20 serious errors (catching edge cases)
- Week 3+ (stable): ~0-3 serious errors per week

**Cost Per Error:**
- Airtable API write: ~200-500ms
- Memory footprint: ~1-2KB per error log entry
- Network overhead: negligible on modern connections

**Weekly Overhead (Stable State):**
```
3 errors/week × 500ms = 1.5 seconds total overhead/week
= 0.00025% of total runtime
= Essentially zero impact
```

### ❌ Where Overhead WOULD Be a Problem

**DO NOT log these to Airtable:**
- Every lead processed (thousands/day) - would add hours of API calls
- Every AI scoring call (hundreds/day) - would overwhelm Airtable
- Every validation warning - would create noise
- Errors in tight loops - would slow processing significantly
- Debug-level logs - only for development

---

## Recommended Two-Tier Approach

### Tier 1: Console Logging (All Errors, Lightweight)
```javascript
// Fast, no network calls, captured by Render logs
logger.error("Non-critical issue", { details });
logger.warn("Validation corrected automatically");
logger.debug("Processing lead", { leadId });
```

### Tier 2: Airtable Logging (Critical Only, Heavyweight)
```javascript
// Selective, with full context for debugging
if (isCriticalError(error)) {
  await logToAirtable({
    errorType: 'CRITICAL',
    severity: 'HIGH',
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    context: {
      runId,
      clientId,
      operation: 'profile-scoring',
      inputData: lead,
      systemState: {
        memoryUsage: process.memoryUsage(),
        activeJobs: getActiveJobCount()
      }
    }
  });
}
```

---

## Implementation Checklist

### Phase 1: Create Error Classification Helper
- [ ] Create `utils/errorClassifier.js`
- [ ] Implement `isCriticalError(error)` function
- [ ] Define error categories and severity levels
- [ ] Add error type detection logic

### Phase 2: Enhance Error Logging
- [ ] Review current error logging in codebase
- [ ] Add stack trace capture where missing
- [ ] Include input data snapshots in catch blocks
- [ ] Add system state capture (memory, active jobs)
- [ ] Include operation context in error logs

### Phase 3: Airtable Integration
- [ ] Review Client Execution Log table schema
- [ ] Add fields if needed: Stack Trace, Input Data, System State
- [ ] Create `logCriticalErrorToAirtable()` function
- [ ] Add rate limiting to prevent log spam
- [ ] Implement error log batching (optional)

### Phase 4: Add to Critical Code Paths
- [ ] Wrap AI service calls with critical error logging
- [ ] Wrap Airtable API calls with critical error logging
- [ ] Wrap job tracking operations with critical error logging
- [ ] Add to batch processing error handlers
- [ ] Add to webhook handlers

### Phase 5: Testing & Monitoring
- [ ] Test error logging in staging
- [ ] Verify all required context is captured
- [ ] Check Airtable error log readability
- [ ] Monitor error log volume
- [ ] Tune error classification rules

---

## Current System Status

### Existing Error Logging Infrastructure
- **Client Execution Log table** - Already exists in Airtable
- **Structured logger** - `utils/structuredLogger.js` available
- **Error classes** - `utils/airtableErrors.js` provides specialized errors

### What Needs Enhancement
1. Consistent stack trace capture across all error handlers
2. Input data snapshots in catch blocks
3. Error severity classification
4. Selective Airtable logging (not all errors)
5. System state capture helper

---

## Next Steps

1. **After current bug fixes are complete** - Let system stabilize
2. **Review existing error patterns** - See what actually needs logging
3. **Implement error classifier** - Start with simple rules
4. **Add to highest-value code paths first** - AI calls, Airtable writes, job tracking
5. **Monitor and tune** - Adjust classification rules based on real data

---

## Questions to Answer During Implementation

1. Should we batch error logs to reduce Airtable API calls?
2. What's the retention policy for error logs? (Auto-delete after 90 days?)
3. Should we deduplicate identical errors? (Same error 10x in 1 minute)
4. Do we need alert thresholds? (Email if >10 critical errors in 1 hour)
5. Should we capture request/response payloads for API errors?

---

## Benefits Summary

✅ **Debug production issues without Render log access**  
✅ **Track error patterns over time**  
✅ **Minimal performance overhead (<0.001% of runtime)**  
✅ **Client-specific error tracking**  
✅ **Automated error categorization**  
✅ **Rich context for root cause analysis**

---

**File Location:** `PRODUCTION-ERROR-LOGGING-PLAN.md`  
**Status:** Planning document - to be implemented in separate session  
**Priority:** Medium (after current field standardization fixes are stable)
