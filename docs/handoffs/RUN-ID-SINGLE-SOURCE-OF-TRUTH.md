# Run ID Single Source of Truth Implementation

> **COMPREHENSIVE VERIFICATION:** This pattern has been verified across all entry points including API routes, webhook handlers, Smart Resume scripts, and legacy code paths.

## Core Principle

Each run ID is generated **exactly once** and passed unchanged throughout the entire process chain. This ensures consistent tracking and metrics across all components.

## Key Implementation Points

1. **No Implicit Normalization**: Run IDs are no longer normalized unless explicitly necessary. When received from upstream processes, they are passed through untouched.

2. **Strict Mode**: The system now operates in strict run ID mode, which means:
   - Objects passed as run IDs will throw errors rather than being silently converted
   - Non-standard run ID formats will throw errors rather than being normalized
   - Stack traces are logged to identify the source of problematic run ID handling

3. **Client-Specific IDs Preserved**: Compound run IDs in the format `baseId-clientId` are always preserved intact.

4. **Priority Order**:
   - `req.specificRunId` (highest priority) - Explicit run ID set for a request
   - `req.query.runId` - Run ID from query parameters
   - `req.body.runId` - Run ID from request body
   - `parentRunId` - Parent run ID from calling process
   - New generated ID (last resort) - Only if none of the above exist

## Implementation Notes

- Enhanced logging with `DEBUG_RUN_ID` shows the flow of run IDs through the system
- Strict validation prevents accidental ID regeneration or normalization
- No automatic fallback to creating records when they don't exist - errors are thrown to highlight issues

## Common Error Messages

- `STRICT RUN ID ERROR: Object passed to normalizeRunId instead of string` - An object was incorrectly passed where a string run ID was expected
- `STRICT RUN ID ERROR: Non-standard run ID format encountered` - A run ID that doesn't match expected formats was passed

## How This Fixes The Problem

The "Job tracking record not found" errors were occurring because:

1. Process A would generate run ID X
2. Process A would create a record with run ID X
3. Process B would receive X but transform it to Y through normalization
4. Process B would then look for records with ID Y but find none

With this fix:
1. Process A generates run ID X
2. Process A creates a record with run ID X
3. Process B receives X and uses it unchanged
4. Process B finds the record correctly using ID X

## Key Integration Points

### Webhook Handlers
- Webhook handlers now preserve run IDs exactly as received
- Enhanced validation ensures proper type handling without normalization
- Detailed logging tracks run ID flow through webhook processing

### Smart Resume Scripts
- Updated `getNormalizedRunId` function to preserve original format
- Added special handling for compound run IDs (baseId-clientId format)
- Improved error handling to prevent run ID transformation

### Legacy Code Paths
- Enhanced compatibility methods with DEBUG_RUN_ID logging
- Stack trace logging to identify legacy code usage
- Preserved backward compatibility while enforcing correct behavior

### External API Integrations
- All external API integrations maintain run ID consistency
- Run IDs are passed unchanged between systems

## Migration Guide

The legacy `generateRunId()` function has been removed in favor of using `generateTimestampRunId()` directly.

### How to Update Your Code

If you see this error:
```
DEPRECATED: generateRunId() has been removed. Use generateTimestampRunId() directly instead.
```

Update your code as follows:

1. **Simple replacements**:
   ```javascript
   // Old code
   const runId = unifiedRunIdService.generateRunId();
   
   // New code
   const runId = unifiedRunIdService.generateTimestampRunId();
   ```

2. **With client IDs**:
   ```javascript
   // Old code
   const runId = generateRunId(clientId);
   
   // New code
   const runId = unifiedRunIdService.generateTimestampRunId(clientId);
   ```

3. **For JobTracking**:
   ```javascript
   // Old code
   const runId = JobTracking.generateRunId();
   
   // New code
   const runId = unifiedRunIdService.generateTimestampRunId();
   ```

## Future Improvements

- Add complete run ID validation on API boundaries
- Create monitoring for run ID consistency across processes
- Implement tracing to visualize the flow of run IDs through the system
- Add automated tests specifically for run ID handling