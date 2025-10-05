# Technical Debt Cleanup Plan

**Created:** October 6, 2025  
**Purpose:** Systematic plan to reduce technical debt and improve maintainability  
**Status:** Planning document - prioritize after field standardization is complete

---

## Executive Summary

**Current State:** Rapid feature development has led to multiple competing implementations, dead code accumulation, and schema drift between code and database.

**Impact:** Bug fixes require changes in 3-4 different files. Hard to onboard new developers. Increased risk of regressions.

**Recommendation:** Phased cleanup approach starting with low-risk wins, then strategic consolidation.

---

## Technical Debt Inventory

### 🔴 HIGH PRIORITY - Causing Active Issues

#### 1. Multiple Competing Service Layers

**Problem:** Same functionality implemented 3-5 different ways across the codebase.

**Job Tracking Services (4 implementations):**
- ✅ `services/jobTracking.js` - **KEEP** (newest, cleanest API, uses class-based design)
- ❌ `services/unifiedJobTrackingRepository.js` - DEPRECATE (older pattern)
- ❌ `services/simpleJobTracking.js` - DEPRECATE (legacy)
- ❌ `_archived_legacy/airtable/jobTrackingRepository.js` - DELETE (archived)

**Airtable Services (7+ implementations):**
- ✅ `services/airtableService.js` - **KEEP** (main service, most used)
- ❌ `services/airtableServiceSimple.js` - DEPRECATE (redundant)
- ❌ `services/airtableServiceAdapter.js` - EVALUATE (adapter pattern, may be useful)
- ❌ `services/airtable/airtableService.js` - CONSOLIDATE (different directory!)
- ❌ `temp/airtableService.new.js` - DELETE (temp file)
- ❌ `services/airtableService.bak.js` - DELETE (backup)
- ❌ `services/airtableService.old.js` - DELETE (backup)

**Run Record Services (3+ implementations):**
- ✅ `services/runRecordServiceV2.js` - **KEEP** (v2 suggests current)
- ❌ `services/runRecordAdapterSimple.js` - EVALUATE (may be adapter)
- ❌ `_archived_legacy/airtable/runRecordRepository.js` - DELETE (archived)

**Impact:**
- When fixing bugs, must update 3-4 files
- Easy to miss one and create inconsistency
- New developers confused about which to use
- Different code paths may use different services

**Estimated Effort:** 2-3 weeks (careful migration with testing)

#### 2. Field Name Inconsistency (IN PROGRESS - Current Branch)

**Problem:** Field names handled inconsistently across codebase.

**Examples Found:**
- Constants: `JOB_TRACKING_FIELDS.STATUS` ✅
- Raw strings: `'Status'` ⚠️
- Lowercase: `status` ❌
- CamelCase: `endTime` ❌

**Multiple Constant Files:**
- ✅ `constants/airtableUnifiedConstants.js` - **KEEP** (unified, most complete)
- ❌ `constants/airtableFields.js` - CONSOLIDATE into unified
- ❌ `constants/airtableFields.unified.js` - CONSOLIDATE into unified
- ❌ `constants/airtableConstants.js` - CONSOLIDATE into unified
- ❌ `src/domain/models/constants.js` - CONSOLIDATE or DELETE

**Current Fixes (feature/comprehensive-field-standardization branch):**
- ✅ Added field validator with auto-normalization
- ✅ Fixed PROFILES_SCORED constant typo
- ✅ Removed deleted fields from Job Tracking operations
- ✅ Normalized field names in JobTracking.updateJob
- ⏳ Need to migrate all callers to use constants

**Remaining Work:**
1. Audit all Airtable update/create operations
2. Replace raw strings with constants
3. Add linting rule to enforce constant usage
4. Consolidate constant files into single source of truth

**Estimated Effort:** 1 week (mostly done on current branch)

#### 3. Schema Drift Between Code and Database

**Problem:** Database schema changed October 2, 2025 but code not fully updated.

**Fields Removed from Job Tracking Table:**
- Clients Processed
- Clients With Errors
- Total Profiles Examined
- Successful Profiles
- Total Posts Harvested
- Posts Examined for Scoring
- Posts Successfully Scored
- Profile Scoring Tokens
- Post Scoring Tokens

**What Went Wrong:**
- Fields removed from Airtable
- Comments added saying "removed 2025-10-02"
- But code still tried to write to these fields
- No automated schema validation
- No integration tests caught the issue

**Solution:**
1. ✅ Remove all references to deleted fields (in progress)
2. Create schema validation on startup
3. Add integration tests for Airtable operations
4. Document current schema as single source of truth
5. Add schema migration process for future changes

**Estimated Effort:** 1 week (partially done)

---

### 🟡 MEDIUM PRIORITY - Technical Debt

#### 4. Run ID System Complexity

**Problem:** Multiple competing systems for Run ID validation/generation.

**Files Involved:**
- `utils/runIdSystem.js` - Main system
- `utils/runIdValidator.js` - Separate validator
- `services/jobTracking.js` - Has own validation
- Multiple services do their own normalization

**Issues:**
- No single source of truth
- Validation logic duplicated
- Normalization inconsistent
- Recent bugs suggest fragility

**Solution:**
1. Consolidate into single `runIdSystem.js`
2. Remove duplicate validation logic
3. Add comprehensive unit tests
4. Document Run ID format and rules
5. Consider using TypeScript for type safety

**Estimated Effort:** 1 week

#### 5. Error Handling Inconsistency

**Problem:** Error handling patterns vary across codebase.

**Patterns Found:**
- Try/catch with console.error
- Try/catch with logger.error
- Try/catch with throw
- Try/catch with return error object
- No try/catch (let it bubble)

**Specialized Error Classes:**
- `utils/airtableErrors.js` - Has FieldNameError class
- Some services use it, many don't
- Inconsistent error messages
- Hard to track error types

**Solution:**
1. Define error handling standards
2. Create error classes for common cases
3. Implement consistent logging pattern
4. Add error tracking (see PRODUCTION-ERROR-LOGGING-PLAN.md)
5. Refactor high-value code paths first

**Estimated Effort:** 2 weeks

#### 6. Logging System Fragmentation

**Problem:** Multiple logger implementations and patterns.

**Loggers Found:**
- `utils/structuredLogger.js` - Structured logging system
- `utils/loggerHelper.js` - Helper wrapper
- `console.log` - Direct usage throughout
- `console.error` - Direct usage throughout
- Custom loggers in various services

**Issues:**
- Hard to filter/search logs
- Inconsistent log formats
- Can't easily change log destination
- No log levels in many places

**Solution:**
1. Standardize on `structuredLogger.js`
2. Create convenience wrappers for common use cases
3. Replace console.log/error with logger calls
4. Add log level filtering
5. Consider structured logging service (Datadog, Loggly)

**Estimated Effort:** 1 week

---

### 🟢 LOW PRIORITY - Cleanup & Organization

#### 7. Root Directory Clutter

**Problem:** 50+ test/debug scripts in root directory making it hard to find production code.

**Test/Debug Scripts in Root (Partial List):**
```
af-test.js
analyze-json-length.js
analyze-lead-data.js
analyze-position-2486.js
analyze-smart-resume-logs.js
breakdown.js
canary.out.json
canary.out.txt
check-all-render-services.js
check-all-services-logs.js
check-current-job.js
check-deployment.js
check-guy-wilson-posts.js
check-job-logs.js
check-job-progress.sh
check-logs-aest.js
check-multiple-failing-leads.js
check-production-data.js
check-recent-scoring.js
check-render-env.js
check-render-logs.js
check-render-timestamp.js
check-service-status.js
check-smart-resume-debug-logs.js
check-smart-resume-logs.js
check-syntax.ps1
check-timing-data.js
check-today-logs.js
find-big-batch.js
search-rec-ids.js
search-for-91.js
simple-log-test.js
test-*.js (20+ files)
```

**Solution:**
1. Create `scripts/debug/` directory
2. Create `scripts/analysis/` directory
3. Move test files to `tests/` directory
4. Move one-time scripts to `scripts/archive/`
5. Delete obsolete scripts
6. Update README with script organization

**Estimated Effort:** 2 hours (low risk, high visibility improvement)

#### 8. Backup Files and Temp Files

**Problem:** Old backup files committed to git.

**Files to Remove:**
```
temp/airtableService.new.js
services/airtableService.bak.js
services/airtableService.old.js
api_start.log
api.log
canary.out.json
canary.out.txt
analysis.txt
```

**Solution:**
1. Verify files are truly obsolete
2. Delete from repository
3. Add to .gitignore patterns
4. Document backup strategy (use git branches instead)

**Estimated Effort:** 1 hour

#### 9. Documentation Overload

**Problem:** Too many docs, unclear which are current.

**Commit Message Documents (15+ files):**
```
COMMIT-MESSAGE-ADDITIONAL-FIXES.md
COMMIT-MESSAGE-APIFY-PROCESS-FIX.md
COMMIT-MESSAGE-AUTH-ERROR-FIX.md
COMMIT-MESSAGE-CLIENT-RUN-DUPLICATION-FIX.md
COMMIT-MESSAGE-DISABLE-RATE-LIMIT.md
COMMIT-MESSAGE-FIELD-NAME-DEBUG.md
COMMIT-MESSAGE-FIELD-NAME-METHOD-FIX.md
COMMIT-MESSAGE-JOB-BYPASS-TEMP.md
COMMIT-MESSAGE-JOB-ID-DUPLICATION-FIX.md
COMMIT-MESSAGE-JOB-TRACKING-RECORD-FIX.md
COMMIT-MESSAGE-METRICS-COMPLETION-FIX.md
COMMIT-MESSAGE-POST-SCORING-DEBUG.md
COMMIT-MESSAGE-POST-SCORING-FIX.md
COMMIT-MESSAGE-RECOVERY-PATH-FIX.md
COMMIT-MESSAGE-RENDERING-ERRORS-FIX.md
COMMIT-MESSAGE-RUN-ID-NORMALIZATION-FIX.md
COMMIT-MESSAGE-RUN-ID-STANDARDIZATION.md
COMMIT-MESSAGE-RUN-ID-STRICT-IMPLEMENTATION.md
COMMIT-MESSAGE-RUN-RECORD-DUPLICATION-FIX.txt
commit-message-constants.txt
```

**Architecture Documents (Many):**
```
ARCHITECTURE-DECISIONS.md
BACKEND-DEEP-DIVE.md
SYSTEM-OVERVIEW.md
CLIENT_RUN_RECORD_DESIGN.md
APIFY-INTEGRATION-GUIDE.md
APIFY-MULTITENANT-GUIDE.md
DEV-RUNBOOK.md
DOCS-INDEX.md
[... many more ...]
```

**Solution:**
1. Create `docs/archive/` directory
2. Move commit message docs to `docs/commit-history/` or delete
3. Create `DOCS-CURRENT.md` listing authoritative docs
4. Consolidate overlapping architecture docs
5. Add "Status" and "Last Updated" to each doc
6. Create docs/README.md as entry point

**Estimated Effort:** 4 hours

#### 10. Archived/Legacy Code Still in Repo

**Problem:** Old code in `_archived_legacy/` directory.

**Directory Contents:**
```
_archived_legacy/
├── airtable/
│   ├── jobTrackingRepository.js
│   └── runRecordRepository.js
└── [other old implementations]
```

**Solution:**
1. Verify nothing references archived code
2. Create git tag for historical reference
3. Delete _archived_legacy directory
4. Document in CHANGELOG.md what was removed and when
5. Note git tag for recovery if needed

**Estimated Effort:** 2 hours

---

## Phased Cleanup Approach

### Phase 1: Quick Wins (Week 1) ✅ LOW RISK

**Goal:** Immediate improvement in code organization with minimal risk.

**Tasks:**
1. ✅ Move test scripts to `tests/` and `scripts/` directories
2. ✅ Delete backup files (.bak, .old, temp/)
3. ✅ Move commit message docs to `docs/commit-history/`
4. ✅ Create `DOCS-CURRENT.md` listing authoritative docs
5. ✅ Delete `_archived_legacy/` directory
6. ✅ Update .gitignore to prevent future clutter

**Deliverables:**
- Clean root directory
- Clear documentation hierarchy
- Updated .gitignore

**Success Metrics:**
- Root directory has <20 files
- All docs have status/date headers
- Zero backup files in repo

**Estimated Effort:** 1 day  
**Risk Level:** LOW (no code changes, just organization)

---

### Phase 2: Field Standardization (Week 2) ⏳ IN PROGRESS

**Goal:** Complete field name standardization work started on current branch.

**Tasks:**
1. ✅ Merge feature/comprehensive-field-standardization branch
2. ⏳ Consolidate constant files into airtableUnifiedConstants.js
3. ⏳ Audit all Airtable operations for raw string usage
4. ⏳ Replace raw strings with constant references
5. ⏳ Add ESLint rule to prevent raw field name strings
6. ⏳ Add integration tests for field operations

**Deliverables:**
- Single source of truth for field names
- All code uses constants
- Automated enforcement via linting
- Test coverage for field operations

**Success Metrics:**
- Zero raw string field names in production code
- All Airtable operations use constants
- Integration tests pass
- Zero field-related errors in production

**Estimated Effort:** 1 week  
**Risk Level:** MEDIUM (touches many files, needs testing)

---

### Phase 3: Service Consolidation (Weeks 3-5) ⚠️ MEDIUM RISK

**Goal:** Reduce from 3-5 implementations of each service to 1 canonical implementation.

#### Step 3.1: Job Tracking Consolidation

**Tasks:**
1. Audit all callers of job tracking services
2. Create migration plan for each caller
3. Add deprecation warnings to old services
4. Migrate callers one by one to `jobTracking.js`
5. Add comprehensive tests
6. Remove deprecated services

**Migration Priority:**
- High-traffic endpoints first (smart-resume workflow)
- Low-traffic endpoints second
- Admin/debug endpoints last

**Deliverables:**
- All callers use `services/jobTracking.js`
- Old services removed
- Test coverage >80%

**Estimated Effort:** 1 week  
**Risk Level:** MEDIUM

#### Step 3.2: Airtable Service Consolidation

**Tasks:**
1. Audit all callers of Airtable services
2. Identify which service is most complete
3. Merge functionality from other services if needed
4. Create adapter layer for gradual migration
5. Migrate callers incrementally
6. Remove redundant services

**Deliverables:**
- Single Airtable service (`services/airtableService.js`)
- All callers migrated
- Test coverage >80%

**Estimated Effort:** 2 weeks  
**Risk Level:** HIGH (core functionality, many callers)

---

### Phase 4: Schema Validation & Testing (Week 6) 🛡️ RISK MITIGATION

**Goal:** Prevent future schema drift issues.

**Tasks:**
1. Document current Airtable schema for each table
2. Create schema validation on application startup
3. Add integration tests for all Airtable operations
4. Create schema migration process
5. Add CI/CD checks for schema consistency

**Deliverables:**
- `docs/AIRTABLE-SCHEMA.md` - Single source of truth
- Startup validation catches schema mismatches
- Integration test suite
- Schema change process documented

**Success Metrics:**
- Application fails fast on schema mismatch
- All Airtable operations have tests
- Zero schema-related production issues

**Estimated Effort:** 1 week  
**Risk Level:** LOW (adds safety, doesn't change behavior)

---

### Phase 5: Error Handling & Logging (Weeks 7-8) 📊 OBSERVABILITY

**Goal:** Consistent error handling and production-ready logging.

**Tasks:**
1. Standardize on structured logger
2. Create error classification system
3. Implement production error logging to Airtable
4. Replace console.log with structured logging
5. Add error monitoring and alerting

**Deliverables:**
- All code uses structured logger
- Critical errors logged to Airtable
- Error classification helper
- Alert thresholds configured

**Success Metrics:**
- Can debug production issues without Render logs
- Error patterns tracked over time
- Alert on critical error spikes

**Estimated Effort:** 2 weeks  
**Risk Level:** MEDIUM

---

### Phase 6: Run ID System Cleanup (Week 9) 🔧 RELIABILITY

**Goal:** Single, robust Run ID system.

**Tasks:**
1. Consolidate into single runIdSystem.js
2. Remove duplicate validation logic
3. Add comprehensive unit tests
4. Document Run ID format and rules
5. Consider TypeScript for type safety

**Deliverables:**
- Single Run ID system
- 100% test coverage
- Clear documentation
- No duplicate validation

**Success Metrics:**
- Zero Run ID related errors
- All validation in one place
- Easy to understand and maintain

**Estimated Effort:** 1 week  
**Risk Level:** MEDIUM

---

## Risk Mitigation Strategies

### For All Phases:

**1. Feature Flags**
- Use environment variables to toggle new vs old code paths
- Gradual rollout to production
- Easy rollback if issues found

**2. Parallel Running**
- Keep old code alongside new during migration
- Log discrepancies between old and new
- Verify identical behavior before cutover

**3. Incremental Migration**
- Migrate one caller at a time
- Test each migration thoroughly
- Don't remove old code until all callers migrated

**4. Comprehensive Testing**
- Add integration tests before refactoring
- Maintain test coverage throughout
- Use tests as safety net

**5. Canary Deployments**
- Deploy to subset of users/clients first
- Monitor error rates closely
- Full rollout only after validation

---

## Success Metrics

### Code Quality Metrics:
- **Lines of Code:** Reduce by 20-30% (remove duplication)
- **Cyclomatic Complexity:** Reduce average complexity
- **Test Coverage:** Increase to >80% for critical paths
- **Time to Fix Bugs:** Reduce by 50% (fewer places to change)

### Developer Experience Metrics:
- **Onboarding Time:** New developer productive in 2 days instead of 2 weeks
- **Time to Find Code:** <5 minutes to locate any functionality
- **Code Review Time:** Reduce by 40% (clearer, less duplication)

### Production Metrics:
- **Field-Related Errors:** Zero after Phase 2
- **Schema Drift Incidents:** Zero after Phase 4
- **Mean Time to Resolution:** Reduce by 60%
- **Production Incidents:** Reduce by 50%

---

## Priority Decision Matrix

| Issue | Impact | Effort | Risk | Priority |
|-------|--------|--------|------|----------|
| Root directory clutter | LOW | 1 day | LOW | 🟢 Phase 1 |
| Backup files | LOW | 1 hour | LOW | 🟢 Phase 1 |
| Field standardization | HIGH | 1 week | MED | 🟡 Phase 2 (IN PROGRESS) |
| Schema drift | HIGH | 1 week | LOW | 🟡 Phase 4 |
| Job tracking services | HIGH | 1 week | MED | 🟡 Phase 3.1 |
| Airtable services | HIGH | 2 weeks | HIGH | 🔴 Phase 3.2 |
| Run ID system | MED | 1 week | MED | 🟡 Phase 6 |
| Error handling | MED | 2 weeks | MED | 🟡 Phase 5 |
| Logging | MED | 1 week | MED | 🟡 Phase 5 |
| Documentation | LOW | 4 hours | LOW | 🟢 Phase 1 |

---

## Estimated Total Timeline

**Conservative Estimate:** 9-12 weeks (2-3 months)  
**Aggressive Estimate:** 6-8 weeks (if full-time focus)  
**Realistic Estimate:** 3-4 months (with ongoing feature work)

**Recommendation:** Do 1 phase per week alongside normal development work.

---

## Dependencies & Prerequisites

**Before Starting:**
1. ✅ Complete current field standardization branch
2. ✅ Get current production stable
3. ⏳ Set up staging environment for testing
4. ⏳ Create backup/rollback plan
5. ⏳ Get team buy-in on priorities

**Required Resources:**
- Developer time: 2-4 hours/day for 3 months
- Testing environment matching production
- Ability to deploy frequently (CI/CD)
- Monitoring/alerting tools

---

## Maintenance Plan

**After Cleanup:**

**Weekly:**
- Review new code for technical debt
- Ensure constants used for field names
- Check for backup files in commits

**Monthly:**
- Review service usage patterns
- Check for code duplication
- Update documentation

**Quarterly:**
- Technical debt review meeting
- Evaluate new patterns/tools
- Plan next cleanup phase

---

## Recommendations

### Immediate (This Week):
1. ✅ Complete field standardization (current branch)
2. Execute Phase 1 quick wins (1 day)
3. Stabilize production

### Short Term (Next Month):
1. Complete Phase 2 (field standardization)
2. Start Phase 3.1 (job tracking consolidation)
3. Implement Phase 4 (schema validation)

### Medium Term (Next Quarter):
1. Complete Phase 3.2 (Airtable service consolidation)
2. Implement Phase 5 (error handling & logging)
3. Complete Phase 6 (Run ID cleanup)

### Long Term (Ongoing):
1. Maintain code quality standards
2. Prevent new technical debt
3. Regular refactoring sprints
4. Consider TypeScript migration

---

## Questions for Decision

**Strategic Decisions:**
1. Should we pause feature development for cleanup sprint?
2. What's acceptable risk tolerance for production changes?
3. Priority: Speed vs. Quality vs. Features?
4. Budget for dedicated refactoring time?

**Technical Decisions:**
1. TypeScript migration worth the effort?
2. Move to clean architecture pattern (src/domain/)?
3. Adopt new testing framework?
4. Implement feature flags system?

**Process Decisions:**
1. Code review requirements for refactoring?
2. Testing requirements before merge?
3. Deployment frequency during cleanup?
4. Rollback criteria?

---

## Appendix: Detailed File Inventory

### Service Layer Files

**Job Tracking (4 implementations):**
```
✅ services/jobTracking.js (KEEP - newest)
❌ services/unifiedJobTrackingRepository.js (DEPRECATE)
❌ services/simpleJobTracking.js (DEPRECATE)
❌ _archived_legacy/airtable/jobTrackingRepository.js (DELETE)
```

**Airtable Services (7+ implementations):**
```
✅ services/airtableService.js (KEEP - main)
❌ services/airtableServiceSimple.js (DEPRECATE)
❓ services/airtableServiceAdapter.js (EVALUATE)
❌ services/airtable/airtableService.js (CONSOLIDATE)
❌ temp/airtableService.new.js (DELETE)
❌ services/airtableService.bak.js (DELETE)
❌ services/airtableService.old.js (DELETE)
```

**Run Record Services (3+ implementations):**
```
✅ services/runRecordServiceV2.js (KEEP - v2)
❓ services/runRecordAdapterSimple.js (EVALUATE)
❌ _archived_legacy/airtable/runRecordRepository.js (DELETE)
```

**Constants (5 files):**
```
✅ constants/airtableUnifiedConstants.js (KEEP - primary)
❌ constants/airtableFields.js (CONSOLIDATE)
❌ constants/airtableFields.unified.js (CONSOLIDATE)
❌ constants/airtableConstants.js (CONSOLIDATE)
❌ src/domain/models/constants.js (EVALUATE)
```

---

**File Location:** `TECHNICAL-DEBT-CLEANUP-PLAN.md`  
**Status:** Planning document - execute after field standardization complete  
**Next Review:** After Phase 2 completion  
**Owner:** Development team
