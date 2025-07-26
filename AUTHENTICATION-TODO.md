# Authentication & Security Implementation TODO

**Project Goal:** Move from hardcoded client testing to dynamic WordPress User ID authentication with service level controls and secure batch processing.

## 🔐 Phase 1: Service Level Logic & Hard-coding Cleanup (PRIORITY: HIGH)

### Fix Service Level Parsing
- [ ] **Update clientService.js** - Parse service level from strings like "2-Lead Scoring + Post Scoring" → extract number 2
- [ ] **Test service level extraction** - Ensure "1-Basic", "2-Lead Scoring + Post Scoring" work correctly
- [ ] **Add fallback logic** - Default to level 1 if parsing fails

### Remove Hard-coded Client References
- [ ] **Backend API Routes** (`routes/apiAndJobRoutes.js`)
  - [ ] Remove `'Guy-Wilson'` default from `getCurrentTokenUsage()`
  - [ ] Remove `'Guy-Wilson'` default from `validateTokenBudget()`
  - [ ] Remove `'Guy-Wilson'` default from `getCurrentPostTokenUsage()`
  - [ ] Remove `'Guy-Wilson'` default from `validatePostTokenBudget()`
  - [ ] Remove `'Guy-Wilson'` fallback from 4 endpoint handlers (lines 815, 845, 882, 912)

- [ ] **Frontend API Calls** (`linkedin-messaging-followup-next/services/api.js`)
  - [ ] Remove `client: 'Guy-Wilson'` from 6 different API call functions
  - [ ] Replace with dynamic client lookup from authentication
  - [ ] Update all TODO comments about making client dynamic

- [ ] **Frontend Components**
  - [ ] Update `TopScoringPosts.js` - remove `'Guy-Wilson'` fallback
  - [ ] Update any other components with hardcoded client references

### Environment Variables Documentation
- [ ] **Document required environment variables** in README.md:
  - [ ] `WP_BASE_URL` - WordPress API base URL
  - [ ] `BATCH_API_SECRET` - Secret key for batch processing authentication
  - [ ] `MASTER_CLIENTS_BASE_ID` - Airtable base ID for clients table
  - [ ] `AIRTABLE_API_KEY` - Airtable API access key

---

## 🚨 Phase 2: Batch Processing Security (PRIORITY: CRITICAL)

### Add Batch API Authentication
- [ ] **Create batch authentication middleware** in `authMiddleware.js`
  - [ ] Add `authenticateBatchRequest()` function
  - [ ] Check for `x-api-key` header or `apiKey` query parameter
  - [ ] Validate against `process.env.BATCH_API_SECRET`
  - [ ] Log unauthorized access attempts

### Secure Batch Endpoints
- [ ] **Protect `/run-post-batch-score` endpoint**
  - [ ] Add batch authentication middleware
  - [ ] Ensure only active clients are processed
  - [ ] Add admin override capability

- [ ] **Protect `/run-batch-score` endpoint**
  - [ ] Add batch authentication middleware  
  - [ ] Filter to active clients only
  - [ ] Add processing limits and logging

### Update Batch Processing Logic
- [ ] **Modify `postBatchScorer.js`**
  - [ ] Filter clients by `status === 'Active'` before processing
  - [ ] Add logging for skipped inactive clients
  - [ ] Return statistics on active vs inactive clients

- [ ] **Modify `batchScorer.js`**
  - [ ] Only process leads for active clients
  - [ ] Skip inactive clients with appropriate logging
  - [ ] Add processing statistics

### Automated System Integration
- [ ] **Set up environment variable on Render**
  - [ ] Add `BATCH_API_SECRET` with secure random value
  - [ ] Document the secret for cron job/automation setup

- [ ] **Update external automation calls**
  - [ ] Add API key header to cron job requests
  - [ ] Update GitHub Actions (if used) with secret
  - [ ] Test automated batch processing with new auth

---

## 🧪 Phase 3: Testing & Validation (PRIORITY: MEDIUM)

### Authentication Flow Testing
- [ ] **Test WordPress authentication**
  - [ ] Verify WordPress API calls work with existing headers
  - [ ] Test user lookup by WordPress User ID
  - [ ] Test client status validation (Active/Inactive)

- [ ] **Test service level enforcement**
  - [ ] Verify level 1 users can't access level 2+ features
  - [ ] Test service level middleware factory
  - [ ] Validate error messages and codes

### Security Testing
- [ ] **Test batch endpoint security**
  - [ ] Verify endpoints reject requests without API key
  - [ ] Test with invalid API keys
  - [ ] Confirm only active clients are processed

- [ ] **Test client filtering**
  - [ ] Create test inactive client
  - [ ] Verify they can't access portal
  - [ ] Confirm they're skipped in batch processing

### Integration Testing
- [ ] **End-to-end authentication test**
  - [ ] WordPress login → Client lookup → Portal access
  - [ ] Test with multiple service levels
  - [ ] Verify proper error handling

- [ ] **Test mode validation**
  - [ ] Verify `?testClient=Guy-Wilson` still works for development
  - [ ] Test fallback to real authentication
  - [ ] Confirm test mode is properly logged

---

## 📋 Phase 4: Documentation & Deployment (PRIORITY: LOW)

### Code Documentation
- [ ] **Update API documentation**
  - [ ] Document new authentication requirements
  - [ ] Update endpoint examples with proper headers
  - [ ] Document service level restrictions

- [ ] **Create deployment checklist**
  - [ ] Environment variables setup
  - [ ] Database field validation
  - [ ] Authentication testing steps

### Production Deployment
- [ ] **Environment setup validation**
  - [ ] Verify all required environment variables are set
  - [ ] Test WordPress API connectivity
  - [ ] Validate Airtable base connections

- [ ] **Gradual rollout plan**
  - [ ] Deploy with test mode enabled
  - [ ] Validate existing clients work correctly
  - [ ] Switch to production authentication
  - [ ] Monitor for authentication errors

### Monitoring & Maintenance
- [ ] **Add authentication logging**
  - [ ] Log successful authentications
  - [ ] Track authentication failures
  - [ ] Monitor batch processing statistics

- [ ] **Create troubleshooting guide**
  - [ ] Common authentication error solutions
  - [ ] Service level access issues
  - [ ] Batch processing troubleshooting

---

## 🔧 Technical Implementation Notes

### Service Level Parsing Logic
```javascript
// Extract numeric service level from strings like "2-Lead Scoring + Post Scoring"
function parseServiceLevel(serviceLevelString) {
  if (typeof serviceLevelString === 'number') return serviceLevelString;
  if (typeof serviceLevelString === 'string') {
    const match = serviceLevelString.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
  }
  return 1; // Default fallback
}
```

### Batch Authentication Middleware
```javascript
// Authenticate batch processing requests
function authenticateBatchRequest(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey || apiKey !== process.env.BATCH_API_SECRET) {
    console.warn('Batch API: Unauthorized access attempt', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.path
    });
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Valid API key required for batch operations' 
    });
  }
  
  console.log('Batch API: Authorized batch request', { endpoint: req.path });
  next();
}
```

### Active Client Filtering
```javascript
// Only process active clients in batch operations
async function getActiveClients() {
  const allClients = await clientService.getAllClients();
  const activeClients = allClients.filter(client => client.status === 'Active');
  
  console.log(`Batch Processing: ${activeClients.length} active clients out of ${allClients.length} total`);
  return activeClients;
}
```

---

## 🎯 Success Criteria

### Phase 1 Complete When:
- ✅ No hardcoded "Guy-Wilson" references in codebase
- ✅ Service levels parse correctly from Airtable strings
- ✅ All environment variables documented

### Phase 2 Complete When:
- ✅ Batch endpoints require authentication
- ✅ Only active clients are processed in batch operations
- ✅ Unauthorized access attempts are blocked and logged

### Phase 3 Complete When:
- ✅ Authentication flow works end-to-end
- ✅ Service level restrictions enforced correctly
- ✅ Test mode still functions for development

### Phase 4 Complete When:
- ✅ Production deployment successful
- ✅ All clients can authenticate correctly
- ✅ Monitoring and logging in place

---

## 🚀 Next Steps

1. **START HERE:** Fix service level parsing in `clientService.js`
2. **CRITICAL:** Secure batch endpoints with authentication
3. **IMPORTANT:** Remove all hardcoded client references
4. **VALIDATE:** Test complete authentication flow

**Estimated Time:** 2-3 hours total implementation + testing

**Risk Level:** Medium (authentication changes require careful testing)

**Dependencies:** Render environment variable setup, WordPress API access
