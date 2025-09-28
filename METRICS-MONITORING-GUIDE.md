# Metrics Tracking Monitoring & Troubleshooting Guide

This quick-reference guide provides information on monitoring and troubleshooting the metrics tracking system after the recent fixes.

## Key Metrics to Monitor

1. **Post Scoring Tokens**
   - Field in Airtable: `Post Scoring Tokens` in Client Run Results table
   - Expected value: Non-zero after post scoring operations
   - Typical range: 5,000-50,000 tokens depending on number of posts

2. **Run Record Creation**
   - Should see "Creating new run record" logs only when expected
   - Normal operation should have run records created during process kickoff

3. **Metrics Update Success Rate**
   - Should see successful metrics updates in logs
   - Should not see "Cannot update non-existent run record" errors

## Key Log Markers

### Token Tracking Logs

```
[DEBUG-METRICS] - Post Scoring Tokens to be updated: 12345
[DEBUG-METRICS] ✅ Token tracking is WORKING! 12345 tokens used.
```

### Run Record Management Logs

```
[RUNDEBUG] Checking if run record exists for 230928-123456-ClientName
[APIFY_METRICS] Run record exists check: YES
```

### Orchestration Check Logs

```
[WEBHOOK_DEBUG] Checking if run is orchestrated
[WEBHOOK_DEBUG] parentRunId: abcd1234
[WEBHOOK_DEBUG] isOrchestrated set to: true
```

## Common Issues & Solutions

### 1. Post Scoring Tokens Still Zero

**Symptoms:**
- `Post Scoring Tokens` field in Airtable shows 0
- Logs show "[DEBUG-METRICS] ❌ WARNING: Token tracking still shows 0 tokens!"

**Troubleshooting Steps:**
1. Check logs for token usage from Gemini API
2. Verify that `clientResult.totalTokensUsed` is being accumulated
3. Check the response structure from `scorePostsWithGemini`

**Possible Solutions:**
- If Gemini API isn't returning token counts, add fallback estimation
- If accumulation is failing, check for type mismatches or NaN values
- If `tokenUsage` property is missing, check `postGeminiScorer.js`

### 2. Run Records Still Missing

**Symptoms:**
- Logs show "[APIFY_METRICS] Run record exists check: NO"
- Frequent record creation through fallback mechanism

**Troubleshooting Steps:**
1. Check process kickoff in Smart Resume flows
2. Verify correct run ID formation and consistency
3. Check if run ID normalization is working properly

**Possible Solutions:**
- Enhance the process kickoff to ensure records are always created
- Update runIdService to handle more variations of run IDs
- Add more robust error handling for run creation failures

### 3. Orchestration Check Issues

**Symptoms:**
- After reverting the temporary force-true change, metrics stop updating
- Logs show runs being filtered out by orchestration check

**Troubleshooting Steps:**
1. Check log lines with "[WEBHOOK_DEBUG] parentRunId:"
2. Review what makes a run "orchestrated" vs standalone
3. Analyze the patterns of runs being filtered vs accepted

**Possible Solutions:**
- Create a more flexible orchestration check
- Add configuration option for different orchestration requirements
- Consider separate handling for different run types

## Monitoring Dashboard

Consider setting up a monitoring dashboard to track:

1. **Metrics Update Success Rate**
   - % of runs with successful metrics updates

2. **Token Usage Trends**
   - Average tokens per post/profile
   - Total token usage per client/period

3. **Run Record Management**
   - % of runs needing fallback record creation
   - Distribution of orchestrated vs standalone runs

## Additional Resources

- **Main Handover Document**: `METRICS-TRACKING-FIXES-HANDOVER.md`
- **Diagnostic Process**: `METRICS-DIAGNOSTIC-PROCESS.md`
- **Related PRs**: 
  - Fix metrics tracking issues with post tokens and run records (PR #XX)

## Support Contacts

For issues with metrics tracking, contact:
- Primary: Development Team
- Secondary: DevOps Team