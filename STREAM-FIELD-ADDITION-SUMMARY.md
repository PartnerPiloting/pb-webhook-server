# Stream Field Addition Summary

## What Was Added

A new **Stream** field to the Production Issues table to track which processing stream an error occurred in.

---

## Field Specification

**Field Name:** `Stream`  
**Field Type:** `Number` (Integer format)  
**Position:** Field #10 (between "Run Type" and "Client ID")  
**Description:** Which processing stream (1, 2, or 3) was running when this error occurred  
**Example Values:** 1, 2, 3  
**Optional:** Yes (may be empty for non-stream operations)

---

## Code Changes Made

### 1. **services/productionIssueService.js**

Added Stream to FIELDS constants:
```javascript
const FIELDS = {
  // ... existing fields ...
  RUN_TYPE: 'Run Type',
  STREAM: 'Stream',  // ← NEW
  CLIENT: 'Client ID',
  // ... rest of fields ...
};
```

Added Stream to createProductionIssue():
```javascript
if (issue.stream) {
  fields[FIELDS.STREAM] = parseInt(issue.stream, 10);
}
```

### 2. **AIRTABLE-PRODUCTION-ISSUES-SCHEMA.md**

- Updated field count: 18 → 19 fields total
- Metadata Fields: 4 → 5 fields
- Added Stream field definition in proper position
- Updated setup instructions
- Added note about Stream field purpose

---

## Airtable Setup Required

### Add This Field to Your Table:

1. Open **Master Clients Base** in Airtable
2. Go to **Production Issues** table
3. Add new field after "Run Type":
   - **Name:** `Stream`
   - **Type:** `Number`
   - **Format:** Integer
   - **Description:** "Which processing stream (1, 2, or 3) was running"

---

## Why This Is Useful

### Troubleshooting Benefits:

**Pattern Detection:**
```
Issue #1: "Gemini timeout" - Stream 1 - 2:30 PM
Issue #2: "Gemini timeout" - Stream 2 - 2:30 PM
```
→ "Both streams hit Gemini simultaneously - concurrent load issue, not a code bug"

**Stream-Specific Issues:**
```
Issue #3: "Bad data error" - Stream 2 - 2:35 PM
Issue #4: "Bad data error" - Stream 2 - 2:40 PM
```
→ "Stream 2 has problematic clients - investigate those specifically"

**Easy Filtering:**
- Filter Airtable: "Show me all Stream 1 issues"
- Compare streams: "Does Stream 2 have more errors than Stream 1?"

---

## How It Works

When smart-resume runs:

1. **Stream determined:** `stream = 1` (or 2, 3)
2. **Run ID created:** `251008-143015` (includes stream in context)
3. **Errors occur during execution** (if any)
4. **Log analysis runs at end:**
   - Fetches logs from actual start/end times
   - Filters by run ID `[251008-143015]`
   - Pattern matches errors
   - **Creates Production Issues with stream number**

Example Production Issue record:
```
Issue ID: 42
Timestamp: 2025-10-08 14:35:22
Severity: ERROR
Run Type: smart-resume
Stream: 1          ← NEW FIELD
Client ID: Guy Wilson
Error Message: "Gemini API timeout after 30s"
```

---

## Next Steps

1. ✅ Code updated (completed)
2. ✅ Documentation updated (completed)
3. ⏳ **YOU:** Add Stream field to Airtable Production Issues table
4. ⏳ Test with next smart-resume run
5. ⏳ Verify Stream field populates correctly

---

## Testing

After adding the field to Airtable, trigger a test smart-resume run:

```bash
curl -X POST https://pb-webhook-server-staging.onrender.com/smart-resume-client-by-client \
  -H "x-webhook-secret: Diamond9753!!@@pb" \
  -H "Content-Type: application/json" \
  -d '{"stream": 1}'
```

Check Production Issues table - any new records should have Stream = 1
