Fixed: Replace runRecordRepository with unifiedRunIdService in postBatchScorer.js

This change replaces the use of runRecordRepository with unifiedRunIdService in postBatchScorer.js to ensure consistent run ID formatting across the application. This is the final fix needed to eliminate duplicate run records with different formats.

- Replaced runRecordRepository.updateRunRecord with unifiedRunIdService.updateRunRecord
- Ensures the standardized YYMMDD-HHMMSS format is used consistently
- Completes the migration to unified job tracking services