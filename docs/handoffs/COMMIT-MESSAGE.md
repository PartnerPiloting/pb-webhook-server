# Add detailed debug logging for run ID flow

## Problem

We're experiencing issues with run record creation and updates in the post harvesting and post scoring processes. Specifically, run records aren't consistently being found when attempting to update metrics.

## Solution

Added detailed debug logging throughout the run ID creation, normalization, and lookup flow to identify exactly where the disconnects are happening.

### Key additions:

1. Added `[DEBUG-RUN-ID-FLOW]` prefix to all debug logs for easy filtering
2. Added detailed logging for:
   - Run ID creation and normalization
   - Run record creation attempts
   - Run record lookup attempts
   - Run ID transformation between processes

3. Added recovery attempts to search for similar run records when exact matches aren't found
4. Added stack traces for errors to better understand failures

### Modified files:
- routes/apifyProcessRoutes.js - Added debug logs for post harvesting
- routes/apiAndJobRoutes.js - Added debug logs for post scoring
- services/runRecordServiceV2.js - Added debug logs for record lookup

This commit is intended to give us the information needed to diagnose and fix the underlying issue with run record creation and updates.