# Job Tracking System Migration Guide

## Overview

This document explains the migration from multiple job tracking services to a simplified, centralized job tracking system. The goal is to prevent duplicate records, ensure consistent ID formats, and maintain a single source of truth for job tracking in our multi-tenant application.

## Problem Statement

The original system had several issues:

1. **Multiple ID Generation Points**: Different services were generating their own run IDs in different formats
2. **Duplicate Records**: The same job could create multiple tracking records
3. **Inconsistent Field Usage**: Some services used "Notes" while others used "System Notes"
4. **Formula Field Updates**: Code was trying to update formula fields like "Success Rate"

## Solution: simpleJobTracking.js

We've consolidated all job tracking functionality into a single service, `services/simpleJobTracking.js`. This service:

1. Provides a single source for generating consistent run IDs
2. Prevents duplicate records by checking for existing records before creating
3. Uses consistent field names (e.g., "System Notes" instead of "Source")
4. Avoids updating formula fields

## Migration Steps

The following changes have been made:

1. Created `services/simpleJobTracking.js` with comprehensive job tracking functionality
2. Archived legacy services to `_archived_legacy/airtable/`:
   - `runIdService.js`
   - `runRecordRepository.js`
   - `jobTrackingRepository.js`
3. Updated imports in affected files:
   - `routes/apifyWebhookRoutes.js`
   - `scripts/smart-resume-client-by-client.js`

## Using the New System

### Generating Run IDs

```javascript
const simpleJobTracking = require('../services/simpleJobTracking');
const runId = simpleJobTracking.generateRunId();
```

### Creating Job Tracking Records

```javascript
const jobRecord = await simpleJobTracking.createJobTrackingRecord({
  runId,
  jobType: 'post-scoring',
  initialData: {
    'System Notes': 'Started batch scoring job'
  }
});
```

### Creating Client Run Records

```javascript
const clientRecord = await simpleJobTracking.createClientRunRecord({
  runId,
  clientId,
  initialData: {
    'Posts Processed': 0
  }
});
```

### Updating Records

```javascript
await simpleJobTracking.updateJobTrackingRecord({
  runId,
  updates: {
    status: 'Running',
    progress: '50% complete',
    notes: 'Processing batch 2 of 4'
  }
});

await simpleJobTracking.updateClientRunRecord({
  runId,
  clientId,
  updates: {
    postsProcessed: 42,
    tokenUsage: 15000
  }
});
```

### Completing Jobs

```javascript
await simpleJobTracking.completeJobTrackingRecord({
  runId,
  status: 'completed'
});

await simpleJobTracking.completeClientRunRecord({
  runId,
  clientId,
  status: 'completed',
  updates: {
    postsProcessed: 100,
    notes: 'All posts processed successfully'
  }
});
```

## Best Practices

1. Always generate run IDs using `simpleJobTracking.generateRunId()`
2. Use consistent field names as defined in the service
3. Pass the run ID between functions rather than generating new IDs
4. Use the appropriate client suffix functions when needed

## Implementation Details

The service handles:

- Standardized YYMMDD-HHMMSS format for run IDs
- Client-specific suffixes when needed (YYMMDD-HHMMSS-ClientName)
- Duplicate record prevention
- Job and client run tracking in separate tables
- Proper field mapping to Airtable schema

If you need additional functionality, please extend the `simpleJobTracking.js` service rather than creating new tracking mechanisms.