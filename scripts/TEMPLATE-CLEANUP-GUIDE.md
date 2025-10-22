# Template Base Cleanup Guide

## Overview
The `clean-template-base.js` script automates cleaning a duplicated Guy Wilson base to create a fresh client template.

## What Gets Cleaned

### 🧼 Basic Mode (Default)
**Tables with records DELETED:**
- `Leads` - All lead data cleared (posts are stored as JSON in "Posts Content" field)
- `Connection Request Parameters` - LinkedHelper automation settings cleared

**Tables UPDATED (not deleted):**
- `Credentials` - Single record updated with default values:
  - AI Score Threshold Input: 50
  - Posts Threshold Percentage: 30%
  - Last LH Leads Export: null
  - Top Leads Last Export At: null

**Tables PRESERVED (seed data kept):**
- `Scoring Attributes` - Profile scoring rubric (all records kept)
- `Post Scoring Attributes` - Post scoring rubric (all records kept)
- `Post Scoring Instructions` - AI prompt components (all records kept)

### 🔥 Deep Clean Mode (`--deep-clean`)
Does everything in basic mode PLUS **permanently deletes** legacy/unused tables:

**Legacy tables DELETED entirely:**
- `Connections` - Not used in code
- `Boolean Searches` - Not referenced
- `Concept Dictionary` - Not referenced
- `Name Parsing Rules` - Not referenced
- `Project Tasks` - Not referenced
- `Attributes Blob` - Not referenced
- `Campaigns` - Not referenced
- `Instructions + Thoughts` - Replaced by help system
- `Test Post Scoring` - Dev/test table
- `Scoring Attributes 06 08 25` - Backup/snapshot table

**How it works:**
1. Uses Airtable Metadata API to permanently delete tables
2. Falls back to clearing all records if API deletion fails
3. Tables are completely removed (not just emptied)

## Usage

### Basic Cleanup
```bash
node scripts/clean-template-base.js <base-id>
```

### Deep Cleanup (Remove Legacy Tables Too)
```bash
node scripts/clean-template-base.js <base-id> --deep-clean
```

## Step-by-Step Workflow

1. **Duplicate Guy Wilson Base**
   - In Airtable: Right-click Guy Wilson base → Duplicate base
   - ✅ Ensure "Duplicate with records" is checked
   - Copy the new base ID from the URL (starts with `app`)

2. **Run Cleanup Script**
   ```bash
   # Basic cleanup
   node scripts/clean-template-base.js appXXXXXXXXXXXX
   
   # OR with deep clean
   node scripts/clean-template-base.js appXXXXXXXXXXXX --deep-clean
   ```

3. **Verify Results**
   - Script will show:
     - ✅ Tables cleared and record counts
     - ✅ Credentials updated with defaults
     - ✅ Seed data preserved (record counts)
     - ✅ (Deep clean) Legacy tables cleared

4. **Rename Base**
   - In Airtable: Rename to "Template - Client Leads"

5. **Use for Onboarding**
   - Save base ID for `onboard-new-client.js` script
   - Future clients will duplicate this cleaned template

## What Happens

### Validation Phase
```
🔍 Validating required table structure...
   ✅ Leads
   ✅ Connection Request Parameters
   ✅ Credentials
   ✅ Scoring Attributes
   ✅ Post Scoring Attributes
   ✅ Post Scoring Instructions
```

### Clearing Phase
```
🗑️  Clearing data tables...
   Processing: Leads
      Found 450 records
      Deleted 450/450 records...
      ✅ Cleared 450 records (posts stored in "Posts Content" field)

   Processing: Connection Request Parameters
      Found 5 records
      Deleted 5/5 records...
      ✅ Cleared 5 records
```

### Update Phase
```
🔧 Updating configuration tables...
   Processing: Credentials
      ⚠️  Multiple records found (2) - updating first, deleting others
      ✅ Updated with default values (AI threshold: 50, Posts threshold: 30%)
```

### Verification Phase
```
✅ Verifying seed data tables...
   ✅ Scoring Attributes: 23 records preserved
   ✅ Post Scoring Attributes: 5 records preserved
   ✅ Post Scoring Instructions: 3 records preserved
```

### Deep Clean Phase (Optional)
```
🔥 DEEP CLEAN: Deleting unused legacy tables...
   ⚠️  WARNING: This will PERMANENTLY DELETE these tables!

   🗑️  Connections: Deleting table permanently...
      ✅ Table deleted permanently

   🗑️  Boolean Searches: Deleting table permanently...
      ✅ Table deleted permanently
   
   🗑️  Instructions + Thoughts: Deleting table permanently...
      ✅ Table deleted permanently

   [... more tables ...]

   ℹ️  Deep clean complete.
```

**If API deletion fails (fallback):**
```
   🗑️  Campaigns: Deleting table permanently...
      ⚠️  Could not delete table via API: Forbidden
      ℹ️  Falling back to clearing records...
   🗑️  Campaigns: Clearing 5 records...
      ✅ Cleared all records from Campaigns
      ℹ️  Table still exists but is empty. Delete manually in Airtable UI.
```

## Credentials Default Values

The script ensures exactly ONE Credentials record exists with these defaults:

| Field | Value | Purpose |
|-------|-------|---------|
| AI Score Threshold Input | 50 | Default minimum score for top scoring leads |
| Posts Threshold Percentage | 30 | Default post relevance percentage filter |
| Last LH Leads Export | null | Timestamp of last LinkedHelper export (populated on use) |
| Top Leads Last Export At | null | Alternative export timestamp field (populated on use) |

## Error Handling

**Missing required table:**
```
❌ Scoring Attributes - NOT FOUND
   Error: Could not find table
```
→ Fix: Ensure you duplicated from Guy Wilson base with all tables

**Invalid base ID:**
```
❌ Error: Please provide a valid Airtable base ID (starts with "app")
```
→ Fix: Check base ID format (should be like `appXySOLo6V9PfMfa`)

**Missing API key:**
```
❌ Error: AIRTABLE_API_KEY not found in environment
```
→ Fix: Ensure `.env` file exists with valid `AIRTABLE_API_KEY`

## Related Scripts

- `onboard-new-client.js` - Uses the cleaned template for new client onboarding
- See `CLIENT-ONBOARDING-GUIDE.md` for complete onboarding workflow

## Technical Notes

- Airtable API limits: 10 records per batch operation
- Tables are processed sequentially to avoid rate limits
- **Deep clean uses Airtable Metadata API** to permanently delete tables
  - Requires `node-fetch` package (automatically imported)
  - Falls back to record clearing if API deletion fails or is forbidden
  - API endpoint: `https://api.airtable.com/v0/meta/bases/{baseId}/tables/{tableId}`
- Seed data integrity is verified before completion
- Script exits on any validation failure to prevent partial cleanup
