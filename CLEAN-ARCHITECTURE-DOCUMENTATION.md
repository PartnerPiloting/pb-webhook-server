# LinkedIn Lead Management System: Clean Architecture

## Overview

This document describes the clean architecture implementation of the LinkedIn Lead Management System. This architecture replaces the original implementation with a modular, maintainable, and testable design following domain-driven design principles.

## Architecture Layers

The system is organized into the following layers:

```
src/
├── domain/
│   ├── models/
│   │   ├── constants.js
│   │   ├── runIdGenerator.js
│   │   └── validators.js
│   └── services/
│       ├── leadScoringService.js
│       ├── postHarvestingService.js
│       ├── postScoringService.js
│       ├── runRecordService.js
│       └── workflowOrchestrator.js
├── infrastructure/
│   ├── ai/
│   │   └── aiService.js
│   ├── airtable/
│   │   ├── airtableClient.js
│   │   └── airtableRepository.js
│   └── logging/
│       └── logger.js
├── tests/
│   ├── test-lead-scoring-service.js
│   ├── test-post-harvesting-service.js
│   ├── test-post-scoring-service.js
│   ├── test-run-record-service.js
│   └── test-workflow-orchestrator.js
└── runner.js
```

### Domain Layer

The domain layer contains the business logic and rules of the system:

- **Models**: Core business entities and logic
  - `constants.js`: Single source of truth for all constants
  - `validators.js`: Business rule validation
  - `runIdGenerator.js`: Generates unique run IDs

- **Services**: Core business operations
  - `leadScoringService.js`: Handles scoring of leads using AI
  - `postHarvestingService.js`: Manages LinkedIn post harvesting
  - `postScoringService.js`: Scores harvested posts using AI
  - `runRecordService.js`: Manages run records
  - `workflowOrchestrator.js`: Orchestrates the complete workflow

### Infrastructure Layer

The infrastructure layer provides technical capabilities:

- **AI**: AI service integrations
  - `aiService.js`: Unified interface for Gemini and OpenAI

- **Airtable**: Database access
  - `airtableClient.js`: Multi-tenant connection management
  - `airtableRepository.js`: Unified data access

- **Logging**: Structured logging
  - `logger.js`: Consistent logging across services

### Entry Point

- `runner.js`: Command-line interface for executing the workflow

## Key Design Patterns

### Dependency Injection

All services accept dependencies through their constructor, making them easier to test and replace.

Example:
```javascript
constructor(options = {}) {
  this.airtableClient = options.airtableClient;
  this.aiService = options.aiService;
}
```

### Repository Pattern

Data access is abstracted through the repository pattern:
```javascript
// Instead of direct Airtable access:
const leads = await base('Leads').select().all();

// We use a repository:
const leads = await repository.findRecords('Leads', query);
```

### Single Responsibility Principle

Each service has a single responsibility:
- `LeadScoringService`: Only handles lead scoring
- `PostHarvestingService`: Only handles post harvesting
- `PostScoringService`: Only handles post scoring

### Command Query Responsibility Segregation (CQRS)

Operations are separated into commands (writes) and queries (reads):
```javascript
// Command (write)
await repository.updateRecord('Leads', leadId, { Status: 'Completed' });

// Query (read)
const leads = await repository.findRecords('Leads', { view: 'All Leads' });
```

### Unit of Work Pattern

The workflow orchestrator manages a complete unit of work, ensuring consistency across operations.

## Multi-Tenant Support

The system supports multi-tenancy through:

1. **Dynamic base connection**:
```javascript
const clientBase = await airtableClient.getClientBase(clientId);
```

2. **Client validation**:
```javascript
const client = await validateClient(clientId, { repository });
```

3. **Service level enforcement**:
```javascript
if (!shouldHarvestPosts(client)) {
  throw new Error(`Client ${clientId} not eligible for post harvesting`);
}
```

## Error Handling

The architecture uses a consistent error handling pattern:

```javascript
try {
  // Operation
} catch (error) {
  logger.error(`Operation failed: ${error.message}`);
  // Update status if needed
  await runRecordService.updateRunRecord(runId, {
    status: STATUS.FAILED,
    message: error.message
  });
  // Return structured error
  return { status: STATUS.FAILED, errors: [error.message] };
}
```

## Run Records

The system uses a "Create once, update many" pattern for run records:

1. **Create on start**:
```javascript
await runRecordService.createOrUpdateRunRecord(runId, {
  status: STATUS.IN_PROGRESS,
  operation: 'lead_scoring'
});
```

2. **Update on completion**:
```javascript
await runRecordService.updateRunRecord(runId, {
  status: STATUS.COMPLETED,
  additionalData: { leadsProcessed: 10 }
});
```

## Testing

Each service includes a corresponding test script:
- `test-lead-scoring-service.js`
- `test-post-harvesting-service.js`
- `test-post-scoring-service.js`
- `test-run-record-service.js`
- `test-workflow-orchestrator.js`

Tests can run with mock dependencies or real services.

## Running the System

The system can be executed using the command-line interface:

```bash
# Process a single client
node src/runner.js --client recXYZ123

# Process all active clients
node src/runner.js --all

# Test mode (no actual changes)
node src/runner.js --client recXYZ123 --dry-run

# Limit processing to a subset of leads
node src/runner.js --client recXYZ123 --limit 10
```

## Benefits Over Previous Implementation

1. **Separation of Concerns**: Each service has a single responsibility
2. **Testability**: Services can be tested in isolation
3. **Maintainability**: Clean separation of layers makes it easier to understand and modify
4. **Reusability**: Components can be reused in other contexts
5. **Error Isolation**: Failures in one component don't affect others
6. **Consistent Patterns**: Standardized approach to logging, error handling, and data access

## Migration Strategy

The new architecture has been implemented in parallel with the existing system. The migration will be a "big bang" approach, switching from the old system to the new architecture in a single deployment since we only have one active client.

## Conclusion

This clean architecture provides a solid foundation for the LinkedIn Lead Management System, enabling easier maintenance, testing, and future enhancements.