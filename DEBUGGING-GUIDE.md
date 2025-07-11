# DEBUGGING PROCEDURES GUIDE

## ⚠️ CRITICAL WARNING
**Huge amounts of time have been wasted on inefficient debugging. Follow this guide systematically to avoid repeating mistakes.**

## 🧠 IMPORTANT: FLEXIBLE THINKING
**This guide provides STARTING POINTS for common issues, not rigid rules. If the systematic approach doesn't reveal the problem quickly, think creatively and try alternative approaches. The goal is efficient problem-solving, not blind rule-following.**

---

## 🔍 SYSTEMATIC DEBUGGING APPROACH

### When form fields disappear after updates:

**❌ DON'T start with:**
- Adding console.logs everywhere
- Debugging backend routes first
- Assuming it's a deployment issue
- Random trial-and-error approaches

**✅ DO check in this exact order:**
1. **API Service Layer FIRST** (`linkedin-messaging-followup-next/services/api.js`)
   - Check `getLeadById()` return object for missing camelCase field mappings
   - Check `updateLead()` fieldMapping object for missing entries
   - This is where 80% of field mapping issues occur

2. **Backend Routes** (only if API service looks correct)
   - Check if backend actually returns the field data
   - Verify both spaced and camelCase versions exist

3. **Frontend Components** (last resort)
   - Only after confirming data flows correctly through API service

### Data Flow Debugging Order:
```
Airtable → Backend GET → API Service → Frontend Display
Frontend Form → API Service → Backend PUT → Airtable
```
**Always trace systematically through this flow, don't skip steps.**

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