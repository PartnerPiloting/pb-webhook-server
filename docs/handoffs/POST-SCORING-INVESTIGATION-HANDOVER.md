# Post Scoring Handover Document

## Current Status

1. **Post Harvesting Fix**:
   - We've fixed the post harvesting endpoint (`/api/apify/process-level2-v2`) to properly handle null response objects in the fire-and-forget pattern
   - Added enhanced logging and documentation
   - Changes have been committed to the `clean-architecture-fixes` branch

2. **Post Scoring Issue**:
   - Based on your clarification, post scoring has been the persistent issue both before and after refactoring
   - Post harvesting appears to have been working correctly before our changes

## Next Steps for Post Scoring Investigation

The post scoring endpoint (`/run-post-batch-score-v2`) needs to be investigated to understand why it's not executing properly. Here's what should be investigated next:

1. **Endpoint Implementation**:
   - Check if the `/run-post-batch-score-v2` endpoint exists and is properly implemented
   - Verify it's correctly registered in Express
   - Check if it properly handles requests with client IDs

2. **Filter Formula Issues**:
   - Similar to the lead scoring issue we fixed previously, the post scoring might have filter formula issues with inconsistent quote styles
   - Check Airtable filter formulas in the post scoring implementation

3. **Data Flow**:
   - Verify that post harvesting is properly storing post data in a format that post scoring can use
   - Ensure the right fields are being populated and in the correct format

4. **Client Handling**:
   - Check if multi-tenant client handling is working correctly for post scoring
   - Verify clientId is being passed correctly to all components

## Key Files to Examine

1. **Post Scoring Implementation**:
   - `routes/apiAndJobRoutes.js` - Contains the `/run-post-batch-score-v2` endpoint
   - `batchScorer.js` or `postBatchScorer.js` - Likely contains the core post scoring logic

2. **Smart Resume Workflow**:
   - `scripts/smart-resume-client-by-client.js` - Orchestrates the workflow and calls the post scoring endpoint

## Testing Approach

1. Test the post scoring endpoint directly with a known client ID:
   ```
   curl -X POST "http://localhost:3001/run-post-batch-score-v2" \
     -H "x-webhook-secret: Diamond9753!!@@pb" \
     -H "Content-Type: application/json" \
     -d '{"clientId":"Guy-Wilson", "stream":"1", "limit":10}'
   ```

2. Check if there are posts available for scoring:
   - Verify that posts have been harvested but not scored
   - Look for leads with posts content but no Posts Relevance Score

3. Add enhanced logging to post scoring similar to what we added for post harvesting

## Recent Fixes and Changes

1. **Post Harvesting Fix** (Just Completed):
   - Fixed null response handling in processClientHandler
   - Added enhanced logging
   - Documented the endpoint and its usage

2. **Previous Lead Scoring Fix**:
   - Fixed filter formula syntax issues in Airtable queries
   - Ensured consistent use of single quotes in filter formulas

## Recommendation

Start a new chat focused specifically on the post scoring issue, using this document as a starting point. The issue is likely similar to the lead scoring issue we fixed previously, with filter formula syntax or similar technical problems.

## Key Points to Remember

- Ensure consistent quote styles in Airtable filter formulas (single quotes vs. double quotes)
- Check for null/undefined handling in fire-and-forget endpoints
- The sequence is: lead scoring → post harvesting → post scoring
- Each step must complete successfully for the next to work