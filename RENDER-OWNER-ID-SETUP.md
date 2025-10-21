# How to Find Your Render Owner ID (Workspace ID)

## What is the Owner ID?

The `RENDER_OWNER_ID` is your Render workspace identifier. It's required for the Render API v1 logs endpoint.

Format: `own_xxxxxxxxxxxxx`

---

## How to Find It

### Method 1: From Render Dashboard URL

1. Go to your Render dashboard: https://dashboard.render.com
2. Look at the URL - it should be something like:
   ```
   https://dashboard.render.com/select/OWNER_ID_HERE
   ```
3. The `OWNER_ID_HERE` part is your `RENDER_OWNER_ID`

### Method 2: From Account Settings

1. Go to https://dashboard.render.com
2. Click on your account name (top right)
3. Click "Account Settings"
4. Look for "Workspace ID" or "Owner ID" (should start with `own_`)

### Method 3: Using Render API

If you already have your `RENDER_API_KEY`, you can fetch it:

```bash
curl -H "Authorization: Bearer YOUR_RENDER_API_KEY" \
  https://api.render.com/v1/owners
```

This returns a list of owners/workspaces with their IDs.

---

## Adding to Your Environment

### Local Development (.env file)

Add this line to your `.env` file:

```bash
RENDER_OWNER_ID=own_xxxxxxxxxxxxx
```

### Render Staging Environment

1. Go to: https://dashboard.render.com/web/srv-d2elj7buibrs73857jfg/env
2. Click "+ Environment Variable"
3. Add:
   - **Key**: `RENDER_OWNER_ID`
   - **Value**: `own_xxxxxxxxxxxxx` (your actual owner ID)
4. Click "Save Changes"
5. Service will automatically redeploy

### Render Production Environment

Same steps as staging, but use your production service URL.

---

## Testing the API

After adding `RENDER_OWNER_ID`, test the Render API:

```bash
node test-render-api.js
```

Expected output:
```
✅ Logs fetched successfully!
Logs count: 10
Has more: true
```

If you see:
- ❌ 404 Not Found → Check owner ID or service ID
- ❌ 403 Forbidden → Check API key permissions
- ❌ "RENDER_OWNER_ID is not set" → Add the env var

---

## Verification Checklist

- [ ] Found your `RENDER_OWNER_ID` (starts with `own_`)
- [ ] Added to local `.env` file
- [ ] Added to Render staging environment
- [ ] Tested with `node test-render-api.js`
- [ ] Saw successful log fetch (not 404)
- [ ] Ready to re-run smart-resume test

---

## What This Fixes

With the correct `RENDER_OWNER_ID`:
- ✅ Production Issues table will auto-populate
- ✅ `analyzeRunLogs()` will actually fetch logs from Render
- ✅ 100% error coverage goal is now achievable
- ✅ No more 404 errors from Render API

---

## Example Values (for reference)

```bash
# Example (not real values):
RENDER_API_KEY=rnd_abc123xyz789def456ghi012jkl345mno678pqr901stu234vwx567yza890
RENDER_SERVICE_ID=srv-d2elj7buibrs73857jfg
RENDER_OWNER_ID=own_abc123def456ghi789jkl012
```

All three are required for the Render API logs endpoint to work.
