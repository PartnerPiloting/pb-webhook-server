# Post Scoring Test Plan

This test plan outlines the steps to verify that post scoring is working correctly for the Guy Wilson client after implementing fixes to the filter formulas and adding debug logging.

## Pre-Test Setup

1. Ensure that Guy Wilson client has leads with posts that need to be scored:
   - Check Airtable base for Guy Wilson
   - Verify that some leads have `Posts Content` but their `Date Posts Scored` field is empty
   - If needed, manually clear the `Date Posts Scored` field for a few leads to create test cases

2. Verify the post harvesting process has run successfully:
   - This is a prerequisite, as post scoring needs posts to score
   - Run the post harvesting process for Guy Wilson client if needed

## Test Execution

### Test 1: Direct Post Scoring Endpoint Test

1. Use the direct post scoring endpoint to test scoring functionality:
   ```bash
   curl -X POST "http://localhost:3001/run-post-batch-score-simple?clientId=Guy-Wilson" \
     -H "x-webhook-secret: Diamond9753!!@@pb" 
   ```

2. Expected outcome:
   - API responds with success
   - Posts are scored for Guy Wilson client
   - Check logs for successful post scoring entries

### Test 2: Smart Resume Client-by-Client Workflow Test

1. Run the full Smart Resume workflow for the Guy Wilson client:
   ```bash
   curl -X POST "http://localhost:3001/smart-resume-client-by-client?stream=1" \
     -H "x-webhook-secret: Diamond9753!!@@pb"
   ```

2. Monitor logs for the execution flow:
   - Check for the special debug logs we added for Guy Wilson
   - Verify that `checkUnscoredPostsCount` correctly identifies unscored posts
   - Confirm that `post_scoring` is included in the operations to run
   - Ensure that the `/run-post-batch-score-v2` endpoint is called

3. Expected outcome:
   - Complete workflow executes (lead scoring → post harvesting → post scoring)
   - Post scoring runs for Guy Wilson client
   - Posts are scored and results are stored in Airtable

## Verification Checks

After running the tests, verify:

1. In Airtable:
   - Leads that had unscored posts now have their `Date Posts Scored` field populated
   - `Posts Relevance Score` and `Posts AI Evaluation` fields are populated
   - `Top Scoring Post` field contains the URL of the highest-scoring post

2. In application logs:
   - Look for the special debug logs we added for Guy Wilson client
   - Verify there are entries showing post scoring completed successfully
   - Check if any errors or issues are reported

## Troubleshooting Guide

If post scoring still doesn't work:

1. Check our new debug logs to see where the process is failing:
   - Is `getLeadsForPostScoring` finding leads with posts that need scoring?
   - Is the filter formula being constructed correctly?
   - Are there any errors in the API calls or Airtable operations?

2. Verify that post harvesting is working correctly:
   - If there are no posts to score, it might be because post harvesting isn't working
   - Check if leads have `Posts Content` populated

3. If needed, manually test the filter formula:
   - Use the Airtable API explorer to test the filter formula directly
   - Verify that the formula returns the expected leads

## Additional Notes

- Remember that post scoring depends on post harvesting having run successfully first
- Service level requirements apply (client must have appropriate service level)
- The view "Leads with Posts not yet scored" should be present in the client's Airtable base