# Production Error Debugging Guide

## Overview

This system automatically captures production errors from Render logs, analyzes them with pattern matching, links them to stack traces, and saves them to Airtable for tracking and fixing.

**Key Point**: 🚨 All debugging must be done using **live utilities on Render staging** because local environment doesn't have required environment variables (AIRTABLE_API_KEY, MASTER_CLIENTS_BASE_ID, RENDER_API_KEY, etc.).

---

## System Architecture

### Data Flow
```
Render Logs (stdout/stderr)
    ↓
Daily Log Analyzer (pattern matching)
    ↓
Production Issues Table (Airtable)
    ↓
Stack Traces Table (linked via timestamp markers)
    ↓
Debug → Fix → Mark as FIXED
```

### Components

1. **Production Issues Table** (Airtable - Master Clients Base)
   - Stores all detected errors with context
   - Fields: Timestamp, Severity, Pattern Matched, Error Message, Run ID, Stack Trace link, Status

2. **Stack Traces Table** (Airtable - Master Clients Base)
   - Detailed stack traces for debugging
   - Linked to Production Issues via unique timestamp markers
   - Contains file paths, line numbers, full stack trace

3. **Daily Log Analyzer** (`daily-log-analyzer.js`)
   - Standalone utility that analyzes Render logs
   - Uses 31+ error patterns to detect issues
   - Runs once per day via cron OR on-demand via API
   - Incremental: picks up from last checkpoint (no duplicates)

4. **Error Pattern Matching** (`config/errorPatterns.js`)
   - 31+ regex patterns for CRITICAL, ERROR, WARNING detection
   - 97-98% accuracy in production
   - Categories: Database errors, API failures, validation errors, crashes, etc.

---

## Airtable Schema

### Production Issues Table

| Field Name | Type | Purpose |
|------------|------|---------|
| Issue ID | Auto Number | Unique identifier |
| Time Created | Created Time | When issue was logged |
| Timestamp | Date/Time | When error occurred in logs |
| Severity | Single Select | CRITICAL, ERROR, WARNING |
| Pattern Matched | Single Line Text | Which error pattern detected it |
| Error Message | Long Text | Full error message with context |
| Context | Long Text | 25 lines before/after error |
| Stack Trace | Link to Record | Links to Stack Traces table |
| Run ID | Single Line Text | Which scoring run caused it |
| Stream | Number | Which stream (if applicable) |
| Client ID | Single Line Text | Which client was being processed |
| Status | Single Select | NEW, INVESTIGATING, FIXED, IGNORED |
| Fixed Time | Date/Time | When marked as fixed |
| Fix Commit | Single Line Text | Git commit hash of the fix |
| Fix Notes | Long Text | Explanation of what was fixed |

### Stack Traces Table

| Field Name | Type | Purpose |
|------------|------|---------|
| Timestamp Marker | Single Line Text | Unique marker (e.g., "STACKTRACE:1697123456789") |
| Stack Trace | Long Text | Full stack trace from error |
| File Path | Single Line Text | Which file threw the error |
| Line Number | Number | Which line number |
| Error Type | Single Line Text | Error class (TypeError, ReferenceError, etc.) |
| Production Issues | Link to Record | Reverse link to issues using this trace |

---

## API Endpoints (Render Staging)

**Base URL**: `https://pb-webhook-server-staging.onrender.com`

### 1. Analyze Production Issues

**Endpoint**: `GET /api/analyze-issues`

**Purpose**: View and filter production errors by severity, pattern, run, or date

**Query Parameters**:
- `status=unfixed` - Only show unfixed issues
- `severity=ERROR` - Filter by severity (CRITICAL, ERROR, WARNING)
- `runId=251012-123456` - Filter by specific run
- `days=7` - Show issues from last N days

**Response**:
```json
{
  "total": 17,
  "bySeverity": { "CRITICAL": 2, "ERROR": 15, "WARNING": 0 },
  "topIssues": [
    {
      "pattern": "FATAL ERROR:",
      "severity": "CRITICAL",
      "count": 2,
      "percentage": "11.8",
      "message": "Full error message...",
      "examples": [
        { "runId": "251012-143358", "timestamp": "2025-10-12T14:34:13Z" }
      ]
    }
  ]
}
```

**Usage**:
```bash
# Get all unfixed issues
curl "https://pb-webhook-server-staging.onrender.com/api/analyze-issues?status=unfixed"

# Get critical issues only
curl "https://pb-webhook-server-staging.onrender.com/api/analyze-issues?severity=CRITICAL"

# Get issues from last 7 days
curl "https://pb-webhook-server-staging.onrender.com/api/analyze-issues?days=7"
```

### 2. Mark Issues as Fixed

**Endpoint**: `POST /api/mark-issue-fixed`

**Purpose**: Mark errors as FIXED after deploying a fix

**Request Body** (Option 1 - by pattern):
```json
{
  "pattern": "Record not found",
  "commitHash": "a9bce6e",
  "fixNotes": "Fixed by adding null check in JobTracking.getJobById"
}
```

**Request Body** (Option 2 - by Issue IDs):
```json
{
  "issueIds": [400, 401, 402],
  "commitHash": "a9bce6e",
  "fixNotes": "Fixed by adding null check"
}
```

**Response**:
```json
{
  "success": true,
  "updatedCount": 6,
  "message": "Marked 6 issues as FIXED"
}
```

**Usage**:
```bash
# Mark all "Record not found" errors as fixed
curl -X POST https://pb-webhook-server-staging.onrender.com/api/mark-issue-fixed \
  -H "Content-Type: application/json" \
  -d '{"pattern":"Record not found","commitHash":"a9bce6e","fixNotes":"Added null check"}'
```

**Important**: 
- Marks ALL unfixed issues matching the pattern (across all runs)
- This is intentional - if the bug reappears tomorrow, new errors will prove it wasn't actually fixed
- Use specific patterns to avoid marking wrong issues

### 3. Run Daily Log Analyzer

**Endpoint**: `POST /api/run-daily-log-analyzer`

**Purpose**: On-demand analysis of Render logs for new errors

**Headers**:
```
Authorization: Bearer Diamond9753!!@@pb
Content-Type: application/json
```

**Request Body** (Optional):
```json
{
  "runId": "251013-100000"  // Analyze specific run, or omit for auto mode
}
```

**Response**:
```json
{
  "ok": true,
  "issues": 5,
  "createdRecords": 5,
  "summary": {
    "critical": 0,
    "error": 5,
    "warning": 0
  },
  "lastLogTimestamp": "2025-10-13T00:41:18.849695397Z",
  "message": "Analyzed from last checkpoint. Found 5 issues."
}
```

**Usage**:
```bash
# Local test utility (auto mode)
node test-daily-log-analyzer-staging.js

# Analyze specific run
node test-daily-log-analyzer-staging.js 251013-100000

# Or use curl
curl -X POST https://pb-webhook-server-staging.onrender.com/api/run-daily-log-analyzer \
  -H "Authorization: Bearer Diamond9753!!@@pb" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Debugging Workflow

### Step 1: View Production Issues

```bash
# See all unfixed errors grouped by pattern
curl -s "https://pb-webhook-server-staging.onrender.com/api/analyze-issues?status=unfixed" | less
```

**What you'll see**:
- Total number of unfixed errors
- Breakdown by severity (CRITICAL, ERROR, WARNING)
- Top issues grouped by pattern with occurrence counts
- Example error messages and timestamps

### Step 2: Identify Unique Root Causes

Look at the patterns and group similar errors:

**Example**:
```
Total: 17 errors
Unique root causes: 5

1. FATAL ERROR (2x) - CRITICAL
2. batch.*failed (4x) - ERROR
3. INVALID_VALUE_FOR_COLUMN (3x) - ERROR
4. Failed to create|update (2x) - ERROR
5. Record not found (6x) - ERROR
```

### Step 3: Investigate Each Error

**Get full details from Airtable**:
1. Open Master Clients Airtable base
2. Go to "Production Issues" table
3. Filter by pattern or severity
4. Click "Stack Trace" link to see full debugging info

**Stack Trace provides**:
- Exact file path (e.g., `services/jobTracking.js`)
- Line number where error occurred
- Full stack trace showing call chain
- Error type and message

### Step 4: Fix the Bug

1. **Locate the code**: Use file path and line number from stack trace
2. **Read the error message**: Understand what went wrong
3. **Review context**: Check the 25 lines before/after in error message
4. **Implement fix**: Make the code change
5. **Test locally** (if possible) or deploy to staging
6. **Commit the fix**: Note the commit hash

### Step 5: Mark as Fixed

```bash
# After committing the fix
curl -X POST https://pb-webhook-server-staging.onrender.com/api/mark-issue-fixed \
  -H "Content-Type: application/json" \
  -d '{
    "pattern": "Record not found",
    "commitHash": "a9bce6e",
    "fixNotes": "Added null check in JobTracking.getJobById before accessing fields"
  }'
```

**What this does**:
- Updates ALL matching unfixed Production Issues
- Sets Status → FIXED
- Records Fix Commit hash
- Records Fix Notes
- Sets Fixed Time → now
- Allows tracking if issue reappears (proves fix didn't work)

### Step 6: Verify Fix

**Option 1: Wait for next run**
- Let system run naturally
- Check if same error appears again
- If it does, fix wasn't complete

**Option 2: Test immediately**
- Trigger a scoring run on staging
- Run daily-log-analyzer
- Check if new errors appear

---

## Error Pattern Categories

The system detects 31+ error patterns across these categories:

### CRITICAL Errors
- FATAL ERROR
- Uncaught exceptions
- Process crashes
- Memory errors (OOM)
- Unhandled promise rejections

### Database/Airtable Errors
- INVALID_VALUE_FOR_COLUMN
- INVALID_MULTIPLE_CHOICE_OPTIONS  
- Record not found
- Failed to create|update|fetch|delete
- Table does not exist
- Invalid permissions

### API Errors
- 429 Rate limiting
- 401 Unauthorized
- 403 Forbidden
- 500 Internal server errors
- Timeout errors

### Validation Errors
- Required field missing
- Type mismatch
- Invalid format
- Schema validation failures

### Business Logic Errors
- batch.*failed
- scoring.*failed
- Client processing errors
- Workflow failures

---

## File Locations

### Core System Files
- `daily-log-analyzer.js` - Standalone log analysis utility
- `services/productionIssueService.js` - Main service for error capture
- `services/renderLogService.js` - Fetches logs from Render API
- `services/stackTraceService.js` - Manages stack trace records
- `services/logFilterService.js` - Pattern matching engine
- `config/errorPatterns.js` - 31+ error pattern definitions
- `utils/errorHandler.js` - Error logging with stack traces

### Test/Debug Utilities
- `test-daily-log-analyzer-staging.js` - Test analyzer on Render
- `analyze-production-issues.js` - Standalone issue analyzer (requires env vars)
- `mark-issue-fixed.js` - CLI tool to mark issues fixed (Render only)

### API Endpoints
- `index.js` - Contains `/api/run-daily-log-analyzer` endpoint
- `routes/apiAndJobRoutes.js` - Contains `/api/analyze-issues` and `/api/mark-issue-fixed`

### Documentation
- `PRODUCTION-ERROR-DEBUGGING-GUIDE.md` - This file
- `DAILY-LOG-ANALYZER-SETUP.md` - Setup guide for Render environment
- `HANDOVER-STACK-TRACE-DEBUGGING.md` - Stack trace system details
- `HANDOVER-AUTO-ANALYZER-DEBUG-SESSION.md` - Historical context

---

## Common Scenarios

### Scenario 1: "What production errors do we have?"

```bash
curl -s "https://pb-webhook-server-staging.onrender.com/api/analyze-issues?status=unfixed"
```

Response tells you:
- Total unfixed errors
- Breakdown by severity
- Top issues with counts and percentages

### Scenario 2: "How many unique issues?"

Count the distinct `pattern` values in the response. Multiple occurrences of the same pattern = same root cause.

**Example**:
```
17 total errors = 5 unique root causes:
1. FATAL ERROR (2 occurrences)
2. batch.*failed (4 occurrences)
3. INVALID_VALUE_FOR_COLUMN (3 occurrences)
4. Failed to update (2 occurrences)
5. Record not found (6 occurrences)
```

### Scenario 3: "Let's fix issue #1"

1. **Get details**:
   - Look at error message in API response
   - Open Production Issues table in Airtable
   - Click Stack Trace link for file/line number

2. **Investigate**:
   ```bash
   # Read the relevant code file
   # Example: services/jobTracking.js line 867
   ```

3. **Fix and deploy**:
   ```bash
   git add -A
   git commit -m "Fix: Add null check for job record before accessing fields"
   git push origin feature/branch-name
   # Note the commit hash (e.g., a9bce6e)
   ```

4. **Mark as fixed**:
   ```bash
   curl -X POST https://pb-webhook-server-staging.onrender.com/api/mark-issue-fixed \
     -H "Content-Type: application/json" \
     -d '{"pattern":"Record not found","commitHash":"a9bce6e","fixNotes":"Added null check"}'
   ```

### Scenario 4: "Did the fix work?"

**Option 1**: Check if issue reappears
- Run another scoring job
- Run daily-log-analyzer
- Check if same pattern appears in new Production Issues

**Option 2**: Check fixed issues
```bash
curl -s "https://pb-webhook-server-staging.onrender.com/api/analyze-issues"
# Look at issues with Status = FIXED
# If they appear again with Status = NEW, fix didn't work
```

---

## Important Notes

### Why We Can't Debug Locally

❌ **Local debugging doesn't work** because:
- Missing `AIRTABLE_API_KEY` (can't read Production Issues table)
- Missing `MASTER_CLIENTS_BASE_ID` (can't access Master base)
- Missing `RENDER_API_KEY` (can't fetch Render logs)
- Missing `RENDER_OWNER_ID` (can't authenticate with Render)

✅ **Solution**: Use live utilities on Render staging via API

### How Daily Log Analyzer Works

**Incremental Processing**:
1. Looks up "Last Analyzed Log ID" from previous run
2. Fetches Render logs from that timestamp → now
3. Analyzes logs with pattern matching
4. Saves new errors to Production Issues table
5. Stores new "Last Analyzed Log ID" for next run

**No Duplicates**:
- Only analyzes NEW logs since last checkpoint
- Won't re-analyze old logs
- Each error logged once per occurrence

**Cron Schedule**:
- Runs once daily at 11am UTC
- Can also trigger on-demand via API
- Typical runtime: 1-5 minutes for 24 hours of logs

### Pattern Matching Accuracy

- **97-98% accuracy** in production
- **31+ patterns** covering common error types
- **False positives**: Rare, usually deprecation warnings
- **False negatives**: Very rare, mostly custom error formats

### Stack Trace Linking

Errors are linked to stack traces via **timestamp markers**:

```javascript
// Error logged with unique marker
console.error('[STACKTRACE:1697123456789] TypeError: Cannot read...')
```

When daily-log-analyzer finds an error:
1. Extracts timestamp marker from log
2. Looks up full stack trace in Stack Traces table
3. Links Production Issue to Stack Trace record
4. Provides direct navigation to debugging info

---

## Troubleshooting

### "No issues found but I see errors in Airtable"

**Cause**: Analyzer hasn't run since those errors occurred

**Solution**:
```bash
# Trigger on-demand analysis
node test-daily-log-analyzer-staging.js
```

### "Marked as fixed but issue reappeared"

**Cause**: Fix didn't address root cause, or there are multiple bugs with same pattern

**Solution**:
1. Review the error message more carefully
2. Check if file/line number is different
3. May need more comprehensive fix

### "Daily analyzer says 0 issues but I know there were errors"

**Cause 1**: Errors occurred outside time window being analyzed

**Solution**: Run with specific runId to target that time period

**Cause 2**: Error pattern not recognized by system

**Solution**: 
1. Check `config/errorPatterns.js` for pattern match
2. Add new pattern if needed
3. Re-run analyzer

### "Can't access Production Issues table in Airtable"

**Cause**: Looking at wrong base or wrong table name

**Solution**:
- Base: Master Clients (not Guy Wilson's base)
- Table: "Production Issues" (exact spelling)
- Check if you have access permissions

---

## Quick Reference Commands

```bash
# View all unfixed production errors
curl -s "https://pb-webhook-server-staging.onrender.com/api/analyze-issues?status=unfixed"

# View critical errors only
curl -s "https://pb-webhook-server-staging.onrender.com/api/analyze-issues?severity=CRITICAL"

# Run daily log analyzer (auto mode)
node test-daily-log-analyzer-staging.js

# Run daily log analyzer (specific run)
node test-daily-log-analyzer-staging.js 251013-100000

# Mark issues as fixed
curl -X POST https://pb-webhook-server-staging.onrender.com/api/mark-issue-fixed \
  -H "Content-Type: application/json" \
  -d '{"pattern":"error text","commitHash":"abc123","fixNotes":"description"}'
```

---

## Next Steps for New Chat

When starting a fresh debugging session:

1. **Paste this document** as context
2. **Ask**: "What production issues do we have?"
3. **System will**: Call `/api/analyze-issues?status=unfixed`
4. **Review**: Total errors and unique patterns
5. **Ask**: "How many unique issues are there?"
6. **System will**: Group by pattern and count root causes
7. **Ask**: "Let's fix them one by one"
8. **System will**: Start with highest priority (CRITICAL first)

For each issue:
- Get error details from API
- Find stack trace in Airtable
- Locate code file and line
- Implement fix
- Commit changes
- Mark as FIXED via API
- Move to next issue

---

**Created**: October 13, 2025  
**Last Updated**: October 13, 2025  
**Version**: 1.0  
**Branch**: feature/comprehensive-field-standardization
