# Airtable Field Name Fixes Summary

The following fixes were implemented to address field name inconsistencies causing errors in the logs:

## 1. Source Field

The code was trying to write to a non-existent 'Source' field. This was fixed by:

1. In `leadService.js`:
   - Replaced direct 'Source' field updates with writing to 'System Notes' instead
   - Added logic to include source information in a formatted string

2. In Next.js frontend (`api.js`):
   - Created a patch file to guide manual modification of this file
   - Modified field mappings to remove 'Source' references
   - Added logic to append source information to 'System Notes'
   - Kept the source property in JS objects for backward compatibility

## 2. Recovery Note Field

The 'Recovery Note' field was already fixed in the codebase - all instances now properly use 'System Notes'.

## 3. Jobs Started Field

The 'Jobs Started' field was already fixed in the codebase - information is stored in 'System Notes' instead.

## 4. completed_with_errors Status

The code was trying to use a select option that doesn't exist in the Airtable schema. Fixed by:

1. In `postBatchScorer.js`:
   - Changed `completed_with_errors` to `Failed`
   - Updated comments referencing this status

2. In `airtableServiceAdapter.js`:
   - Updated status mapping to use `Completed` and `Failed` which exist in the schema

3. In `apiAndJobRoutes.js`:
   - Updated comments referencing this status

## Testing

These changes should resolve the errors seen in the logs:

1. ✅ `Unknown field name: "Source"` - Fixed by using 'System Notes' instead
2. ✅ `Unknown field name: "Recovery Note"` - Already fixed in codebase
3. ✅ `Unknown field name: "Jobs Started"` - Already fixed in codebase
4. ✅ `Insufficient permissions to create new select option ""completed_with_errors""` - Fixed by using 'Failed'

## Notes for Implementation

1. The Next.js frontend modifications should be carefully tested after applying the patch
2. Consider documenting the valid field names in a central location to prevent future issues
3. Monitor the logs after deployment to confirm that the errors have been resolved
