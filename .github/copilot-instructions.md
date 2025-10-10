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

## Auto-Analyzer Testing & Validation

### Auto-Analyzer Timing Configuration

**Environment Variable**: `AUTO_ANALYZER_DELAY_MINUTES`
- **Purpose**: Delay before auto-analyzer runs after job completion
- **Default**: 6 minutes (allows background jobs to finish and write errors to logs)
- **Location**: Set in Render environment variables
- **Why it matters**: Background jobs (post scoring, metrics updates) continue after main script returns. Analyzer must wait for these jobs to complete and write errors to Render logs.

**Background Job Timing:**
- Typical duration: 4-6 minutes (varies by workload, API latency, rate limits)
- Jobs run asynchronously after main endpoint returns Run ID
- Jobs write errors to stdout/stderr with Run ID tags
- Auto-analyzer must wait long enough to capture all background job errors

**Testing Mode:**
- Set `AUTO_ANALYZER_DELAY_MINUTES=0` to recreate original bug (misses background errors)
- Used for Phase 2 validation (catch-up logic should back-fill missed errors)

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
- **captureRate = 100%**: Auto-analyzer working perfectly
- **captureRate < 100%**: Background jobs took longer than delay setting
- **adjustedCaptureRate**: Excludes deprecation warnings and noise from calculation

### Testing Workflow

**After a run on Render:**
1. Note the Run ID from response (e.g., `251010-192838`)
2. Note the timestamp from Production Issues table in Airtable (in AEST)
3. Convert AEST to UTC (subtract 10 hours)
4. Call reconciliation API with Run ID and UTC timestamp
5. Check `captureRate` - should be 100%
6. If < 100%, review `inLogNotInTable` errors and their timestamps
7. Calculate latest error timestamp minus run start time = minimum delay needed
8. Add 1-2 minute safety margin to account for workload variability

**Example Calculation:**
- Run started: Oct 10 19:28 UTC
- Latest error: Oct 10 19:32:19 UTC
- Duration: 4 minutes 19 seconds
- Recommended delay: 6 minutes (includes 1.5 min safety margin)

### Phase 2: Catch-Up Logic (Planned)

**Purpose**: Belt-and-suspenders approach to guarantee 100% capture even if delay is insufficient

**Design:**
1. Add "Last Analyzed Log ID" field to Job Tracking table
2. After each auto-analyzer run, store the last log entry ID processed
3. On next run, check previous run's record for new logs since last ID
4. Analyze missed logs and extract errors with original Run ID (from log pattern)
5. Save to Production Issues table with original Run ID (back-fill)

**Testing Phase 2:**
1. Set `AUTO_ANALYZER_DELAY_MINUTES=0` (recreates bug)
2. Run job, verify capture rate < 100%
3. Run second job (Phase 2 catches missed errors from first run)
4. Re-run reconciliation on first run ID
5. Should now show 100% (errors back-filled with original Run ID)

**Key Files:**
- `routes/apiAndJobRoutes.js` - Auto-analyzer invocation with delay
- `reconcile-errors.js` - Validation utility script
- `index.js` - API endpoint wrapper for reconciliation
- `config/errorPatterns.js` - Error pattern matching for log analysis

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