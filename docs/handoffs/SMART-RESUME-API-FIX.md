# Smart Resume API Fix - Post-Mortem

## Issue
After making changes to the run ID system to remove the "C" prefix from client IDs, the `/smart-resume-client-by-client` endpoint stopped working, returning "Cannot POST /smart-resume-client-by-client" errors.

## Root Cause
The changes to the regex patterns in `utils/runIdUtils.js` broke backward compatibility, causing the API routes to fail to load. Specifically:

1. The `STANDARD_RUN_ID_REGEX` was updated to only match client IDs without a "C" prefix
2. The `CLIENT_SUFFIX_REGEX` was updated to expect a format without the "C" prefix
3. The `hasClientSuffix` function was modified to use a new detection method

When Express attempted to load the `apiAndJobRoutes.js` file (which contains the smart-resume endpoints), it failed due to incompatibility between the route code and the updated utils.

## Solution
We made the regex patterns backward compatible to handle both formats:

```javascript
// BEFORE:
const STANDARD_RUN_ID_REGEX = /^(SR-\d{6}-\d{3}-T\d+-S\d+)(?:-([^-].+))?$/;
const CLIENT_SUFFIX_REGEX = /-([^-][^-]+)$/;

// AFTER:
const STANDARD_RUN_ID_REGEX = /^(SR-\d{6}-\d{3}-T\d+-S\d+)(?:-(?:C)?(.+))?$/;
const CLIENT_SUFFIX_REGEX = /-(?:C)?([^-]+)$/;
```

This allows both the old format (`SR-250924-001-T3304-S1-CGuy-Wilson`) and the new format (`SR-250924-001-T3304-S1-Guy-Wilson`) to work.

We also updated the `hasClientSuffix` function to be more flexible in detecting client suffixes:

```javascript
function hasClientSuffix(runId) {
  if (!runId) return false;
  // Support both formats: with -C prefix and without
  return (runId.indexOf('-C') > 0) || 
         (runId.lastIndexOf('-') > 0 && 
          !runId.endsWith('-') &&
          CLIENT_SUFFIX_REGEX.test(runId));
}
```

## Prevention
In the future, we should:
1. Test changes to core utilities that multiple modules depend on more thoroughly
2. Ensure backward compatibility when updating regex patterns
3. Consider implementing proper unit tests for critical utility functions
4. Test key API endpoints after making changes to shared modules

## Timeline
- 07:05:29 UTC: First observed failure of the `/smart-resume-client-by-client` endpoint
- After investigation, identified the issue with regex patterns
- Applied backward compatible fix to `utils/runIdUtils.js`
- Committed and pushed changes to the staging branch
- API should now be functioning correctly again