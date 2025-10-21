# Structured Run ID System for PB-Webhook-Server

## Environment Variables for Structured Logging

The PB-Webhook-Server implements a structured run ID system to enable efficient log filtering and tracking in Render. The system uses the following environment variables to customize run IDs:

### Primary Environment Variables

```
DEBUG_STREAM=<number>      # Stream identifier (e.g., 1, 2, 3)
DEBUG_CLIENT=<client_code> # Client identifier (e.g., ABC, XYZ)
DEBUG_ISSUE=<issue_type>   # Issue or operation type (e.g., POSTS, LEADS, SCORE)
```

### Run ID Format

The structured format follows: `SR-YYMMDD-NNN-SSTREAM-CCLIENT-ISSUE`

Example: `SR-250922-001-S2-CABC-POSTS`

Components:
- `SR`: Smart Resume prefix (constant)
- `YYMMDD`: Date in YY/MM/DD format
- `NNN`: Sequential daily run number (auto-incremented)
- `SSTREAM`: Stream identifier (`S` + `DEBUG_STREAM` value)
- `CCLIENT`: Client identifier (`C` + `DEBUG_CLIENT` value)
- `ISSUE`: Operation type (direct `DEBUG_ISSUE` value)

### Usage Examples

#### Example 1: Running with all identifiers
```bash
DEBUG_STREAM=2 DEBUG_CLIENT=ABC DEBUG_ISSUE=POSTS node scripts/smart-resume-client-by-client.js
```
Generates run ID like: `SR-220925-001-S2-CABC-POSTS`

#### Example 2: Stream-specific run
```bash
DEBUG_STREAM=3 node scripts/smart-resume-client-by-client.js
```
Generates run ID like: `SR-220925-002-S3`

#### Example 3: Client-specific run
```bash
DEBUG_CLIENT=XYZ DEBUG_ISSUE=LEADS node scripts/smart-resume-client-by-client.js
```
Generates run ID like: `SR-220925-003-CXYZ-LEADS`

### Log Filtering in Render

These structured IDs enable powerful filtering in Render logs:

1. **Filter by date**: Search for `SR-250922` to find all runs on September 25, 2022
2. **Filter by stream**: Search for `-S2` to find all runs for stream 2
3. **Filter by client**: Search for `-CXYZ` to find all runs for client XYZ
4. **Filter by issue**: Search for `-POSTS` to find all post-processing runs
5. **Filter by run number**: Search for `SR-250922-003` to find the third run on September 25, 2022

### Issue Type Reference

Common values for `DEBUG_ISSUE`:
- `LEADS`: Lead data processing/scoring
- `POSTS`: LinkedIn post processing
- `SCORE`: General scoring operations
- `BATCH`: Default batch operations
- `RESYNC`: Data resynchronization
- `AUDIT`: System auditing operations
- `REPAIR`: Data repair operations

### Implementation Notes

1. All environment variables are optional and will be omitted from the run ID if not provided
2. The system maintains a counter file (.run-counter.json) to track sequential run numbers per day
3. Log messages are automatically prefixed with the generated run ID
4. When no environment variables are specified, a minimal run ID is generated (e.g., `SR-250922-001`)

### Technical Integration

The run ID system is implemented in `utils/runIdGenerator.js` and automatically integrated into the smart resume script. The main functions are:

- `generateRunId()`: Creates the structured ID based on environment variables
- `createLogger(runId)`: Returns a logging function that prefixes all messages with the run ID

For more details, refer to RUN-ID-SYSTEM.md in the repository.