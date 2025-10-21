# Error Monitoring System Migration: Airtable Logger → Sentry

**Date:** October 7, 2025  
**Status:** Ready for Implementation  
**Decision:** Migrate from custom Airtable Error Logger to Sentry  

---

## Executive Summary

**Decision:** Replace custom Airtable Error Logger with Sentry for production error monitoring.

**Key Reasons:**
- Custom logger only catches ~5% of errors (requires manual calls everywhere)
- Sentry catches 100% automatically (wraps entire app)
- FREE for our scale (~90 errors/month vs 5,000 limit)
- Proven, industry-standard solution
- Better error details (full stack traces, grouping, deduplication)

**Timeline:**
- **Today:** Set up Sentry, keep Airtable Logger running (parallel validation)
- **Week 1-2:** Validate Sentry catches everything, tune alerts
- **Week 3:** Remove Airtable Logger code, cleanup

---

## Current State Analysis

### What We Have Now

**Custom Airtable Error Logger:**
- Location: `utils/errorLogger.js`, `utils/errorClassifier.js`
- Coverage: ~5% of actual errors (only catches errors manually sent to it)
- Features: Deduplication, sanitization, structured logging
- Storage: Airtable "Error Log" table in Master Clients base
- Problem: Requires `errorLogger.logError()` call at every error location

**Current Workflow:**
1. Deploy code
2. Check Render logs manually (5-10 min per deployment)
3. Copy/paste logs to AI for analysis
4. Investigate errors from console output

**Active Production Errors (Perfect for Testing):**
- **Error A:** "Client run record not found for [run-id]" (missing client suffix)
  - Affects: Dean-Hobin, Guy-Wilson clients
  - NOT caught by Airtable Logger (just console.error)
  
- **Error 38/39:** "Unknown field name: Errors" (field name mismatch)
  - Caught by Airtable Logger ✅
  - Still happening despite fix (need investigation)

**Error Volume:** ~3 errors per run × 30 runs/month = **~90 errors/month**

---

## Why Custom Airtable Logger Failed

### The Fundamental Problem

**Error Logger only catches what it's called for:**
```javascript
// This goes to Airtable:
try {
  // code
} catch (error) {
  await errorLogger.logError(error, context); // Manual call
}

// This does NOT go to Airtable:
log.error("Client run record not found"); // Just console.error
```

**Coverage Analysis:**
- Codebase has ~200+ error logging locations
- Only ~10 locations call errorLogger
- 95% of errors use `log.error()` or `console.error()` (Render logs only)
- Result: Airtable Error Log shows ~5% of actual errors

### What We Discovered

**Error A revealed the gap:**
- Error happened in production (Render logs showed it)
- Airtable Error Log showed "1 error" (Error 38 only)
- Without Render logs, we'd be blind to Error A
- **Airtable Logger is unreliable for production monitoring**

### Attempted Fix: Improve Classifier

**What we tried:**
- Made `shouldSkipError()` smarter (distinguish system vs business errors)
- Added `isSystemError()` to catch infrastructure failures
- Improved error classification

**Result:**
- Classifier is better BUT error still not logged
- Why? Error A doesn't call errorLogger at all (just `log.error()`)
- **Problem isn't classifier, it's coverage**

### Options Considered

**Option 1: Complete Airtable Logger (Manual Audit)**
- Find all 200+ error locations
- Add errorLogger calls everywhere
- Time: 20-40 hours
- Accuracy: 90-95% (still might miss some)
- Verdict: ❌ Too much work, still not 100%

**Option 2: Automatic Wrapper**
- Override `log.error()` to call errorLogger automatically
- Time: 4-6 hours
- Accuracy: 90-95% (classifier could still miss errors)
- Verdict: ❌ Complex, not guaranteed reliable

**Option 3: AI Parse Render Logs**
- Store logs in Airtable, use AI to extract errors
- Time: 2-3 hours implementation
- Cost: $30-60/month (too expensive)
- Verdict: ❌ Ongoing cost, less detailed than native error catching

**Option 4: External Tools (Sentry, Better Stack, etc.)**
- Use proven error monitoring service
- Time: 5-10 minutes setup
- Cost: FREE (Sentry up to 5,000 errors/month)
- Accuracy: 100% (automatic coverage)
- Verdict: ✅ **SELECTED**

---

## New Architecture: Sentry + Airtable Logs

### How It Works

**Sentry (Real-time Error Monitoring):**
```
Error happens → Sentry intercepts → Sends to Sentry cloud → Email alert
                      ↓
                Also goes to Render logs
```

**Airtable (Historical Log Storage):**
```
Run completes → Store full Render log → Airtable "Client Run Results" table
```

### What You Get

**From Sentry:**
- ✅ 100% error coverage (automatic, no manual calls)
- ✅ Full stack traces (not truncated like Render)
- ✅ Error grouping (47 occurrences of same error = 1 group)
- ✅ Smart deduplication
- ✅ Email/Slack alerts (configurable)
- ✅ Search and filter by client, severity, date
- ✅ 90-day retention (FREE tier)
- ✅ Beautiful dashboard

**From Airtable Logs:**
- ✅ Forever retention (Render only keeps 7 days)
- ✅ Full run context (all logs, not just errors)
- ✅ Historical investigation ("what happened 2 weeks ago?")
- ✅ You own the data
- ✅ FREE storage

### Cost Analysis

**Sentry FREE Tier:**
- Up to 5,000 errors/month
- Your volume: ~90 errors/month
- **Usage: 1.8% of free quota**
- Can have 55× more errors and still be FREE
- Conclusion: **Will never pay**

**Airtable Storage:**
- Long text fields: Up to 100,000 characters
- Typical run log: 10,000-50,000 characters
- Included in your plan
- **Cost: $0**

**Total: FREE** (unless errors exceed 5,000/month)

---

## Implementation Plan

### Phase 1: Set Up Sentry (Today - 45 min)

**Step 1: Sentry Account Setup (5 min)**
1. Sign up at sentry.io (FREE account)
2. Create new project (Node.js)
3. Get DSN key (connection string)

**Step 2: Install Package (5 min)**
```bash
npm install @sentry/node @sentry/profiling-node
```

**Step 3: Add Sentry to Code (10 min)**
- Initialize in `index.js` (before app code)
- Add error handlers
- Test locally

**Step 4: Configure Alerts (10 min)**
- Email: All new errors + daily digest
- Filters: Critical/Error only (no warnings initially)

**Step 5: Deploy & Test (15 min)**
- Deploy to Render
- Trigger post scoring run (errors will happen)
- Verify Sentry catches Error A & Error 38
- Check email alerts work

### Phase 2: Validate Side-by-Side (Week 1-2)

**Keep Both Systems Running:**
- Sentry catches errors → Email alerts
- Airtable Logger catches errors → Airtable table
- **Compare what each system catches**

**Validation Checklist:**
- [ ] Sentry catches Error A (client run not found)
- [ ] Sentry catches Error 38 (field name)
- [ ] Sentry email alerts working
- [ ] Sentry dashboard shows useful info
- [ ] Sentry grouping/deduplication working
- [ ] No errors missed by Sentry that Airtable caught
- [ ] Alert configuration tuned (not too noisy)

**Success Criteria:**
- Sentry catches 100% of errors Airtable Logger catches
- Plus errors Airtable Logger missed (like Error A)
- Email alerts are actionable (not spam)
- Confident we can rely on Sentry alone

### Phase 3: Remove Airtable Logger (Week 3 - 30 min)

**Once validated, clean up:**

1. **Delete Error Logger Files:**
   - `utils/errorLogger.js`
   - `utils/errorClassifier.js`
   - Remove error logger imports from codebase

2. **Delete Airtable Error Log Table:**
   - Archive existing data if needed
   - Delete "Error Log" table from Master Clients base

3. **Update Documentation:**
   - Remove Error Logger references
   - Update monitoring docs to reference Sentry

4. **Commit:**
   ```
   git commit -m "Remove custom error logger, replaced with Sentry
   
   - Deleted utils/errorLogger.js and utils/errorClassifier.js
   - Removed Error Log table from Airtable
   - Sentry provides 100% error coverage (validated over 2 weeks)
   - Simpler codebase, proven monitoring solution"
   ```

---

## Sentry Configuration

### Alert Configuration (Recommended)

**Immediate Email Alerts:**
- New error type (first occurrence)
- Fatal/crash errors
- Error spike (10+ occurrences in 10 minutes)

**Daily Digest Email (8am):**
- Summary of all errors from yesterday
- Top issues by occurrence count
- Trend analysis (increasing/decreasing)

**No Alerts:**
- Repeat occurrences of known errors
- Warnings (unless spike detected)
- Info-level messages

### Error Grouping

**Sentry automatically groups by:**
- Error message similarity
- Stack trace pattern
- File/function location

**Example:**
```
Group: "Client run record not found"
├─ 47 occurrences
├─ First seen: Oct 7, 2025 9:34am
├─ Last seen: Oct 7, 2025 3:15pm
├─ Affected users: 2 (Dean-Hobin, Guy-Wilson)
└─ Stack trace: services/jobTracking.js:670
```

### Integration Options

**Available (optional, future):**
- Slack notifications
- GitHub issue creation
- PagerDuty escalation
- Custom webhooks

---

## Migration Benefits

### Time Savings

**Before (Current):**
- Check Render logs after every deployment: 5-10 min
- Copy/paste to AI for analysis: 2-3 min
- Manual investigation: Variable
- **Total: ~10-15 min per deployment**

**After (Sentry):**
- Check Sentry dashboard: 30 seconds
- Email alerts for critical issues: Immediate
- Detailed error context: Built-in
- **Total: ~1 min per deployment**

**Monthly savings: ~4 hours** (30 deployments × 8 min saved)

### Reliability Improvements

**Before:**
- 5% error coverage (missed Error A completely)
- No alerts (must manually check)
- Truncated stack traces in Render logs
- Easy to miss errors

**After:**
- 100% error coverage (automatic)
- Real-time email alerts
- Full stack traces with context
- Impossible to miss critical errors

### Developer Experience

**Before:**
- Go to Render → Logs → Copy → Paste → Ask AI
- No error history (7-day Render limit)
- Hard to track error trends
- Manual correlation across clients

**After:**
- Email notification → Click link → See full details
- 90-day error history (FREE tier)
- Built-in trends and analytics
- Automatic client/user correlation

---

## Gotchas & Limitations

### External Dependency Risk

**What it means:**
- Sentry is 3rd party service (not you, not Airtable)
- If Sentry goes down → No error logging (temporarily)
- If Sentry changes pricing → Could become expensive

**Mitigation:**
- Sentry has 99.9% uptime SLA
- Used by millions of developers
- Can switch to other service if needed
- Keep Render logs as ultimate backup

**Risk level:** Low

### Free Tier Limits

**The fine print:**
- 5,000 errors/month FREE
- After that: $26/month minimum

**Mitigation:**
- Current volume: 90 errors/month (1.8% of limit)
- Would need 55× more errors to hit limit
- If bad bug causes spike, temporarily disable Sentry

**Risk level:** Very Low (for current scale)

### Data Ownership

**What you lose:**
- Error data stored in Sentry's cloud (not your Airtable)
- 90-day retention on FREE tier (vs forever in Airtable)

**What you keep:**
- Full Render logs in Airtable (forever)
- Can export Sentry data anytime
- Can switch to self-hosted Sentry if needed

**Trade-off:** Convenience vs absolute control

### No Perfect Solution

**Reality check:**
- Every error monitoring approach has trade-offs
- Custom solution: 100% control but incomplete/unreliable
- External service: Proven/reliable but external dependency
- **Selected:** Proven reliability over absolute control

---

## Active Errors (Test Cases)

### Error A: Client Run Record Not Found

**Error Message:**
```
[CLIENT:Dean-Hobin] [SESSION:251007-093451] [ERROR] 
Client run record not found for 251007-093451 - cannot update non-existent record
```

**Location:** `services/jobTracking.js:670`

**Root Cause:** Missing client suffix in run ID
- Base run ID: `251007-093451`
- Expected: `251007-093451-Dean-Hobin`
- Somewhere code is passing base ID to consumer function

**Status:** 
- ❌ NOT caught by Airtable Logger (just console.error)
- ✅ Should be caught by Sentry (perfect test case)

**Affects:** Dean-Hobin, Guy-Wilson clients

### Error 38/39: Unknown Field Name

**Error Message:**
```
[CLIENT:Guy-Wilson] [SESSION:unknown] [ERROR] 
Error updating client run record: Unknown field name: "Errors"
```

**Root Cause:** Field name mismatch
- Code tries to update field "Errors"
- Actual field name: "Error Details" (CLIENT_RUN_FIELDS.ERROR_DETAILS)
- Fixed in jobTracking.js line 713, but still happening elsewhere

**Status:**
- ✅ Caught by Airtable Logger
- ✅ Should be caught by Sentry
- ❌ Fix didn't work (need to find other location)

**Validation in Airtable:**
```
[WARN] Invalid field names for Client Run Results: Errors, undefined
```

---

## Next Steps for Sentry Implementation Chat

### Information You'll Need

**Your Setup:**
- Platform: Render (auto-deploy from GitHub)
- Stack: Node.js/Express
- Repository: pb-webhook-server (feature/comprehensive-field-standardization branch)
- Main file: `index.js`

**What to Provide in New Chat:**
```
I want to set up Sentry error monitoring for my Node.js app on Render.

Context:
- Multi-tenant LinkedIn lead scoring system
- Running on Render with auto-deploy from GitHub
- Currently checking Render logs manually after deployments
- Have custom Airtable Error Logger (will keep running during validation)
- Active production errors perfect for testing:
  - Error A: "Client run record not found" (not caught by current logger)
  - Error 38: "Unknown field name: Errors" (caught by current logger)
- Error volume: ~90 errors/month (well under FREE tier limit)
- Want email alerts for new errors + daily digest

Goal: Set up Sentry, test with existing errors, validate for 2 weeks, 
then remove custom logger.
```

### Implementation Checklist

**Sentry Setup:**
- [ ] Create Sentry account (sentry.io)
- [ ] Create new Node.js project
- [ ] Get DSN key
- [ ] Install @sentry/node package
- [ ] Add initialization to index.js
- [ ] Configure error handlers
- [ ] Test locally

**Deployment:**
- [ ] Commit changes
- [ ] Push to GitHub
- [ ] Verify Render auto-deploys
- [ ] Check deployment logs

**Validation:**
- [ ] Trigger post scoring run
- [ ] Check Sentry dashboard for Error A
- [ ] Check Sentry dashboard for Error 38
- [ ] Verify email alerts received
- [ ] Compare with Airtable Error Log
- [ ] Tune alert configuration

**Week 1-2:**
- [ ] Monitor both systems (Sentry + Airtable Logger)
- [ ] Verify Sentry catches everything
- [ ] Adjust alert settings (reduce noise if needed)
- [ ] Build confidence in Sentry

**Week 3:**
- [ ] Delete Error Logger code
- [ ] Delete Error Log table
- [ ] Update documentation
- [ ] Commit cleanup

---

## Key Decisions Summary

### What We're Doing
✅ Migrate to Sentry for real-time error monitoring  
✅ Store full Render logs in Airtable (historical backup)  
✅ Keep both systems running for 2 weeks (validation)  
✅ Remove custom Error Logger after validation  

### What We're NOT Doing
❌ Completing Airtable Logger (too much work, not 100% reliable)  
❌ AI parsing Render logs (too expensive at $30-60/month)  
❌ Manual Render log checking forever (time-consuming)  

### Why This Is The Right Decision
- Sentry: Industry-standard, proven, 100% coverage, FREE
- Low risk: Validation period before removing old system
- Time savings: 4+ hours/month
- Better reliability: Can't miss critical errors
- Professional tooling: Built for this exact use case

---

## Files Modified This Session

### Already Committed (commit ece6c49)

**constants/airtableUnifiedConstants.js:**
- Added `FULL_RUN_LOG: 'Full Run Log'` field for log storage

**services/jobTracking.js:**
- Fixed line 713: `CLIENT_RUN_FIELDS.ERRORS` → `CLIENT_RUN_FIELDS.ERROR_DETAILS`

**utils/errorClassifier.js:**
- Added `isSystemError()` function
- Improved `isExpectedBehavior()` to never skip system errors
- Improved `shouldSkipError()` to always log system errors
- System errors: run tracking, job tracking, schema, field names
- Exported `isSystemError` for testing

### To Be Added (Sentry Implementation)

**package.json:**
- Add dependencies: `@sentry/node`, `@sentry/profiling-node`

**index.js:**
- Add Sentry initialization (before app code)
- Add error handlers

---

## Contact & Questions

**For Sentry implementation questions:**
- Start new chat with context from this document
- Reference "ERROR-MONITORING-SENTRY-MIGRATION.md"

**For architecture questions:**
- Refer to this handoff document
- Review decision rationale sections

---

## Document History

- **Oct 7, 2025:** Initial creation after 70+ message architecture discussion
- **Status:** Ready for implementation
- **Next Review:** After 2-week Sentry validation period

---

**END OF HANDOFF DOCUMENT**
