Fix: Client Run Results metrics tracking and completion logic

This commit addresses several issues with the Client Run Results metrics tracking system:

1. End Time and Status fields were being prematurely updated after individual 
   processes (lead scoring, post harvesting, post scoring) instead of after all 
   processes completed for a client.

2. Enhanced updateClientMetrics function to explicitly prevent setting End Time 
   or Status during regular updates.

3. Added completeClientProcessing function to properly finalize client 
   processing with correct metrics and status.

4. Added proper handling of standalone vs. workflow processes:
   - Standalone processes: Sets End Time and completes the record
   - Multi-step workflow processes: Only updates metrics until all steps complete

5. Fixed specific field updates:
   - Posts Examined for Scoring and Posts Successfully Scored metrics are now tracked
   - Post Scoring Tokens are correctly recorded
   - Profiles Submitted for Post Harvesting metrics added
   - Total Posts Harvested metrics correctly tracked
   - Apify Run ID now saved to the record

These changes will provide more accurate and complete metrics for each client run,
making tracking and troubleshooting much easier.