# Service Layer Consolidation Guide

**Created:** October 6, 2025  
**Branch:** feature/service-layer-consolidation (to be created)  
**Status:** Ready to implement  
**Estimated Time:** 2-3 weeks (phased approach with testing)  
**Priority:** HIGH - Core technical debt causing bug multiplication

---

## TL;DR - The Problem

**Current State:** 11+ duplicate service implementations causing:
- Bug fixes require updating 3-4 files
- Field normalization bug required 21 commits across 11 files
- New developers don't know which service to use
- Production bugs multiply across implementations

**Goal:** Consolidate to single canonical implementation per service type.

**Strategy:** Fix production blocker first (1 hour), then systematic consolidation (2-3 weeks).

---

## Phase 0: Production Blocker Fix (MUST DO FIRST)

### ⚠️ Before You Start Consolidation

**Current production issue:** Apify routes use raw field name strings causing "Unknown field name: undefined" error.

**Required:** Complete **APIFY-FIELD-STANDARDIZATION-PLAN.md** first (1 hour).

**Why:** This unblocks production and gives you working code patterns to reference during consolidation.

**Steps:**
1. Read APIFY-FIELD-STANDARDIZATION-PLAN.md
2. Create feature/apify-field-constants branch
3. Fix field constants in routes/apifyProcessRoutes.js
4. Deploy and verify
5. **THEN** proceed to Phase 1 below

---

## Phase 1: Analysis & Planning (Week 1, Days 1-2)

### Step 1.1: Create Consolidation Branch

```bash
cd /c/Users/guyra/Desktop/pb-webhook-server-dev
git checkout main
git pull origin main
git checkout -b feature/service-layer-consolidation
```

### Step 1.2: Map Service Dependencies

**Task:** Understand which files use which services.

**Known Service Usage (from grep analysis):**

**JobTracking Service Users:**
- ✅ `utils/postScoringMetricsHelper.js` (2 imports)
- ✅ `scripts/smart-resume-client-by-client.js`
- ✅ `scripts/smart-resume-fixed.js`
- ✅ `postBatchScorer.js`
- ✅ `routes/diagnosticRoutes.js`
- ✅ `routes/apifyWebhookRoutes.js`
- ✅ `test-job-tracking.js`
- ✅ `test-run-id-consistency.js`

**airtableService Users:**
- ✅ `batchScorer.js`
- ✅ `routes/apifyProcessRoutes.js`
- ✅ `test-client-run-records.js`
- ✅ `test-e2e-run-id-handling.js`
- ✅ `test-post-harvest-run-ids.js`
- ✅ `tests/test-client-run-caching.js`

**Action Items:**
```bash
# Find all JobTracking imports
grep -r "require.*services/jobTracking" --include="*.js" . > analysis/jobTracking-usage.txt

# Find all airtableService imports  
grep -r "require.*services/airtableService" --include="*.js" . > analysis/airtableService-usage.txt

# Find all runRecordService imports
grep -r "require.*services/runRecord" --include="*.js" . > analysis/runRecordService-usage.txt
```

### Step 1.3: Inventory All Service Implementations

**Job Tracking Services (4 found):**

| File | Status | Lines | Pattern | Keep/Deprecate |
|------|--------|-------|---------|----------------|
| `services/jobTracking.js` | ✅ KEEP | ~800 | Class-based, newest API | **PRIMARY** |
| `services/unifiedJobTrackingRepository.js` | ❌ DEPRECATE | ~600 | Older pattern | Migrate to jobTracking.js |
| `services/simpleJobTracking.js` | ❌ DEPRECATE | ~400 | Legacy | Migrate to jobTracking.js |
| `_archived_legacy/airtable/jobTrackingRepository.js` | ❌ DELETE | ~300 | Archived | Delete immediately |

**Airtable Services (7 found):**

| File | Status | Lines | Pattern | Keep/Deprecate |
|------|--------|-------|---------|----------------|
| `services/airtableService.js` | ✅ KEEP | ~1200 | Most used, comprehensive | **PRIMARY** |
| `services/airtableServiceSimple.js` | ❌ DEPRECATE | ~800 | Redundant | Migrate to airtableService.js |
| `services/airtableServiceAdapter.js` | ⚠️ EVALUATE | ~400 | Adapter pattern | May be useful wrapper |
| `services/airtable/airtableService.js` | ❌ CONSOLIDATE | ~600 | Wrong directory | Merge into primary |
| `temp/airtableService.new.js` | ❌ DELETE | Unknown | Temp file | Delete immediately |
| `services/airtableService.bak.js` | ❌ DELETE | Unknown | Backup | Delete immediately |
| `services/airtableService.old.js` | ❌ DELETE | Unknown | Backup | Delete immediately |

**Run Record Services (3 found):**

| File | Status | Lines | Pattern | Keep/Deprecate |
|------|--------|-------|---------|----------------|
| `services/runRecordServiceV2.js` | ✅ KEEP | ~900 | v2 = current version | **PRIMARY** |
| `services/runRecordAdapterSimple.js` | ⚠️ EVALUATE | ~1300 | Adapter, "Simple Creation Point" pattern | May be useful wrapper |
| `_archived_legacy/airtable/runRecordRepository.js` | ❌ DELETE | ~500 | Archived | Delete immediately |

### Step 1.4: Document Current API Patterns

**Create:** `analysis/service-api-inventory.md`

**For each service to KEEP, document:**
- Public methods and signatures
- Field validation approach (uses createValidatedObject?)
- Run ID handling (uses runIdSystem?)
- Error handling pattern
- Logging approach
- Multi-tenant support

**Example for jobTracking.js:**
```markdown
## JobTracking Service (PRIMARY)

**File:** services/jobTracking.js
**Pattern:** ES6 Class with static methods
**Multi-tenant:** Yes - takes clientId or base parameter

### Public API:
- `JobTracking.createJob({ runId, clientId, stream, ...options })`
- `JobTracking.updateJob({ runId, updates, options })`
- `JobTracking.completeJob({ runId, status, systemNotes, options })`
- `JobTracking.getJob({ runId, options })`

### Field Validation:
✅ Uses createValidatedObject() from utils/airtableFieldValidator.js

### Run ID Handling:
✅ Uses runIdSystem.getBaseRunId() for normalization

### Error Handling:
✅ Uses FieldNameError from utils/airtableErrors.js
✅ Structured logging with StructuredLogger

### Dependencies:
- constants/airtableUnifiedConstants.js (JOB_TRACKING_FIELDS)
- utils/airtableFieldValidator.js (createValidatedObject)
- utils/runIdSystem.js (Run ID normalization)
- utils/structuredLogger.js (Logging)
```

---

## Phase 2: Safe Deletions (Week 1, Days 3-4)

### Step 2.1: Delete Obviously Dead Code

**Safe to delete immediately:**

```bash
# Delete archived legacy files
rm -rf _archived_legacy/airtable/jobTrackingRepository.js
rm -rf _archived_legacy/airtable/runRecordRepository.js

# Delete temp/backup files
rm -f temp/airtableService.new.js
rm -f services/airtableService.bak.js  
rm -f services/airtableService.old.js

# Commit the cleanup
git add -A
git commit -m "chore: Remove archived and backup service files

DELETED FILES:
- _archived_legacy/airtable/jobTrackingRepository.js (archived)
- _archived_legacy/airtable/runRecordRepository.js (archived)
- temp/airtableService.new.js (temp file)
- services/airtableService.bak.js (backup)
- services/airtableService.old.js (backup)

REASON: These files are not imported anywhere in active codebase.
Confirmed with grep search for require statements.

No functional impact - dead code removal only."
```

### Step 2.2: Verify No Imports Exist

```bash
# Should return ZERO results
grep -r "jobTrackingRepository" --include="*.js" .
grep -r "airtableService.bak" --include="*.js" .
grep -r "airtableService.old" --include="*.js" .
grep -r "airtableService.new" --include="*.js" .
```

If any results found, investigate before deleting.

---

## Phase 3: Consolidate Job Tracking Services (Week 1-2, Days 5-10)

### Why Job Tracking First?

- ✅ Fewer dependencies than airtableService
- ✅ Clear primary service (jobTracking.js)
- ✅ Well-defined API surface
- ✅ Already uses field normalization pattern

### Step 3.1: Analyze Differences Between Implementations

**Create comparison file:** `analysis/jobTracking-comparison.md`

**Compare:**
1. **Method signatures** - Are they compatible?
2. **Field handling** - Do all use constants?
3. **Run ID normalization** - Consistent approach?
4. **Error handling** - Same patterns?

**Example comparison:**

```markdown
### createJob Method Comparison

**jobTracking.js (KEEP):**
```javascript
static async createJob({ runId, clientId, stream = 'linkedin', status = 'Running', options = {} }) {
  const logger = getLoggerFromOptions(options, clientId, runId, 'job_tracking');
  const baseRunId = runIdSystem.getBaseRunId(runId);
  
  const fields = createValidatedObject({
    [JOB_TRACKING_FIELDS.RUN_ID]: baseRunId,
    [JOB_TRACKING_FIELDS.STATUS]: status,
    [JOB_TRACKING_FIELDS.STREAM]: stream,
    [JOB_TRACKING_FIELDS.START_TIME]: new Date().toISOString()
  }, JOB_TRACKING_FIELDS);
  
  return masterBase(MASTER_TABLES.JOB_TRACKING).create(fields);
}
```

**unifiedJobTrackingRepository.js (DEPRECATE):**
```javascript
async function createJobRecord(runId, clientId, status = 'Running') {
  // ❌ No field validation
  // ❌ No Run ID normalization  
  // ❌ Uses raw field names
  return masterBase('Job Tracking').create({
    'Run ID': runId,  // ❌ Raw string
    'Status': status,  // ❌ Raw string
    'Start Time': new Date().toISOString()  // ❌ Raw string
  });
}
```

**Migration Decision:** Migrate all calls to jobTracking.js pattern.
```

### Step 3.2: Create Migration Script

**File:** `scripts/migrate-job-tracking-calls.js`

```javascript
#!/usr/bin/env node
/**
 * Migration script for Job Tracking service consolidation
 * 
 * Finds all calls to deprecated Job Tracking services and suggests replacements.
 */

const fs = require('fs');
const path = require('path');

// Files that use deprecated services
const deprecatedImports = [
  { pattern: /require\(['"].*unifiedJobTrackingRepository['"]/, file: 'unifiedJobTrackingRepository.js' },
  { pattern: /require\(['"].*simpleJobTracking['"]/, file: 'simpleJobTracking.js' }
];

// Scan codebase
function findDeprecatedUsage(dir, results = []) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      if (!file.startsWith('.') && !file.includes('node_modules')) {
        findDeprecatedUsage(filePath, results);
      }
    } else if (file.endsWith('.js')) {
      const content = fs.readFileSync(filePath, 'utf8');
      
      for (const { pattern, file: deprecatedFile } of deprecatedImports) {
        if (pattern.test(content)) {
          results.push({ file: filePath, deprecated: deprecatedFile, content });
        }
      }
    }
  }
  
  return results;
}

// Main execution
const usages = findDeprecatedUsage(process.cwd());

console.log(`Found ${usages.length} files using deprecated Job Tracking services:\n`);

usages.forEach(({ file, deprecated }) => {
  console.log(`❌ ${file}`);
  console.log(`   Uses: ${deprecated}`);
  console.log(`   Action: Migrate to services/jobTracking.js\n`);
});

if (usages.length === 0) {
  console.log('✅ No deprecated Job Tracking imports found!');
}
```

### Step 3.3: Migrate Each File Individually

**For each file using deprecated service:**

1. **Update import:**
   ```javascript
   // BEFORE
   const jobTracking = require('./services/unifiedJobTrackingRepository');
   
   // AFTER  
   const { JobTracking } = require('./services/jobTracking');
   ```

2. **Update method calls:**
   ```javascript
   // BEFORE
   await jobTracking.createJobRecord(runId, clientId, 'Running');
   
   // AFTER
   await JobTracking.createJob({ 
     runId, 
     clientId, 
     status: 'Running',
     options: { logger, source: 'apify_webhook' }
   });
   ```

3. **Update field references:**
   ```javascript
   // BEFORE (if any raw strings exist)
   const updates = {
     'Status': 'Completed',
     'End Time': endTime
   };
   
   // AFTER
   const { JOB_TRACKING_FIELDS } = require('./constants/airtableUnifiedConstants');
   const updates = {
     [JOB_TRACKING_FIELDS.STATUS]: 'Completed',
     [JOB_TRACKING_FIELDS.END_TIME]: endTime
   };
   ```

4. **Test the migration:**
   ```bash
   # Syntax check
   node -c <file-path>
   
   # Run related tests if they exist
   npm test -- <test-file>
   ```

5. **Commit individually:**
   ```bash
   git add <file-path>
   git commit -m "refactor: Migrate <file> to use canonical JobTracking service

   BEFORE: Used deprecated unifiedJobTrackingRepository
   AFTER: Uses services/jobTracking.js (canonical implementation)
   
   CHANGES:
   - Updated import statement
   - Migrated createJobRecord() to JobTracking.createJob()
   - Migrated updateJobRecord() to JobTracking.updateJob()
   - Added field constants for all Airtable updates
   
   TESTED: Syntax check passed, no functional changes expected
   
   Part of service layer consolidation effort."
   ```

### Step 3.4: Known Files to Migrate (Job Tracking)

**Priority migration order:**

1. **utils/postScoringMetricsHelper.js** (2 imports)
   - High usage, used by scoring workflows
   - Test with: Run scoring job, verify metrics update

2. **routes/apifyWebhookRoutes.js**
   - Production code, Apify workflow
   - Test with: Trigger Apify webhook, verify job tracking

3. **postBatchScorer.js**
   - Post scoring workflow
   - Test with: Run post scoring, verify job creation

4. **routes/diagnosticRoutes.js**
   - Lower risk, diagnostic endpoints
   - Test with: Call diagnostic endpoints

5. **scripts/smart-resume-client-by-client.js**
   - Script, not production critical
   - Test with: Run script manually

6. **scripts/smart-resume-fixed.js**
   - Script, not production critical
   - Test with: Run script manually

7. **Test files last:** (lower priority)
   - test-job-tracking.js
   - test-run-id-consistency.js

### Step 3.5: Delete Deprecated Job Tracking Services

**After ALL migrations complete and tested:**

```bash
# Final verification - should return ZERO
grep -r "unifiedJobTrackingRepository" --include="*.js" .
grep -r "simpleJobTracking" --include="*.js" .

# Delete the deprecated files
rm services/unifiedJobTrackingRepository.js
rm services/simpleJobTracking.js

# Commit
git add -A
git commit -m "refactor: Remove deprecated Job Tracking services

DELETED:
- services/unifiedJobTrackingRepository.js
- services/simpleJobTracking.js

REASON: All callers migrated to canonical services/jobTracking.js

VERIFIED: Zero references remain in codebase (grep confirmed)

Consolidation complete for Job Tracking service layer.
Part of broader service layer consolidation effort."
```

---

## Phase 4: Consolidate Airtable Services (Week 2-3, Days 11-18)

### Why Airtable Services Second?

- ⚠️ More complex than Job Tracking
- ⚠️ More dependencies across codebase
- ⚠️ Need to evaluate adapter pattern carefully
- ✅ But follows same consolidation strategy

### Step 4.1: Decide on Adapter Pattern

**Question:** Keep airtableServiceAdapter.js?

**Evaluate:**
- Does it provide value beyond airtableService.js?
- Is it a useful abstraction layer?
- Does it introduce complexity or reduce it?

**Options:**
1. **Keep adapter** - If it simplifies caller code
2. **Merge into primary** - If it's redundant
3. **Create new thin adapter** - If pattern is useful but implementation is messy

**Document decision in:** `analysis/adapter-pattern-decision.md`

### Step 4.2: Consolidate services/airtable/ Directory

**Problem:** `services/airtable/airtableService.js` is in wrong directory.

**Strategy:**
1. Compare with `services/airtableService.js`
2. Identify unique functionality
3. Merge unique parts into primary service
4. Delete directory structure

**Comparison script:**

```bash
# Compare the two files
diff services/airtableService.js services/airtable/airtableService.js > analysis/airtable-diff.txt

# Analyze differences
cat analysis/airtable-diff.txt
```

### Step 4.3: Migration Pattern (Same as Job Tracking)

**For each file using deprecated airtableService variants:**

1. Run migration finder script
2. Update imports
3. Update method calls
4. Test individually
5. Commit individually

**Known files to migrate:**
- batchScorer.js
- routes/apifyProcessRoutes.js
- test-client-run-records.js
- test-e2e-run-id-handling.js
- test-post-harvest-run-ids.js
- tests/test-client-run-caching.js

### Step 4.4: Delete Deprecated Airtable Services

**After migrations complete:**

```bash
# Verify no imports
grep -r "airtableServiceSimple" --include="*.js" .
grep -r "services/airtable/airtableService" --include="*.js" .

# Delete
rm services/airtableServiceSimple.js
rm -rf services/airtable/

# Commit
git add -A
git commit -m "refactor: Remove deprecated Airtable services and consolidate directory structure"
```

---

## Phase 5: Consolidate Run Record Services (Week 3, Days 19-21)

### Special Consideration: runRecordAdapterSimple.js

**Status:** 1,300 lines - might be valuable adapter

**Evaluate:**
- Is "Simple Creation Point" pattern useful?
- Does it genuinely simplify calling code?
- Is it maintained with field normalization?

**Options:**
1. **Keep as adapter** - If it adds value
2. **Deprecate** - If it's just duplication
3. **Refactor** - Clean it up and make it canonical adapter

**Decision criteria:**
- How many callers use it?
- Does it prevent code duplication in callers?
- Is its abstraction level appropriate?

### Migration Strategy (If Deprecating)

Same pattern as Job Tracking and Airtable services.

### Enhancement Strategy (If Keeping)

1. Ensure it uses runRecordServiceV2 internally
2. Verify field normalization throughout
3. Add comprehensive tests
4. Document as canonical adapter layer

---

## Phase 6: Prevention & Enforcement (Week 3-4, Days 22+)

### Step 6.1: Add ESLint Rules

**Prevent raw field name strings:**

**File:** `.eslintrc.js` (create if doesn't exist)

```javascript
module.exports = {
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'CallExpression[callee.property.name="create"] > ObjectExpression > Property[key.type="Literal"][key.value=/^[A-Z]/]',
        message: 'Use field constants from airtableUnifiedConstants.js instead of raw field name strings'
      },
      {
        selector: 'CallExpression[callee.property.name="update"] > ObjectExpression > Property[key.type="Literal"][key.value=/^[A-Z]/]',
        message: 'Use field constants from airtableUnifiedConstants.js instead of raw field name strings'
      }
    ],
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/services/unifiedJobTrackingRepository*'],
            message: 'Use services/jobTracking.js instead'
          },
          {
            group: ['**/services/simpleJobTracking*'],
            message: 'Use services/jobTracking.js instead'
          },
          {
            group: ['**/services/airtableServiceSimple*'],
            message: 'Use services/airtableService.js instead'
          }
        ]
      }
    ]
  }
};
```

### Step 6.2: Add Integration Tests

**File:** `tests/integration/service-layer-integration.test.js`

```javascript
/**
 * Integration tests for service layer
 * Ensures services work with real Airtable API
 */

const { JobTracking } = require('../../services/jobTracking');
const runIdService = require('../../services/unifiedRunIdService');

describe('Service Layer Integration', () => {
  describe('JobTracking Service', () => {
    it('should create job with proper field names', async () => {
      const runId = runIdService.generateTimestampRunId();
      const clientId = 'Test-Client';
      
      const job = await JobTracking.createJob({
        runId,
        clientId,
        stream: 'linkedin',
        options: { source: 'integration-test' }
      });
      
      expect(job.id).toBeDefined();
      expect(job.fields['Run ID']).toBe(runId);
      expect(job.fields['Status']).toBe('Running');
    });
    
    it('should reject invalid field names', async () => {
      const runId = runIdService.generateTimestampRunId();
      
      await expect(
        JobTracking.updateJob({
          runId,
          updates: { 'Invalid Field': 'value' }  // Should throw FieldNameError
        })
      ).rejects.toThrow('Unknown field name');
    });
  });
});
```

### Step 6.3: Add Startup Schema Validation

**File:** `utils/schemaValidator.js`

```javascript
/**
 * Validates that field constants match actual Airtable schema
 * Runs on server startup to catch schema drift early
 */

const airtable = require('../config/airtableClient');
const { 
  JOB_TRACKING_FIELDS,
  CLIENT_RUN_FIELDS 
} = require('../constants/airtableUnifiedConstants');

async function validateSchema() {
  console.log('🔍 Validating Airtable schema against constants...');
  
  try {
    // Get actual fields from Airtable
    const masterBase = airtable.getMasterBase();
    const jobTrackingRecords = await masterBase('Job Tracking').select({ maxRecords: 1 }).firstPage();
    
    if (jobTrackingRecords.length > 0) {
      const actualFields = Object.keys(jobTrackingRecords[0].fields);
      const constantFields = Object.values(JOB_TRACKING_FIELDS);
      
      // Check for fields in constants that don't exist in Airtable
      const missingFields = constantFields.filter(field => !actualFields.includes(field));
      
      if (missingFields.length > 0) {
        console.warn('⚠️  WARNING: Constants reference fields that don\'t exist in Airtable:');
        missingFields.forEach(field => console.warn(`   - ${field}`));
      } else {
        console.log('✅ Schema validation passed: All constants match Airtable fields');
      }
    }
  } catch (error) {
    console.error('❌ Schema validation failed:', error.message);
    // Don't crash server, but log the issue
  }
}

module.exports = { validateSchema };
```

**Add to index.js startup:**
```javascript
// In index.js
const { validateSchema } = require('./utils/schemaValidator');

async function startServer() {
  // ... other startup code ...
  
  // Validate schema on startup
  await validateSchema();
  
  // ... start listening ...
}
```

### Step 6.4: Documentation Updates

**Update files:**
1. **DEV-RUNBOOK.md** - Add "Which Service to Use" section
2. **ARCHITECTURE-DECISIONS.md** - Document service consolidation decision
3. **SYSTEM-OVERVIEW.md** - Update file structure to show consolidated services

**Create new:**
- **SERVICE-LAYER-GUIDE.md** - Canonical guide for which service to use when

---

## Testing Strategy

### Unit Tests

**For each service after consolidation:**
- Test field normalization
- Test Run ID handling
- Test error cases
- Test multi-tenant isolation

### Integration Tests

**After each phase:**
- Run full smart-resume workflow
- Verify Apify webhook processing
- Check diagnostic endpoints
- Run batch scoring

### Regression Prevention

**Before merging:**
- ✅ All existing tests pass
- ✅ No grep hits for deprecated service imports
- ✅ ESLint rules catch future violations
- ✅ Schema validation passes on startup

---

## Rollback Plan

### If Issues Found During Migration

**Per-file rollback:**
```bash
# Rollback specific file
git checkout HEAD~1 -- <file-path>

# Test
npm test

# Commit rollback
git commit -m "revert: Rollback <file> migration due to <issue>"
```

**Full phase rollback:**
```bash
# Identify last good commit
git log --oneline

# Reset to before phase started
git reset --hard <commit-before-phase>

# Force push if already pushed
git push --force-with-lease origin feature/service-layer-consolidation
```

### Deployment Strategy

**Incremental deployment:**
1. Deploy after each phase completes
2. Monitor production for 24 hours
3. If stable, proceed to next phase
4. If issues, rollback and investigate

**Don't:** Deploy entire consolidation at once

---

## Success Criteria

### Phase Completion

**Job Tracking Consolidation Complete When:**
- ✅ Zero grep hits for deprecated imports
- ✅ All tests passing
- ✅ Production running stable for 24 hours
- ✅ Deprecated files deleted

**Airtable Service Consolidation Complete When:**
- ✅ Same criteria as Job Tracking
- ✅ Directory structure clean (no services/airtable/)
- ✅ Adapter decision documented and implemented

**Run Record Consolidation Complete When:**
- ✅ Same criteria as above
- ✅ Adapter pattern decision implemented
- ✅ All services use consistent patterns

### Overall Project Success

- ✅ 11+ duplicate implementations → 3 canonical services
- ✅ ESLint rules prevent future duplication
- ✅ Integration tests verify schema compatibility
- ✅ Startup validation catches schema drift
- ✅ Documentation updated with service usage guide
- ✅ New developers onboard faster (single service per type)
- ✅ Bug fixes only require 1 file change (not 3-4)

---

## Commit Message Template

```
refactor: Migrate <file> to use canonical <Service> service

BEFORE: Used deprecated <old-service>
AFTER: Uses services/<canonical-service>.js

CHANGES:
- Updated import statement
- Migrated <old-method>() to <Service>.<new-method>()
- Added field constants for Airtable operations
- Updated error handling to use FieldNameError

TESTING:
- Syntax check: PASSED
- Unit tests: <PASSED/N/A>
- Integration test: <manual-test-description>

PHASE: <phase-number> - <Service> Service Consolidation
Part of broader service layer consolidation initiative.

Related: <issue-number or previous-commit-hash>
```

---

## Timeline & Milestones

### Week 1
- **Day 1-2:** Analysis & Planning (Phase 1)
- **Day 3-4:** Safe Deletions (Phase 2)
- **Day 5-7:** Start Job Tracking Consolidation (Phase 3)

### Week 2  
- **Day 8-10:** Finish Job Tracking, Test & Deploy
- **Day 11-14:** Start Airtable Service Consolidation (Phase 4)

### Week 3
- **Day 15-18:** Finish Airtable Services, Test & Deploy
- **Day 19-21:** Run Record Consolidation (Phase 5)

### Week 4
- **Day 22-24:** Prevention & Enforcement (Phase 6)
- **Day 25:** Buffer for issues/rollbacks
- **Day 26-28:** Final testing, documentation, merge to main

---

## Resources & References

### Documentation
- **TECHNICAL-DEBT-CLEANUP-PLAN.md** - Strategic overview
- **APIFY-FIELD-STANDARDIZATION-PLAN.md** - Field constants pattern (complete first!)
- **CLIENT-RUN-RESULTS-FIXES-COMPLETE.md** - Field normalization examples
- **BUSINESS-LOGIC-ERRORS-FOUND.md** - Bug catalog showing multiplication pattern

### Code Examples
- **services/jobTracking.js** - Reference implementation (class-based, field constants)
- **utils/airtableFieldValidator.js** - Field normalization utility
- **utils/runIdSystem.js** - Run ID handling patterns

### Tools
- `scripts/migrate-job-tracking-calls.js` - Migration finder (create in Phase 3)
- `analysis/` directory - Store comparison files and migration plans

---

## Questions & Troubleshooting

### "Which service should I use?"

**Job Tracking:** `services/jobTracking.js` (always)
**Airtable Operations:** `services/airtableService.js` (usually)
**Run Records:** `services/runRecordServiceV2.js` (or adapter if decided to keep)

### "How do I know if migration worked?"

1. ✅ Syntax check passes: `node -c <file>`
2. ✅ No deprecated imports: `grep -r "<deprecated>" .`
3. ✅ Tests pass: `npm test`
4. ✅ Integration test works: Run relevant workflow manually

### "What if I find a bug in the canonical service?"

1. **Fix it in the canonical service** (not in deprecated service)
2. Create separate commit for the fix
3. Continue migration after fix is deployed
4. Document the fix in commit message

### "Should I fix other issues I find?"

**No - stay focused on consolidation only.**
- Log other issues in BUSINESS-LOGIC-ERRORS-FOUND.md
- Create separate branch for unrelated fixes
- Don't mix consolidation with feature work

---

## Final Notes

This is a **multi-week effort** requiring:
- ✅ Careful planning and analysis
- ✅ Incremental migration with testing
- ✅ Individual commits per file
- ✅ Phased deployment approach
- ✅ Comprehensive prevention measures

**Don't rush.** Each phase builds on the previous.

**Expected outcome:** Maintainable service layer that prevents bug multiplication and accelerates development velocity.

**Success indicator:** Future field name changes require editing 1 file, not 11.

---

**Created by:** AI Assistant analyzing 22 commits of field standardization work
**Based on:** Actual bug patterns found in production (Oct 2-6, 2025)
**Validated against:** Real service usage patterns in codebase
