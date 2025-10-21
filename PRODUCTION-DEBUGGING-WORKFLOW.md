# Production Debugging Workflow - Complete Reference

## Critical Workflow Pattern

### Step 1: Verify Deployment Status
**ALWAYS check deployment timestamps BEFORE claiming fixes are deployed**

- Check Render dashboard deployment log for latest commit hash and timestamp
- Timestamps are shown in **AEST (UTC+10)** - Australian Eastern Standard Time
- Convert to UTC by **subtracting 10 hours** when needed
- Example: 9:35pm AEST = 11:35am UTC (same day if before 2pm AEST, previous day if after 2pm AEST)

**Render Staging URL**: https://pb-webhook-server-staging.onrender.com
**Deployment Branch**: feature/comprehensive-field-standardization

### Step 2: Fetch Production Issues from STAGING (Not Local)
**CRITICAL: Always use the staging API endpoint, never local code**

```bash
# Get all unfixed production issues
https://pb-webhook-server-staging.onrender.com/api/analyze-issues?status=unfixed

# Filter by severity
https://pb-webhook-server-staging.onrender.com/api/analyze-issues?status=unfixed&severity=ERROR

# Filter by run ID
https://pb-webhook-server-staging.onrender.com/api/analyze-issues?runId=251012-114302

# Filter by client
https://pb-webhook-server-staging.onrender.com/api/analyze-issues?client=Guy-Wilson
```

**Use `fetch_webpage` tool with these URLs - DO NOT read local files**

### Step 3: Compare Timestamps
**Critical for determining if errors are pre-fix or post-fix**

1. Note deployment "live" timestamp from Render (in AEST)
2. Note error timestamps from Production Issues table (in AEST)
3. Compare:
   - **Error BEFORE deployment**: Old error, may already be fixed
   - **Error AFTER deployment**: New error or fix didn't work

### Step 4: Solve Issues One by One
**Strict ROOT CAUSE only approach**

#### Rules:
1. **No defensive validation** - Let future mistakes fail loudly
2. **No bandaids** - Fix the actual cause, not symptoms
3. **Use existing data** - Don't manipulate/strip/transform if source already has what you need
4. **Use constants** - Always use EXECUTION_DATA_KEYS, CLIENT_RUN_FIELDS, etc. from airtableUnifiedConstants.js
5. **Plain English explanations** - User wants simple explanations of what went wrong

#### Process:
1. Read error from Production Issues API (staging endpoint)
2. Find exact source location (use stack traces if available)
3. Identify ROOT CAUSE (not symptoms)
4. Implement minimal fix
5. Explain in plain English
6. Commit with detailed message
7. Push immediately
8. Move to next issue

### Step 5: Commit Message Format
```
Fix [SEVERITY]: [Brief description]

ROOT CAUSE:
- [What actually caused the problem]
- [Why it happened]
- [When it manifests]

FIX:
- [Exact change made]
- [Why this fixes it]
- [What code now does instead]

PLAIN ENGLISH:
- [Simple explanation using analogies]

Fixes issues #XXX, #YYY ([SEVERITY] severity - N instances)
```

### Step 6: Mark Issues as Fixed
**After deployment and validation, clean up Production Issues table**

```bash
# Option 1: Mark specific issues by pattern
POST https://pb-webhook-server-staging.onrender.com/api/mark-issue-fixed
Body: {
  "pattern": "Cannot access logger",
  "commitHash": "ac812bf",
  "fixNotes": "Fixed TDZ error by using console.error in initialization checks"
}

# Option 2: Mark specific issues by ID
POST https://pb-webhook-server-staging.onrender.com/api/mark-issue-fixed
Body: {
  "issueIds": [393, 398],
  "commitHash": "ac812bf", 
  "fixNotes": "Description of fix"
}
```

## Common Pitfalls to Avoid

### ❌ DON'T: Assume fixes are deployed
- Just because you committed doesn't mean Render deployed it
- Always check Render dashboard for deployment status
- Check commit hash matches your latest commit

### ❌ DON'T: Read local Production Issues
- Local code might be different from deployed code
- Always use staging API endpoint to fetch issues
- Use `fetch_webpage` tool, not `read_file`

### ❌ DON'T: Add defensive validation
- User explicitly wants fail-fast approach
- Silent failures hide bugs
- Let errors surface immediately

### ❌ DON'T: Use literal strings for property names
- Always use constants from airtableUnifiedConstants.js
- Example: Use `EXECUTION_DATA_KEYS.STATUS` not `'status'`
- Prevents uppercase/lowercase mismatches

### ❌ DON'T: Manipulate data if source already has it
- Example: Don't strip client suffix from Run ID if parentRunId already exists
- Use what's already there
- Prefer existing data over transformations

## Key Files Reference

### Configuration & Constants
- `constants/airtableUnifiedConstants.js` - All field names, status values, data keys
- `.env` - Environment variables (not committed to git)

### Services (Backend)
- `services/clientService.js` - Client management, execution logs
- `services/jobTracking.js` - Job tracking records
- `services/runRecordAdapterSimple.js` - Client run records (single creation point pattern)
- `services/logFilterService.js` - Production error detection (31+ patterns)
- `services/productionIssueService.js` - Production Issues table operations

### Scoring
- `batchScorer.js` - Multi-tenant batch lead scoring
- `postBatchScorer.js` - Post-scoring workflow
- `singleScorer.js` - Single lead scoring

### Routes
- `routes/apiAndJobRoutes.js` - Main API endpoints (leads, scoring, attributes)
- `index.js` - Server initialization, health checks, debug endpoints

## Important Constants

### EXECUTION_DATA_KEYS (for formatExecutionLog data objects)
```javascript
const EXECUTION_DATA_KEYS = {
  STATUS: 'status',
  LEADS_PROCESSED: 'leadsProcessed',
  POST_SCORING: 'postScoring',
  DURATION: 'duration',
  TOKENS_USED: 'tokensUsed',
  ERRORS: 'errors',
  PERFORMANCE: 'performance',
  NEXT_ACTION: 'nextAction'
};
```

### CLIENT_EXECUTION_LOG_FIELDS (for formatted output labels)
```javascript
const CLIENT_EXECUTION_LOG_FIELDS = {
  EXECUTION_LOG: 'Execution Log',
  STATUS: 'Status',
  LEADS_PROCESSED: 'Leads Processed',
  POSTS_SCORED: 'Posts Scored',
  DURATION: 'Duration',
  TOKENS_USED: 'Tokens Used',
  ERRORS: 'Errors',
  PERFORMANCE: 'Performance',
  NEXT_ACTION: 'Next Action'
};
```

### Run ID Formats
- **Base format**: `251012-085512` (used in Job Tracking table)
- **Client-suffixed format**: `251012-085512-Guy-Wilson` (used in Client Run Results table)
- **When to use which**: Use `parentRunId` for Job Tracking lookups, `runId` for Client Run Results

## Timezone Conversions

### AEST to UTC
- **AEST = UTC+10** (always, no daylight saving in our context)
- **Subtract 10 hours** to convert AEST to UTC
- **Examples**:
  - Oct 12, 9:35pm AEST = Oct 12, 11:35am UTC
  - Oct 12, 1:00am AEST = Oct 11, 3:00pm UTC (previous day!)

### When comparing timestamps:
1. Note deployment time from Render (AEST)
2. Note error time from Production Issues (AEST)
3. Both in same timezone, direct comparison works
4. If error timestamp > deployment timestamp → error occurred AFTER fix

## Production Issues Table Schema

**Location**: Master Clients Airtable base → Production Issues table

### Key Fields:
- **Issue ID** - Auto-incrementing number
- **Error Message** - Full error text with context
- **Severity** - CRITICAL, ERROR, WARNING
- **Pattern Matched** - Which error pattern detected it
- **Run ID** - Which run produced the error
- **Client ID** - Which client was processing
- **Status** - NEW, INVESTIGATING, FIXED, IGNORED
- **Timestamp** - When error occurred (AEST)
- **Stack Trace** - Linked to Stack Traces table
- **Fixed Time** - When marked as FIXED
- **Fix Commit** - Git commit hash of the fix
- **Fix Notes** - Description of what was fixed

## Session Handover Checklist

When starting a new debugging session, verify:

1. ✅ Latest deployment commit hash from Render dashboard
2. ✅ Latest deployment timestamp (AEST)
3. ✅ Production Issues fetched from staging endpoint
4. ✅ Timestamp comparison done (pre-fix vs post-fix errors)
5. ✅ Constants imported in files being modified
6. ✅ Root cause identified (not symptoms)
7. ✅ Plain English explanation ready
8. ✅ Commit message follows format
9. ✅ Push completed before moving to next issue

## Examples of Past Fixes

### Issue #1: Execution Log undefined (First occurrence)
**Root Cause**: `formatExecutionLog` destructured with `[CLIENT_EXECUTION_LOG_FIELDS.STATUS]` expecting uppercase 'Status', but caller passed lowercase 'status'
**Fix**: Changed destructuring to use simple property names matching caller
**Commit**: 56bb9f1

### Issue #2: Unknown field 'undefined'
**Root Cause**: `CLIENT_RUN_FIELDS.PROCESSING_COMPLETED` constant doesn't exist
**Fix**: Removed the line completely - field doesn't exist in Airtable schema
**Commit**: d1fa378

### Issue #3: Job Tracking record not found
**Root Cause**: Auto-analyzer searched with client-suffixed Run ID, Job Tracking uses base format
**Fix**: Use `parentRunId` parameter instead of stripping suffix from `runId`
**Commit**: 797ef83

### Issue #4: Execution Log undefined (Second occurrence)
**Root Cause**: `logExecution()` POST_SCORING branch used `[CLIENT_EXECUTION_LOG_FIELDS.STATUS]` as object key (uppercase), but `formatExecutionLog` expects lowercase
**Fix**: Use constants for property keys: `[EXECUTION_DATA_KEYS.STATUS]` instead of `[CLIENT_EXECUTION_LOG_FIELDS.STATUS]`
**Commit**: ac1fa46

### Issue #5: Cannot access 'logger' before initialization
**Root Cause**: Module initialization checks tried to use `logger.error()` but no module-level logger variable exists
**Fix**: Use `console.error()` for initialization checks that run before any logger can be created
**Commit**: ac812bf

## Questions to Ask User

Before starting debugging session:
1. "What timestamp do you see on recent deploys in Render dashboard (UTC+10)?"
2. "What timestamp do you see on Production Issues records (UTC+10)?"
3. "Have you deleted old pre-fix issues from the table?"

During debugging:
1. "Is this a root cause fix or a bandaid?" (User wants root cause only)
2. "Can you explain this in plain English?" (User prefers simple explanations)
3. "Are we using existing data or manipulating it?" (User prefers using existing data)

## URLs for AI Reference

### Production Debugging
- **Get unfixed issues**: https://pb-webhook-server-staging.onrender.com/api/analyze-issues?status=unfixed
- **Mark issue fixed**: https://pb-webhook-server-staging.onrender.com/api/mark-issue-fixed (POST)
- **Cleanup old issues**: https://pb-webhook-server-staging.onrender.com/api/cleanup-old-production-issues (GET)

### Render Dashboard
- **Staging deployment log**: https://dashboard.render.com (check pb-webhook-server-staging service)
- **Branch**: feature/comprehensive-field-standardization

### Airtable
- **Master Clients Base**: Contains Production Issues table, Job Tracking table, Client Run Results table
- **Client Bases**: Each client has separate base (e.g., "My Leads - Guy Wilson")

## Final Notes

- **ALWAYS** verify deployment before claiming fixes are live
- **ALWAYS** fetch Production Issues from staging API endpoint
- **ALWAYS** use constants instead of literal strings
- **ALWAYS** explain in plain English when asked
- **NEVER** add defensive validation (fail-fast approach)
- **NEVER** manipulate data if source already has what you need
- **NEVER** assume - verify timestamps, deployment status, error context

This workflow ensures systematic, verifiable bug fixing with no assumptions and no bandaids.
