# Fix Last Updated field error and express-rate-limit installation

## Issues
1. "Unknown field name: Last Updated" errors in the logs
2. express-rate-limit module not being installed despite being in package.json

## Changes Made
1. Removed 'Last Updated' field from updateFields in updateRunRecord function
2. Added deploy.sh script to explicitly install express-rate-limit dependency

## How to Test
1. Monitor logs for "Unknown field name: Last Updated" errors - should be resolved
2. Check if apifyWebhookRoutes successfully mounts without express-rate-limit errors
3. Verify post harvesting returns proper JSON responses instead of HTML

## Note
These changes address the two specific errors seen in the logs:
- "Unknown field name: Last Updated"
- "Cannot find module 'express-rate-limit'"