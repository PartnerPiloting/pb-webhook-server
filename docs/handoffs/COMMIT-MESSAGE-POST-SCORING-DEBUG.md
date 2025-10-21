# Add detailed debug logging for post scoring process

## Problem

We're having issues with post scoring - specifically:
1. Only 3 posts are being scored when there are 582 eligible leads
2. The "Date Posts Scored" field doesn't appear to be updating in Airtable

## Solution

Added comprehensive debug logging throughout the post scoring process to:

1. Log how many posts are available for scoring and any limits being applied
2. Track environment variables that might affect scoring limits
3. Add detailed logging of Airtable updates, especially for the Date Posts Scored field
4. Add verification steps to confirm updates are successful

These debug logs will help us determine:
- Why only a small number of posts are being selected for scoring
- Whether updates to the Date Posts Scored field are being attempted
- Whether those updates are succeeding or failing

### Modified files:
- postBatchScorer.js