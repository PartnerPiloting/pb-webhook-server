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
2. Parse the JSON response to extract ERROR severity issues
3. Show prioritized list with:
   - Frequency counts (e.g., "5 occurrences, 55% of errors")
   - File locations from error messages
   - Priority ranking (CRITICAL > HIGH > MEDIUM)
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
📊 Found 9 ERROR issues in Production Issues

Top 3 by priority:
1. ❌ Batch scoring crash (5x, 55%) - batchScorer.js:277
   Priority: CRITICAL 🔥
   
2. ❌ Record not found (2x, 22%) - job tracking
   Priority: HIGH
   
3. ❌ Logger initialization bug (1x, 11%) - apiAndJobRoutes.js
   Priority: HIGH

I suggest we start with #1: Batch scoring crash
This is affecting 55% of errors.

Ready to investigate and fix?
```

**Next Steps After User Agrees:**
1. Extract file path and line number from error message
2. Read the relevant code section
3. Analyze the error context
4. Propose a specific fix
5. Implement fix if user approves

**Key Files:**
- Production Issues table: Master Clients Airtable base
- API endpoint: `GET /api/analyze-issues` (public, no auth)
- Helper script: `helpers/issueInvestigator.js` (for reference)
- Analysis script: `analyze-production-issues.js` (standalone CLI tool)