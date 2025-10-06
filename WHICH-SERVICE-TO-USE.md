# Which Service Should I Use?

**Quick Reference Guide** - Updated October 6, 2025

## 🎯 Canonical Services (Use These!)

### Job Tracking Operations
**Use:** `services/jobTracking.js`

```javascript
const { JobTracking } = require('./services/jobTracking');

// Create a job
await JobTracking.createJob({ runId, clientId, stream, options });

// Update a job
await JobTracking.updateJob({ runId, updates, options });

// Complete a job
await JobTracking.completeJob({ runId, status, systemNotes, options });

// Create client run
await JobTracking.createClientRun({ runId, clientId, options });

// Update client run
await JobTracking.updateClientRun({ runId, clientId, updates, options });
```

**✅ This service:**
- Uses field constants (no raw strings)
- Validates field names automatically
- Normalizes run IDs
- Handles multi-tenant isolation

---

### Airtable Operations
**Use:** `services/airtableService.js`

```javascript
const airtableService = require('./services/airtableService');

// Initialize
airtableService.initialize();

// Create job tracking record
await airtableService.createJobTrackingRecord({ runId, clientId, stream, options });

// Update job tracking
await airtableService.updateJobTracking({ runId, updates, options });

// Update client run
await airtableService.updateClientRun({ runId, clientId, updates, options });
```

**✅ This service:**
- Provides high-level Airtable operations
- Uses field constants
- Coordinates job tracking and client runs

---

### Run Record Operations
**Use:** `services/runRecordServiceV2.js`

```javascript
const runRecordService = require('./services/runRecordServiceV2');

// Create run record
await runRecordService.createRunRecord({ runId, clientId, clientName, options });

// Update run record
await runRecordService.updateRunRecord({ runId, clientId, updates, options });

// Complete run record
await runRecordService.completeRunRecord({ runId, clientId, success, notes, options });
```

**OR use the simplified adapter:**

**Use:** `services/runRecordAdapterSimple.js`

```javascript
const runRecordAdapter = require('./services/runRecordAdapterSimple');

// Simplified API with automatic validation
await runRecordAdapter.createRunRecord({ runId, clientId, clientName, options });
await runRecordAdapter.updateMetrics({ runId, clientId, metrics, options });
```

**✅ These services:**
- Handle run record lifecycle
- Prevent duplicate creation
- Validate run IDs automatically
- Provide safety checks

---

### Client Management
**Use:** `services/clientService.js`

```javascript
const clientService = require('./services/clientService');

// Get all clients
const clients = await clientService.getAllClients();

// Get client by ID
const client = await clientService.getClientById(clientId);

// Get client base
const clientBase = await clientService.getClientBase(clientId);
```

**✅ This service:**
- Caches client data
- Manages multi-tenant base connections
- Provides client lookup utilities

---

### Run ID Operations
**Use:** `services/runIdSystem.js`

```javascript
const runIdSystem = require('./services/runIdSystem');

// Normalize run ID
const baseRunId = runIdSystem.getBaseRunId(runId);

// Parse run ID
const { base, iteration } = runIdSystem.parseRunId(runId);

// Add iteration
const newRunId = runIdSystem.addIteration(runId, 2);
```

**✅ This service:**
- Centralizes run ID logic
- Handles iteration suffixes
- Provides validation

---

## ❌ Do NOT Use (Deprecated/Deleted)

### ~~unifiedJobTrackingRepository~~ → Use `JobTracking` instead
**Status:** DELETED ✂️  
**Reason:** Superseded by `services/jobTracking.js`

### ~~simpleJobTracking~~ → Use `JobTracking` instead  
**Status:** DELETED ✂️  
**Reason:** Superseded by `services/jobTracking.js`

### ~~airtableServiceSimple~~ → Use `airtableService` instead
**Status:** DELETED ✂️  
**Reason:** Superseded by `services/airtableService.js`

### ~~services/airtable/*~~ → Use main services instead
**Status:** DELETED ✂️  
**Reason:** Entire subdirectory removed (baseManager, clientRepository, leadRepository, airtableService)

---

## 🔍 How to Find the Right Service

### I need to... → Use this service

| Task | Service |
|------|---------|
| Create/update a job in Job Tracking table | `services/jobTracking.js` |
| Create/update client run in Client Run Results table | `services/jobTracking.js` or `services/runRecordServiceV2.js` |
| Get client information | `services/clientService.js` |
| Work with leads | `services/leadService.js` |
| Normalize a run ID | `services/runIdSystem.js` |
| Validate field names | `utils/airtableFieldValidator.js` |
| Get field constants | `constants/airtableUnifiedConstants.js` |

---

## 🛡️ Best Practices

### Always Use Field Constants
**❌ DON'T:**
```javascript
const updates = {
  'Status': 'Completed',  // Raw string - breaks if field name changes
  'End Time': endTime
};
```

**✅ DO:**
```javascript
const { CLIENT_RUN_FIELDS } = require('./constants/airtableUnifiedConstants');

const updates = {
  [CLIENT_RUN_FIELDS.STATUS]: 'Completed',  // Constant - safe!
  [CLIENT_RUN_FIELDS.END_TIME]: endTime
};
```

### Always Normalize Run IDs
**❌ DON'T:**
```javascript
await JobTracking.createJob({ runId: userProvidedRunId, ... });  // Might have iteration suffix
```

**✅ DO:**
```javascript
const runIdSystem = require('./services/runIdSystem');
const baseRunId = runIdSystem.getBaseRunId(userProvidedRunId);  // Remove iteration suffix
await JobTracking.createJob({ runId: baseRunId, ... });
```

### Always Use Options Object Pattern
**❌ DON'T:**
```javascript
createRunRecord(runId, clientId, clientName);  // Positional args - hard to read
```

**✅ DO:**
```javascript
createRunRecord({ 
  runId, 
  clientId, 
  clientName,
  options: { logger, source: 'my_script' }
});  // Named params - clear and flexible
```

---

## 📚 Related Documentation

- **Field Constants:** `constants/airtableUnifiedConstants.js`
- **Field Validation:** `utils/airtableFieldValidator.js`  
- **Run ID System:** `services/runIdSystem.js`
- **Architecture:** `SYSTEM-OVERVIEW.md`
- **Consolidation History:** `SERVICE-LAYER-CONSOLIDATION-GUIDE.md`

---

## 🎉 Service Layer Consolidation Complete!

**Before:** 11+ duplicate service implementations  
**After:** 6 canonical services with clear responsibilities

**Impact:**
- ✅ Deleted 3,401 lines of duplicate code (Oct 6, 2025)
- ✅ Migrated 10+ production files to canonical services
- ✅ Bug fixes now require updating 1 file instead of 3-4
- ✅ Clear documentation for which service to use

**Next steps:**
- Use this guide when writing new code
- Share with new developers during onboarding
- Update test files to use canonical services (deferred)

---

**Created:** October 6, 2025  
**Consolidated by:** AI Assistant + Guy Wilson  
**Effort:** ~4 hours, 8 phases, multiple commits
