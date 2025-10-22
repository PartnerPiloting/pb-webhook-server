# Template Cleanup API Guide

## Overview

Run the template cleanup script via HTTP endpoint - no SSH needed!

## Endpoints

### 🔹 Help Endpoint (No Auth Required)

```
GET https://pb-webhook-server-staging.onrender.com/api/template-cleanup/help
```

**Browser:** Just paste the URL and press Enter

**Returns:** Full API documentation with examples

---

### 🔹 Cleanup Endpoint (Requires Auth)

```
POST https://pb-webhook-server-staging.onrender.com/api/template-cleanup/clean-base
```

**Authentication:** Bearer token with your `PB_WEBHOOK_SECRET`

**Body:**
```json
{
  "baseId": "appXXXXXXXXXXXX",
  "deepClean": true,
  "dryRun": false
}
```

---

## Workflow

### Step 1: Duplicate Guy Wilson Base
1. Go to Airtable
2. Find "My Leads - Guy Wilson" base
3. Click "..." → Duplicate base → **Include records**
4. Rename to "Template - Test 1" (or similar)
5. Copy the base ID from URL (starts with `app`)

### Step 2: Dry Run (Recommended)
Test what will happen without making changes:

**Postman:**
```
POST https://pb-webhook-server-staging.onrender.com/api/template-cleanup/clean-base

Headers:
  Authorization: Bearer Diamond9753!!@@pb
  Content-Type: application/json

Body (raw JSON):
{
  "baseId": "appYOURBASEID",
  "deepClean": true,
  "dryRun": true
}
```

**Browser (using Postman web or similar):**
Same as above

**cURL (from local terminal):**
```bash
curl -X POST https://pb-webhook-server-staging.onrender.com/api/template-cleanup/clean-base \
  -H "Authorization: Bearer Diamond9753!!@@pb" \
  -H "Content-Type: application/json" \
  -d '{"baseId":"appYOURBASEID","deepClean":true,"dryRun":true}'
```

### Step 3: Real Run
Remove `dryRun` or set to `false`:

```json
{
  "baseId": "appYOURBASEID",
  "deepClean": true,
  "dryRun": false
}
```

⏱️ **Duration:** 15-20 minutes (6000+ records)

### Step 4: Verify Results
Check the response JSON and your Airtable base:

**Expected:**
- ✅ Only 7 tables remain (down from 15)
- ✅ Leads: 0 records (posts are stored as JSON in "Posts Content" field)
- ✅ Connection Request Parameters: 0 records
- ✅ Credentials: 1 record with defaults (AI=50, Posts=30%)
- ✅ Scoring Attributes: 23 records
- ✅ Post Scoring Attributes: 5 records
- ✅ Post Scoring Instructions: 3 records

**10 Legacy Tables Deleted:**
- Connections
- Boolean Searches
- Concept Dictionary
- Name Parsing Rules
- Project Tasks
- Attributes Blob
- Campaigns
- Instructions + Thoughts
- Test Post Scoring
- Scoring Attributes 06 08 25

### Step 5: Finalize Template
1. Rename base to **"Template - Client Leads"**
2. Save the base ID for future use
3. Use this template for all new client onboarding

---

## Response Structure

### Success Response
```json
{
  "success": true,
  "message": "Template base cleaned successfully",
  "results": {
    "baseId": "appXXXXXXXXXXXX",
    "deepClean": true,
    "dryRun": false,
    "startTime": "2025-10-22T10:30:00.000Z",
    "endTime": "2025-10-22T10:45:23.000Z",
    "duration": "923s",
    "operations": [
      {
        "step": "validation",
        "table": "Leads",
        "status": "exists"
      },
      {
        "step": "clearing",
        "table": "Leads",
        "status": "cleared",
        "recordsDeleted": 6247
      },
      {
        "step": "updating_credentials",
        "status": "updated",
        "action": "updated with defaults"
      },
      {
        "step": "verification",
        "table": "Scoring Attributes",
        "status": "preserved",
        "recordCount": 23
      },
      {
        "step": "deep_clean",
        "table": "Connections",
        "status": "deleted",
        "method": "api"
      }
    ],
    "summary": {
      "totalRecordsDeleted": 9342,
      "tablesCleared": 3,
      "tablesPreserved": 3,
      "tablesDeleted": 10,
      "credentialsUpdated": true,
      "dryRun": false
    }
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": "Invalid baseId - must start with 'app'"
}
```

---

## Parameters

### `baseId` (required)
- **Type:** String
- **Format:** Must start with "app"
- **Example:** `"appXySOLo6V9PfMfa"`
- **Description:** The Airtable base ID to clean

### `deepClean` (optional)
- **Type:** Boolean
- **Default:** `false`
- **Description:** Permanently delete 10 legacy tables
- **Recommendation:** Always use `true` for template creation

### `dryRun` (optional)
- **Type:** Boolean
- **Default:** `false`
- **Description:** Simulate the operation without making changes
- **Recommendation:** Run with `true` first to preview

---

## Security

### Authentication Required
All cleanup operations require authentication via Bearer token:

```
Authorization: Bearer YOUR_PB_WEBHOOK_SECRET
```

**Secret:** Use the value from `PB_WEBHOOK_SECRET` environment variable
- Local: Check your `.env` file
- Staging: `Diamond9753!!@@pb`

### Rate Limits
- Respects Airtable's 5 requests/second limit
- Sequential processing prevents throttling
- Automatic batching (10 records max per request)

---

## Troubleshooting

### ❌ 401 Unauthorized
**Problem:** Missing or invalid Authorization header
**Solution:** Add header: `Authorization: Bearer YOUR_SECRET`

### ❌ 400 Invalid baseId
**Problem:** Base ID format is wrong
**Solution:** Ensure base ID starts with "app" (e.g., `appXySOLo6V9PfMfa`)

### ❌ 400 Required table not found
**Problem:** Base is missing expected tables
**Solution:** Ensure you duplicated the correct base (Guy Wilson's)

### ❌ 500 AIRTABLE_API_KEY not configured
**Problem:** Server environment variable missing
**Solution:** Contact admin - this is a server config issue

### ⏱️ Operation Taking Too Long
**Normal:** 15-20 minutes for 6000+ records
**Check:** Response includes progress in `operations` array
**Monitor:** Each table shows `recordsDeleted` count

---

## Comparison: API vs Local Script

| Feature | API Endpoint | Local Script |
|---------|--------------|--------------|
| **Setup** | None | Requires .env file |
| **Access** | Browser/Postman | Terminal/Node.js |
| **Auth** | Bearer token | Local API key |
| **Speed** | Same | Same |
| **Logs** | JSON response | Console output |
| **Best For** | Production use | Development |

---

## Next Steps After Template Creation

1. **Update onboarding script:**
   - Edit `scripts/onboard-new-client.js`
   - Change `sourceBaseId` to your template base ID

2. **Test new client workflow:**
   ```
   POST /api/onboard-client
   {
     "clientName": "Test Client",
     "templateBaseId": "appYourTemplateBaseId"
   }
   ```

3. **Document template base ID:**
   - Save in your notes
   - Add to `.env` as `TEMPLATE_BASE_ID`
   - Update client onboarding docs

---

## Support

**Issues?** Check:
1. Airtable API status: https://status.airtable.com/
2. Base permissions (need write access)
3. Server logs for detailed errors

**Questions?** See the comprehensive guide:
- `scripts/TEMPLATE-CLEANUP-GUIDE.md` (detailed docs)
- `scripts/clean-template-base.js` (local script version)
