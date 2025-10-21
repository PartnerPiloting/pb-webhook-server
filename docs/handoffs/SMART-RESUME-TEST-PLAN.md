# Smart Resume Module Integration - Test Plan

This document outlines the test strategy for the Smart Resume module integration changes.

## 1. Local Testing

### 1.1 Baseline Tests

#### Test Script Execution
```bash
# Test the script directly
node scripts/smart-resume-client-by-client.js
```
Expected outcome:
- Script executes successfully
- Proper logging is displayed
- Email report is sent if configured

#### Module Import Test
```bash
# Test importing the module
node test-smart-resume-module.js
```
Expected outcome:
- Module successfully imports
- runSmartResume function executes
- Process completes with proper logging

### 1.2 API Integration Tests

#### Normal Operation
```bash
# Test the API endpoint with local server
node test-smart-resume-endpoint.js --local
```
Expected outcome:
- Endpoint accepts request with 202 status
- Background processing starts
- Process completes successfully
- Logs show proper execution steps

#### Status Check
```bash
# Test the status endpoint during execution
node test-smart-resume-status.js --local
```
Expected outcome:
- Shows isRunning=true during execution
- Shows correct job ID
- Shows accurate lock age

#### Lock Management Tests

1. **Test Stale Lock Detection**:
   - Manually set lockTime to old value
   - Verify lock is auto-released

2. **Test Lock Reset Endpoint**:
   ```bash
   curl -X POST 'http://localhost:3001/reset-smart-resume-lock' \
     -H 'x-webhook-secret: Diamond9753!!@@pb' \
     -H 'Content-Type: application/json' -d '{}'
   ```
   Expected outcome:
   - Lock is released
   - API returns success

#### Concurrency Test
```bash
# Start two processes in quick succession
node test-smart-resume-endpoint.js --local &
sleep 1
node test-smart-resume-endpoint.js --local
```
Expected outcome:
- First process starts normally
- Second process is rejected with 409 Conflict

## 2. Staging Tests

### 2.1 Basic Functionality

```bash
# Test against staging environment
node test-smart-resume-endpoint.js
```

Expected outcome:
- Endpoint accepts request with 202 status
- Process runs successfully on staging
- Email reports are sent correctly

### 2.2 Status Monitoring

```bash
# Monitor process on staging
node test-smart-resume-status.js
```

Expected outcome:
- Accurate status information
- Lock age calculation correct
- isStale flag works properly

### 2.3 Error Recovery

1. Force an error by modifying module temporarily
2. Verify lock is released despite error
3. Verify error email is sent
4. Verify next execution works normally

## 3. Production Rollout

1. Deploy to production with limited client range first
2. Monitor execution closely
3. Check logs for any warnings or errors
4. Verify email reporting works in production

## Special Considerations

- When testing locally, ensure proper environment variables are set
- Test with smaller client/lead limits initially
- Verify memory usage doesn't increase unexpectedly
- Check all logs for any unexpected warnings