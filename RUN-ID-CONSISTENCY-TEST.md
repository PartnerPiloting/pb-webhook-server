# Run ID Consistency Test

This script tests the run ID handling system to verify that run IDs are preserved correctly throughout the application flow.

## Tests performed:
1. Generate a run ID and verify it remains consistent when passed through the system
2. Check that client-specific run IDs (compound IDs) are properly preserved
3. Verify that the standardization process doesn't alter valid run IDs
4. Test error handling for invalid run IDs

## Running the test:
```bash
node test-run-id-consistency.js
```

Look for "ALL TESTS PASSED" in the output to verify success.