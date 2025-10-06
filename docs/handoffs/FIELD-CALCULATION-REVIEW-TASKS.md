# Field Calculation Logic Review Tasks

This document tracks fields that need their calculation logic reviewed for accuracy and comprehensiveness.

## Active Review Tasks

### 1. CLIENTS_WITH_ERRORS Calculation Logic

**Priority:** High  
**Created:** 2025-10-02  
**Related PR:** feature/comprehensive-field-standardization  
**Deadline:** [TBD]

#### Current Implementation

Currently, `CLIENTS_WITH_ERRORS` is calculated by counting clients with 'Failed' status:

```javascript
[JOB_TRACKING_FIELDS.CLIENTS_WITH_ERRORS]: clientRecords.filter(r => 
  r.fields[CLIENT_RUN_FIELDS.STATUS] === 'Failed'
).length
```

#### Issues with Current Implementation

This calculation may miss clients that:
- Encountered errors but ultimately completed successfully
- Had partial success with some operations failing
- Have error logs but not a 'Failed' status
- Failed for reasons other than error (e.g., timeout, cancellation)

#### Proposed Improvements

1. Define what "client with errors" means more precisely:
   - Any client that encountered at least one error during processing?
   - Only clients that failed completely due to errors?
   - Should we track error severity levels?

2. Consider alternative calculation approaches:
   - Check for presence of error logs or specific error fields
   - Count clients with any error indicators, not just failed status
   - Potentially add an explicit "had_errors" flag to client records

3. Implementation considerations:
   - Add validation to ensure consistent error tracking
   - Update documentation to clarify what this metric means
   - Consider adding more granular error metrics (e.g., by error type)

#### Files to Modify

- `services/airtableServiceSimple.js` (primary calculation logic)
- `services/jobTracking.js` (error tracking logic)
- `constants/airtableUnifiedConstants.js` (field definitions)

#### Next Steps

- [ ] Schedule technical review meeting
- [ ] Design improved calculation approach
- [ ] Implement and test changes
- [ ] Update documentation

## Completed Review Tasks

*None yet*