# ⚠️ CRITICAL: Hardcoded Client References Found
*Must be fixed before client onboarding*

## 🚨 Production-Breaking Issues

### 1. Frontend Fallback in TopScoringPosts.js
**File:** `LinkedIn-Messaging-FollowUp/web-portal/src/components/TopScoringPosts.js`
**Line 31:** `const client = urlParams.get('client') || 'Guy-Wilson';`

**Risk:** If URL has no client parameter, it defaults to Guy-Wilson instead of the actual client
**Impact:** Real clients would see Guy Wilson's data instead of their own

### 2. Next.js API Service Fallback
**File:** `linkedin-messaging-followup-next/services/api.js`  
**Line 65:** `config.params.client = 'Guy-Wilson';`

**Risk:** Development fallback in production API calls
**Impact:** All API calls without proper client initialization default to Guy Wilson's data

### 3. Legacy AIRTABLE_BASE_ID in index.js
**File:** `index.js`
**Line 55:** `const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;`

**Risk:** Single base ID instead of per-client base lookup
**Impact:** All webhook operations use one base instead of client-specific bases

## 🔧 Test Files (Safe but Should Be Updated)

### Test Scripts
- `test-api-endpoints.js` - Line 7: `const CLIENT_ID = 'Guy-Wilson';`
- `test-create-lead.js` - Line 14: Guy-Wilson in URL
- `test-leads-endpoints.js` - Lines 10, 37: Guy-Wilson in test data
- `test-new-lead.js` - Line 19: Guy-Wilson in test data

### Documentation Files
- `AIRTABLE-FIELD-REFERENCE.md` - Sample values showing Guy-Wilson
- `PB-Webhook-Server-Documentation.md` - Examples using Guy-Wilson
- Various `.md` files with Guy-Wilson examples

### Start Scripts
- `start-server.bat` - Line 4: URL with Guy-Wilson parameter
- `start-server.ps1` - Line 4: URL with Guy-Wilson parameter

## ✅ Already Secure (Good!)

### Authentication System
- `middleware/authMiddleware.js` - Properly uses dynamic client lookup ✅
- `services/clientService.js` - Uses MASTER_CLIENTS_BASE_ID dynamically ✅
- All route handlers use `req.client.airtableBaseId` ✅

### Backend Services
- Multi-tenant architecture working correctly ✅
- Client base lookup functioning ✅
- Environment variables properly configured ✅

## 🛠️ Required Fixes Before Client Launch

### Priority 1: Critical Frontend Fixes
1. Remove Guy-Wilson fallback from TopScoringPosts.js
2. Remove Guy-Wilson fallback from Next.js API service
3. Add proper error handling when no client is available

### Priority 2: Webhook System Update
1. Update index.js to use client-specific base lookup
2. Ensure webhook endpoints respect multi-tenant architecture

### Priority 3: Development Safety
1. Update test files to use environment variables
2. Update start scripts to not default to Guy-Wilson
3. Add client parameter validation

## 🎯 Action Plan

### Step 1: Fix Critical Frontend Issues
```bash
# Fix the two critical frontend fallbacks
# Replace hardcoded Guy-Wilson with proper error handling
```

### Step 2: Update Webhook System  
```bash
# Modify index.js to use dynamic client lookup
# Test webhook with authentication middleware
```

### Step 3: Clean Up Development Files
```bash
# Update test files and start scripts
# Remove hardcoded references from documentation examples
```

## 🔒 Security Validation

After fixes, verify:
- [ ] No hardcoded client IDs in production code
- [ ] All API calls use authenticated client data
- [ ] Frontend shows error instead of wrong client data
- [ ] Webhook system respects client boundaries
- [ ] Test mode still works for development

## 🚀 Ready for Client Onboarding

Once these fixes are complete:
✅ Each client sees only their data  
✅ No cross-client data leakage  
✅ Proper authentication required  
✅ Graceful error handling  
✅ Multi-tenant architecture secure  
