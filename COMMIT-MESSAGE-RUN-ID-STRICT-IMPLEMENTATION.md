# Implement Strict Single-Source-of-Truth for Run IDs

## Problem
Inconsistent run ID handling throughout the codebase was causing "Job tracking record not found" errors. Run IDs were being regenerated or normalized at different points in the code flow, breaking the connection between related processes.

## Solution
Implemented a strict single-source-of-truth pattern for run IDs to ensure they're generated once and passed unchanged throughout the system:

1. Removed the legacy `generateRunId()` function in favor of direct `generateTimestampRunId()` usage
2. Updated `normalizeRunId()` to preserve compound IDs with special handling
3. Modified all code paths to maintain consistent run ID handling
4. Added error-throwing implementation to identify any remaining legacy code

## Files Changed
- services/unifiedRunIdService.js - Core run ID handling functions
- routes/apifyProcessRoutes.js - Main process routes with run ID handling
- services/jobTracking.js - Job tracking service
- routes/apiAndJobRoutes.js - API routes for job management
- routes/apifyWebhookRoutes.js - Webhook handlers
- scripts/smart-resume-client-by-client.js - Smart resume script
- services/jobOrchestrationService.js - Job orchestration service
- RUN-ID-SINGLE-SOURCE-OF-TRUTH.md - Updated with migration guide

## Testing
This change should eliminate "Job tracking record not found" errors by ensuring that:
1. Run IDs are generated once at the beginning of a process
2. The same run ID is used throughout the entire process lifecycle
3. Run IDs are preserved in their original format when passed between systems
4. Any remaining legacy code will throw explicit errors rather than silently failing

## Additional Notes
This is a breaking change that enforces stricter architectural patterns. Any code still using the legacy `generateRunId()` function will now throw errors with detailed stack traces to aid in migration.