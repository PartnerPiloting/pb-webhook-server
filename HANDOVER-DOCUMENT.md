# PB-Webhook-Server Handover Document

## Project Overview & Business Logic

The PB-Webhook-Server is a multi-tenant LinkedIn lead management system with AI-powered scoring capabilities. It serves as the central backend for collecting, processing, and analyzing LinkedIn leads for multiple clients.

### Core Business Logic

1. **Multi-Tenant Architecture**: Each client has their own isolated data in separate Airtable bases
   - Master "Clients" base contains client registry
   - Individual client bases follow naming pattern `My Leads - [Client Name]`

2. **Lead Processing Pipeline**:
   - Receive raw leads from LinkedIn via webhooks
   - Process and normalize lead data with field mapping
   - Score leads using AI models (Gemini primary, OpenAI backup)
   - Track job execution metrics for debugging and billing

3. **Post Scoring Integration**:
   - Added post content analysis capability that scores LinkedIn posts
   - Maintains consistent metrics tracking across scoring operations
   - Integrates with Apify for LinkedIn post scraping

## Recent Development Focus

We've been focusing on improving service stability and system robustness through several key initiatives:

1. **Service Boundary Definition**:
   - Clearly separating multi-tenant concerns
   - Ensuring proper client isolation

2. **Run Record Standardization**:
   - Normalizing run IDs consistently across the system
   - Preventing duplication of client run records

3. **Error Handling Improvements**:
   - Better logging with structured data
   - Safer function parameter handling
   - Proper error isolation between clients

## Issues Addressed in Current Work

### 1. Logger Instantiation Issues

**Problem**: Direct instantiation of `StructuredLogger` with null parameters was leading to inconsistent logging and potential errors.

**Solution**: 
- Replaced direct `StructuredLogger` instantiations with `createSafeLogger`
- This ensures proper validation of parameters before logger creation
- Prevents null pointer exceptions in logging code

### 2. Field Name Casing Inconsistencies

**Problem**: Inconsistent field name casing (e.g., `status` vs `Status`) was causing field mismatches with Airtable.

**Solution**:
- Standardized field name casing in the codebase
- Updated `postScoringMetricsHelper.js` to use proper field casing
- Ensured consistent return structures in API responses

### 3. Undefined normalizedRunId References

**Problem**: Some code paths were attempting to use `normalizedRunId` before it was defined, leading to runtime errors.

**Solution**:
- Added null checks before accessing `normalizedRunId`
- Implemented fallback values when `normalizedRunId` might be undefined
- Fixed issues in `postBatchScorer.js` and `apifyWebhookRoutes.js`

### 4. Metric Structure Inconsistencies

**Problem**: Inconsistent return structures from metrics helpers made error handling unreliable.

**Solution**:
- Standardized return structures in `postScoringMetricsHelper.js`
- Added `Status` field with consistent casing
- Ensured both success and error cases return consistent objects

## Ongoing Concerns

1. **Service Robustness**:
   - Continue monitoring for null parameter handling throughout the codebase
   - Ensure all API endpoints properly validate client IDs from headers

2. **Airtable Field Name Synchronization**:
   - Maintain vigilance around field name casing issues
   - Consider a field name validation system during startup

3. **Error Handling in Multi-Tenant Operations**:
   - Continue improving isolation of client errors
   - Ensure errors in one client don't affect others

## Testing Recommendations

When testing the system, focus on these key areas:

1. **Multi-Client Operations**:
   - Test with multiple clients simultaneously
   - Verify proper client isolation

2. **Error Recovery**:
   - Test system behavior when Airtable operations fail
   - Verify AI scoring fallback mechanisms work correctly

3. **Job Tracking**:
   - Confirm run records are created without duplication
   - Check metrics are properly updated throughout job execution

## Next Steps

1. Complete thorough testing with production-like data volumes
2. Monitor Render deployment logs for any remaining error patterns
3. Consider implementing additional validation for client-specific operations
4. Continue standardizing return structures across all service functions

## Documentation Links

For deeper context:
- `SYSTEM-OVERVIEW.md` - Complete architecture overview
- `BACKEND-DEEP-DIVE.md` - Technical implementation details
- `DEV-RUNBOOK.md` - Development workflow guide
- `MULTI-TENANT-ARCHITECTURE.md` - Details on client isolation