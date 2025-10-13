# PB-Webhook-Server AI Coding Instructions

## Architecture Overview

This is a **multi-tenant LinkedIn lead management system** with AI-powered scoring. Core architecture:
- **Backend**: Node.js/Express API deployed on Render (`index.js` + `routes/`)
- **Frontend**: Next.js React app deployed on Vercel (`linkedin-messaging-followup-next/`)
- **Data**: Multi-tenant Airtable architecture with Master Clients base + individual client bases
- **AI**: Google Gemini (primary) + OpenAI (backup) for lead scoring

## Multi-Tenant Architecture (Critical)

**Master Control**: Single "Clients" base contains client registry
**Client Data**: Each client has separate Airtable base (`My Leads - [Client Name]`)

### Service Boundaries
- `services/clientService.js` - Client management, handles switching between client bases
- `config/airtableClient.js` - Dynamic base connections via `getClientBase(clientId)`
- All API endpoints require `x-client-id` header for client isolation

### Data Flow
1. Frontend sends `x-client-id` header with all API calls
2. Backend resolves client via `clientService.getClientById(clientId)`
3. Operations execute against client-specific Airtable base
4. Results logged to client's execution log in Master base

## Development Workflow

### Local Development Commands
```bash
# Start development (use VS Code tasks)
npm run dev:api        # Backend on port 3001
npm run dev:front      # Frontend on port 3000
npm run dev:simple     # Both concurrently

# Debug/restart
npm run dev:reset      # Kill stray node processes
npm run ports:free 3000 3001  # Force-kill ports
```

### Key Files Structure
- `index.js` - Main server with initialization checks
- `routes/apiAndJobRoutes.js` - Primary API endpoints (leads, scoring, attributes)
- `services/leadService.js` - Lead CRUD with multi-tenant support
- `singleScorer.js` + `batchScorer.js` - AI scoring engines
- `promptBuilder.js` - AI prompt construction

## Environment Configuration

### Required Variables
```bash
# Airtable
AIRTABLE_API_KEY=pat_xxx
AIRTABLE_BASE_ID=appXXX (Guy Wilson's base)
MASTER_CLIENTS_BASE_ID=appXXX (Clients registry)

# AI Services
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GCP_PROJECT_ID=your-project
GCP_LOCATION=us-central1
GEMINI_MODEL_ID=gemini-2.5-pro-preview-05-06
OPENAI_API_KEY=sk-xxx

# Auth
PB_WEBHOOK_SECRET=Diamond9753!!@@pb
```

## Critical Patterns & Conventions

### Multi-Tenant API Pattern
```javascript
// Always extract clientId from headers
const clientId = req.headers['x-client-id'];
const clientBase = await getClientBase(clientId);

// Use client-specific base for operations
const leads = await clientBase('Leads').select().all();
```

### Error Isolation
- Each client operation wrapped in try/catch
- Client failures don't affect other clients
- Structured logging with `utils/structuredLogger.js`

### AI Scoring Integration
- Gemini primary, OpenAI fallback pattern
- Batch processing in chunks (configurable via `BATCH_CHUNK_SIZE`)
- Token usage tracking per client
- Timeout handling with `GEMINI_TIMEOUT_MS`

### Configuration Loading Pattern
```javascript
// Always check initialization in index.js style
const geminiConfig = require('./config/geminiClient.js');
if (!geminiConfig?.geminiModel) {
    console.error("FATAL ERROR: Gemini Model failed to initialize");
}
```

## Testing & Debugging

### Health Checks
- `/health` - Basic server status
- `/debug-gemini-info` - AI service status
- `/debug-clients` - Multi-tenant status (requires DEBUG_API_KEY)

### Production Error Debugging System ⭐
**The system automatically captures ALL production errors with full stack traces and context.**

**How it works:**
1. All operations on Render write logs to stdout/stderr
2. Pattern-based scanner analyzes logs with 31+ regex patterns (97-98% accuracy)
3. Errors saved to **Production Issues table** in Master Clients base with full debugging info
4. Stack traces linked via unique markers for instant root cause identification

**Airtable Tables (Master Clients Base):**
- **Production Issues** - Main error tracking table
  - Fields: Error Message, Severity, Pattern Matched, Stack Trace, Run ID, Client ID, Status, Fixed Time, Fix Commit, Fix Notes
  - Status values: NEW, INVESTIGATING, FIXED, IGNORED
- **Stack Traces** - Detailed stack traces with file/line numbers
  - Links to Production Issues via unique markers
  - Contains full stack trace, file paths, line numbers, error context
- **Job Tracking** - Run metadata for time window lookups
  - Used by auto-analyzer to determine log analysis window

**Key endpoints:**
- `GET /api/analyze-issues` - View and filter production errors by severity, pattern, run, client
  - Query params: `?status=unfixed`, `?severity=ERROR`, `?runId=251012-123456`, `?days=7`
- `POST /api/mark-issue-fixed` - Mark errors as FIXED with commit hash and notes
  - Body: `{ pattern: "error text", commitHash: "abc123", fixNotes: "description" }`
  - OR: `{ issueIds: [123, 124], commitHash: "abc123", fixNotes: "description" }`
- `POST /api/analyze-logs/recent` - Analyze recent Render logs (specify minutes)
- `POST /api/analyze-logs/text` - Analyze arbitrary log text

**Debug workflow:**
1. Run operations on Render
2. Check Production Issues table in Airtable (or call `/api/analyze-issues`)
3. Click stack trace to see exact file/line causing error
4. Fix bug, commit with hash
5. Mark issue as FIXED: `POST /api/mark-issue-fixed` with pattern + commit hash
6. System tracks: NEW → INVESTIGATING → FIXED → measures fix effectiveness

**Cleanup after fixing bugs:**
Use `/api/mark-issue-fixed` endpoint - it automatically updates Production Issues table:
- Sets Status = "FIXED"
- Records Fix Commit hash
- Records Fix Notes (your explanation)
- Sets Fixed Time = now
- Finds ALL matching unfixed issues (across all runs) and marks them FIXED

**Example cleanup script:**
```javascript
const https = require('https');
const data = JSON.stringify({
    pattern: 'Cannot access logger',
    commitHash: 'd2ccab2',
    fixNotes: 'Fixed TDZ error by creating tempLogger'
});
// POST to https://pb-webhook-server-staging.onrender.com/api/mark-issue-fixed
```

**Real-world value:** In Oct 2024 debugging session, stack traces enabled fixing 16 production errors in under 2 hours. Without stack traces, would have taken days of manual log analysis. Jump straight to bug location instead of guessing.

**Files:**
- `services/productionIssueService.js` - Main service
- `services/logFilterService.js` - Pattern detection engine
- `config/errorPatterns.js` - 31+ error patterns
- `routes/apiAndJobRoutes.js` - API endpoints for analysis and cleanup
- Master Clients base → Production Issues table

**Branch independence:** ✅ This system works across ALL branches and environments
- Production Issues table is in Master Clients Airtable base (persistent across branches)
- API endpoints work on any deployed environment (staging, production)
- Stack traces capture errors regardless of which branch is running
- Use this debugging workflow on any branch, any environment, any deployment

### Common Issues
- **Port conflicts**: Use `npm run dev:reset` then restart tasks
- **AI scoring failures**: Check `/debug-gemini-info` endpoint
- **Multi-tenant issues**: Verify `x-client-id` header and client exists in Master base
- **Memory crashes**: See `MEMORY-CRASH-WARNING.md` for batch size limits

## Production Error Logging System

### Overview
Production errors are captured by analyzing Render logs using pattern-based detection. Errors are saved to the **Production Issues table** in the Master Clients Airtable base.

### Architecture (Single System - Pattern-Based Log Analysis)
- **Location**: `config/errorPatterns.js` + `services/logFilterService.js`
- **How it works**: Scans Render logs with 31+ regex patterns for CRITICAL/ERROR/WARNING detection
- **Coverage**: 97-98% (analyzes all logs, not just caught errors)
- **API endpoints**: `/api/analyze-logs/recent`, `/api/analyze-logs/text`

### Error Detection Process
1. Operations run on Render → logs written to stdout/stderr
2. Pattern-based scanner analyzes logs (either via API call or scheduled)
3. Errors extracted with context (25 lines before/after, stack traces)
4. Saved to Production Issues table with full debugging info
5. Errors tracked through fix workflow (NEW → INVESTIGATING → FIXED)

### Production Issues Table
- **Base**: Master Clients Airtable base
- **Table**: Production Issues
- **Status Values**: NEW, INVESTIGATING, FIXED, IGNORED
- **Fields**: Error message, stack trace, severity, error type, context, timestamps

### How to Analyze Errors

**API Endpoints:**
- `POST /api/analyze-logs/recent` - Analyze recent Render logs (last N minutes)
- `POST /api/analyze-logs/text` - Analyze arbitrary log text

**Workflow:**
1. Run operations on Render
2. Call `/api/analyze-logs/recent` with minutes parameter
3. Errors automatically saved to Production Issues table
4. Review errors in Airtable, fix code, mark as FIXED

### Note on Legacy System
Prior to Oct 9, 2025, a second system (direct error logger in `utils/errorLogger.js`) existed but has been fully removed. All error detection now uses pattern-based log analysis only.

## Log Analyzer (Standalone - No Longer Auto-Runs)

### ⚠️ IMPORTANT: Analyzer is Now Standalone

**The auto-analyzer was REMOVED from the batch scoring endpoint.** It is now a **standalone checkpoint-based system** that runs separately.

**How to Run the Analyzer:**

1. **Manual API Call** (preferred for testing):
   ```bash
   POST https://pb-webhook-server-staging.onrender.com/api/analyze-logs/recent
   Body: { "minutes": 30 }  # Analyze last 30 minutes of logs
   ```

2. **Helper Script** (local development):
   ```bash
   node run-analyzer-now.js
   ```

3. **Daily Cron Job** (production - automated):
   - Runs once daily via `daily-log-analyzer.js`
   - Uses checkpoint system (Last Analyzed Log ID from Job Tracking table)
   - Picks up from where it left off, no duplicates

**Why the Change:**
- Keeps batch scoring endpoint fast (no analyzer overhead)
- Avoids duplicate error detection
- Checkpoint system ensures 100% coverage with no gaps
- Allows on-demand analysis without waiting for next batch run

**Background Job Timing:**
- Typical duration: 4-6 minutes (varies by workload, API latency, rate limits)
- Jobs run asynchronously after main endpoint returns Run ID
- Jobs write errors to stdout/stderr with Run ID tags
- **Wait 15+ minutes after job completion** before running analyzer manually to ensure all background jobs have finished writing to logs

### Reconciliation API (Validation Tool)

**Purpose**: Validate that auto-analyzer captured all errors for a specific run

**Endpoint**: `POST /api/reconcile-errors`

**Parameters:**
```json
{
  "runId": "251010-192838",
  "startTime": "2025-10-10T19:28:00.000Z"
}
```

**Critical: Time Zone Conversion**
- Airtable shows timestamps in **AEST** (UTC+10, Australian Eastern Standard Time)
- Render logs are in **UTC**
- **Conversion**: Subtract 10 hours from AEST to get UTC
- **Example**: Oct 11 5:28am AEST = Oct 10 19:28 UTC (previous day!)
- **Note**: AEST, not AEDT (daylight saving). Always UTC+10 offset.

**Response Structure:**
```json
{
  "stats": {
    "totalInLogs": 5,
    "totalInTable": 3,
    "matched": 3,
    "inLogNotInTable": 2,
    "captureRate": 60,
    "adjustedCaptureRate": 60
  },
  "errors": {
    "matched": [...],
    "inLogNotInTable": [...],
    "realErrors": [...],
    "warnings": [...]
  }
}
```

**Interpreting Results:**
- **captureRate = 100%**: Analyzer captured all errors successfully
- **captureRate < 100%**: Some errors may have been missed or logged after analysis window
- **adjustedCaptureRate**: Excludes deprecation warnings and noise from calculation

### Testing Workflow

**After a run on Render:**
1. Wait 15+ minutes for all background jobs to finish writing logs
2. Trigger analyzer: `POST /api/analyze-logs/recent` with `{ "minutes": 30 }`
3. Check Production Issues table for new errors
4. (Optional) Run reconciliation to validate 100% capture
5. Note the Run ID from response (e.g., `251010-192838`)
6. Note the timestamp from Production Issues table in Airtable (in AEST)
7. Convert AEST to UTC (subtract 10 hours)
8. Call reconciliation API with Run ID and UTC timestamp
9. Check `captureRate` - should be 100%

**Example Calculation:**
- Run started: Oct 10 19:28 UTC
- Latest error: Oct 10 19:32:19 UTC
- Duration: 4 minutes 19 seconds
- Recommended wait time: 15 minutes (includes safety margin for all background jobs)

**Key Files:**
- `routes/apiAndJobRoutes.js` - Manual analyzer API endpoints
- `daily-log-analyzer.js` - Daily cron job for automated analysis
- `run-analyzer-now.js` - Helper script for manual analysis
- `services/productionIssueService.js` - Checkpoint-based analyzer with Last Analyzed Log ID
- `reconcile-errors.js` - Validation utility script
- `config/errorPatterns.js` - Error pattern matching for log analysis (31+ patterns)

## Key Integration Points

### Frontend ↔ Backend
- Frontend uses `services/api.js` with automatic `x-client-id` header injection
- Authentication pattern: `getAuthenticatedHeaders()` in all API calls

### Airtable Webhooks
- `routes/webhookHandlers.js` processes LinkedHelper data updates
- Field mapping handles profile data normalization

### Apify Integration
- Multi-tenant LinkedIn post scraping via `routes/apifyWebhookRoutes.js`
- Run tracking in Master base, data sync to client bases

## Documentation References

For deeper context:
- `SYSTEM-OVERVIEW.md` - Complete architecture overview
- `BACKEND-DEEP-DIVE.md` - Technical implementation details
- `DEV-RUNBOOK.md` - Development workflow guide
- `DOCS-INDEX.md` - Master documentation index

## Performance Notes

- Client data cached for 5 minutes in `clientService.js`
- Batch operations process clients sequentially to avoid resource conflicts
- Use `limit` query parameter for testing large operations
- Monitor token usage via client execution logs

## Conversational Error Investigation (Phase 2)

### When User Asks About Production Issues

**Trigger phrases:**
- "Can you investigate the log issues by severity?"
- "What errors do we have?"
- "Show me the production issues"
- "Analyze the log issues"
- "What are the top errors?"

**What to do:**
1. Call `fetch_webpage` with URL: `https://pb-webhook-server-staging.onrender.com/api/analyze-issues`
2. Parse the JSON response to extract:
   - CRITICAL severity issues (always show)
   - ERROR severity issues (always show)
   - WARNING severity issues (show if actionable: rate limits, auth failures, validation errors, timeouts)
   - Exclude: deprecation warnings, debug logs, build warnings
3. Show prioritized list with:
   - Frequency counts (e.g., "5 occurrences, 55% of errors")
   - File locations from error messages
   - Priority ranking (CRITICAL > ERROR > WARNING)
   - Actionable recommendations
4. Ask: "Ready to investigate this issue?"

**API Response Structure:**
```json
{
  "total": 23,
  "bySeverity": {"ERROR": 9, "WARNING": 14},
  "topIssues": [
    {
      "pattern": "Error pattern name",
      "severity": "ERROR",
      "count": 5,
      "percentage": "21.7",
      "message": "Full error message with context",
      "examples": [{"runId": "...", "timestamp": "...", "clientId": "..."}]
    }
  ]
}
```

**Example Response Format:**
```
📊 Production Issues Summary

🔴 CRITICAL & ERROR: 9 issues
1. ❌ Batch scoring crash (5x, 55% of errors) - batchScorer.js:277
   Priority: CRITICAL 🔥
   
2. ❌ Record not found (2x, 22% of errors) - job tracking
   Priority: ERROR - HIGH
   
3. ❌ Logger initialization bug (1x, 11% of errors) - apiAndJobRoutes.js
   Priority: ERROR - HIGH

⚠️ ACTIONABLE WARNINGS: 14 issues
1. ⚠️ 429 Rate limiting (14x, 100% of warnings)
   Priority: WARNING - Investigate API throttling
   
💡 Hidden: 0 low-priority warnings (deprecations, debug logs)

I suggest we start with #1: Batch scoring crash (CRITICAL)
This is affecting 55% of all errors.

Ready to investigate and fix?
```

**Next Steps After User Agrees:**
1. Extract file path and line number from error message
2. Read the relevant code section
3. Analyze the error context
4. Propose a specific fix
5. Implement fix if user approves
6. **After fixing:** Mark issue as FIXED in Production Issues table

**Marking Issues as FIXED:**

**Trigger phrases:**
- "Mark it off the list"
- "Mark that as fixed"
- "Can you mark it off"
- "Update the Production Issues table"

**What to do:**
After implementing a fix and committing it, extract the commit hash and use the most specific pattern from the error message to mark issues as FIXED.

```javascript
// Use fetch_webpage to call the API
const response = await fetch_webpage({
  url: 'https://pb-webhook-server-staging.onrender.com/api/mark-issue-fixed',
  method: 'POST',
  body: {
    pattern: 'at scoreChunk',  // Text to search in Error Message field
    commitHash: '6203483',      // Git commit hash from the fix commit
    fixNotes: 'Fixed batch scoring crash by passing runId string instead of logger object'
  }
});
```

This will:
- Find all Production Issues with that pattern and Status != FIXED (across ALL runs)
- Update them: Status → FIXED, Fixed Time → now, Fix Commit → hash, Fix Notes → description
- Return summary of updated issues
- **Note:** Marks ALL matching unfixed issues regardless of run date (self-correcting: if bug reappears tomorrow, new errors will show it wasn't actually fixed)

**Alternative:** Specify exact Issue IDs instead of pattern:
```javascript
{
  issueIds: [123, 124],
  commitHash: 'abc123',
  fixNotes: 'Description of fix'
}
```

**Key Files:**
- Production Issues table: Master Clients Airtable base
- API endpoints: 
  - `GET /api/analyze-issues` (analyze and list issues)
  - `POST /api/mark-issue-fixed` (mark issues as fixed)
- Helper script: `helpers/issueInvestigator.js` (for reference)
- Standalone script: `mark-issue-fixed.js` (for CLI use on Render)
- Analysis script: `analyze-production-issues.js` (standalone CLI tool)