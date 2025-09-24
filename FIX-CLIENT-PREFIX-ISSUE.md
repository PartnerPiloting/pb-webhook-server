## Run ID System Client Suffix Fix

### Issue
The `normalizeRunId` function in `services/runIdService.js` was incorrectly adding an extra 'C' prefix to client IDs that already contained a 'C' prefix, resulting in double prefixes like `-CCGuy-Wilson` instead of the expected `-CGuy-Wilson`.

### Root Cause
The function was blindly appending `-C${clientId}` without checking if the clientId already started with 'C'.

### Fix Implementation
Modified the `normalizeRunId` function to check if the clientId already starts with 'C' before adding the prefix:

```javascript
function normalizeRunId(runId, clientId) {
  if (!runId) return null;
  if (!clientId) return runId;
  
  const baseId = runIdUtils.getBaseRunId(runId);
  
  // Check if clientId already starts with 'C' prefix
  const normalizedClientId = clientId.startsWith('C') ? clientId : `C${clientId}`;
  
  return `${baseId}-${normalizedClientId}`;
}
```

### Test Modifications
Updated test expectations in `test-run-id-system.js` to match the new behavior.

### Verification
All 14 tests in the Run ID System comprehensive test suite now pass successfully.