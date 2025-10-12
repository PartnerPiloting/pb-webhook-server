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