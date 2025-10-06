# Run ID Architecture Proposal

## Current Issues

We've encountered several issues with our run ID handling in the multi-tenant system:

1. **Double Client Suffixes**: Run IDs sometimes get double-suffixed (e.g., `8MSTBAfqMzuXPvgB3-CGuy-Wilson-CGuy-Wilson`)
2. **Inconsistent Formatting**: Some services use client-suffixed IDs while others don't
3. **Cache Misses**: Record lookup failures occur when client suffixes are applied inconsistently
4. **Error Prone**: The current approach relies on string manipulation which is error-prone

## Proposed Architecture

### 1. Central Run ID Service

Create a dedicated service to handle all run ID operations:

```javascript
// services/runIdService.js
const runIdUtils = require('../utils/runIdUtils');
const { v4: uuidv4 } = require('uuid');

/**
 * Generate a new run ID with proper format and client suffix
 */
function generateRunId(clientId, taskId = null, stepId = null) {
  // Get current date in YYMMDD format
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const sequence = getNextSequence();
  
  // Format: SR-DATE-SEQ[-TASK][-STEP]-CLIENT
  let baseId = `SR-${date}-${sequence}`;
  if (taskId) baseId += `-T${taskId}`;
  if (stepId) baseId += `-S${stepId}`;
  
  return runIdUtils.addClientSuffix(baseId, clientId);
}

/**
 * Store run metadata in a centralized store
 */
function registerRun(runId, clientId, metadata = {}) {
  // Store run details in database or cache
}

/**
 * Standardize Apify run IDs by mapping them to our format
 */
function registerApifyRun(apifyRunId, clientId) {
  const clientSuffixedId = runIdUtils.addClientSuffix(apifyRunId, clientId);
  registerRun(clientSuffixedId, clientId, { type: 'apify', originalId: apifyRunId });
  return clientSuffixedId;
}
```

### 2. Strong Type Enforcement

Create a RunId class to enforce proper handling:

```typescript
class RunId {
  private baseId: string;
  private clientId: string;
  
  constructor(idString: string, clientId?: string) {
    if (!idString) throw new Error("Run ID cannot be empty");
    
    // If idString already has a client suffix and clientId is provided,
    // ensure they match or throw an error
    if (runIdUtils.hasClientSuffix(idString) && clientId) {
      const extractedClientId = runIdUtils.extractClientId(idString);
      if (extractedClientId !== clientId) {
        throw new Error(`Run ID has mismatched client ID: ${extractedClientId} vs ${clientId}`);
      }
    }
    
    this.baseId = runIdUtils.getBaseRunId(idString);
    this.clientId = clientId || runIdUtils.extractClientId(idString) || null;
  }
  
  toString(): string {
    if (!this.clientId) return this.baseId;
    return runIdUtils.addClientSuffix(this.baseId, this.clientId);
  }
  
  getBaseId(): string {
    return this.baseId;
  }
  
  getClientId(): string {
    return this.clientId;
  }
}
```

### 3. Persistent ID Mapping

Store mappings between various ID formats:

```javascript
// ID mappings table/collection:
{
  "standardId": "SR-250924-001-T1234-S1-CGuy-Wilson",
  "baseId": "SR-250924-001-T1234-S1",
  "clientId": "Guy-Wilson",
  "externalIds": {
    "apify": "8MSTBAfqMzuXPvgB3"
  },
  "metadata": {
    "startTime": "2025-09-24T12:34:56Z",
    "type": "postharvest"
  }
}
```

## Implementation Plan

1. **Phase 1**: Implement improved runIdUtils (current PR)
2. **Phase 2**: Create runIdService with standardized generation
3. **Phase 3**: Add persistent ID mapping
4. **Phase 4**: Transition to RunId class (TypeScript migration)

## Benefits

1. **Consistency**: All run IDs follow a standard pattern
2. **Reliability**: Reduced bugs from string manipulation
3. **Traceability**: Better tracking of runs across services
4. **Performance**: Fewer cache misses and lookup failures

## Conclusion

While our immediate fix resolves the double suffix issue, a more comprehensive approach would address the underlying architecture to prevent similar issues in the future. This proposal aims to create a more robust system for handling run IDs in our multi-tenant environment.