# PROJECT MANAGEMENT COMPLETE GUIDE
*Comprehensive Task Management, Implementation Plans & Production Status*

## 🎯 EXECUTIVE SUMMARY

**Current Status**: Multi-Tenant Phase 1 Complete ✅ | Apify Integration Analysis Complete ✅  
**Active Focus**: Production Issue Resolution + Phase 2-3 Implementation + Documentation Optimization  
**Critical Issues**: Complex lead profile scoring failures in production environment  
**Last Updated**: August 7, 2025  

---

## 🚨 CRITICAL PRODUCTION ISSUES

### **Issue #1: AI Scoring Failures for Complex Lead Profiles**
- **Status**: 🔴 PRODUCTION ISSUE IDENTIFIED
- **Impact**: ~10 leads consistently fail scoring attempts
- **Root Cause**: Complex/large profile data (20K+ chars) causes Gemini JSON corruption
- **Environment Gap**: Works locally, fails in production (Render resource constraints)
- **Next Steps**: 
  - [ ] Test increased `maxOutputTokens` in production
  - [ ] Analyze Render resource usage during AI calls
  - [ ] Implement timeout/retry mechanisms
  - [ ] Consider profile data chunking for large profiles

---

## 📋 MULTI-TENANT ARCHITECTURE STATUS

### **✅ PHASE 1: CORE INFRASTRUCTURE (COMPLETED)**

#### **Task 1.1: Airtable Integration Analysis** ✅
- **Status**: COMPLETED ✅
- **Findings**: Simple single-base pattern, clean refactoring path
- **Key Insight**: Clean structure makes multi-tenant upgrade straightforward

#### **Task 1.2: Client Management Service** ✅
- **Status**: COMPLETED ✅
- **File**: `services/clientService.js`
- **Functions Implemented**:
  - ✅ `getAllActiveClients()` - Read active clients from Clients base
  - ✅ `getClientById(clientId)` - Get specific client config
  - ✅ `updateExecutionLog(clientId, logEntry)` - Append execution logs
  - ✅ `validateClient(clientId)` - Check if client exists and is active
  - ✅ `formatExecutionLog(executionData)` - Format log entries consistently
  - ✅ `clearCache()` - Cache management utility
- **Key Features**:
  - **Caching**: 5-minute cache for performance optimization
  - **Error Handling**: Comprehensive error logging and graceful failures
  - **Execution Logging**: Structured log format with timestamps and performance metrics

#### **Task 1.3: Airtable Client Refactoring** ✅
- **Status**: COMPLETED ✅
- **File**: `config/airtableClient.js`
- **Changes Implemented**:
  - ✅ Dynamic base switching support
  - ✅ Client-specific base access functions
  - ✅ 100% backward compatibility maintained
  - ✅ Base instance caching for performance
  - ✅ Comprehensive error handling and validation

#### **Task 1.4: Batch Processing Core Logic** ✅
- **Status**: COMPLETED ✅
- **File**: `batchScorer.js`
- **Key Features**:
  - ✅ Multi-client processing with sequential execution
  - ✅ Per-client execution logging with detailed metrics
  - ✅ Error isolation between clients
  - ✅ Token usage and performance tracking per client
  - ✅ Support for both single-client (`?clientId=xyz`) and multi-client modes

---

### **🔄 PHASE 2: ENDPOINT REFACTORING (IN PROGRESS)**

#### **Task 2.1: Update Lead Scoring Batch API**
- **Status**: NOT STARTED
- **File**: Update endpoint handlers calling `batchScorer.js`
- **Changes Needed**:
  - [ ] Modify `/run-batch-score` to process all clients
  - [ ] Add `/run-batch-score?clientId=xyz` for single client
  - [ ] Implement execution logging integration
- **Dependencies**: Phase 1 complete ✅
- **Estimated Time**: 1 hour

#### **Task 2.2: Update Post Scoring Batch API** ✅
- **Status**: COMPLETED ✅
- **File**: `postBatchScorer.js` and `/run-post-batch-score` endpoint
- **Changes Implemented**:
  - ✅ Multi-tenant post scoring system created
  - ✅ Single-client and all-clients mode support
  - ✅ Client service integration with dynamic base switching
  - ✅ Per-client error isolation and detailed result tracking
  - ✅ Query parameter support: `?clientId=guy-wilson&limit=50`

#### **Task 2.3: Update Webhook Handlers**
- **Status**: NOT STARTED  
- **Files**: `routes/apiAndJobRoutes.js`
- **Changes Needed**:
  - [ ] Remove hardcoded 'Guy-Wilson' from PB webhook (line 240)
  - [ ] Add client detection logic from profile URLs
  - [ ] Add fallback to master client lookup
- **Dependencies**: Phase 1 complete ✅
- **Estimated Time**: 1.5 hours

---

### **📋 PHASE 3: SUPPORTING SERVICES (PENDING)**

#### **Task 3.1: Update All Scoring Components**
- **Status**: NOT STARTED
- **Files**: `singleScorer.js`, `attributeLoader.js`, `scoring.js`, `breakdown.js`
- **Changes Needed**: Add client-aware functions for multi-tenant scoring
- **Dependencies**: Phase 1 complete ✅
- **Estimated Time**: 3 hours

#### **Task 3.2: Update Post Scoring Components** 
- **Status**: NOT STARTED
- **Files**: `postBatchScorer.js`, `postGeminiScorer.js`
- **Changes Needed**: Ensure client isolation in post scoring
- **Dependencies**: Phase 1 complete ✅
- **Estimated Time**: 2 hours

#### **Task 3.3: Update Utility Functions**
- **Status**: NOT STARTED
- **Files**: `utils/appHelpers.js`, `utils/parsePlainTextPosts.js`
- **Changes Needed**: Review and update any hardcoded base references
- **Dependencies**: Task 1.3 complete ✅
- **Estimated Time**: 1 hour

---

## 🚀 APIFY LINKEDIN INTEGRATION ROADMAP

### **Task 4.1: Apify Service Analysis** ✅
- **Status**: COMPLETED ✅ (August 7, 2025)
- **Analysis Results**:
  - ✅ **Service Quality**: 4.1/5 stars, 5,300+ runs, well-maintained
  - ✅ **Pricing**: $5/1000 posts vs PhantomBuster's $400/year fixed cost
  - ✅ **Technical**: No-cookies architecture eliminates account restrictions
  - ✅ **Data Quality**: Superior engagement metrics and media attachments
  - ✅ **Multi-Tenant**: Native support with usage-based billing
  - ✅ **Risk Assessment**: LOW risk, multiple alternatives available
- **Deliverable**: Created `APIFY-INTEGRATION-GUIDE.md` with full implementation plan

### **Task 4.2: Implement Apify Webhook Endpoint**
- **Status**: READY TO START
- **Purpose**: Create new webhook endpoint to receive Apify LinkedIn posts data
- **Implementation Plan**:
  - [ ] Add `POST /api/apify-webhook` endpoint to `apiAndJobRoutes.js`
  - [ ] Implement token-based authentication using `APIFY_WEBHOOK_TOKEN`
  - [ ] Transform Apify data format to match existing `syncPBPostsToAirtable()` function
  - [ ] Add multi-tenant client detection via `x-client-id` header
- **Environment Variables Needed**:
  - [ ] `APIFY_API_TOKEN` - for API access
  - [ ] `APIFY_WEBHOOK_TOKEN` - for webhook authentication
- **Dependencies**: Task 1.3 complete ✅
- **Estimated Time**: 3 hours

### **Task 4.3: Setup Apify Scheduled Tasks**
- **Status**: NOT STARTED
- **Purpose**: Configure Apify platform for automated daily LinkedIn post extraction
- **Implementation Plan**:
  - [ ] Create Apify account and obtain API tokens
  - [ ] Setup daily cron schedules for each client (`0 0 * * *`)
  - [ ] Configure webhooks pointing to new endpoint
  - [ ] Test data flow from Apify → Webhook → Airtable
- **Dependencies**: Task 4.2 complete
- **Estimated Time**: 2 hours

### **Task 4.4: Migration Strategy Implementation**
- **Status**: NOT STARTED
- **Purpose**: Gradual migration from PhantomBuster to Apify
- **Strategy**:
  - [ ] **Phase 1**: Keep PhantomBuster for Guy-Wilson (paid for full year)
  - [ ] **Phase 2**: All new clients use Apify immediately
  - [ ] **Phase 3**: Migrate existing clients based on value proposition
- **Dependencies**: Task 4.3 complete
- **Estimated Time**: 4 hours

### **Task 4.5: Enhanced Analytics Implementation**
- **Status**: NOT STARTED
- **Purpose**: Leverage Apify's richer data for improved insights
- **Implementation Plan**:
  - [ ] Extend Airtable schema for engagement breakdown (likes, supports, loves)
  - [ ] Add media attachment tracking (images, videos, documents)
  - [ ] Implement post type classification (regular, quotes, reshares, articles)
  - [ ] Create enhanced reporting views
- **Dependencies**: Task 4.2 complete
- **Estimated Time**: 3 hours

---

## 🔐 AUTHENTICATION & SECURITY IMPLEMENTATION

### **🚨 PHASE 1: CRITICAL SECURITY FIXES (HIGH PRIORITY)**

#### **Service Level Logic & Hard-coding Cleanup**
- [ ] **Update clientService.js** - Parse service level from strings like "2-Lead Scoring + Post Scoring" → extract number 2
- [ ] **Test service level extraction** - Ensure "1-Basic", "2-Lead Scoring + Post Scoring" work correctly
- [ ] **Add fallback logic** - Default to level 1 if parsing fails

#### **Remove Hard-coded Client References**
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

### **🚨 PHASE 2: BATCH PROCESSING SECURITY (CRITICAL)**

#### **Add Batch API Authentication**
- [ ] **Create batch authentication middleware** in `authMiddleware.js`
  - [ ] Add `authenticateBatchRequest()` function
  - [ ] Check for `x-api-key` header or `apiKey` query parameter
  - [ ] Validate against `process.env.BATCH_API_SECRET`
  - [ ] Log unauthorized access attempts

#### **Secure Batch Endpoints**
- [ ] **Protect `/run-post-batch-score` endpoint**
  - [ ] Add batch authentication middleware
  - [ ] Ensure only active clients are processed
  - [ ] Add admin override capability

- [ ] **Protect `/run-batch-score` endpoint**
  - [ ] Add batch authentication middleware  
  - [ ] Filter to active clients only
  - [ ] Add processing limits and logging

#### **Environment Variables Required**
- [ ] `WP_BASE_URL` - WordPress API base URL
- [ ] `BATCH_API_SECRET` - Secret key for batch processing authentication
- [ ] `MASTER_CLIENTS_BASE_ID` - Airtable base ID for clients table
- [ ] `AIRTABLE_API_KEY` - Airtable API access key

---

## 💰 TOKEN BUDGET SYSTEM IMPLEMENTATION

### **✅ PHASE 1: TESTING IMPLEMENTATION (COMPLETED)**
- [x] Hardcoded 15K token limit for testing
- [x] Token counting function (`calculateAttributeTokens()`)
- [x] Current usage calculation (`getCurrentTokenUsage()`)
- [x] Budget validation before save (`validateTokenBudget()`)
- [x] API endpoints:
  - [x] `GET /api/token-usage` - Current usage status
  - [x] `POST /api/attributes/:id/validate-budget` - Check if save would exceed budget
- [x] Modified save endpoint to prevent activation when over budget

### **🚧 PHASE 2: CLIENT MASTER TABLE INTEGRATION (PENDING)**

#### **Service Level Tiers Configuration**
```javascript
const TOKEN_BUDGETS_BY_LEVEL = {
  1: 3000,   // Basic tier - 3,000 tokens
  2: 6000,   // Professional tier - 6,000 tokens  
  3: 12000,  // Enterprise tier - 12,000 tokens
  4: 25000   // Unlimited tier - 25,000 tokens
};
```

#### **Implementation Tasks**
- [ ] **Add Fields to Clients Table in Airtable**:
  - [ ] "Token Budget": 5000 (Total tokens this client can use)
  - [ ] "Token Usage": 1250 (Current token usage - real-time)
  - [ ] "Budget Reset Date": "2025-01-01" (When usage resets)
  - [ ] "Last Token Update": "2025-01-22T10:30:00Z" (Last update timestamp)

- [ ] **Update Client Service**:
  - [ ] Modify `clientService.js` to read new token fields
  - [ ] Add function `getClientTokenBudget(clientId)`
  - [ ] Add function `updateClientTokenUsage(clientId, newUsage)`
  - [ ] Add function `resetClientTokenUsage(clientId)`

- [ ] **Multi-Tenant Token Tracking**:
  - [ ] Modify token functions to be client-aware
  - [ ] Update `getCurrentTokenUsage(clientId)` 
  - [ ] Update `validateTokenBudget(clientId, attributeId, updatedData)`
  - [ ] Track usage per client in real-time

---

## 📋 PHASE 5: PRODUCTION DEPLOYMENT

### **Task 5.1: Update Environment Configuration**
- **Status**: NOT STARTED
- **Changes Needed**:
  - [ ] Add client-specific API keys, tokens, and base IDs
  - [ ] Add Clients base ID to environment variables
  - [ ] Update any hardcoded references
  - [ ] Verify all API keys and secrets are properly configured
- **Dependencies**: All previous phases complete
- **Estimated Time**: 1 hour

### **Task 5.2: Deploy and Monitor**
- **Status**: NOT STARTED
- **Actions**:
  - [ ] Deploy multi-tenant system to production
  - [ ] Validation: Test with Guy-Wilson client first
  - [ ] Monitor first multi-tenant batch run
  - [ ] Verify execution logs in Clients table
  - [ ] Confirm cron jobs execute properly
- **Dependencies**: Task 5.1 complete
- **Estimated Time**: 2 hours + monitoring

---

## ⚡ HIGH PRIORITY QUICK WINS

### **System Monitoring Infrastructure** 
- [ ] **Phase 1: Basic Monitoring**
  - [ ] Health check endpoints for all services
  - [ ] Error rate tracking
  - [ ] **Time**: 30-60 minutes

- [ ] **Phase 2: Email Alert System**
  - [ ] Critical error notifications
  - [ ] Daily processing summaries
  - [ ] **Time**: 1-2 hours

### **Frontend UX Improvements**
- [ ] **Phase 1: Bonus Points Frontend UX** 
  - [ ] Add toggle switches for bonus points in attribute library
  - [ ] Show bonus indicators in scoring breakdowns
  - [ ] **Time**: 2-3 hours

---

## 📊 TASK DEPENDENCIES & EXECUTION ORDER

### **Critical Path**
```
Phase 1 (COMPLETE) ✅
  ↓
Phase 2 (Endpoints) → Phase 3 (Services) → Phase 5 (Deploy)
  ↓                     ↓
Phase 4 (Apify) ←──────┘
  ↓
Authentication & Security (Parallel)
  ↓
Token Budget System (Parallel)
```

### **Recommended Execution Order**
1. **🚨 Critical Security Fixes** (Authentication Phase 1 & 2)
2. **📋 Multi-Tenant Phase 2** (Endpoint refactoring)
3. **🚀 Production Issues** (Complex lead profile fixes)
4. **📋 Multi-Tenant Phase 3** (Supporting services)
5. **🚀 Apify Integration** (Phase 4.2-4.4)
6. **💰 Token Budget System** (Phase 2)
7. **📋 Production Deployment** (Phase 5)

---

## 🏁 SUCCESS METRICS

### **Multi-Tenant System**
- ✅ Processing multiple clients without cross-contamination
- ✅ Client isolation in all scoring operations
- ✅ Execution logging per client with performance metrics

### **Apify Integration**
- 🎯 Cost per client <$10/month
- 🎯 >99% webhook success rate
- 🎯 Enhanced data quality (engagement metrics, media attachments)

### **Production Stability**
- 🎯 <1% scoring failure rate on complex profiles
- 🎯 Automated error recovery and retry mechanisms
- 🎯 Real-time monitoring and alerting

### **Security & Authentication**
- 🎯 No hardcoded client references in codebase
- 🎯 Secure batch processing with API key authentication
- 🎯 Service level restrictions properly enforced

### **Client Onboarding**
- 🎯 New clients operational within 24 hours
- 🎯 Automated client management tools
- 🎯 Self-service client status management

---

## 📚 DOCUMENTATION REFERENCE

- **Multi-Tenant Architecture**: `MULTI-TENANT-IMPLEMENTATION-SUMMARY.md`
- **Apify Integration**: `APIFY-INTEGRATION-GUIDE.md`
- **Development Environment**: `DEVELOPMENT-ENVIRONMENT-COMPLETE-GUIDE.md`
- **Authentication Setup**: Current document (Authentication section)
- **Environment Management**: `ENVIRONMENT-MANAGEMENT.md`

---

**Total Estimated Time**: ~40 hours across all phases  
**Current Progress**: Phase 1 complete, Phase 2 in progress  
**Next Critical Task**: Authentication security fixes + Phase 2 endpoint refactoring  

*This document consolidates and replaces: `MASTER-TASKS.md`, `Multi-Tenant-Migration-Tasks.md`, `AUTHENTICATION-TODO.md`, and `TOKEN-BUDGET-TODO.md`*
