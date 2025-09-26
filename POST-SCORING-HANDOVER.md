# LinkedIn Lead Management System: Post Scoring Investigation

## Current Status Summary

We've fixed the post harvesting endpoint in the client-by-client workflow, but post scoring still needs investigation.

### Fixed Issue: Post Harvesting in Client-by-Client Workflow
- Post harvesting was working under the original endpoint but not in client-by-client URL structure
- Fixed by updating the `/api/apify/process-level2-v2` endpoint to handle null response objects correctly
- Added enhanced logging and documentation for easier debugging

### Outstanding Issue: Post Scoring Not Working
- Post scoring has never worked properly (both before and after refactoring)
- Problem is likely similar to the lead scoring issue (filter formula syntax errors)
- Needs dedicated investigation focusing on the `/run-post-batch-score-v2` endpoint

## Technical Investigation Steps

### 1. Check Post Scoring Endpoint
- Examine `/run-post-batch-score-v2` endpoint in `routes/apiAndJobRoutes.js`
- Verify proper registration in Express and correct handling of client IDs
- Check for proper authentication handling

### 2. Examine Post Scoring Implementation
- Check `batchScorer.js` or `postBatchScorer.js` for filter formula issues
- Look for inconsistent quote styles in Airtable filter formulas (similar to lead scoring issue)
- Verify the view name and field references are correct

### 3. Data Flow Analysis
- Confirm posts are properly harvested and stored in the correct format
- Verify the fields being used for post scoring exist and contain data
- Check that client ID is being passed correctly throughout the process

### 4. Testing Approach
- Test the post scoring endpoint directly with a known client ID
- Add logging to track the execution flow
- Check if posts are actually available for scoring

## Key Code Locations

### Endpoints & Routes
- Client-by-client workflow: `scripts/smart-resume-client-by-client.js`
- Post scoring endpoint: `/run-post-batch-score-v2` in `routes/apiAndJobRoutes.js`

### Core Logic
- Post scoring implementation: `batchScorer.js` or `postBatchScorer.js`

## Recent Fixes (Already Implemented)

1. **Post Harvesting Fix**:
   - Updated `processClientHandler()` in `routes/apifyProcessRoutes.js` to handle null response objects
   - Added better error handling for fire-and-forget pattern
   - Enhanced logging for debugging purposes

2. **Lead Scoring Fix** (Previous work):
   - Fixed filter formula syntax in Airtable queries
   - Ensured consistent use of single quotes

## Recommended Next Steps

1. Check filter formulas in post scoring implementation
2. Fix any inconsistent quote styles or syntax errors
3. Add enhanced logging to track execution flow
4. Test with a known client that has harvested posts

## GitHub Link to this Document
https://github.com/PartnerPiloting/pb-webhook-server/blob/clean-architecture-fixes/POST-SCORING-HANDOVER.md