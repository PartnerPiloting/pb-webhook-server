Fixed: Job Tracking ID Duplication Problem

This change ensures consistent run ID formats across the entire job tracking system:

1. Added JOB_BYPASS format to unifiedRunIdService.js:
   - Now recognizes job_post_scoring_bypass_* format IDs
   - Converts them to standardized YYMMDD-HHMMSS format

2. Modified postBatchScorer.js to use consistent IDs:
   - Generates standardized YYMMDD-HHMMSS format at the beginning
   - Uses the same ID throughout all operations
   - Eliminated conditional metrics update that was causing duplication
   
This fixes the issue where separate tracking records were being created in the Job Tracking table
with different ID formats (YYMMDD-HHMMSS and job_post_scoring_*) for the same job run.