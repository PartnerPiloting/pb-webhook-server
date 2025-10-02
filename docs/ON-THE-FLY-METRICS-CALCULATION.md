# On-The-Fly Job Metrics Calculation

## Overview

As of October 2, 2025, we've adopted a "single source of truth" approach for job metrics. Previously, we stored aggregated metrics in the Job Tracking table, which created data redundancy and potential inconsistencies. Now, these metrics are calculated on-the-fly from the Client Run Results table when needed.

## Fields Removed from Job Tracking Table

The following fields have been removed from the Job Tracking table in Airtable:

1. `Clients Processed`
2. `Clients With Errors`
3. `Total Profiles Examined`
4. `Successful Profiles` 
5. `Total Posts Harvested`
6. `Posts Examined`
7. `Posts Scored`
8. `Profile Scoring Tokens`
9. `Post Scoring Tokens` 
10. `Total Tokens Used`
11. `Success Rate` (formula field)
12. `Post Scoring Success Rate` (formula field)

## Benefits

1. **Single Source of Truth**: All raw data stays in the Client Run Results table
2. **Data Consistency**: No risk of Job Tracking table having outdated aggregates
3. **Simplification**: Removes complexity of maintaining duplicate data
4. **Flexibility**: Easier to add new metrics without updating multiple tables
5. **Real-time Accuracy**: Calculations always reflect the current state of client runs

## Implementation Details

### New Function

A new function `getAggregateMetrics(runId)` has been added to `services/airtableServiceSimple.js` that:

1. Fetches all Client Run Results records for a given run ID
2. Calculates aggregates on-the-fly
3. Returns the metrics without updating the Job Tracking table

### Backwards Compatibility

The original `updateAggregateMetrics(runId)` function has been maintained for backwards compatibility, but now simply calls `getAggregateMetrics(runId)` without updating the Job Tracking table.

### Constants Changes

The constants for these removed fields have been commented out in `constants/airtableUnifiedConstants.js` to maintain a record of what was removed.

## How to Access Job Metrics

To access job metrics, use:

```javascript
const { getAggregateMetrics } = require('./services/airtableServiceSimple');

// Get metrics for a job
const { metrics } = await getAggregateMetrics('231001-120000');

console.log(`Total profiles examined: ${metrics.totalProfilesExamined}`);
console.log(`Successful profiles: ${metrics.successfulProfiles}`);
console.log(`Profile success rate: ${metrics.profileSuccessRate}`);
```

## Dashboard Considerations

Any dashboards that relied on these fields in the Job Tracking table will need to be updated to use the new calculation method instead.