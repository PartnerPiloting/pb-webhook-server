# Multi-Tenant Migration Task List

## Project Overview
Transition PB-Webhook-Server from single-tenant to multi-tenant architecture, enabling the system t- [ ] **Dependencies**: Task 1.3 complete
- [ ] **Estimated Time**: 2 hours

### Task 3.3: Create Execution Summary Dashboard
- [ ] **Status**: NOT STARTED
- [ ] **Purpose**: Central dashboard view of all client processing performance without diving into individual execution logs
- [ ] **Implementation**:
  - [ ] Add "Execution Summary" table to "Clients" master base
  - [ ] Create table schema with fields: Execution ID, Date, Time, Client ID, Client Name, Process Type, Status, Leads Processed/Successful/Failed, Success Rate, Duration, Tokens Used, Error Count, Performance Score
  - [ ] Set up dashboard views: "Today's Executions", "Last 7 Days", "By Client", "Performance Trends"
  - [ ] Modify `clientService.js` to write summary records alongside execution logs
  - [ ] Add summary record creation to both lead scoring and post scoring processes
- [ ] **Benefits**: 
  - [ ] Quick performance overview across all clients
  - [ ] Timing analysis and trend tracking
  - [ ] Error spotting and performance monitoring
  - [ ] Client reporting capabilities
- [ ] **Dependencies**: Task 1.2, 1.3 complete
- [ ] **Estimated Time**: 3 hours

---rve multiple clients while maintaining the owner (Guy Wilson) as the first client.

## Current Status: PHASE 1 COMPLETED ✅
- **Documentation**: Updated and comprehensive ✅
- **Airtable Structure**: Master "Clients" base created ✅
- **Client Data**: "My Leads - Guy Wilson" base renamed and configured ✅
- **Schema**: Clients table with Execution Log field designed ✅
- **Current Airtable Analysis**: Complete - simple single-base pattern identified ✅
- **Client Management Service**: Complete with caching and validation ✅
- **Airtable Client Refactoring**: Complete with dynamic base switching ✅
- **Batch Processing Core**: Complete with multi-tenant support ✅

---

## Phase 1: Core Multi-Tenant Infrastructure

### Task 1.1: Analyze Current Airtable Integration
- [x] **Status**: COMPLETED ✅
- [x] **File**: Read and analyzed `config/airtableClient.js`
- [x] **Purpose**: Understand current connection logic and identify refactoring needs
- [x] **Output**: Document current implementation patterns
- [x] **Estimated Time**: 30 minutes

**Findings**:
- **Current Pattern**: Single global `airtableBaseInstance` using environment variables
- **Configuration**: Clean environment-based setup with `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID`
- **Limitations**: Hardcoded to one base, no dynamic switching capability
- **Refactoring Strategy**: Add factory functions for multi-tenant support while maintaining backward compatibility
- **Key Insight**: Simple, clean structure makes refactoring straightforward

### Task 1.2: Create Client Management Service
- [x] **Status**: COMPLETED ✅
- [x] **File**: Created `services/clientService.js`
- [x] **Functions Implemented**:
  - [x] `getAllActiveClients()` - Read active clients from Clients base
  - [x] `getClientById(clientId)` - Get specific client config
  - [x] `updateExecutionLog(clientId, logEntry)` - Append execution logs
  - [x] `validateClient(clientId)` - Check if client exists and is active
  - [x] `formatExecutionLog(executionData)` - Format log entries consistently
  - [x] `clearCache()` - Cache management utility
- [x] **Dependencies**: Task 1.1 complete ✅
- [x] **Estimated Time**: 2 hours

**Key Features Implemented**:
- **Caching**: 5-minute cache for performance optimization
- **Error Handling**: Comprehensive error logging and graceful failures
- **Execution Logging**: Structured log format with timestamps and performance metrics
- **Environment Safety**: Proper validation of required environment variables
- **Cache Management**: Automatic invalidation and manual clearing capabilities

### Task 1.3: Refactor Airtable Client Configuration
- [x] **Status**: COMPLETED ✅
- [x] **File**: Modified `config/airtableClient.js`
- [x] **Changes Implemented**:
  - [x] Added support for dynamic base switching
  - [x] Created wrapper functions accepting `clientId` parameter
  - [x] Maintained 100% backward compatibility during transition
  - [x] Added base instance caching for performance
  - [x] Added `createBaseInstance(baseId)` for direct base creation
  - [x] Added `getClientBase(clientId)` for client-specific base access
  - [x] Added `clearBaseCache()` for cache management
- [x] **Dependencies**: Task 1.1, 1.2 complete ✅
- [x] **Estimated Time**: 1.5 hours

**Key Features Implemented**:
- **Backward Compatibility**: Existing `module.exports` unchanged - all current code keeps working
- **Performance Optimization**: Base instance caching to avoid repeated initialization
- **Error Handling**: Comprehensive validation and error messages
- **Client Integration**: Seamless integration with clientService for dynamic base lookup

### Task 1.4: Update Batch Processing Core Logic
- [x] **Status**: COMPLETED ✅
- [x] **File**: Modified `batchScorer.js`
- [x] **Changes Implemented**:
  - [x] Added client iteration loop at the top level with sequential processing
  - [x] Implemented per-client execution logging with detailed metrics
  - [x] Added error isolation between clients (one client failure doesn't affect others)
  - [x] Added token usage and performance tracking per client
  - [x] Added support for both single-client (`?clientId=xyz`) and multi-client modes
  - [x] Enhanced all functions to be client-aware with logging prefixes
  - [x] Added structured client result reporting with comprehensive summary
- [x] **Dependencies**: Task 1.2, 1.3 complete ✅
- [x] **Estimated Time**: 3 hours

**Key Features Implemented**:
- **Multi-Client Processing**: Supports both single client (`?clientId=guy-wilson`) and all-clients mode
- **Error Isolation**: Individual client failures don't stop processing of other clients
- **Performance Tracking**: Detailed metrics per client (leads processed, tokens used, duration)
- **Execution Logging**: Comprehensive logs stored in each client's execution log field
- **Backward Compatibility**: Maintains API contract while adding multi-tenant capabilities
- **Client-Aware Logging**: All console output includes client identifier for debugging

---

## Phase 2: Endpoint Refactoring

### Task 2.1: Update Lead Scoring Batch API
- [ ] **Status**: NOT STARTED
- [ ] **File**: Update endpoint handlers calling `batchScorer.js`
- [ ] **Changes Needed**:
  - [ ] Modify `/run-batch-score` to process all clients
  - [ ] Add `/run-batch-score?clientId=xyz` for single client
  - [ ] Implement execution logging integration
- [ ] **Dependencies**: Task 1.4 complete
- [ ] **Estimated Time**: 1 hour

### Task 2.2: Update Post Scoring Batch API  
- [x] **Status**: COMPLETED ✅
- [x] **File**: Created `postBatchScorer.js` and added `/run-post-batch-score` endpoint
- [x] **Changes Implemented**:
  - [x] Created new multi-tenant post scoring system (`postBatchScorer.js`)
  - [x] Added `/run-post-batch-score` endpoint supporting both single-client and all-clients modes
  - [x] Integrated with client service for dynamic base switching and execution logging
  - [x] Implemented per-client error isolation and detailed result tracking
  - [x] Supports query parameters: `?clientId=guy-wilson&limit=50`
- [x] **Dependencies**: Task 1.2, 1.3 complete ✅
- [x] **Estimated Time**: 2 hours (Actual: 2 hours)

### Task 2.3: Update Webhook Handlers
- [ ] **Status**: NOT STARTED
- [ ] **Files**: `routes/webhookHandlers.js`, LinkedHelper/PhantomBuster endpoints
- [ ] **Changes Needed**:
  - [ ] Add `clientId` parameter support to webhooks
  - [ ] Implement client validation for incoming data
  - [ ] Route data to correct client base
- [ ] **Dependencies**: Task 1.2, 1.3 complete
- [ ] **Estimated Time**: 2 hours

---

## Phase 3: Supporting Services Updates

### Task 3.1: Update All Scoring Components
- [ ] **Status**: NOT STARTED
- [ ] **Files**: `singleScorer.js`, `scoring.js`, `promptBuilder.js`, `attributeLoader.js`, `breakdown.js`
- [ ] **Changes Needed**:
  - [ ] Add client-context parameter passing
  - [ ] Update attribute loading for client-specific bases
  - [ ] Ensure all components work with dynamic base connections
- [ ] **Dependencies**: Task 1.3 complete
- [ ] **Estimated Time**: 3 hours

### Task 3.2: Update Post Scoring Components
- [ ] **Status**: NOT STARTED
- [ ] **Files**: `postAnalysisService.js`, `postGeminiScorer.js`, `postPromptBuilder.js`, `postAttributeLoader.js`
- [ ] **Changes Needed**:
  - [ ] Add client-context support
  - [ ] Update for multi-tenant base switching
- [ ] **Dependencies**: Task 1.3 complete
- [ ] **Estimated Time**: 2 hours

### Task 3.3: Update Utility Functions
- [ ] **Status**: NOT STARTED
- [ ] **Files**: `utils/appHelpers.js`, `utils/parsePlainTextPosts.js`
- [ ] **Changes Needed**:
  - [ ] Review and update any hardcoded base references
  - [ ] Add client-context support where needed
- [ ] **Dependencies**: Task 1.3 complete
- [ ] **Estimated Time**: 1 hour

---

## Phase 4: Testing & Validation

### Task 4.1: Add Guy Wilson as First Client
- [ ] **Status**: NOT STARTED
- [ ] **Action**: Add record to Clients table in "Clients" base
- [ ] **Data**:
  - Client ID: `guy-wilson`
  - Client Name: `Guy Wilson`
  - Status: `Active`
  - Airtable Base ID: `appXySOLo6V9PfMfa`
  - Execution Log: `(empty initially)`
- [ ] **Dependencies**: Clients base already created ✅
- [ ] **Estimated Time**: 5 minutes

### Task 4.2: Test Single Client Processing
- [ ] **Status**: NOT STARTED
- [ ] **Tests**:
  - [ ] Run lead scoring for guy-wilson only
  - [ ] Verify execution log is properly recorded
  - [ ] Confirm no regressions in scoring logic
  - [ ] Check token usage tracking
- [ ] **Dependencies**: All Phase 1-3 tasks complete
- [ ] **Estimated Time**: 1 hour

### Task 4.3: Test Multi-Client Processing (Simulation)
- [ ] **Status**: NOT STARTED
- [ ] **Tests**:
  - [ ] Add test client record (status: Paused)
  - [ ] Run full batch processing
  - [ ] Verify only active clients are processed
  - [ ] Test error isolation between clients
- [ ] **Dependencies**: Task 4.2 complete
- [ ] **Estimated Time**: 1 hour

### Task 4.4: Performance & Error Handling Validation
- [ ] **Status**: NOT STARTED
- [ ] **Tests**:
  - [ ] Test with intentional errors (bad base ID, API failures)
  - [ ] Verify execution logs capture all scenarios
  - [ ] Confirm performance metrics are tracked
  - [ ] Test token usage limits across clients
- [ ] **Dependencies**: Task 4.3 complete
- [ ] **Estimated Time**: 1.5 hours

---

## Phase 5: Production Deployment

### Task 5.1: Update Environment Configuration
- [ ] **Status**: NOT STARTED
- [ ] **Changes Needed**:
  - [ ] Add Clients base ID to environment variables
  - [ ] Update any hardcoded references
  - [ ] Verify all API keys and secrets are properly configured
- [ ] **Dependencies**: All testing complete
- [ ] **Estimated Time**: 30 minutes

### Task 5.2: Deploy and Monitor
- [ ] **Status**: NOT STARTED
- [ ] **Actions**:
  - [ ] Deploy to Render
  - [ ] Monitor first multi-tenant batch run
  - [ ] Verify execution logs in Clients table
  - [ ] Confirm cron jobs execute properly
- [ ] **Dependencies**: Task 5.1 complete
- [ ] **Estimated Time**: 1 hour + monitoring

### Task 5.3: Documentation Updates
- [ ] **Status**: NOT STARTED
- [ ] **Files**: Update `PB-Webhook-Server-Documentation.md`
- [ ] **Updates Needed**:
  - [ ] Add implementation details
  - [ ] Update API endpoint documentation
  - [ ] Document new client onboarding process
  - [ ] Add troubleshooting guide for multi-tenant issues
- [ ] **Dependencies**: Production deployment successful
- [ ] **Estimated Time**: 1 hour

---

## Phase 6: Client Onboarding Preparation

### Task 6.1: Create Client Onboarding Template
- [ ] **Status**: NOT STARTED
- [ ] **Deliverable**: Base template for new client data
- [ ] **Contents**:
  - [ ] Duplicate "My Leads - Guy Wilson" structure
  - [ ] Template naming convention
  - [ ] Required table and field setup
- [ ] **Estimated Time**: 30 minutes

### Task 6.2: Create Client Management Tools
- [ ] **Status**: NOT STARTED
- [ ] **Tools Needed**:
  - [ ] Add client API endpoint
  - [ ] Update client status API endpoint
  - [ ] Client health check endpoint
- [ ] **Estimated Time**: 2 hours

---

## Known Dependencies & Considerations

### Critical Path Dependencies
1. **Task 1.1 → 1.2 → 1.3** must be completed sequentially
2. **Phase 1** must be complete before starting **Phase 2**
3. **All development** must be complete before **Phase 4** testing

### Environment Variables Needed
- `CLIENTS_BASE_ID` - For the master Clients base
- Existing variables remain the same

### Risk Mitigation
- Keep backup of current working single-tenant code
- Test thoroughly with Guy Wilson as first client before adding others
- Implement rollback plan in case of issues

---

## Progress Tracking

**Total Estimated Time**: ~25 hours
**Completed Tasks**: 3/23 tasks ✅
**Current Phase**: Phase 1 - Core Infrastructure  
**Next Task**: Task 1.4 - Update Batch Processing Core Logic

---

## Quick Status Check Template
When resuming work, check:
1. What was the last completed task?
2. Are there any blockers or dependencies?
3. Have any new requirements or changes emerged?
4. Is the current phase timeline still realistic?

---

## Change Log
- **2025-06-26**: Initial task list created
- **2025-06-26**: Planning phase completed, Airtable structure set up
- **2025-06-26**: Task 1.1 completed - analyzed current Airtable integration patterns

---

*This document should be updated after each task completion and included in any new chat sessions to maintain continuity.*
