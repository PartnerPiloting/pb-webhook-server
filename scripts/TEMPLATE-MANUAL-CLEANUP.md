# Template Base - Manual Cleanup Steps

## Overview
After running the automated template cleanup script, you need to **manually delete 9 legacy tables** in Airtable. The Airtable API does not support table deletion, so this must be done through the Airtable UI.

## Why Manual Deletion?
- Airtable's API does **not** support deleting tables (404 NOT_FOUND error)
- The `schema.bases:write` scope only allows creating and updating tables, not deleting them
- Manual deletion via Airtable UI is quick (< 2 minutes) and ensures clean template

## Tables to Delete Manually

After running the cleanup script, delete these **9 legacy tables** from your template base:

1. **Boolean Searches**
2. **Concept Dictionary**
3. **Name Parsing Rules**
4. **Project Tasks**
5. **Attributes Blob**
6. **Campaigns**
7. **Scoring Attributes 06 08 25**
8. **Instructions + Thoughts**
9. **Test Post Scoring**

## Keep These 6 Core Tables

**DO NOT DELETE** these tables - they are required for the system to function:

1. **Leads** (cleared by script)
2. **Connection Request Parameters** (cleared by script)
3. **Credentials** (updated with defaults by script)
4. **Scoring Attributes** (preserved with seed data)
5. **Post Scoring Attributes** (preserved with seed data)
6. **Post Scoring Instructions** (preserved with seed data)

## How to Delete Tables in Airtable UI

1. Open your template base in Airtable
2. For each legacy table listed above:
   - Click the table tab at the top
   - Click the **▼** dropdown arrow next to the table name
   - Select **Delete table**
   - Confirm deletion
3. Verify you have exactly **6 tables** remaining

## Complete Workflow

### Step 1: Run Automated Script
```bash
# Via Render API (recommended)
POST https://pb-webhook-server-staging.onrender.com/api/template-cleanup/clean-base
Body: {
  "baseId": "appXXXXXXXXXXXX",
  "deepClean": false,  # No need for deep clean since API can't delete tables
  "dryRun": false
}

# Or local script
node scripts/clean-template-base.js appXXXXXXXXXXXX
```

### Step 2: Manual Table Deletion (< 2 minutes)
Delete the 9 legacy tables listed above via Airtable UI

### Step 3: Rename Base (Optional)
Rename the cleaned base to: **"Template - Client Leads"**

### Step 4: Use Template
- Base ID: `[save for onboard-new-client.js]`
- Future onboarding: Just duplicate this template (30 seconds vs 20 minutes!)

## Verification Checklist

After cleanup, your template base should have:

- ✅ **6 tables total**
- ✅ **Leads**: 0 records
- ✅ **Connection Request Parameters**: 0 records  
- ✅ **Credentials**: 1 record with defaults (AI Score Threshold=50, Posts Threshold=30, Last Export=null)
- ✅ **Scoring Attributes**: 23 records (preserved)
- ✅ **Post Scoring Attributes**: 5 records (preserved)
- ✅ **Post Scoring Instructions**: 7 records (preserved)

## Time Savings

- **Old way**: Duplicate Guy Wilson base + manual cleanup = 20 minutes
- **New way**: Duplicate template base = 30 seconds
- **Template creation**: One-time 10 minutes (script 8 sec + manual deletion 2 min)

**ROI**: After 2nd client onboarding, you've already saved time!
