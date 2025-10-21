# Run ID Normalization System

## Overview

This document outlines the proper way to handle run IDs throughout the application. A run ID is a unique identifier for a job run that may be processed across multiple services and functions. Proper handling of run IDs is critical for job tracking, error diagnosis, and multi-tenant isolation.

## Common Issues

The system has encountered several run ID related issues:

1. **Undefined normalizedRunId**: Functions using `normalizedRunId` without properly initializing it
2. **Object Reference Errors**: Run IDs passed as objects instead of strings
3. **Inconsistent Formats**: Run IDs used in different formats across the system
4. **Missing Validation**: Lack of validation at API and service entry points

## Best Practices

### 1. Always Validate Run IDs at Entry Points

For API routes and service entry points:

```javascript
// In API controller or service function
function processJob(req, res) {
  const { runId } = req.body;
  
  // Validate at entry point
  if (!runId || typeof runId !== 'string') {
    return res.status(400).json({ 
      error: 'Invalid run ID format. Must be a non-empty string.'
    });
  }
  
  // Process with validated ID
  // ...
}
```

### 2. Use Proper Initialization Pattern

When working with run IDs, always use this pattern:

```javascript
// Extract runId from options
const inputRunId = options.runId;

// Validate and normalize early
if (!inputRunId) {
  throw new Error('Run ID is required for this operation');
}

// Normalize once and reuse
const normalizedRunId = unifiedRunIdService.normalizeRunId(inputRunId);

// Pass explicitly to child functions
await childFunction({ runId: normalizedRunId });
```

### 3. Explicitly Extract from Options

When receiving an options object that may contain a runId:

```javascript
function processFunction(options = {}) {
  // Explicitly extract from options
  const inputRunId = options.runId;
  
  // Validate and handle
  if (!inputRunId) {
    throw new Error('Run ID is required');
  }
  
  // Continue processing...
}
```

### 4. Use the unifiedRunIdService

Always use the official runId service for normalization:

```javascript
const unifiedRunIdService = require('../services/unifiedRunIdService');

// Normalize the ID
const normalizedRunId = unifiedRunIdService.normalizeRunId(inputRunId);
```

### 5. Handle Validation Failures Gracefully

When normalization might fail:

```javascript
let normalizedRunId;
try {
  normalizedRunId = unifiedRunIdService.normalizeRunId(inputRunId);
} catch (error) {
  logger.error(`Failed to normalize run ID: ${error.message}`);
  normalizedRunId = `fallback_${Date.now()}`; // Create fallback ID
}
```

## Run ID Format Standards

The standard run ID format is: `YYMMDD-HHMMSS` (e.g., `251002-110353`)

For client-specific run IDs: `YYMMDD-HHMMSS-ClientId` (e.g., `251002-110353-Guy-Wilson`)

## Utilities Available

1. `unifiedRunIdService.normalizeRunId(runId)` - Normalizes any run ID to standard format
2. `unifiedRunIdService.addClientSuffix(runId, clientId)` - Creates client-specific run ID
3. `validateAndNormalizeRunId(runId)` - For API entry point validation
4. `safeRunIdUtils.safeNormalizeRunId(runId)` - Never returns undefined
5. `safeRunIdUtils.safeAddClientSuffix(baseRunId, clientId)` - Safe client ID addition

## Remember

- A run ID should never be undefined in business logic
- Always validate run IDs as early as possible
- When in doubt, use the safety utilities from safeRunIdUtils