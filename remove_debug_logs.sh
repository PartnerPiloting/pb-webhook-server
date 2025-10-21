#!/bin/bash

# Remove POST_DEBUG logs from postBatchScorer.js
sed -i '/console\.log(`\[POST_DEBUG\]/d' postBatchScorer.js
sed -i '/console\.error(`\[POST_DEBUG\]/d' postBatchScorer.js

# Remove POST_SCORING_TRACE logs from smart-resume script  
sed -i '/POST_SCORING_TRACE/d' scripts/smart-resume-client-by-client.js

# Remove DEBUG-EXTREME logs from airtableClient.js
sed -i '/DEBUG-EXTREME/d' config/airtableClient.js

# Remove DEBUG-RUN-ID-FLOW logs from apifyProcessRoutes.js
sed -i '/DEBUG-RUN-ID-FLOW/d' routes/apifyProcessRoutes.js

# Remove DEBUG-RUN-ID-FLOW logs from runRecordServiceV2.js
sed -i '/DEBUG-RUN-ID-FLOW/d' services/runRecordServiceV2.js

# Remove METDEBUG logs from apifyRunsService.js
sed -i '/METDEBUG/d' services/apifyRunsService.js

# Remove DEBUG-METRICS logs from postBatchScorer.js
sed -i '/DEBUG-METRICS/d' postBatchScorer.js

echo "Debug log removal complete!"
