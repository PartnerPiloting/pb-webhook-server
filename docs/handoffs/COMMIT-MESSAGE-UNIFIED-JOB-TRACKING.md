fix: Implement unified job tracking with single ID source

This commit implements a comprehensive solution to eliminate duplicate job tracking records by:

1. Creating a streamlined simpleJobTracking service that:
   - Provides a single source of truth for run ID generation
   - Prevents duplicate record creation
   - Uses proper field names consistently (System Notes instead of Source)
   - Avoids updating formula fields like Success Rate
   
2. Fixing core issues:
   - Fixed leadService.js to use System Notes instead of Source
   - Updated postBatchScorer.js to use passed run ID instead of generating its own
   - Modified API routes to generate ONE run ID and pass it consistently
   
3. Eliminating duplicate ID generation:
   - ONE run ID is now generated at the start of a job
   - That SAME ID is passed to all processes
   - Records can only be created once, updates will not create duplicates
   
This creates a clean, consistent job tracking system that prevents duplicate records
and provides reliable metrics.