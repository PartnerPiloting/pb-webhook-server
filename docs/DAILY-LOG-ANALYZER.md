# Daily Log Analyzer - Standalone Utility

## Overview
Analyzes Render production logs for errors and saves them to the Production Issues table in Airtable.

## Key Features
✅ **Incremental Analysis** - Picks up from where previous run left off (no re-analysis)  
✅ **Stack Trace Linking** - Automatically looks up stack traces from Stack Traces table  
✅ **Pattern Matching** - Uses 31+ regex patterns to detect CRITICAL, ERROR, WARNING issues  
✅ **No Duplicates** - Only analyzes new logs since last checkpoint  
✅ **Fast** - Completes in 1-5 minutes for 24 hours of logs  

## Usage

### Manual Run (Testing)
```bash
# Analyze from last checkpoint to now
node daily-log-analyzer.js

# Analyze specific run
node daily-log-analyzer.js --runId=251013-100000
```

### Production (Cron Job on Render)

**Schedule:** Daily at 6am UTC (or your preferred time)

**Command:** `node daily-log-analyzer.js`

**Cron Expression:** `0 6 * * *`

**Setup in Render:**
1. Go to your service → Settings → Cron Jobs
2. Add new cron job:
   - Name: Daily Log Analyzer
   - Command: `node daily-log-analyzer.js`
   - Schedule: `0 6 * * *`
3. Save

## How It Works

### Incremental Processing Flow
```
Day 1 @ 6am:
  → Looks up latest run's "Last Analyzed Log ID" field
  → Fetches Render logs from that timestamp → now
  → Runs pattern matching to find errors
  → Creates Production Issue records
  → Stores new "Last Analyzed Log ID" for next day

Day 2 @ 6am:
  → Starts from Day 1's "Last Analyzed Log ID"
  → No overlap, no re-analysis
  → Only new logs processed
```

### Stack Trace Lookup
When analyzer finds error with `STACKTRACE:2025-10-13T10:45:00Z` marker:
1. Extracts timestamp from log
2. Queries Stack Traces table for matching record
3. Retrieves full stack trace
4. Saves to Production Issues table's "Stack Trace" field

## Environment Variables Required
- `RENDER_API_KEY` - For fetching logs from Render
- `AIRTABLE_API_KEY` - For saving Production Issues
- `MASTER_CLIENTS_BASE_ID` - For Production Issues table

## Output Example
```
🔍 DAILY LOG ANALYZER: Starting...
🔄 Auto mode: Analyzing from last checkpoint to now
📍 Found latest run 251013-100000 - continuing from 2025-10-13T10:45:00Z
✅ Analysis complete
   Time range: 2025-10-13T10:45:00Z → now
   Found: 5 issues (2 critical, 3 errors, 0 warnings)
   Saved: 5 errors to Production Issues table
📍 Stored last analyzed timestamp: 2025-10-13T16:30:00Z
✅ Daily log analyzer completed successfully
```

## Benefits vs. Auto-Analyzer in Endpoint

**Old way (auto-analyzer after scoring):**
- ❌ Duplicates - every run created duplicate errors
- ❌ Timing issues - delay guessing (6 min?) to wait for background jobs
- ❌ Slow - scoring endpoint had to wait for log analysis
- ❌ Complex - catch-up logic, reconciliation APIs

**New way (standalone cron):**
- ✅ No duplicates - runs once per day
- ✅ No timing issues - runs hours after all jobs complete
- ✅ Fast scoring endpoint - no log analysis overhead
- ✅ Simple - one clear time when errors are detected
- ✅ Reliable - picks up from last checkpoint automatically

## Troubleshooting

**"No previous runs found"**
- First run ever - will analyze last 24 hours
- Normal behavior, will work incrementally from next run

**"Failed to store last analyzed timestamp"**
- Check Job Tracking table has "Last Analyzed Log ID" field
- Check Airtable API permissions

**No errors found but you know there are errors**
- Check timestamp range is correct
- Verify error patterns match your log format
- Review `config/errorPatterns.js` for pattern list

## Related Files
- `services/productionIssueService.js` - Core analysis logic
- `services/logFilterService.js` - Pattern matching engine
- `config/errorPatterns.js` - Error detection patterns
- `constants/airtableUnifiedConstants.js` - Field name constants

## Migration Notes

Removed auto-analyzer from `/smart-resume-client-by-client` endpoint:
- See commit: "Move log analysis to standalone daily cron utility"
- File: `routes/apiAndJobRoutes.js` line ~5330
- Replaced 120+ lines of auto-analyzer logic with 9-line notice

Manual analysis still available via API:
- `POST /api/analyze-logs/recent` with `minutes` parameter
- `POST /api/analyze-logs/text` for arbitrary log text
