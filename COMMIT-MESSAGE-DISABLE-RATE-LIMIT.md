# Temporarily disable express-rate-limit to fix apifyWebhookRoutes loading

## Issue
The apifyWebhookRoutes module was failing to load because the express-rate-limit package was missing, causing HTML responses instead of JSON for post harvesting requests.

## Changes Made
- Commented out the express-rate-limit require statement in apifyWebhookRoutes.js
- Added a dummy middleware function that simply calls next() to maintain the API structure
- Left comments explaining the temporary nature of this fix

## How to Test
- Check if apifyWebhookRoutes loads without errors during server startup
- Test post harvesting to see if JSON responses are returned instead of HTML errors

## Next Steps
- Consider reinstating rate limiting with proper dependency management in the future
- Monitor for any potential abuse of API endpoints while rate limiting is disabled