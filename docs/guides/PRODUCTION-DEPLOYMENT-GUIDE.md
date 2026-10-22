# Level ≥ 2 Multi-Tenant System - Production Deployment Guide

## ✅ WHAT WE'VE ACCOMPLISHED ON STAGING

### 1. **Multi-Tenant Level ≥ 2 Filtering**
- ✅ Harvest process filters for clients with service level ≥ 2
- ✅ Scoring process filters for clients with service level ≥ 2
- ✅ Successfully tested with Dean Hobin and Guy Wilson

### 2. **Apify Integration**
- ✅ Multi-tenant LinkedIn post harvesting via Apify
- ✅ Webhook synchronization from Apify to client Airtable bases
- ✅ Run tracking and status management per client

### 3. **Cron Job Automation**
- ✅ `harvest-posts-all-clients` - harvests for level ≥ 2 clients
- ✅ `daily-post-scoring-all-eligible-clients` - scores for level ≥ 2 clients
- ✅ Proper scheduling and environment configuration

### 4. **Issue Resolution**
- ✅ Fixed missing field issue ("Last Post Processed At")
- ✅ Webhook synchronization working for all clients
- ✅ End-to-end flow: Harvest → Webhook → Scoring

## 🚀 PRODUCTION DEPLOYMENT STEPS

### Step 1: Clean Up Debug Logs
```bash
# Remove verbose debug logs but keep essential logging
# Keep error logs and key success indicators
```

### Step 2: Environment Configuration
**Production needs these environment variables:**
- `API_PUBLIC_BASE_URL=https://pb-webhook-server.onrender.com` (production URL)
- `PB_WEBHOOK_SECRET=$PB_WEBHOOK_SECRET`
- `AIRTABLE_API_KEY` (production key)
- `MASTER_CLIENTS_BASE_ID` (production master base)

### Step 3: Client Base Preparation
**Ensure ALL production client bases have these fields:**
- `Posts Content` (Long Text)
- `Date Posts Scored` (Date)
- `Posts Relevance Score` (Number) 
- `Last Post Processed At` (Date/Time)
- `Last Post Check At` (Date/Time)

### Step 4: Production Branch Process
```bash
# 1. Create production branch from staging
git checkout main
git merge staging

# 2. Update production webhook URLs in code
# 3. Remove debug logs
# 4. Test on production environment
```

### Step 5: Render Production Configuration
**Update render.yaml for production:**
- Change webhook URLs to production URLs
- Verify cron schedules
- Ensure environment variables sync correctly

## ⚠️ CRITICAL PRODUCTION CHECKLIST

### Before Going Live:
- [ ] All client bases have required fields
- [ ] Production webhook URL updated in Apify configurations
- [ ] Environment variables set correctly
- [ ] Service level configurations verified in Client Master
- [ ] Backup plans for rollback if needed

### After Deployment:
- [ ] Monitor first harvest run
- [ ] Verify webhook synchronization working
- [ ] Confirm scoring runs successfully
- [ ] Check logs for any production-specific issues

## 📊 MONITORING & VALIDATION

### Key Metrics to Watch:
- Harvest success rate per client
- Webhook synchronization success
- Posts scored vs posts harvested
- Error rates and types

### Log Entries to Monitor:
- `[apify/process-level2]` - harvest orchestration
- `[ApifyWebhook]` - webhook processing
- `PB Posts sync completed` - synchronization success
- Scoring completion logs per client

## 🔄 ROLLBACK PLAN

If issues arise in production:
1. Immediately disable cron jobs
2. Revert to previous stable version
3. Investigate logs and fix issues
4. Re-test on staging before re-deploying

## 📝 NEXT STEPS

1. **Clean debug logs** (remove verbose [DEBUG] entries)
2. **Update webhook URLs** for production
3. **Merge staging to main** 
4. **Deploy to production Render service**
5. **Monitor first production runs**