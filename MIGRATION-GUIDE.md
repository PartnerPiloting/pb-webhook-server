# Migration Guide: Moving to Clean Architecture

This document provides a step-by-step guide for migrating from the original LinkedIn Lead Management System to the new clean architecture implementation.

## Migration Strategy

We'll use a "big bang" migration approach where we replace the old implementation with the new architecture in a single deployment. This approach is suitable because:

1. We only have one active client currently
2. We want a clean break from the old code structure
3. Both systems can coexist during testing

## Prerequisites

Before starting the migration:

1. Ensure all environment variables are set up
2. Verify access to all required Airtable bases
3. Confirm AI service API keys are valid
4. Create a backup of the current state of all databases

## Migration Steps

### 1. Preparation Phase

- [ ] Deploy the new clean architecture code alongside the existing code
- [ ] Verify that the new system is initialized correctly by checking logs
- [ ] Run the test scripts to confirm functionality:
  ```bash
  node src/tests/test-run-record-service.js <clientId>
  node src/tests/test-lead-scoring-service.js <clientId>
  node src/tests/test-post-harvesting-service.js <clientId>
  node src/tests/test-post-scoring-service.js <clientId>
  node src/tests/test-workflow-orchestrator.js single <clientId> --dry-run
  ```

### 2. Validation Phase

- [ ] Run the new system in parallel with the old system in dry-run mode:
  ```bash
  node src/runner.js --client <clientId> --dry-run
  ```
- [ ] Compare outputs and logs between the old and new systems
- [ ] Verify that the new system's run records are created correctly
- [ ] Validate that error handling works as expected

### 3. Migration Phase

- [ ] Stop all scheduled jobs for the old system
- [ ] Make a final backup of all databases
- [ ] Run the new system with a single client:
  ```bash
  node src/runner.js --client <clientId>
  ```
- [ ] Verify results in Airtable:
  - Check that lead scores are updated correctly
  - Confirm that run records are created with the right status
  - Validate that error logging is working

### 4. Scale-Up Phase

- [ ] Schedule the new system to run regularly:
  ```bash
  # Example cron job
  0 */6 * * * cd /path/to/app && node src/runner.js --all >> /path/to/logs/workflow-$(date +\%Y\%m\%d).log 2>&1
  ```
- [ ] Monitor the first few scheduled runs to ensure stability
- [ ] Set up monitoring and alerts for the new system

## Rollback Plan

If issues are encountered during migration:

1. Stop the new system
2. Reactivate the old system's scheduled jobs
3. Investigate issues using logs and run records
4. Fix issues in the new system
5. Re-attempt migration when ready

## Monitoring During Migration

During the migration process, closely monitor:

1. Run records in the Master base
2. Error logs in the application
3. CPU and memory usage on the server
4. Airtable API usage and rate limits
5. AI service token consumption

## Airtable Data Validation

Verify data integrity after migration:

- [ ] Lead records have correct scores and statuses
- [ ] Run records show successful execution
- [ ] Post harvesting is tracking correctly
- [ ] Post scoring results are being saved

## Post-Migration Tasks

After successful migration:

- [ ] Archive the old implementation code
- [ ] Update documentation to reference the new architecture
- [ ] Review and optimize performance based on initial runs
- [ ] Plan for onboarding additional clients

## Key Changes to Be Aware Of

Here are the key differences between the old and new implementations:

1. **File Structure**: Complete reorganization into domain/infrastructure layers
2. **Command Line Interface**: New runner.js with different command line options
3. **Run Records**: Using a "Create once, update many" pattern for tracking execution
4. **Error Handling**: More structured approach with consistent error reporting
5. **Service Boundaries**: Clearer separation between lead scoring, post harvesting, and post scoring
6. **Testing**: Dedicated test scripts for each component

## Support

For assistance during migration:

- **Technical Contact**: [Your Name]
- **Documentation**: See CLEAN-ARCHITECTURE-DOCUMENTATION.md for details
- **Logs**: Check /path/to/logs for execution logs
- **Monitoring**: [Monitoring Service URL]