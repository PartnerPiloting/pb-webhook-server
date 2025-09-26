# Standardized Parameter Pattern Guide

## Overview

This document describes the standardized parameter pattern implemented across the codebase, specifically focusing on the run record management system. This architectural pattern improves code consistency, readability, and maintainability.

## The Pattern

All service functions now accept a **single object parameter** with named properties instead of multiple positional parameters.

### Example:

```javascript
// OLD STYLE (positional parameters)
createRunRecord(runId, clientId, clientName, options);

// NEW STYLE (object parameter)
createRunRecord({
  runId: 'SR-250924-001-T3304',
  clientId: 'Client-A',
  clientName: 'Client A Name',
  options: { source: 'workflow' }
});
```

## Benefits

1. **Self-documenting calls**: Function calls explicitly name each parameter
2. **Order independence**: Parameters can be provided in any order
3. **Optional parameters**: Easy to omit optional parameters without confusion
4. **Extensibility**: New parameters can be added without breaking existing code
5. **Consistency**: All functions follow the same pattern
6. **IDE support**: Better autocomplete and type checking

## Implementation

### Core Modules Using This Pattern

- `services/runRecordAdapterSimple.js`
- `services/runRecordServiceV2.js`

### Backward Compatibility

While we're transitioning to this new pattern, all functions maintain backward compatibility by checking parameter types and handling both old-style and new-style calls:

```javascript
function someFunction(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: someFunction(param1, param2, param3)
    const param1 = arguments[0];
    const param2 = arguments[1];
    const param3 = arguments[2];
    
    // Convert to new format
    return someFunction({ param1, param2, param3 });
  }
  
  // New style using object parameters
  const { param1, param2, param3 } = params;
  // Function implementation...
}
```

## Migration Guide

### For Existing Code

Existing code will continue to work thanks to backward compatibility. However, we encourage updating to the new pattern when making changes:

```javascript
// CHANGE FROM:
updateRunRecord(runId, clientId, updates, { source: 'workflow' });

// TO:
updateRunRecord({
  runId: runId,
  clientId: clientId,
  updates: updates,
  options: { source: 'workflow' }
});
```

### For New Code

All new code should use the object parameter pattern exclusively:

```javascript
createClientRunRecord({
  runId: generatedRunId,
  clientId: client.id,
  clientName: client.name,
  options: {
    source: 'new_workflow',
    logger: customLogger
  }
});
```

## Common Parameter Objects

### RunRecordParams

```typescript
/**
 * @typedef {Object} RunRecordParams
 * @property {string} runId - The run identifier
 * @property {string} clientId - The client identifier
 * @property {string} [clientName] - Optional client name (will be looked up if not provided)
 * @property {Object} [options] - Additional options
 * @property {Object} [options.logger] - Logger instance
 * @property {string} [options.source] - Source of the operation
 */
```

### RunRecordMetrics

```typescript
/**
 * @typedef {Object} RunRecordMetrics
 * @property {number} [totalPosts] - Total posts harvested
 * @property {number} [apiCosts] - API costs
 * @property {string} [apifyRunId] - Apify run identifier
 * @property {number} [profilesSubmitted] - Profiles submitted count
 */
```

## Best Practices

1. Use destructuring to extract parameters at the top of the function
2. Provide default values for optional parameters
3. Use JSDoc to document the parameter object structure
4. For large objects, extract type definitions to make them reusable

---

Document Version: 1.0  
Last Updated: September 26, 2025