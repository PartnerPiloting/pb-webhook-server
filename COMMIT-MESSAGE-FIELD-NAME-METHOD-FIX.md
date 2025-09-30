Fixed: Field name and method call issues in job tracking system

This change fixes two critical issues in the job tracking system:

1. Field name conflicts:
   - Updated unifiedJobTrackingRepository.js to exclude the 'Success Rate' field (a formula field that shouldn't be updated directly)
   
2. Method call mismatch:
   - Changed postBatchScorer.js to use unifiedJobTrackingRepository.updateClientRunRecord instead of unifiedRunIdService.updateRunRecord (which doesn't exist)

These changes should resolve the errors seen in logs:
- "Unknown field name: 'Source'" - Already fixed by using 'System Notes' consistently
- "Unknown field name: 'Success Rate'" - Fixed by excluding this formula field
- Method call errors - Fixed by using the correct repository method