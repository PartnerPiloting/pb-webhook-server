# Post Harvesting Fixes - 2024-09-27

This document describes the recent fixes implemented to address issues with post harvesting, duplicate records, and ESM/CommonJS compatibility.

## 1. Fixed Issues

### 1.1. Airtable Field Type Issue

**Problem**: The `updateClientRunMetrics` function in `services/apifyRunsService.js` was using `.toFixed(2)` which converted the numeric cost value to a string, causing Airtable to reject it since the field requires a number.

**Fix**: Removed `.toFixed(2)` to ensure Airtable receives a proper number value for the "Apify API Costs" field.

### 1.2. Corrupted apifyWebhookRoutes.js

**Problem**: The `routes/apifyWebhookRoutes.js` file was corrupted, causing webhook processing failures.

**Fix**: Created a clean version of the file and implemented it to restore functionality.

### 1.3. ESM/CommonJS Module Compatibility

**Problem**: The `test-run-tracking.js` file in the root directory was using ESM-style imports (`import fetch from 'node-fetch'`) while the project primarily uses CommonJS (`require()`), causing compatibility issues.

**Fix**: Updated `test-run-tracking.js` to use CommonJS-style requires and leverage the project's `safeFetch.js` utility for consistent fetch implementation.

## 2. Post Harvesting Cost Control

Implemented the `APIFY_MAX_POSTS` environment variable to limit the number of posts harvested per profile, reducing API credit usage. This is documented in `docs/POST-HARVESTING-COST-OPTIMIZATION.md`.

## 3. Implementation Details

### 3.1. Changes to apifyRunsService.js

Updated the `updateClientRunMetrics` function to properly handle numeric values for Airtable:

```javascript
// Calculate estimated API costs (based on LinkedIn post queries)
const estimatedCost = data.postsCount * 0.02; // $0.02 per post as estimate

// Update the client run record with all metrics
const updated = await airtableService.updateClientRun(standardizedRunId, clientId, {
    'Total Posts Harvested': data.postsCount,
    'Apify API Costs': estimatedCost, // Now passing as a number instead of a string
    'Apify Run ID': runId,
    'Profiles Submitted for Post Harvesting': data.profilesCount
});
```

### 3.2. Module Compatibility

The project uses a mix of module systems:
- Main application: CommonJS (`require()`)
- Test scripts in subdirectories: ESM (with `"type": "module"` in their package.json)

The `safeFetch.js` utility handles cross-compatibility by providing a consistent fetch implementation regardless of environment.

## 4. Testing

After implementing these changes, the following should be tested:
1. Post harvesting with different clients
2. Metrics updates in the Client Run Results table
3. Run the test-run-tracking.js script to verify it works with CommonJS imports

## 5. Future Recommendations

1. Standardize on one module system across the project
2. Add validation for numeric fields before sending to Airtable
3. Consider implementing more robust error handling for webhook processing