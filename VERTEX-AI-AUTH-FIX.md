# Vertex AI Authentication Fix - Action Plan

## Problem Summary
- **Root Cause**: Missing Vertex AI authentication credentials in Render production environment
- **Impact**: 10 out of 96 leads failing with `VertexAI.GoogleAuthError`
- **Status**: All required environment variables missing from Render services

## Current State
✅ **Working**: 86/96 leads processing successfully (code is correct)  
❌ **Failing**: 10 leads with authentication errors  
✅ **Identified**: You have GCP_PROJECT_ID (`leads-scoring-459307`) and GCP_LOCATION (`us-central1`)  
❌ **Missing**: Service account credentials file  

## Step-by-Step Fix

### Phase 1: Create Service Account (If Not Already Done)

1. **Go to Google Cloud Console**
   - URL: https://console.cloud.google.com
   - Select project: `leads-scoring-459307`

2. **Navigate to Service Accounts**
   - Go to: IAM & Admin > Service Accounts
   - Click "Create Service Account"

3. **Create Service Account**
   - Name: `vertex-ai-batch-scorer`
   - Description: `Service account for batch lead scoring with Vertex AI`
   - Click "Create and Continue"

4. **Grant Roles**
   - Add role: `Vertex AI User`
   - Add role: `AI Platform Developer` (if needed)
   - Click "Continue" then "Done"

5. **Generate Key**
   - Click on the newly created service account
   - Go to "Keys" tab
   - Click "Add Key" > "Create new key"
   - Select "JSON" format
   - Download the JSON file
   - **IMPORTANT**: Save this file securely!

### Phase 2: Configure Local Environment

1. **Save Credentials File**
   ```bash
   # Save the downloaded JSON file in your project directory
   # Example: save as "google-credentials.json"
   ```

2. **Update .env File**
   ```bash
   # Add this line to your .env file:
   GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json
   GCP_PROJECT_ID=leads-scoring-459307
   GCP_LOCATION=us-central1
   ```

3. **Test Locally**
   ```bash
   node test-vertex-auth.js
   ```
   - Should show "VERTEX AI AUTHENTICATION WORKING PERFECTLY!"

### Phase 3: Deploy to Render

1. **Upload Credentials to Render**
   - Option A: Upload JSON file through Render dashboard
   - Option B: Add JSON content as environment variable

2. **Set Environment Variables in Render**
   Go to each service that needs Vertex AI access:
   - **Daily Batch Lead Scoring** (cron_job)
   - **Daily Batch Post Scoring** (cron_job)
   
   Add these environment variables:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/google-credentials.json
   GCP_PROJECT_ID=leads-scoring-459307
   GCP_LOCATION=us-central1
   ```

3. **Alternative: JSON Content as Environment Variable**
   If file upload doesn't work:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account","project_id":"..."}
   GCP_PROJECT_ID=leads-scoring-459307
   GCP_LOCATION=us-central1
   ```

### Phase 4: Verify Fix

1. **Restart Render Services**
   - Redeploy the cron job services
   - Or manually restart them

2. **Test Manual Run**
   - Trigger a manual run of "Daily Batch Lead Scoring"
   - Check logs for authentication success

3. **Run Diagnostic Scripts**
   ```bash
   # Check that environment variables are set
   node check-render-env.js
   
   # Test individual leads again
   node test-failed-leads-diagnostic.js
   ```

4. **Expected Results**
   - All 96 leads should process successfully
   - No more `VertexAI.GoogleAuthError` messages
   - Guy-Wilson client shows 96/96 processed

## Quick Reference Commands

```bash
# 1. Test local authentication
node test-vertex-auth.js

# 2. Check Render environment variables
node check-render-env.js

# 3. Test failed leads after fix
node test-failed-leads-diagnostic.js

# 4. Monitor Render logs
node check-render-logs.js
```

## Troubleshooting

### If Authentication Still Fails:
1. Verify JSON file format is valid
2. Check service account has correct roles
3. Ensure Vertex AI API is enabled in your project
4. Try alternative credential setup methods

### If Only Some Leads Still Fail:
1. Check for rate limiting
2. Verify consistent environment variable setup
3. Monitor for quota issues

### If File Upload Issues:
1. Try base64 encoding the JSON content
2. Use environment variable instead of file
3. Check Render file size limits

## Success Metrics
- ✅ Environment variables visible in Render dashboard
- ✅ Authentication test passes locally
- ✅ Manual cron job run succeeds
- ✅ All 96 leads process successfully
- ✅ Zero authentication errors in logs

## Timeline
- **Setup**: 15-30 minutes
- **Testing**: 5-10 minutes  
- **Deployment**: 5 minutes
- **Verification**: 10 minutes
- **Total**: ~1 hour maximum

The key insight is that your code is working perfectly (86 successful leads prove this), you just need to provide the authentication credentials to the production environment.
