# Constants Migration Guide

## Overview
We've consolidated all Airtable constants into a single source of truth: `constants/airtableUnifiedConstants.js`

## Migration Steps

### 1. Update Imports

**Old:**
```javascript
const { CLIENT_RUN_FIELDS } = require('../constants/airtableConstants');
const { TABLES } = require('../constants/airtableSimpleConstants');
```

**New:**
```javascript
const { 
    MASTER_TABLES,
    CLIENT_TABLES,
    LEAD_FIELDS,
    CLIENT_RUN_RESULTS_FIELDS,
    JOB_TRACKING_FIELDS
} = require('../constants/airtableUnifiedConstants');
```

### 2. Update Field References

**Old:**
```javascript
updates['Status'] = 'Completed';
record['Run ID'] = runId;
```

**New:**
```javascript
updates[CLIENT_RUN_RESULTS_FIELDS.STATUS] = STATUS_VALUES.COMPLETED;
record[CLIENT_RUN_RESULTS_FIELDS.RUN_ID] = runId;
```

### 3. Use Validation

**Before sending to Airtable:**
```javascript
const { validateFieldNames, createValidatedObject } = require('../utils/airtableFieldValidator');

// Validate before sending
const validation = validateFieldNames(data);
if (!validation.valid) {
    console.error('Invalid fields:', validation.errors);
}

// Or auto-fix field names
const validData = createValidatedObject(data);
```

## Files Requiring Updates

Based on our scan, these files still need migration:

### High Priority (Core Services)
- [ ] services/airtableService.js
- [ ] services/airtableServiceSimple.js
- [ ] services/clientService.js
- [ ] services/leadService.js
- [ ] services/jobOrchestrationService.js

### Medium Priority (Routes)
- [ ] routes/apiAndJobRoutes.js
- [ ] routes/apifyWebhookRoutes.js
- [ ] routes/apifyProcessRoutes.js
- [ ] routes/webhookHandlers.js

### Low Priority (Scripts & Utils)
- [ ] scripts/smart-resume-client-by-client.js
- [ ] utils/metricsHelper.js
- [ ] utils/postScoringMetricsHelper.js

## Field Mapping Reference

| Old Field Name | New Constant |
|---------------|--------------|
| 'Status' | CLIENT_RUN_RESULTS_FIELDS.STATUS |
| 'Run ID' | CLIENT_RUN_RESULTS_FIELDS.RUN_ID |
| 'Client ID' | CLIENT_RUN_RESULTS_FIELDS.CLIENT_ID |
| 'Total Posts Harvested' | CLIENT_RUN_RESULTS_FIELDS.TOTAL_POSTS_HARVESTED |
| 'Profiles Submitted' | CLIENT_RUN_RESULTS_FIELDS.PROFILES_SUBMITTED |
| 'System Notes' | CLIENT_RUN_RESULTS_FIELDS.SYSTEM_NOTES |
| 'Score' | LEAD_FIELDS.AI_SCORE |
| 'Name' | LEAD_FIELDS.LEAD_NAME |

## Testing After Migration

1. Test a single lead scoring operation
2. Test batch scoring
3. Test post harvesting
4. Verify Airtable updates are working
5. Check error logs for field name issues

## Rollback Plan

If issues occur, revert to the previous commit:
```bash
git revert HEAD
git push
```

## Implementation Strategy

- Each service can be migrated independently
- The backward compatibility mappings ensure nothing breaks immediately
- The validation functions will catch any issues during migration

This allows for incremental updates without requiring a "big bang" change where all services must be updated simultaneously.