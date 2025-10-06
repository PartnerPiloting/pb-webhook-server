# PB-Webhook-Server Run Tracking System Implementation

## Current Context
- We've successfully implemented and verified the structured run ID system (format: SR-YYMMDD-NNN-SSTREAM-CCLIENT-ISSUE)
- Fixed cron job issue by changing from direct script execution to API call
- Confirmed run IDs are incrementing properly (SR-250922-001 → SR-250922-002)
- Current branch: staging
- Planning to create a new feature branch: `feature/run-tracking-system`

## Airtable Table Structure

### 1. Job Tracking Table
**Purpose**: Master table to track all run executions and their overall results
**Fields**:
- `Run ID` (Primary Field, Text): The structured run ID (e.g., SR-250922-002-S1-CGuy-Wilson)
- `Start Time` (DateTime): When the job started
- `End Time` (DateTime): When the job completed
- `Duration` (Formula, minutes): Calculated from start/end times
- `Status` (Single Select): "Running", "Completed", "Failed"
- `Stream` (Number): The stream identifier
- `Total Clients` (Number): Count of clients processed
- `Successful Clients` (Number): Count of clients processed without errors
- `Failed Clients` (Number): Count of clients with errors
- `Success Rate` (Formula): Percentage of successful clients
- `Total Leads` (Number): Aggregate count of all leads processed
- `Successful Leads` (Number): Count of leads successfully processed
- `Failed Leads` (Number): Count of leads that failed processing
- `Lead Success Rate` (Formula): Percentage of successful leads
- `Error Details` (Long Text): Any overall job errors
- `Triggered By` (Single Select): "Cron", "Manual", "API"
- `Notes` (Long Text): Any additional context about this run

### 2. Client Run Results Table
**Purpose**: Detailed tracking of each client's processing results in each run
**Fields**:
- `Run ID` (Text): Foreign key to Job Tracking table
- `Client ID` (Text): Client identifier
- `Client Name` (Text): Human-readable client name
- `Start Time` (DateTime): When this client's processing started
- `End Time` (DateTime): When this client's processing completed
- `Duration` (Formula, minutes): Calculated processing time
- `Status` (Single Select): "Running", "Completed", "Failed"
- `Total Leads` (Number): Count of leads processed for this client
- `Successful Leads` (Number): Count of leads successfully processed
- `Failed Leads` (Number): Count of leads that failed processing
- `Lead Success Rate` (Formula): Percentage of successful leads
- `AI Tokens Used` (Number): Total AI token consumption
- `Average Tokens Per Lead` (Formula): AI efficiency metric
- `Error Details` (Long Text): Any client-specific errors
- `Notes` (Long Text): Additional context

## Integration Points
- `utils/runIdGenerator.js`: Already generates run IDs, will need to create tables
- `services/airtableService.js`: New file for Airtable tracking operations
- `scripts/smart-resume-client-by-client.js`: Update to record metrics at start/end
- `services/leadService.js`: Update to record lead-specific metrics

## Next Steps
1. Create feature branch `feature/run-tracking-system` from staging
2. Create Airtable tables in Master Clients base
3. Implement tracking code integration
4. Enhance email reporting with tracking data
5. Test the system end-to-end
6. Prepare for code review and merge

## Technical References
- The run ID system is defined in `utils/runIdGenerator.js`
- Main processing happens in `scripts/smart-resume-client-by-client.js`
- Environment variables: DEBUG_STREAM, DEBUG_CLIENT, DEBUG_ISSUE

## Multi-Tenant Considerations
- Job Tracking table belongs in Master Clients base
- Client Run Results respects multi-tenant architecture
- Each client metrics isolated but linked to master tracking

## Documentation Updates
- Update `RUN-ID-SYSTEM.md` to include job tracking details
- Document the table structure in Airtable
- Update operational guides to include monitoring of run tracking