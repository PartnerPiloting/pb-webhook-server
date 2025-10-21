# Smart Resume Process Management

This document outlines how the Smart Resume process is managed, monitored, and controlled.

## Overview

Smart Resume is a background process that processes leads across multiple client bases. It can be a long-running operation (typically 1-2 hours) and includes:

- Lock management to prevent concurrent execution
- Stale lock detection to auto-recover from crashes
- Process tracking with real-time status updates
- Manual termination capabilities for stuck processes

## Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `SMART_RESUME_LOCK_TIMEOUT_HOURS` | Maximum time a lock can be held before considered stale | 3.5 | `2.5` |

## API Endpoints

### 1. Run Smart Resume

```
POST /smart-resume-client-by-client
Headers:
  x-client-id: [client_id]
  x-webhook-secret: [webhook_secret]
```

This endpoint returns immediately (202 Accepted) and processes in the background.

### 2. Check Status

```
GET /debug-smart-resume-status
Headers:
  x-webhook-secret: [webhook_secret]
```

Returns the current status of any running or recent Smart Resume process.

### 3. Reset/Terminate Process

```
POST /reset-smart-resume-lock
Headers:
  x-webhook-secret: [webhook_secret]
Body:
  {
    "forceTerminate": true|false
  }
```

Use this to reset a stale lock or terminate a running process.

## Process Monitoring

The Smart Resume process emits heartbeat logs every 15 seconds to indicate it's still running. You can monitor these logs in the console or in the Render logs.

Example log pattern:
```
💓 [job-123] Smart resume still running... (15 minutes elapsed)
```

## Termination Process

If a Smart Resume process becomes stuck or needs to be stopped:

1. Check current status: `GET /debug-smart-resume-status`
2. If necessary, terminate: `POST /reset-smart-resume-lock` with `forceTerminate: true`
3. The process will detect the termination signal within 15 seconds

## Stale Lock Detection

If a process crashes unexpectedly, the lock will automatically be released after the configured timeout period (default: 3.5 hours). This prevents the system from becoming permanently locked.

## Testing Tools

A test script is available to validate termination functionality:

```bash
node test-smart-resume-termination.js [--force]
```

This tests the status endpoint and optionally forces termination of a running process.