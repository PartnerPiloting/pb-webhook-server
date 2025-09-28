# Metrics Update System Validation Plan

## Overview

This document outlines the plan for validating that the metrics update system is working properly across all components of the application. The goal is to ensure that all processes that update metrics (lead scoring, post harvesting, post scoring) are using the `safeUpdateMetrics` function consistently and that metrics are being properly recorded in the Airtable database.

## Test Scenarios

### 1. Lead Scoring Metrics

**Test Setup:**
- Run the batch scoring process for a test client
- Set debug logging to verbose

**Validation Steps:**
1. Monitor logs for calls to `trackLeadProcessingMetrics` and `safeUpdateMetrics`
2. Verify that the metrics are correctly recorded in the Client Run Results table
3. Check for any error messages related to metrics updates

**Expected Results:**
- No "Field cannot accept provided value" errors
- Proper token usage recorded
- Correct counts of profiles processed

### 2. Post Harvesting Metrics

**Test Setup:**
- Trigger the Apify webhook handler with test data
- Ensure that the client ID is properly extracted

**Validation Steps:**
1. Check for calls to `safeUpdateMetrics` in the logs
2. Verify that metrics like "Total Posts Harvested" are updated correctly
3. Confirm that the "Apify Run ID" field is correctly populated

**Expected Results:**
- Post count increments properly
- API costs are tracked
- No authorization errors when updating

### 3. Post Scoring Metrics

**Test Setup:**
- Run the post scoring process for a test client
- Trigger both through the API and via the batch scorer

**Validation Steps:**
1. Verify metrics are updated via `safeUpdateMetrics`
2. Check that "Post Scoring Last Run Time" field is properly formatted
3. Confirm that token usage is recorded correctly

**Expected Results:**
- Proper updating of "Posts Examined for Scoring" and "Posts Successfully Scored"
- Token usage is tracked correctly
- Duration field is formatted properly

### 4. Error Handling

**Test Setup:**
- Deliberately cause errors by:
  - Using an invalid client ID
  - Using a non-existent run ID
  - Providing invalid field values

**Validation Steps:**
1. Verify that errors are caught and logged
2. Confirm that the main process continues despite metrics errors
3. Check error messages for helpful diagnostic information

**Expected Results:**
- Graceful error handling without process crashes
- Informative error messages
- Proper fallback behavior when metrics can't be updated

## Execution Plan

1. **Set Up Test Environment:**
   - Create a test client in the Master Clients base
   - Prepare test data for each scenario
   - Enable verbose logging

2. **Run Tests Sequentially:**
   - Lead scoring test
   - Post harvesting test
   - Post scoring test
   - Error handling tests

3. **Analyze Results:**
   - Review logs for each test
   - Check Airtable records for correct updates
   - Document any issues or unexpected behavior

4. **Resolve Issues:**
   - Fix any issues found during testing
   - Retest to verify fixes

## Success Criteria

The metrics update system is considered successfully validated when:

1. All processes use `safeUpdateMetrics` consistently
2. No field validation errors occur
3. Metrics are correctly updated in all scenarios
4. Errors are handled gracefully without affecting the main process
5. Token usage is accurately tracked across all AI operations

## Reporting

After completing the validation, prepare a summary report that includes:

1. Test results for each scenario
2. Any issues discovered and how they were resolved
3. Recommendations for further improvements
4. Performance impact observations