# Airtable Field Name Inconsistencies - Fixes Handover Document

## Overview

This document summarizes the fixes implemented for resolving field name inconsistencies between the codebase and the Airtable schema. These inconsistencies were causing runtime errors when the application attempted to create or update records with field names that didn't exist in the Airtable tables.

## Issues Addressed

We identified and fixed the following field name inconsistencies:

1. **'Client' vs 'Client ID'**
   - **Issue**: Code was using `{Client}` in filter formulas, but the actual field name in Airtable is `Client ID`.
   - **Error**: `The formula for filtering records is invalid: Unknown field names: client`
   - **Files Fixed**: 
     - `routes/apifyWebhookRoutes.js`
     - `services/airtableServiceSimple.js`
     - `services/runRecordServiceV2.js`
     - `services/airtable/clientRepository.js`

2. **'Notes' vs 'System Notes'**
   - **Issue**: Code was using `Notes` field, but the actual field name in Airtable Job Tracking table is `System Notes`.
   - **Error**: Field name inconsistencies in update operations
   - **Files Fixed**:
     - `services/airtable/clientRepository.js`
     - `services/airtable/runRecordRepository.js`
     - `services/airtable/jobTrackingRepository.js`
     - `index.js` (constant definition)
     - `test-airtable-service-boundaries.js`

3. **'Recovery Note' vs 'System Notes'**
   - **Issue**: Code was using `Recovery Note` field, but no such field exists in Airtable.
   - **Error**: `Unknown field name: "Recovery Note"`
   - **Files Fixed**:
     - `services/airtable/runRecordRepository.js`

4. **'Jobs Started' vs System Notes**
   - **Issue**: Code was trying to update a non-existent `Jobs Started` field.
   - **Error**: `Unknown field name: "Jobs Started"`
   - **Files Fixed**:
     - `scripts/smart-resume-client-by-client.js`

5. **'Source' vs 'System Notes'**
   - **Issue**: Code was using `Source` field, but no such field exists in Airtable.
   - **Error**: `Unknown field name: "Source"`
   - **Files Fixed**:
     - `scripts/smart-resume-client-by-client.js`

## Implementation Details

### Approach

1. **Code Analysis**: Identified all instances where incorrect field names were being used through error logs and code search.
2. **Schema Verification**: Confirmed the actual field names in the Airtable schema.
3. **Consistent Fixes**: Updated all occurrences to use consistent field names matching the Airtable schema.
4. **Testing**: Verified all fixes through code review to ensure no field name inconsistencies remained.

### Key Changes

#### Client ID Fixes

```javascript
// BEFORE
filterByFormula: `{Client} = '${clientId}'`

// AFTER
filterByFormula: `{Client ID} = '${clientId}'` // Fixed to match Airtable schema
```

#### System Notes Fixes

```javascript
// BEFORE
if (updates.notes) updateFields['Notes'] = updates.notes;

// AFTER
if (updates.notes) updateFields['System Notes'] = updates.notes; // Fixed to match Airtable schema
```

#### Recovery Note Fixes

```javascript
// BEFORE
'Recovery Note': 'Created during update attempt - original record missing'

// AFTER
'System Notes': 'Created during update attempt - original record missing' // Fixed to match Airtable schema
```

#### Jobs Started Fixes

```javascript
// BEFORE
'Jobs Started': totalJobsStarted

// AFTER
'System Notes': `Total jobs started: ${totalJobsStarted}` // Fixed to use existing field
```

## Table Schemas

### Job Tracking Table

Confirmed fields in Job Tracking table:
- Run ID (primary field)
- Clients Processed
- Clients With Errors
- Duration
- End Time
- Post Scoring Success Rate
- Post Scoring Tokens
- Posts Examined for Scoring
- Posts Successfully Scored
- Profile Scoring Tokens
- Profile Success Rate
- Start Time
- Status
- Stream
- Successful Profiles
- System Notes
- Total Posts Harvested
- Total Profiles Examined
- Total Tokens Used

### Client Run Results Table

Relevant fields in Client Run Results table:
- Run ID
- Client ID (not 'Client')
- Client Name
- Start Time
- End Time
- Status
- System Notes (not 'Notes')

## Remaining Known Issues

- AI scoring errors were observed in the logs but are unrelated to the field name inconsistencies. These would need separate investigation:
  ```
  Lead recKNcA8WlMR2EhdJ: Error during AI scoring process. Error: AI response was not a valid or non-empty array of post scores.
  ```

- Job tracking record not found errors may still occur but are not directly related to field naming:
  ```
  Job tracking record not found for job_post_scoring_stream1_20250929064200 (base: job_post_scoring_stream1_20250929064200). Updates will not be applied.
  ```

## Future Recommendations

1. **Schema Validation**: Implement schema validation to catch field name mismatches during development rather than at runtime.
2. **Constants Usage**: Consistently use constants from `src/domain/models/constants.js` for field names rather than hardcoding strings.
3. **Documentation**: Keep an up-to-date document of the Airtable schema for reference during development.
4. **Field Mapping Layer**: Consider implementing a dedicated field mapping layer to abstract Airtable field names from the business logic.

## Commits Summary

1. "Update gitignore to exclude test env files" - Added .env.test* to gitignore
2. "Fix Airtable field name inconsistencies: Change 'Notes' to 'System Notes' to match schema" - Fixed initial field name issues
3. "Fix additional field name inconsistencies: 'Notes' and 'Source' to 'System Notes'" - Fixed additional issues found during review
4. "Fix remaining Client/Client ID field name inconsistencies in filterByFormula expressions" - Fixed final issues with filterByFormula expressions

---

Document prepared on September 29, 2025