# Fix Post Scoring Issues (Phase 2)

## Additional Problems Found
1. **Quote Inconsistencies**: Airtable formulas were using inconsistent quote styles (single vs double) causing filter failures
2. **Date Posts Scored Updates**: The Date Posts Scored field wasn't consistently updating despite other fields updating successfully

## New Root Causes Identified
1. **Formula Quote Handling**: Airtable requires specific quote formatting in filterByFormula parameters
2. **Formula Transformation**: Formula strings weren't being consistently normalized before use
3. **Field Name Resolution**: Inconsistent handling of field name references across different client bases

## Additional Changes Made
1. **Enhanced Quote Normalization**: Improved the `ensureFormulaQuotes` helper function to systematically normalize all formulas
2. **Formula Coverage**: Applied helper function to all formula construction points in postBatchScorer.js
3. **Expanded Debugging**: Added `[POST_DEBUG]` tags and detailed formula transformation logging
4. **Quote Detection**: Added regex patterns to detect and normalize string literals in complex formulas

## Complete Fix Commit Message
```
fix(post-scoring): Fix quote handling in Airtable formulas

- Enhance ensureFormulaQuotes helper function for consistent quote normalization 
- Apply helper to all formula construction points in postBatchScorer.js
- Fix actionedGuard and dateClause formula construction
- Add debugging for formula transformations with [POST_DEBUG] tags
- Add BLANK() function normalization
- Fix formula string literal handling

This resolves issues with Date Posts Scored field not updating properly due to 
quote format inconsistencies in Airtable formulas.
```

## Testing
These changes have been tested across multiple client bases to ensure consistent quote handling across different Airtable formulas and field naming conventions.