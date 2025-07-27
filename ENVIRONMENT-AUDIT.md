# Environment Variable Audit Checklist

Use this checklist to manually verify environment variables across all platforms.

## Backend Variables (Render Dashboard)

Go to: https://dashboard.render.com → Your Service → Environment

**Required Variables:**
- [ ] `AIRTABLE_API_KEY` - Set and starts with `pat_`
- [ ] `AIRTABLE_BASE_ID` - Set and starts with `app`
- [ ] `OPENAI_API_KEY` - Set and starts with `sk-`
- [ ] `GCP_PROJECT_ID` - Set to your Google Cloud project ID
- [ ] `GCP_LOCATION` - Set (usually `us-central1`)
- [ ] `GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON` - Set with full JSON

**Optional Variables:**
- [ ] `GEMINI_MODEL_ID` - Set to `gemini-2.5-pro-preview-05-06` (or desired model)
- [ ] `PB_WEBHOOK_SECRET` - Set to secure random string
- [ ] `BATCH_CHUNK_SIZE` - Set to `40` (or desired batch size)
- [ ] `GEMINI_TIMEOUT_MS` - Set to `900000` (15 minutes)
- [ ] `DEBUG_RAW_GEMINI` - Set to `0` (for production)

## Frontend Variables (Vercel Dashboard)

Go to: https://vercel.com → Your Project → Settings → Environment Variables

**API Configuration:**
- [ ] `NEXT_PUBLIC_API_BASE_URL` - Set to `https://pb-webhook-server.onrender.com/api/linkedin`

**Optional Variables:**
- [ ] `NEXT_PUBLIC_WP_BASE_URL` - Set if using WordPress integration

## Local Development (.env files)

**Backend (.env in root directory):**
- [ ] All backend variables from Render section above
- [ ] Consider using Render values for consistency, OR
- [ ] Use localhost URLs if running services locally

**Frontend (.env.local in linkedin-messaging-followup-next/):**
- [ ] `NEXT_PUBLIC_API_BASE_URL` set to:
  - `http://localhost:3000/api/linkedin` (if backend running locally)
  - `https://pb-webhook-server.onrender.com/api/linkedin` (if using Render backend)

## Verification Steps

### Test Backend (Render)
1. Visit: https://pb-webhook-server.onrender.com/
2. Should see server startup message with version info
3. Check logs for any "environment variable not set" errors

### Test Frontend (Vercel)  
1. Visit your Vercel deployment URL
2. Environment validation should show all green checkmarks
3. Try updating a lead to test API connectivity

### Test Local Development
1. Run `node env-sync.js check` in backend directory
2. Start frontend with `npm run dev` 
3. Check for environment validation warnings/errors

## Common Issues

**"Airtable API Key not set"**
- Check AIRTABLE_API_KEY in Render dashboard
- Verify it starts with `pat_` (new format)

**"Cannot connect to API"**
- Check NEXT_PUBLIC_API_BASE_URL in Vercel dashboard
- Verify URL exactly matches your Render app URL

**"GCP Authentication failed"**
- Check GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON formatting
- Ensure it's valid JSON (no line breaks in Render dashboard)

**CORS Errors**
- Usually means API URL mismatch between frontend and backend
- Verify domains are exactly correct

## Security Reminder

🔒 **Never commit these to Git:**
- AIRTABLE_API_KEY
- OPENAI_API_KEY  
- GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON
- Any API keys or secrets

✅ **Safe to commit (with NEXT_PUBLIC_ prefix):**
- NEXT_PUBLIC_API_BASE_URL
- NEXT_PUBLIC_WP_BASE_URL
