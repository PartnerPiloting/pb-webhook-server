# Architecture Decision Record: Clean Architecture Implementation

## Context

This document explains the architecture decisions made in the clean architecture implementation for the PB-Webhook-Server project, a multi-tenant LinkedIn lead management system with AI-powered scoring. This serves as a reference for current and future developers who work on this codebase.

## Clean Architecture Implementation

We have implemented a pragmatic approach to clean architecture, separating our codebase into the following layers:

1. **Domain Layer** (`src/domain/`)
   - Contains business rules and entities
   - Domain logic is independent of external services or frameworks
   - Located in `models/`, `services/` and other domain-specific directories

2. **Application Layer** (`src/application/`)
   - Orchestrates the flow between domain and infrastructure
   - Contains use cases and service coordination
   - Examples: `workflowOrchestrator.js`

3. **Infrastructure Layer** (`src/infrastructure/`)
   - Implements interfaces to external systems and services
   - Examples: `airtable/`, `ai/`, `logging/`

4. **Presentation Layer** (`routes/`)
   - Exposes the API endpoints
   - Handles request/response formatting and validation

## Pragmatic Architecture Decisions

### 1. Domain Layer Dependencies on Infrastructure

In some cases, the domain layer has direct dependencies on infrastructure components, such as:

```javascript
// In domain/models/validators.js
const { FIELDS } = require('../../infrastructure/airtable/schema');
```

**Decision**: We chose to allow this dependency for pragmatic reasons:
- The project is already in production and used by multiple clients
- The field mappings are stable and unlikely to change frequently
- Introducing abstractions would add complexity without providing significant benefits in the short term

**Long-term plan**: If the application grows significantly or we need to support multiple data stores, we will revisit this decision and introduce proper abstractions.

### 2. Direct References to Airtable Fields

In parts of the domain layer, there are direct references to Airtable field names rather than domain abstractions.

**Decision**: We've moved field names to a centralized `schema.js` file to improve maintainability while keeping the codebase pragmatic. This strikes a balance between clean architecture principles and practical implementation.

### 3. Status Management

Status management is implemented with explicit transition maps rather than a full state machine pattern:

```javascript
// In validators.js
const transitionMaps = {
  RUN_RECORD: {
    [STATUS.RUN_RECORD.RUNNING]: [STATUS.RUN_RECORD.COMPLETED, STATUS.RUN_RECORD.FAILED, STATUS.RUN_RECORD.PARTIAL],
    [STATUS.RUN_RECORD.COMPLETED]: [], // Terminal state
    [STATUS.RUN_RECORD.FAILED]: [], // Terminal state
    [STATUS.RUN_RECORD.PARTIAL]: [STATUS.RUN_RECORD.COMPLETED, STATUS.RUN_RECORD.FAILED]
  },
  // Other process types...
}
```

**Decision**: We chose this approach because it's:
- Easy to understand and modify
- Sufficient for our current needs
- Self-documenting in terms of allowed transitions

### 4. Testing Strategy

We've implemented targeted tests for critical components rather than comprehensive test coverage:

**Decision**: We prioritized tests for business-critical functions like validators to ensure proper error handling and domain rule enforcement. This ensures that the core business rules are properly tested while avoiding excessive testing overhead.

## Future Considerations

1. **Field Abstraction**: If we need to support multiple data stores in the future, introduce a domain-level abstraction for field mappings.

2. **Domain Events**: Consider implementing domain events to further decouple the layers.

3. **Test Coverage**: Gradually increase test coverage for all domain components.

4. **Dependency Inversion**: Implement proper dependency inversion where domain services require infrastructure capabilities.

## Conclusion

Our clean architecture implementation follows a pragmatic approach that balances theoretical purity with practical concerns. As the application evolves, we can refine the architecture further in line with clean architecture principles while maintaining a maintainable and efficient codebase.