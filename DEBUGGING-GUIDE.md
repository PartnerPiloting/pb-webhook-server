# DEBUGGING PROCEDURES GUIDE

## ⚠️ CRITICAL WARNING
**Huge amounts of time have been wasted on inefficient debugging. Follow this guide systematically to avoid repeating mistakes.**

## 🛡️ **NEW: AUTOMATED PREVENTION TOOLS (Jan 2025)**

### **BEFORE you start debugging, use these tools:**

#### **Pre-Commit Syntax Checking (Automatic)**
- ✅ **Automatic validation** on every `git commit`
- ✅ **Blocks commits** with syntax errors
- ✅ **Immediate feedback** on problematic files

#### **Manual Syntax Validation**
```powershell
# Quick syntax check (backend files only)
.\check-syntax.ps1

# Full pre-deployment validation
npm run syntax-check
npm run pre-deploy
```

#### **GitHub Actions (Automatic)**
- ✅ **Syntax checking** on every push
- ✅ **CI/CD validation** before deployment
- ✅ **Prevents broken deployments**

### **80% Time Savings Rule**
**Most debugging time (80%) was spent on syntax errors that are now caught automatically. Only proceed with manual debugging if automated tools pass.**

---

## 🧠 IMPORTANT: FLEXIBLE THINKING
**This guide provides STARTING POINTS for common issues, not rigid rules. If the systematic approach doesn't reveal the problem quickly, think creatively and try alternative approaches. The goal is efficient problem-solving, not blind rule-following.**

---

## 🔍 SYSTEMATIC DEBUGGING APPROACH

### **STEP 0: Automated Validation (NEW)**
**Always run these FIRST before any manual debugging:**

1. **Check git commit logs** for pre-commit hook results
2. **Run syntax checker**: `.\check-syntax.ps1` (if PowerShell policies allow)
3. **Check GitHub Actions** for CI/CD validation results
4. **Verify deployment logs** on Render for syntax errors

**If automated tools find issues → Fix them FIRST before proceeding**

### When API endpoints return 404 errors:

**✅ START with automated validation:**
1. **Syntax check**: Ensure route files load without errors
2. **Route structure**: Verify Express route definitions
3. **Frontend/Backend ID mismatch**: Check if using correct record IDs vs URLs

**Common 404 causes (in order of frequency):**
1. **Syntax errors** preventing route file from loading (80% of cases)
2. **Route order issues** (specific routes after parameterized routes)
3. **Frontend using wrong ID format** (LinkedIn URLs vs Airtable record IDs)
4. **Missing route definitions**

---

## 🛠️ PREVENTION CHECKLIST

### When adding new fields to forms:

**Required in 4 places:**
1. **Backend GET endpoint** - both `'Spaced Name'` and `camelCase` versions
2. **Backend PUT endpoint** - field in fieldMapping object  
3. **API Service getLeadById()** - both formats in return object
4. **API Service updateLead()** - field in fieldMapping object

**Testing requirements:**
- Test initial load (does field display?)
- Test form update (does field persist after save?)
- Test in hard refresh/incognito mode (avoid cache issues)

---

## 📚 LESSONS FROM PAST ISSUES

### Follow-up Date Field Issue (December 2024)
**Problem:** Field displayed on load but disappeared after updates
**Root Cause:** Missing `followUpDate: lead.followUpDate` in API service `getLeadById()`
**Time Wasted:** 3+ hours of scattered debugging
**Should Have Done:** Checked API service field mappings first

### ASH Workshop Email & Phone Field Issues  
**Problem:** Fields not displaying/saving correctly
**Root Cause:** Missing camelCase mappings in API service
**Pattern:** Same issue, same solution - API service field mapping

---

## 🚀 EFFICIENT DEBUGGING COMMANDS

### Quick field mapping check:
```bash
# Search for field in API service
grep -n "fieldName" linkedin-messaging-followup-next/services/api.js

# Check if both formats exist
grep -n "Field Name\|fieldName" linkedin-messaging-followup-next/services/api.js
```

### Testing approach:
1. Hard refresh browser (Ctrl+F5) before testing
2. Check browser console for actual errors
3. Add targeted debugging only at transition points

---

## 💡 REMEMBER

- **Browser caching can hide working fixes** - always hard refresh when testing
- **Follow the data flow systematically** - don't guess where the problem is
- **API Service is the most common failure point** for field mapping issues
- **Every debugging session should add lessons to this guide**

---

## 📏 GUIDE MAINTENANCE

**Keep this guide manageable:**
- **Max 2-3 common patterns** - don't add every minor issue
- **Only add issues that wasted 2+ hours** - focus on significant time-savers
- **Keep sections under 5 bullet points** - avoid information overload
- **Archive/remove outdated lessons** - guide should be current and focused
- **Goal: 2-minute read time** - if longer, consider trimming

---

*Last updated: December 2024 - Follow-up Date field fix*