# Fix Run ID Normalization in Client Run Completion

## Bug Description
Fixed a critical issue where the system was creating duplicate records when completing client runs. One record would remain in "Running" status while a second record would be created with "Completed" status.

## Root Cause
The `normalizeRunId` function in `runIdService.js` was ALWAYS generating a new timestamp-based ID regardless of the input run ID. This meant:

1. When a record was initially created, it used timestamp X (e.g., "250925-024211-Dean-Hobin")
2. When attempting to complete the record, `normalizeRunId` would generate a new timestamp Y
3. `updateClientRun` couldn't find the original record with the new ID, so `completeClientRun` would create a new record

## Fix
Modified the `normalizeRunId` function to:
- Check if the input run ID already has a valid timestamp format
- Use that existing timestamp if it matches our expected format (YYMMDD-HHMMSS)
- Only create a new timestamp when the input doesn't match the expected format

## Before Fix
```javascript
// Always generate a new timestamp-based ID to ensure uniqueness for each client
const baseId = createRunId();
const standardId = `${baseId}-${cleanClientId}`;
```

## After Fix
```javascript
// Extract the base ID if it exists and looks valid, otherwise create a new one
let baseId;
if (runId && typeof runId === 'string') {
  // Check if runId has our expected timestamp format (YYMMDD-HHMMSS...)
  const timestampMatch = runId.match(/^(\d{6}-\d{6})/);
  if (timestampMatch) {
    baseId = timestampMatch[1]; // Use the existing timestamp
  } else {
    baseId = createRunId(); // Create new if not in expected format
  }
} else {
  baseId = createRunId(); // Create new if runId is not a string
}

const standardId = `${baseId}-${cleanClientId}`;
```

## Testing
- Verify that client runs have only ONE record each
- Confirm that the record properly transitions from "Running" to "Completed"
- Check that no new "duplicate completed" records are created

This change ensures run IDs remain consistent throughout the client processing lifecycle.