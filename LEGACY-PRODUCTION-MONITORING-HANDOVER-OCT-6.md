# Production Monitoring Handover - October 6, 2025

## What We Just Did (Massive Code Changes)

Today we deployed **major changes** to production that touched critical parts of the system:

### 1. ✅ **Comprehensive Field Standardization** (MAIN CHANGE)
- **Unified all Airtable field names** across the entire codebase
- Created single source of truth: `constants/airtableUnifiedConstants.js`
- Updated 50+ files to use standardized field references
- **HIGH RISK**: Any typos or missed field references will break the app

### 2. ✅ **Production Error Logging System** (SAFETY NET)
- Built automatic error logging to Airtable **Error Log table** in Master Clients base
- Added error logging to **112 catch blocks** across routes and services (79% coverage)
- **100% of critical business logic** now logs errors with full context
- Each error includes: stack trace, file/line, severity, operation, input data, client context

### 3. ✅ **Smart Error Classification**
- Errors auto-classified as CRITICAL/ERROR/WARNING/INFO
- Expected errors (JSON parse failures, 404s, duplicates) marked as WARNING/INFO
- Only real bugs show as CRITICAL/ERROR in queries

---

## Current Production State

### Deployment Info:
- **Branch**: `feature/comprehensive-field-standardization`
- **Last Commit**: `65647f3` - "Complete error logging coverage for active production routes"
- **Service**: https://pb-webhook-server.onrender.com
- **Auto-Deploy**: ✅ Enabled (pushes to branch auto-deploy)
- **Status**: ✅ Service responding (checked 2 mins ago)

### What's Running:
- Backend API on Render
- Frontend Next.js on Vercel (not modified today)
- Multi-tenant Airtable architecture
- AI scoring (Gemini + OpenAI fallback)

---

## ⚠️ EXPECTED ISSUES (What to Watch For)

### 🔴 **HIGH PROBABILITY - Field Name Issues**
We standardized 100+ field references today. **Likely problems:**

1. **Symptom**: "Unknown field name" errors in Airtable operations
   - **Cause**: Typo in field constant or missed field reference
   - **Where to Look**: Error Log table will show which field failed
   - **Fix**: Update the field name in the code to match Airtable

2. **Symptom**: Leads not scoring / batch operations failing
   - **Cause**: Critical field missing from mapping
   - **Where to Look**: Check `/debug-field-mapping` endpoint
   - **Fix**: Add missing field to `airtableUnifiedConstants.js`

3. **Symptom**: Webhook data not saving to Airtable
   - **Cause**: LinkedHelper → Airtable field mapping broken
   - **Where to Look**: `routes/webhookHandlers.js` mappings
   - **Fix**: Verify field names match actual Airtable schema

### 🟡 **MEDIUM PROBABILITY - Error Logger Issues**

1. **Symptom**: Error Log table getting spammed with duplicate errors
   - **Cause**: Deduplication not working (5-min window might be too short)
   - **Fix**: Increase deduplication window in `utils/errorLogger.js`

2. **Symptom**: Errors NOT appearing in Error Log table
   - **Cause**: Rate limit hit (100 errors/hour) OR Airtable API failure
   - **Where to Look**: Render logs will show "Error logging failed"
   - **Fix**: Check `DISABLE_ERROR_LOGGING` env var, verify Airtable API key

3. **Symptom**: Error Log missing context (empty fields)
   - **Cause**: Context serialization failed (circular JSON, too large)
   - **Fix**: Check `sanitizeErrorContext()` in errorLogger.js

### 🟢 **LOW PROBABILITY - But Possible**

1. **Memory crashes** during large batch operations
   - We increased batch limits today
   - Watch for "JavaScript heap out of memory"
   
2. **Multi-tenant client switching failures**
   - Fixed client resolution today, but edge cases possible
   - Look for "Client not found" or "Base not configured"

3. **AI scoring timeouts**
   - Gemini timeout set to 60s, might not be enough for large batches
   - OpenAI fallback should catch this

---

## 🔍 How to Monitor Production (Step-by-Step)

### **STEP 1: Check for Immediate Crashes**
Run this command to see if service is up:
```bash
curl https://pb-webhook-server.onrender.com/health
```

**Expected**: `{"status":"ok","enhanced_audit_system":"loaded","timestamp":"..."}`  
**If fails**: Service crashed on startup → Check Render logs immediately

---

### **STEP 2: Check Airtable Error Log Table**

**Ask AI in new chat:**
> "Show me all NEW errors from the Airtable Error Log table"

**What to look for:**
- **CRITICAL errors** = Real bugs that need immediate fixing
- **ERROR severity** = Important but not app-breaking
- **WARNING/INFO** = Expected errors (JSON parse, 404s) - can ignore

**Filter by:**
- Status = "NEW" (unresolved errors)
- Timestamp = last 2 hours (errors since deployment)
- Severity = "CRITICAL" or "ERROR" (ignore WARNING/INFO)

---

### **STEP 3: Check Render Logs (Fallback)**

If Error Log table is empty or broken, check Render directly:

**Ask AI:**
> "Check the last 100 lines of Render logs for errors"

**Red flags to look for:**
- "Unknown field name"
- "Cannot read property"
- "undefined is not a function"
- "FATAL ERROR"
- "Error logging failed" (means error logger itself is broken)

---

### **STEP 4: Run a Small Test**

Test the main pipeline with 1-2 leads:

**Ask AI:**
> "Score 2 leads for Guy Wilson's client to test the pipeline"

**What should happen:**
1. Leads pulled from Airtable ✅
2. AI scoring completes ✅
3. Scores written back to Airtable ✅
4. No errors in Error Log table ✅

**If fails**: Error Log should capture what went wrong

---

## 🛠️ How to Fix Issues (Instructions)

### **For Field Name Errors:**

1. **Ask AI to show the error:**
   > "Show me error #[number] from Error Log"

2. **AI will show you:**
   - Which field failed: `"Unknown field name 'AI Score'"`
   - Which file: `routes/apiAndJobRoutes.js:1234`
   - What operation: `score_single_lead`

3. **Ask AI to fix it:**
   > "Fix error #[number] - update the field name to match Airtable"

4. **AI will:**
   - Read the error context
   - Find the typo
   - Fix the code
   - Commit with message
   - Auto-mark error as FIXED in Airtable

### **For Other Errors:**

Same process:
1. "Show me error #X"
2. "Fix error #X"
3. AI reads context, fixes code, commits, marks FIXED

---

## 📊 Key Monitoring Endpoints

### Check Service Health:
```
GET https://pb-webhook-server.onrender.com/health
```

### Check AI Services:
```
GET https://pb-webhook-server.onrender.com/debug-gemini-info
```

### Check Multi-Tenant Status (requires DEBUG_API_KEY):
```
GET https://pb-webhook-server.onrender.com/debug-clients
```

### Check Field Mappings:
```
GET https://pb-webhook-server.onrender.com/debug-field-mapping
```

### Check Top Scoring Leads Feature:
```
GET https://pb-webhook-server.onrender.com/api/top-scoring-leads/status
```
Should return: `{"ok":true,"enabled":true}`

---

## 🎯 Success Criteria (How to Know It's Working)

### ✅ **All Systems Operational:**
1. `/health` returns 200 OK
2. Error Log table has ZERO "NEW" CRITICAL errors
3. Test scoring run completes successfully
4. Render logs show no recurring errors
5. Webhook data flowing into Airtable

### ⚠️ **Needs Attention:**
1. Error Log has NEW errors (but they're all WARNING/INFO) = Expected behavior OK
2. 1-2 CRITICAL errors = Fix them, should be quick
3. Test run works but slow = Performance issue, not critical

### 🚨 **Emergency - Rollback Required:**
1. Service won't start (health check fails)
2. 10+ CRITICAL errors in Error Log
3. All scoring runs failing
4. Data corruption in Airtable

**Rollback command:**
```bash
git revert HEAD
git push origin feature/comprehensive-field-standardization
```
(Render will auto-deploy the rollback)

---

## 📁 Key Files Modified Today

### Core Constants (Most Critical):
- `constants/airtableUnifiedConstants.js` - All field names defined here

### Routes (High Traffic):
- `routes/apiAndJobRoutes.js` - Main API endpoints
- `routes/topScoringLeadsRoutes.js` - Top leads dashboard
- `routes/webhookHandlers.js` - LinkedHelper webhook processing
- `routes/apifyControlRoutes.js` - LinkedIn post scraping
- `routes/diagnosticRoutes.js` - Debug endpoints

### Services (Business Logic):
- `services/leadService.js` - Lead CRUD operations
- `services/apifyRunsService.js` - Apify run management
- `services/clientService.js` - Multi-tenant client handling

### Error Logging System:
- `utils/errorLogger.js` - Main error logging to Airtable
- `utils/errorClassifier.js` - Smart error classification
- `utils/structuredLogger.js` - Console logging

### AI Scoring:
- `batchScorer.js` - Batch scoring engine
- `singleScorer.js` - Single lead scoring
- `promptBuilder.js` - AI prompt construction

---

## 🗣️ Plain English Instructions for You (Guy)

### **What to say to start monitoring:**

In a **new chat**, say:
> "We just deployed major code changes. Show me any NEW errors from the Airtable Error Log table, then check Render logs for crashes."

### **If there are errors, say:**
> "Show me error #1 details"
> "Fix error #1"

AI will fix it automatically and mark it FIXED in Airtable.

### **If you want to test the system:**
> "Run a test scoring job for Guy Wilson with 2 leads"

### **If everything looks broken:**
> "Rollback the last deployment - service is not working"

### **If you want a status summary:**
> "Give me a production status summary: check health, error log, and Render logs"

---

## 🎓 What the New Chat AI Needs to Know

### **Context to provide:**
- "We deployed comprehensive field standardization today"
- "All Airtable field names now in `constants/airtableUnifiedConstants.js`"
- "Error logging system logs to Error Log table in Master Clients base"
- "79% of catches logged, 100% of critical paths covered"

### **First task:**
- Check Error Log table for NEW errors
- Check Render logs for startup issues
- Verify service health endpoint

### **Tools to use:**
- `utils/errorLogger.js` - Functions to query Error Log table
- Error Log table location: Master Clients base → Error Log table
- Status field values: NEW, INVESTIGATING, FIXED, IGNORED

### **Expected issues:**
- Field name typos/mismatches (most likely)
- Error logger bugs (medium likelihood)
- Memory issues from batch ops (low likelihood)

---

## 📞 Quick Reference Commands

```bash
# Check service health
curl https://pb-webhook-server.onrender.com/health

# Check git status
git status

# Check recent commits
git log --oneline -5

# View current branch
git branch

# Emergency rollback
git revert HEAD && git push origin feature/comprehensive-field-standardization
```

---

## ✅ Summary (TL;DR)

**What we did:**
- Standardized all Airtable field names (big refactor)
- Added production error logging to Airtable
- 79% coverage, 100% of critical paths

**What to expect:**
- Field name errors (most likely)
- Error logger issues (possible)
- Everything might be fine (also possible!)

**What to do:**
1. Open new chat
2. Say: "Show me production errors and check Render logs"
3. Fix any CRITICAL/ERROR issues
4. Test with small scoring run
5. Monitor for next few hours

**If broken badly:**
- Rollback with `git revert HEAD`
- Errors will have full context in Error Log table

**You got this!** 🚀

---

*Handover created: October 6, 2025*  
*Last deployment: 65647f3*  
*Branch: feature/comprehensive-field-standardization*
