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
Production errors are automatically logged to the **Error Log table** in the Master Clients Airtable base with full debugging context (stack trace, input data, system state, etc.).

### Error Log Service
- **Location**: `utils/errorLogger.js`
- **Purpose**: Capture critical errors to Airtable for debugging without needing Render logs
- **Classification**: `utils/errorClassifier.js` determines which errors are critical enough to log

### Key Functions Available

```javascript
// Query errors
await getNewErrors()                    // Get all NEW status errors
await getNewErrors({ filterByClient })  // Filter by specific client
await getErrorById(recordId)            // Get full error details

// Manage errors
await markErrorAsFixed(recordId, commitHash, fixedBy, notes)
await updateResolutionNotes(recordId, notes)
```

### Common AI Commands (Use These!)

**Query Errors:**
- "Show production errors" → Query Error Log for NEW errors
- "What errors happened today?" → Filter by recent timestamp
- "Show errors for Guy Wilson" → Filter by client
- "Show me error #5 details" → Get full error context

**Fix Errors:**
- "Fix error #3" → Read error, fix code, commit, auto-mark as FIXED
- "Fix all module import errors" → Batch fix similar errors
- "Add note to error #2: [your note]" → Update resolution notes

**Error Details Include:**
- Error message & stack trace
- File path, line number, function name
- Severity (CRITICAL, ERROR, WARNING)
- Error type (Module Import, AI Service, Airtable API, etc.)
- Full context JSON (runId, clientId, input data, system state)
- Auto-populated: Fixed In Commit, Fixed By, Fixed Date

### Error Table Location
- **Base**: Master Clients Airtable base
- **Table**: Error Log
- **Status Values**: NEW, INVESTIGATING, FIXED, IGNORED
- **Constants**: `constants/airtableUnifiedConstants.js` (ERROR_LOG_FIELDS)

### Workflow
1. Production error occurs → Auto-logged to Airtable (Status: NEW)
2. User asks "Show production errors" → AI queries Error Log table
3. User says "Fix error #X" → AI fixes code, commits, auto-updates Airtable
4. Error marked FIXED with commit hash, date, and resolution notes

### Configuration
- **Enable/Disable**: Set `DISABLE_ERROR_LOGGING=true` to turn off
- **Rate Limit**: Max 100 errors/hour (prevents log spam)
- **Deduplication**: Same error within 5 minutes = single record
- **Sanitization**: Passwords, tokens, API keys automatically redacted

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