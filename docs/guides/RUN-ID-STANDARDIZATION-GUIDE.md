# Run ID Standardization Guidelines

## Standard Run ID Format

The system now uses a standardized run ID format throughout all operations. The standard format is:

```
YYMMDD-HHMMSS
```

Example: `250103-142536` (January 3, 2025, 14:25:36)

## Run ID Entry Points

All run IDs are immediately standardized at entry points using the `standardizeRunId()` function in `jobTracking.js`, which delegates to the comprehensive `unifiedRunIdService.js` for normalization.

## Key Guidelines for Developers

1. **Always use the standardizeRunId() function** when receiving a run ID from any source.
2. **Never use hardcoded field names** for run IDs. Use the constants from `airtableSimpleConstants.js`:
   ```javascript
   JOB_TRACKING_FIELDS.RUN_ID // For Job Tracking table
   CLIENT_RUN_FIELDS.RUN_ID   // For Client Run Results table
   ```

3. **Only store standardized run IDs** in the database. This prevents lookup inconsistencies.

4. **Use constants for lookups**:
   ```javascript
   const formula = `{${JOB_TRACKING_FIELDS.RUN_ID}} = '${standardRunId}'`;
   ```

5. **Client run IDs** should be generated using `JobTracking.addClientSuffix()` to ensure consistency.

## Handling Legacy Run ID Formats

While the system now generates standardized run IDs, you may encounter legacy formats in existing data. The `unifiedRunIdService.js` contains comprehensive logic to detect and convert these formats.

### Legacy Format Examples:

1. Client-suffixed format: `230101-123045-ClientName`
2. Job process format: `job_post_scoring_stream1_20250929094802`
3. Job bypass format: `job_post_scoring_bypass_1717146242405`

All these formats are automatically converted to the standard format when using the `standardizeRunId()` function.

## Common Issues and Solutions

1. **Run ID not found errors**: Ensure you're using the standardized run ID for lookups.
2. **Duplicate records**: May occur if using non-standardized run IDs for existence checks.
3. **Client run record issues**: Make sure to standardize the base run ID before adding client suffix.

## Implementation Notes

The standardization system was implemented in the October 2025 update to address inconsistencies in run ID handling across the system. It ensures that all run IDs follow a single standard format, which simplifies lookups, prevents duplicates, and improves overall system reliability.