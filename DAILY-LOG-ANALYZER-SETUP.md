# Daily Log Analyzer - Render Environment Setup

## Required Environment Variables

To use the `/api/run-daily-log-analyzer` endpoint, you must configure these environment variables in Render:

### 1. RENDER_API_KEY
**Purpose**: Authenticates with Render API to fetch service logs

**How to get it**:
1. Go to https://dashboard.render.com/
2. Click your profile (top right) → Account Settings
3. Scroll to "API Keys" section
4. Click "Generate New API Key"
5. Copy the key (starts with `rnd_`)

**Add to Render**:
1. Go to your service on Render
2. Environment tab
3. Add environment variable:
   - Key: `RENDER_API_KEY`
   - Value: `rnd_xxxxxxxxxxxxx` (your API key)

---

### 2. RENDER_OWNER_ID
**Purpose**: Identifies your Render workspace/account

**How to get it**:
1. Go to https://dashboard.render.com/
2. Click "Account Settings" (top right under profile)
3. Look for "Team ID" or "Owner ID" in the URL or settings
   - URL format: `https://dashboard.render.com/o/OWNER_ID_HERE/settings`
   - Example: `tea-clt1234567890abcdef`

**Add to Render**:
1. Go to your service on Render
2. Environment tab
3. Add environment variable:
   - Key: `RENDER_OWNER_ID`
   - Value: `tea-xxxxxxxxxxxxx` (your owner/team ID)

---

### 3. RENDER_SERVICE_ID (Optional)
**Purpose**: Specifies which service's logs to analyze (defaults to current service)

**How to get it**:
1. Go to your service on Render dashboard
2. Look at the URL: `https://dashboard.render.com/web/SERVICE_ID_HERE`
3. Example: `srv-abcd1234efgh5678`

**Add to Render** (only if you want to analyze logs from a different service):
1. Go to your service on Render
2. Environment tab
3. Add environment variable:
   - Key: `RENDER_SERVICE_ID`
   - Value: `srv-xxxxxxxxxxxxx` (target service ID)

**Note**: If not set, it will analyze logs from the service making the request (current service).

---

## Testing the Endpoint

Once environment variables are configured:

```bash
# Test from local machine (auto mode - from last checkpoint)
node test-daily-log-analyzer-staging.js

# Test with specific run ID
node test-daily-log-analyzer-staging.js 251013-100000
```

Or use curl:
```bash
curl -X POST https://pb-webhook-server-staging.onrender.com/api/run-daily-log-analyzer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer Diamond9753!!@@pb" \
  -d '{"runId":"251013-100000"}'
```

---

## Expected Responses

### Success (with env vars configured):
```json
{
  "ok": true,
  "issues": 5,
  "createdRecords": 3,
  "summary": {
    "critical": 1,
    "error": 2,
    "warning": 2
  },
  "message": "Analyzed from last checkpoint. Found 5 issues."
}
```

### Error (missing RENDER_API_KEY):
```json
{
  "ok": false,
  "error": "RENDER_API_KEY environment variable is not set on Render. Please add it in Environment settings."
}
```

### Error (missing RENDER_OWNER_ID):
```json
{
  "ok": false,
  "error": "RENDER_OWNER_ID environment variable is not set on Render. Please add it in Environment settings."
}
```

---

## Deployment Checklist

- [ ] Generate RENDER_API_KEY from Render dashboard
- [ ] Find RENDER_OWNER_ID from account settings or URL
- [ ] Add both variables to Render Environment settings
- [ ] Trigger redeploy (or wait for auto-deploy)
- [ ] Test endpoint with `node test-daily-log-analyzer-staging.js`
- [ ] Verify logs show no "RENDER_API_KEY is not set" errors
- [ ] Check Production Issues table for new records

---

## Troubleshooting

**"502 Bad Gateway"**
- Server is starting up or deploying. Wait 30-60 seconds and retry.

**"RENDER_API_KEY environment variable is not set"**
- Go to Render → Environment tab → Add RENDER_API_KEY variable
- Trigger manual deploy or wait for auto-deploy

**"RENDER_OWNER_ID environment variable is not set"**
- Go to Render → Environment tab → Add RENDER_OWNER_ID variable
- Trigger manual deploy or wait for auto-deploy

**"401 Unauthorized"**
- Check Authorization header has correct Bearer token
- Default: `Bearer Diamond9753!!@@pb` (PB_WEBHOOK_SECRET)

---

## Files Modified
- `index.js` - Added `/api/run-daily-log-analyzer` endpoint with env var validation
- `daily-log-analyzer.js` - Fixed process.exit() bug, added proper error propagation
- `services/productionIssueService.js` - Lazy initialization of RenderLogService
- `test-daily-log-analyzer-staging.js` - Test utility for calling the endpoint

## Commit
Commit: `a00bb3a` - Fix critical bugs in daily-log-analyzer endpoint
