# Apify Routes Field Standardization Plan

**Created:** October 6, 2025  
**Branch:** feature/apify-field-constants (NEW - to be created)  
**Status:** Ready to implement  
**Estimated Time:** 1 hour systematic fix vs 2-4 hours whack-a-mole debugging  
**Priority:** HIGH - Blocking production Apify webhook data from saving

---

## Context: Why This Matters

### Current Production Issue

**Error:** `Unknown field name: "undefined"`  
**Location:** Apify webhook processing when updating Client Run Results  
**Impact:** Apify post harvesting data (895 posts, $17.90 costs, 5 profiles) not saving to Airtable  
**Root Cause:** `routes/apifyProcessRoutes.js` uses **raw field name strings** instead of **constants**

### The Pattern We've Been Fixing

Over the past 21 commits on `feature/comprehensive-field-standardization`, we've systematically fixed field name bugs across **11 service implementations**:

**Fixed Services (commits 1-21):**
1. ✅ Job Tracking field normalization (5 services)
2. ✅ Client Run Results field normalization (6 services)
3. ✅ Run ID format standardization (1 route)

**Still Broken:**
- ❌ `routes/apifyProcessRoutes.js` - Uses raw strings like `'Total Posts Harvested'`
- ❌ `routes/apifyWebhookRoutes.js` - Likely same pattern
- ❌ Other Apify-related routes - Unknown

---

## The Problem: Raw Field Names vs Constants

### ❌ Current Anti-Pattern (Lines 882-921 in apifyProcessRoutes.js)

```javascript
// Reading fields - mix of constant and raw strings
const currentPostCount = Number(currentRecord.get('Total Posts Harvested') || 0);
const currentApiCosts = Number(currentRecord.get('Apify API Costs') || 0);
const profilesSubmittedCount = Number(currentRecord.get('Profiles Submitted for Post Harvesting') || 0);
const currentApifyRunId = currentRecord.get(APIFY_RUN_ID); // ← Using constant here

// Writing fields - raw strings
await runRecordService.updateClientMetrics({
  runId: runIdToUse,
  clientId,
  metrics: {
    'Total Posts Harvested': updatedCount,              // ❌ Raw string
    'Apify API Costs': updatedCosts,                    // ❌ Raw string
    [APIFY_RUN_ID]: apifyRunId,                         // ❌ Computed property, but APIFY_RUN_ID is undefined
    'Profiles Submitted for Post Harvesting': updatedProfilesSubmitted  // ❌ Raw string
  }
});
```

### ✅ Correct Pattern (What We Need)

```javascript
// Import constants at top of file
const { 
  CLIENT_RUN_FIELDS,
  APIFY_FIELDS 
} = require('../constants/airtableUnifiedConstants');

// Reading fields - use constants
const currentPostCount = Number(currentRecord.get(CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED) || 0);
const currentApiCosts = Number(currentRecord.get(CLIENT_RUN_FIELDS.APIFY_API_COSTS) || 0);
const profilesSubmittedCount = Number(currentRecord.get(CLIENT_RUN_FIELDS.PROFILES_SUBMITTED) || 0);
const currentApifyRunId = currentRecord.get(CLIENT_RUN_FIELDS.APIFY_RUN_ID);

// Writing fields - use constants as object keys
await runRecordService.updateClientMetrics({
  runId: runIdToUse,
  clientId,
  metrics: {
    [CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED]: updatedCount,
    [CLIENT_RUN_FIELDS.APIFY_API_COSTS]: updatedCosts,
    [CLIENT_RUN_FIELDS.APIFY_RUN_ID]: apifyRunId,
    [CLIENT_RUN_FIELDS.PROFILES_SUBMITTED]: profilesSubmittedCount
  }
});
```

---

## Available Constants (From airtableUnifiedConstants.js)

### CLIENT_RUN_FIELDS (Lines 104-145)

**Apify-related fields we need:**
```javascript
CLIENT_RUN_FIELDS = {
  // Harvesting metrics
  PROFILES_SUBMITTED: 'Profiles Submitted for Post Harvesting',  // ← Line 129
  TOTAL_POSTS_HARVESTED: 'Total Posts Harvested',                 // ← Line 130
  APIFY_RUN_ID: 'Apify Run ID',                                    // ← Line 131
  APIFY_STATUS: 'Apify Status',                                    // ← Line 132
  APIFY_API_COSTS: 'Apify API Costs',                             // ← Line 133
}
```

**Other fields we might need:**
```javascript
CLIENT_RUN_FIELDS = {
  // Core fields
  RUN_ID: 'Run ID',
  CLIENT_ID: 'Client ID',
  CLIENT_NAME: 'Client Name',
  STATUS: 'Status',
  START_TIME: 'Start Time',
  END_TIME: 'End Time',
  
  // System fields
  SYSTEM_NOTES: 'System Notes',
  ERROR_DETAILS: 'Error Details',
  LAST_WEBHOOK: 'Last Webhook',
}
```

### APIFY_FIELDS (Lines 279-291)

**For Apify table operations:**
```javascript
APIFY_FIELDS = {
  APIFY_RUN_ID: 'Apify Run ID',  // Primary field
  RUN_ID: 'Run ID',              // Our system run ID
  ACTOR_ID: 'Actor ID',
  CLIENT_ID: 'Client ID',
  COMPLETED_AT: 'Completed At',
  CREATED_AT: 'Created At',
  DATASET_ID: 'Dataset ID',
  ERROR: 'Error',
  LAST_UPDATED: 'Last Updated',
  MODE: 'Mode',
  STATUS: 'Status',
  TARGET_URLS: 'Target URLs'
}
```

**Note:** The constant exists and is exported (line 327), but we need to verify the import statement actually brings it in.

---

## Files To Audit & Fix

### Priority 1: Currently Failing in Production

**File:** `routes/apifyProcessRoutes.js` (1,267 lines)  
**Current Imports:** Line 15 only imports `APIFY_RUN_ID`  
**Required Fix:** Import full `CLIENT_RUN_FIELDS` and replace all raw strings

**Known Problem Areas:**

1. **Lines 882-885** - Reading current values:
   ```javascript
   const currentPostCount = Number(currentRecord.get('Total Posts Harvested') || 0);
   const currentApiCosts = Number(currentRecord.get('Apify API Costs') || 0);
   const profilesSubmittedCount = Number(currentRecord.get('Profiles Submitted for Post Harvesting') || 0);
   ```

2. **Lines 918-921** - Updating existing record (PRIMARY FAILURE POINT):
   ```javascript
   'Total Posts Harvested': updatedCount,
   'Apify API Costs': updatedCosts,
   [APIFY_RUN_ID]: apifyRunId,  // ← This is causing "undefined" error
   'Profiles Submitted for Post Harvesting': updatedProfilesSubmitted
   ```

3. **Lines 985-988** - Creating new record (LIKELY NEXT FAILURE):
   ```javascript
   'Total Posts Harvested': postsToday,
   'Apify API Costs': estimatedCost,
   [APIFY_RUN_ID]: apifyRunId,
   'Profiles Submitted for Post Harvesting': profilesSubmitted
   ```

4. **Lines 1018-1020** - Another create path (LIKELY FAILURE):
   ```javascript
   'Total Posts Harvested': postsToday,
   'Profiles Submitted for Post Harvesting': targetUrls ? targetUrls.length : 0
   ```

5. **Lines 1133-1136** - Client record reading:
   ```javascript
   clientId: record.get('Client ID'),
   clientName: record.get('Client Name'),
   serviceLevel: record.get('Service Level'),
   status: record.get('Status')
   ```

### Priority 2: Likely Similar Issues

**File:** `routes/apifyWebhookRoutes.js`  
**Check For:** Same pattern of raw field name strings  
**Known Usage:** Lines 243, 252, 501 mention "Profiles Submitted" in grep results

### Priority 3: Comprehensive Audit

**Search Pattern:** All files in `routes/` that contain "Apify" or "Post Harvest"

---

## Systematic Fix Strategy (Path B - Recommended)

### Phase 1: Import Constants (5 minutes)

**File:** `routes/apifyProcessRoutes.js`

**Current import (line 15):**
```javascript
const { APIFY_RUN_ID } = require('../constants/airtableUnifiedConstants');
```

**Updated import:**
```javascript
const { 
  CLIENT_RUN_FIELDS,
  APIFY_FIELDS,
  LEAD_FIELDS 
} = require('../constants/airtableUnifiedConstants');
```

### Phase 2: Find All Raw String Field References (10 minutes)

**Search patterns to use:**
```bash
# In routes/apifyProcessRoutes.js
\.get\(['"]           # Find all .get('...') calls
\.fields\[['"]        # Find all .fields['...'] access
'[A-Z][a-z]+          # Find all 'Title Case strings that might be fields
```

**Expected locations from grep:**
- Line 166: `FOUND_LAST_RUN_FIELD` usage (already using constant ✅)
- Lines 547-549: `STATUS_FIELD`, `POSTS_ACTIONED_FIELD`, `DATE_POSTS_SCORED_FIELD` (constants ✅)
- Line 566: `LINKEDIN_URL_FIELD` (constant ✅)
- Line 580: `LINKEDIN_URL_FIELD` (constant ✅)
- Line 879: `Object.keys(currentRecord.fields)` (OK, not writing ✅)
- **Lines 882-885:** ❌ Need fixing
- Line 962: `'Run ID'` ❌ Need fixing
- Line 1081: `LINKEDIN_URL_FIELD` (constant ✅)
- **Lines 1133-1136:** ❌ Need fixing

### Phase 3: Replace Raw Strings with Constants (20 minutes)

**Priority replacements (in order of execution path):**

1. **Lines 882-885** - Reading current metrics:
   ```javascript
   // BEFORE
   const currentPostCount = Number(currentRecord.get('Total Posts Harvested') || 0);
   const currentApiCosts = Number(currentRecord.get('Apify API Costs') || 0);
   const profilesSubmittedCount = Number(currentRecord.get('Profiles Submitted for Post Harvesting') || 0);
   const currentApifyRunId = currentRecord.get(APIFY_RUN_ID);
   
   // AFTER
   const currentPostCount = Number(currentRecord.get(CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED) || 0);
   const currentApiCosts = Number(currentRecord.get(CLIENT_RUN_FIELDS.APIFY_API_COSTS) || 0);
   const profilesSubmittedCount = Number(currentRecord.get(CLIENT_RUN_FIELDS.PROFILES_SUBMITTED) || 0);
   const currentApifyRunId = currentRecord.get(CLIENT_RUN_FIELDS.APIFY_RUN_ID);
   ```

2. **Lines 918-921** - Updating metrics (PRIMARY FIX):
   ```javascript
   // BEFORE
   metrics: {
     'Total Posts Harvested': updatedCount,
     'Apify API Costs': updatedCosts,
     [APIFY_RUN_ID]: apifyRunId,
     'Profiles Submitted for Post Harvesting': updatedProfilesSubmitted
   }
   
   // AFTER
   metrics: {
     [CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED]: updatedCount,
     [CLIENT_RUN_FIELDS.APIFY_API_COSTS]: updatedCosts,
     [CLIENT_RUN_FIELDS.APIFY_RUN_ID]: apifyRunId,
     [CLIENT_RUN_FIELDS.PROFILES_SUBMITTED]: updatedProfilesSubmitted
   }
   ```

3. **Lines 985-988** - Creating new record:
   ```javascript
   // BEFORE
   metrics: {
     'Total Posts Harvested': postsToday,
     'Apify API Costs': estimatedCost,
     [APIFY_RUN_ID]: apifyRunId,
     'Profiles Submitted for Post Harvesting': profilesSubmitted
   }
   
   // AFTER
   metrics: {
     [CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED]: postsToday,
     [CLIENT_RUN_FIELDS.APIFY_API_COSTS]: estimatedCost,
     [CLIENT_RUN_FIELDS.APIFY_RUN_ID]: apifyRunId,
     [CLIENT_RUN_FIELDS.PROFILES_SUBMITTED]: profilesSubmitted
   }
   ```

4. **Lines 1018-1020** - Another create path:
   ```javascript
   // BEFORE
   metrics: {
     'Total Posts Harvested': postsToday,
     'Profiles Submitted for Post Harvesting': targetUrls ? targetUrls.length : 0
   }
   
   // AFTER
   metrics: {
     [CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED]: postsToday,
     [CLIENT_RUN_FIELDS.PROFILES_SUBMITTED]: targetUrls ? targetUrls.length : 0
   }
   ```

5. **Line 962** - Debug logging:
   ```javascript
   // BEFORE
   console.log(`[DEBUG-RUN-ID-FLOW] - Similar Run ID: ${record.fields['Run ID']}, Record ID: ${record.id}`);
   
   // AFTER
   console.log(`[DEBUG-RUN-ID-FLOW] - Similar Run ID: ${record.fields[CLIENT_RUN_FIELDS.RUN_ID]}, Record ID: ${record.id}`);
   ```

6. **Lines 1133-1136** - Reading client data:
   ```javascript
   // BEFORE - This is reading from Clients table, so we need CLIENT_FIELDS not CLIENT_RUN_FIELDS!
   clientId: record.get('Client ID'),
   clientName: record.get('Client Name'),
   serviceLevel: record.get('Service Level'),
   status: record.get('Status')
   
   // Need to check if CLIENT_FIELDS has these constants...
   ```

### Phase 4: Verify Constant Availability (5 minutes)

**Check if all needed constants exist in airtableUnifiedConstants.js:**

From my read, we have:
- ✅ `CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED` (line 130)
- ✅ `CLIENT_RUN_FIELDS.APIFY_API_COSTS` (line 133)
- ✅ `CLIENT_RUN_FIELDS.APIFY_RUN_ID` (line 131)
- ✅ `CLIENT_RUN_FIELDS.PROFILES_SUBMITTED` (line 129)
- ✅ `CLIENT_RUN_FIELDS.RUN_ID` (line 107)
- ✅ `CLIENT_RUN_FIELDS.CLIENT_ID` (line 108)
- ✅ `CLIENT_RUN_FIELDS.CLIENT_NAME` (line 109)
- ✅ `CLIENT_RUN_FIELDS.STATUS` (line 110)

**For line 1133-1136, we need CLIENT_FIELDS not CLIENT_RUN_FIELDS:**
- Need to check if `CLIENT_FIELDS` exists for the Clients table
- If not, may need to create these constants

### Phase 5: Test Locally (10 minutes)

**Run syntax check:**
```bash
node -c routes/apifyProcessRoutes.js
```

**Look for any:**
- Missing closing braces
- Typos in constant names
- Import errors

### Phase 6: Audit Other Apify Routes (10 minutes)

**File:** `routes/apifyWebhookRoutes.js`

**Check:**
- Line 243: "Track profiles submitted for harvesting"
- Line 252: Reference to profiles submitted
- Line 501: "Determine profiles submitted count from payload"

**Pattern to search:**
```javascript
// Look for raw field names in metrics objects
metrics: {
  'Field Name': value  // ❌ Raw string
}

// Or direct .get() calls
record.get('Field Name')  // ❌ Raw string
```

### Phase 7: Commit Strategy (5 minutes)

**Single focused commit:**
```
fix: Standardize Apify field names to use constants

PROBLEM:
- routes/apifyProcessRoutes.js used raw field name strings
- Caused "Unknown field name: undefined" error in production
- Apify webhook data (posts, costs, profiles) not saving

ROOT CAUSE:
- Import only had APIFY_RUN_ID constant
- But used it in computed property [APIFY_RUN_ID] which required CLIENT_RUN_FIELDS.APIFY_RUN_ID
- Other fields used raw strings like 'Total Posts Harvested'

SOLUTION:
- Import full CLIENT_RUN_FIELDS from airtableUnifiedConstants
- Replace all raw field name strings with constants
- Use computed property syntax for all dynamic keys

LOCATIONS FIXED:
- Lines 882-885: Reading current metric values
- Lines 918-921: Updating existing run record (primary failure point)
- Lines 985-988: Creating new run record
- Lines 1018-1020: Alternative create path
- Line 962: Debug logging
- Lines 1133-1136: Client record reading

IMPACT:
- Apify webhook data will now save successfully
- Consistent with field standardization across 11 other services
- Prevents future "Unknown field name" errors

Part of broader field standardization initiative across codebase.
```

---

## Missing Constants Analysis

### Check: Do We Have All Needed Constants?

**From CLIENT_RUN_FIELDS (lines 104-145):**
```javascript
✅ TOTAL_POSTS_HARVESTED: 'Total Posts Harvested'          // Line 130
✅ APIFY_API_COSTS: 'Apify API Costs'                      // Line 133  
✅ APIFY_RUN_ID: 'Apify Run ID'                            // Line 131
✅ PROFILES_SUBMITTED: 'Profiles Submitted for Post Harvesting'  // Line 129
✅ RUN_ID: 'Run ID'                                        // Line 107
✅ CLIENT_ID: 'Client ID'                                  // Line 108
✅ CLIENT_NAME: 'Client Name'                              // Line 109
✅ STATUS: 'Status'                                        // Line 110
```

**For Clients table (lines 1133-1136):**
Need to check if `CLIENT_FIELDS` constant group exists...

**From airtableUnifiedConstants.js exports (line 322+):**
```javascript
module.exports = {
  MASTER_TABLES,
  CLIENT_TABLES,
  CLIENT_FIELDS,      // ← Need to check if this has the fields we need
  LEAD_FIELDS,
  CLIENT_RUN_FIELDS,  // ✅ Has all our Apify metrics fields
  ...
}
```

**Action:** Read CLIENT_FIELDS to see what's available for Clients table operations.

---

## Alternative Path A: Whack-a-Mole (Not Recommended)

**What would happen if we just fix current bug:**

1. Fix APIFY_RUN_ID import issue (10 min)
2. Deploy to Render (5 min)
3. Run test (2 min)
4. ❌ NEXT ERROR: "Unknown field name: Total Posts Harvested" (raw string at line 918)
5. Fix that (5 min)
6. Deploy (5 min)
7. Run test (2 min)
8. ❌ NEXT ERROR: Same issue at line 985
9. Fix that (5 min)
10. Deploy (5 min)
11. Run test (2 min)
12. ❌ NEXT ERROR: Same issue at line 1018
13. ... etc ...

**Total Time:** 2-4 hours of iterative debugging, multiple deploys, constant context switching

**Risk:** Easy to miss edge cases, inconsistent fixes, deployment fatigue

---

## Why This Keeps Happening

### Root Cause: No Enforcement

**Current state:**
- Constants file exists ✅
- Good patterns documented ✅
- Some code uses constants ✅
- Some code uses raw strings ⚠️
- No linting to catch violations ❌
- No tests to verify field names ❌
- No validation on startup ❌

### Proposed Future Work (After This Fix)

1. **ESLint Rule:** Detect raw field name strings in Airtable operations
2. **Schema Validation:** Check constants match actual Airtable schema on startup
3. **Integration Tests:** Verify field names work with real Airtable API
4. **TypeScript Migration:** Type safety would catch many of these issues

**See:** `TECHNICAL-DEBT-CLEANUP-PLAN.md` for comprehensive plan

---

## Success Criteria

### After This Branch Merges

**Production verification:**
1. ✅ Run smart-resume test with Apify post harvesting
2. ✅ Check logs show NO "Unknown field name" errors
3. ✅ Verify Client Run Results record has populated values:
   - Total Posts Harvested: 895 (or current value)
   - Apify API Costs: $17.90 (or current value)
   - Profiles Submitted: 5 (or current value)
   - Apify Run ID: (the Apify run identifier)
4. ✅ Verify System Notes shows "Apify webhook received" timestamp

**Code quality:**
1. ✅ All Apify field references use constants
2. ✅ No raw field name strings in routes/apifyProcessRoutes.js
3. ✅ No raw field name strings in routes/apifyWebhookRoutes.js
4. ✅ Consistent pattern with other 11 fixed services

**Documentation:**
1. ✅ Clear commit message explaining all changes
2. ✅ Update CLIENT-RUN-RESULTS-FIXES-COMPLETE.md to include Apify routes
3. ✅ Add "Apify Routes Field Standardization" to BUSINESS-LOGIC-ERRORS-FOUND.md

---

## Related Documentation

**Current branch context:**
- `CLIENT-RUN-RESULTS-FIXES-COMPLETE.md` - Summary of 6 service fixes (commits 17-21)
- `BUSINESS-LOGIC-ERRORS-FOUND.md` - List of business logic issues from screenshot
- `TECHNICAL-DEBT-CLEANUP-PLAN.md` - Broader technical debt strategy

**Field constants:**
- `constants/airtableUnifiedConstants.js` - Single source of truth for field names

**Other fixes in this effort:**
- Commits 1-16: Job Tracking field normalization
- Commits 17-19: Client Run Results field normalization  
- Commit 20: Diagnostic logging for Run ID mismatch
- Commit 21: Run ID format fix

**Next recommended:**
- Service layer consolidation (see TECHNICAL-DEBT-CLEANUP-PLAN.md section on "Multiple Competing Service Layers")
- ESLint rules to prevent raw field name usage
- Integration tests for Airtable operations

---

## Quick Start for New Chat

**Context needed:**
1. We're on commit 21 of feature/comprehensive-field-standardization
2. Fixed 11 service implementations with field normalization
3. Apify routes still use raw field names - blocking production
4. Decision made: Systematic fix (Path B) vs iterative debugging (Path A)

**Immediate action:**
```bash
# Create new branch
git checkout -b feature/apify-field-constants

# Start with apifyProcessRoutes.js
# 1. Update imports (line 15)
# 2. Replace raw strings at lines 882-885, 918-921, 985-988, 1018-1020, 962, 1133-1136
# 3. Test syntax: node -c routes/apifyProcessRoutes.js
# 4. Commit with detailed message
# 5. Check apifyWebhookRoutes.js for same pattern
# 6. Deploy and test
```

**Expected outcome:**
- Single commit fixing all field references
- 1 hour total work vs 2-4 hours of debugging
- Production Apify data saving successfully
- Consistent with other service fixes

---

## Notes for AI Assistant

**Context preservation:**
- User has been debugging for ~6 hours through multiple deploy-test-fix cycles
- Started with field name errors, found same bug in 11 files
- Fixed systematically, but routes layer still has issues  
- User's time is valuable - systematic fix saves 1-3 hours

**Critical constraints:**
- Use ONLY constants from airtableUnifiedConstants.js
- NO defensive fixes - only fix identified root causes
- Follow same pattern as commits 17-21 (field normalization)
- All dynamic object keys need computed property syntax: `[CONSTANT]` not `CONSTANT`

**Success pattern:**
1. Import full constant groups
2. Replace ALL raw strings with constants
3. Use computed properties for dynamic keys
4. Test syntax before committing
5. Single focused commit with detailed message

**Watch out for:**
- CLIENT_FIELDS vs CLIENT_RUN_FIELDS (different tables!)
- Computed property syntax: `[CONST]` required for dynamic keys
- Import statement must include ALL needed constant groups
- Some grep results are duplicates (tool quirk)
