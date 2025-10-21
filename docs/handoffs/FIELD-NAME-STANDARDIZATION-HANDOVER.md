# Field Name Standardization Handover Document

## Current Project Status
We are working on a comprehensive refactoring of the run ID system to create a single source of truth for run ID operations. As part of this work, we discovered a broader issue with inconsistent field name references that's causing "Unknown field name" errors in Airtable operations.

## Primary Focus: String Literals to Constants Conversion

### Issue Description
Throughout the codebase, Airtable field names are referenced using two different approaches:
1. **String Literals**: Direct strings like `'Status'` or `'Run ID'`
2. **Constants**: Using imports like `CLIENT_RUN_FIELDS.STATUS`

This inconsistency is causing Airtable operations to fail with "Unknown field name" errors when the string literals don't exactly match the field names defined in Airtable.

### Error Examples
Errors seen in logs:
- "Unknown field name: 'status'" (incorrect case)
- "Unknown field name: 'Apify Run ID'" (field might be defined differently in constants)

### Progress So Far
- ✅ Identified the root cause (mixing string literals and constants)
- ✅ Fixed `apifyRunsService.js` to use constants for field references 
- ✅ Updated `jobTrackingErrorHandling.js` to import and use proper field name constants
- ✅ Committed and pushed these initial fixes

### Files Prioritized for Update
1. **High Priority** (Core services with direct Airtable interaction):
   - `runRecordServiceV2.js` - Contains multiple string literal instances
   - `unifiedJobTrackingRepository.js` - Multiple instances of 'Status' and field access
   - `runRecordAdapterSimple.js` - Contains string literals for fields
   - `jobMetricsService.js` - Multiple instances of string literals

2. **Medium Priority** (Supporting services):
   - `airtableService.js` - May contain additional string literals
   - Any services importing `airtableService.js`

3. **Lower Priority** (Test files and utilities):
   - Test files using string literals
   - Example files
   - Utility functions

### Implementation Approach
1. **Import Constants**: Ensure all files interacting with Airtable import constants:
   ```javascript
   const { CLIENT_RUN_FIELDS, CLIENT_RUN_STATUS_VALUES } = require('../constants/airtableUnifiedConstants');
   ```

2. **Replace String Keys**: Change from string literals to constants:
   ```javascript
   // Before
   record['Status'] = 'Running';
   
   // After
   record[CLIENT_RUN_FIELDS.STATUS] = CLIENT_RUN_STATUS_VALUES.RUNNING;
   ```

3. **Replace String in get() Calls**: For Airtable record access:
   ```javascript
   // Before
   const status = record.get('Status');
   
   // After
   const status = record.get(CLIENT_RUN_FIELDS.STATUS);
   ```

4. **Test After Each File**: Ensure changes don't break functionality.

### Find String Literals
To find string literals in the code, use grep searches like:
```
grep -r "'Status'" --include="*.js" .
grep -r "'Run ID'" --include="*.js" .
grep -r "'Client ID'" --include="*.js" .
```

Or use the grep_search tool with patterns like:
```
'Status'
'Run ID'
'Client ID'
```

### Potential Challenges
1. **Field Names Missing from Constants**: Some string literals may reference fields not yet defined in the constants. These should be added to `airtableUnifiedConstants.js`.

2. **Dynamic Field Access**: Some code may use dynamic field access patterns that are harder to standardize.

3. **Legacy Code**: Older parts might have complex references that need careful updating.

4. **Last Updated Field**: This field is used in code but may not be defined in constants. Check if it should be added.

### Next Steps After Completion
After all string literals are converted to constants:
1. Run comprehensive tests to ensure all Airtable operations work
2. Document the standardized approach for future developers
3. Return to the remaining run ID system refactoring tasks

## Other Issues (to address after string literal conversion)
1. Resolve any remaining runIdUtils references
2. Complete the migration to runIdSystem.js
3. Update documentation to reflect the new architecture
4. Review error handling consistency across the system

## Testing Verification
Once all files are updated, verify:
1. No "Unknown field name" errors appear in logs
2. Client run records are created and updated properly
3. Job tracking records maintain proper field references
4. Post harvesting and scoring functions operate normally

## Key Constants Files
- `constants/airtableUnifiedConstants.js` - Main source of truth for field names
- `constants/airtableFields.js` - Older constants file, some code may still reference it

## Git Information
- Current branch: feature/comprehensive-field-standardization
- Last commit message: "Fix: Replace string literals with field name constants to resolve unknown field name errors"