# PB-Webhook Server Context for Next Chat

## Project Overview

This is a multi-tenant LinkedIn lead management system with three core processes:

1. **Lead Scoring**: AI evaluation of LinkedIn profiles
2. **Post Harvesting**: Retrieval of LinkedIn posts via Apify
3. **Post Scoring**: AI evaluation of LinkedIn posts

These processes were originally separate but have been amalgamated into a client-by-client workflow orchestrated by `scripts/smart-resume-client-by-client.js`.

## System Architecture

- **Backend**: Node.js/Express API server
- **Frontend**: Next.js React app (in linkedin-messaging-followup-next directory)
- **Data Storage**: Airtable with multi-tenant design
  - Master Clients base - Client registry
  - Client-specific bases - Each client's lead data
- **AI Services**: Google Gemini (primary) + OpenAI (fallback)

## Recent Refactoring: Run Record Simplification

### Problem Addressed
The run record tracking system was overly complex (600+ lines) with duplicate record creation, complex fallback mechanisms, and circular dependencies.

### Solution Implemented
We've simplified to a "Create once, update many, error if missing" pattern:
- **airtableServiceSimple.js**: Direct Airtable operations (~250 lines)
- **runRecordAdapterSimple.js**: Clean adapter enforcing the pattern

### Current Implementation Status
- ✅ Created simplified service and adapter
- ✅ Updated smart-resume-client-by-client.js to use new adapter
- ✅ Updated batchScorer.js to use new adapter
- ✅ Modified apifyProcessRoutes.js to remove record creation
- ✅ Created test script for validating changes

## Current Issues to Address

1. **Status Field Inconsistencies**:
   - Different status values: `'Success'` vs `'Completed'`
   - Need to standardize across codebase

2. **Documentation Gaps**:
   - No field reference for run record tables
   - Need to document all Airtable fields and valid values

3. **System Testing**:
   - Need comprehensive testing of all processes with the new adapter

4. **Code Cleanup**:
   - Multiple adapter implementations cause confusion
   - Need to remove deprecated code after testing

## Files to Focus On

- **scripts/smart-resume-client-by-client.js**: Main orchestrator
- **batchScorer.js**: Lead scoring engine
- **routes/apifyProcessRoutes.js**: Post harvesting handler
- **services/runRecordAdapterSimple.js**: Simplified adapter
- **services/airtableServiceSimple.js**: Core implementation

## Testing Approach

1. Use `test-smart-resume-with-simple-adapter.js` to test with limited clients
2. Verify records in Airtable match expectations
3. Check for any errors or inconsistencies in status values

## Next Steps

1. Address status field inconsistencies 
2. Create documentation for all Airtable fields
3. Complete system testing
4. Remove deprecated adapter implementations
5. Standardize naming conventions