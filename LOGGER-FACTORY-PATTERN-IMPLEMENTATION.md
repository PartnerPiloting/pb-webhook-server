# Root Cause Fix: Unified Logger Factory Pattern

## Problem

The application was experiencing critical errors with messages like:

```
CRITICAL ERROR: Object passed as sessionId to StructuredLogger constructor
```

This was causing issues in the log output, as objects were being stringified to `[object Object]` instead of proper session identifiers.

## Root Cause

1. **Direct Instantiation**: The application had numerous instances of direct `new StructuredLogger()` calls without proper parameter validation.
   
2. **Multiple Creation Patterns**: Three competing patterns for logger creation:
   - Direct instantiation with `new StructuredLogger()`
   - Helper functions in `loggerHelper.js`
   - Factory methods in `loggerFactory.js`
   
3. **Inconsistent Parameter Validation**: Each approach handled parameter validation differently or not at all.

## Solution: Unified Logger Factory Pattern

We implemented a comprehensive solution following the Single Source of Truth pattern:

1. **Created `unifiedLoggerFactory.js`**: A central factory for all logger creation with robust parameter validation.

2. **Eliminated Competing Patterns**: Replaced all helper modules with direct exports from the unified factory.

3. **Added Warning Messages**: Modified the `StructuredLogger` constructor to warn about direct instantiation.

4. **Updated Code References**: Modified all direct instantiations to use the unified factory instead.

## Benefits

1. **Single Source of Truth**: One definitive way to create loggers
2. **Consistent Parameter Validation**: All loggers created with proper validation
3. **Clean Architecture**: Simplified maintenance with a single pattern
4. **Clear Warnings**: Any remaining direct instantiations will emit clear warnings

## Usage

Old pattern (deprecated):
```javascript
const logger = new StructuredLogger(clientId, sessionId, processType);
```

New pattern (correct):
```javascript
const { createLogger } = require('./utils/unifiedLoggerFactory');
const logger = createLogger(clientId, sessionId, processType);
```

## Other Factory Methods

- **createSystemLogger**: For system-wide operations (`'SYSTEM'` clientId)
- **createClientLogger**: For client-specific operations
- **createProcessLogger**: For process-specific operations
- **getOrCreateLogger**: Utility to use existing logger or create a new one

## Validation Logic

The unified factory implements robust validation:
- Objects are properly handled with property extraction (clientId, runId)
- Null/undefined values are replaced with appropriate defaults
- Non-string values are safely converted to strings