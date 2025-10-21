// Fire-and-forget endpoint addition for apiAndJobRoutes.js

// Add this after the existing /run-post-batch-score endpoint:

// ---------------------------------------------------------------
// FIRE-AND-FORGET Post Batch Score (NEW PATTERN) 
// ---------------------------------------------------------------
router.post("/run-post-batch-score-v2", async (req, res) => {
  console.log("🚀 apiAndJobRoutes.js: /run-post-batch-score-v2 endpoint hit (FIRE-AND-FORGET)");
  
  // Check if fire-and-forget is enabled
  const fireAndForgetEnabled = process.env.FIRE_AND_FORGET === 'true';
  if (!fireAndForgetEnabled) {
    console.log("⚠️ Fire-and-forget not enabled, falling back to synchronous processing");
    return res.status(501).json({
      status: 'error',
      message: 'Fire-and-forget mode not enabled. Set FIRE_AND_FORGET=true'
    });
  }

  // Multi-tenant batch operation: processes ALL clients, no x-client-id required
  if (!vertexAIClient || !geminiModelId) {
    console.error("❌ Multi-tenant post scoring unavailable: missing Vertex AI client or model ID");
    return res.status(503).json({
      status: 'error',
      message: "Multi-tenant post scoring unavailable (Gemini config missing)."
    });
  }

  try {
    // Parse query parameters (same as original endpoint)
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
    const dryRun = req.query.dryRun === 'true' || req.query.dry_run === 'true';
    const verboseErrors = req.query.verboseErrors === 'true';
    const maxVerboseErrors = req.query.maxVerboseErrors ? parseInt(req.query.maxVerboseErrors, 10) : 10;
    const tableOverride = req.query.table || req.query.leadsTableName || null;
    const markSkips = req.query.markSkips === undefined ? true : req.query.markSkips === 'true';
    let singleClientId = req.query.clientId || req.query.client_id || null;
    const clientNameQuery = req.query.clientName || req.query.client_name || null;
    const stream = req.query.stream ? parseInt(req.query.stream, 10) : 1; // Default to stream 1
    
    // Accept explicit record IDs via query or body
    const idsFromQuery = typeof req.query.ids === 'string' ? req.query.ids.split(',').map(s => s.trim()).filter(Boolean) : [];
    const idsFromBody = Array.isArray(req.body?.ids) ? req.body.ids.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()) : [];
    const targetIds = (idsFromQuery.length ? idsFromQuery : idsFromBody);

    // Generate job ID for this execution
    const { generateJobId } = require('../services/clientService');
    const jobId = generateJobId('post_scoring', stream);
    
    console.log(`🎯 Starting fire-and-forget post scoring: jobId=${jobId}, stream=${stream}, limit=${limit || 'UNLIMITED'}, dryRun=${dryRun}`);
    
    // FIRE-AND-FORGET: Respond immediately with 202 Accepted
    res.status(202).json({
      status: 'accepted',
      message: 'Post scoring job started in background',
      jobId: jobId,
      stream: stream,
      mode: dryRun ? 'dryRun' : 'live',
      estimatedDuration: '5-30 minutes depending on client count',
      note: 'Check job status via client tracking fields in Airtable'
    });

    // Start background processing (don't await - fire and forget!)
    processPostScoringInBackground(jobId, stream, {
      limit,
      dryRun,
      verboseErrors,
      maxVerboseErrors,
      tableOverride,
      markSkips,
      singleClientId,
      clientNameQuery,
      targetIds
    }).catch(error => {
      console.error(`❌ Background post scoring failed for job ${jobId}:`, error.message);
    });

  } catch (error) {
    console.error("❌ Fire-and-forget post scoring startup error:", error.message);
    if (!res.headersSent) {
      return res.status(500).json({
        status: 'error',
        message: `Failed to start post scoring job: ${error.message}`
      });
    }
  }
});

/**
 * Background processing function for fire-and-forget post scoring
 */
async function processPostScoringInBackground(jobId, stream, options) {
  const { 
    setJobStatus, 
    setProcessingStream, 
    formatDuration 
  } = require('../services/clientService');
  
  const startTime = Date.now();
  const maxClientMinutes = parseInt(process.env.MAX_CLIENT_PROCESSING_MINUTES) || 10;
  const maxJobHours = parseInt(process.env.MAX_JOB_PROCESSING_HOURS) || 2;
  const maxJobMs = maxJobHours * 60 * 60 * 1000;
  
  console.log(`🔄 Background post scoring started: ${jobId}`);
  
  try {
    // Get all active clients
    const clientService = require("../services/clientService");
    let clients = await clientService.getActiveClients(options.singleClientId);
    
    if (options.clientNameQuery && !options.singleClientId) {
      const match = clients.find(c => (c.clientName || '').toLowerCase() === options.clientNameQuery.toLowerCase());
      if (match) {
        clients = [match];
        console.log(`✅ Resolved clientName='${options.clientNameQuery}' to clientId='${match.clientId}'`);
      } else {
        throw new Error(`No active client found with name '${options.clientNameQuery}'`);
      }
    }

    console.log(`📊 Processing ${clients.length} clients in stream ${stream}`);

    let totalProcessed = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;

    // Process each client with timeout protection
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      
      // Check overall job timeout
      if (Date.now() - startTime > maxJobMs) {
        console.log(`⏰ Job timeout reached (${maxJobHours} hours) - stopping gracefully`);
        await setJobStatus(client.clientId, 'post_scoring', 'JOB_TIMEOUT_KILLED', jobId, {
          duration: formatDuration(Date.now() - startTime),
          count: totalSuccessful
        });
        break;
      }

      console.log(`🎯 Processing client ${i + 1}/${clients.length}: ${client.clientName} (${client.clientId})`);
      
      // Set client processing stream and status
      await setProcessingStream(client.clientId, stream);
      await setJobStatus(client.clientId, 'post_scoring', 'RUNNING', jobId);
      
      const clientStartTime = Date.now();
      
      try {
        
        // Run post scoring for this client with timeout
        // FIX: Corrected parameter order - jobId as runId, client.clientId as clientId, options.limit as limit
        const clientResult = await Promise.race([
          postBatchScorer.runMultiTenantPostScoring(
            vertexAIClient,
            geminiModelId,
            jobId, // FIXED: Using jobId as runId (was incorrectly passing client.clientId as runId)
            client.clientId, // FIXED: Now correctly passed as clientId parameter
            options.limit,
            {
              dryRun: options.dryRun,
              leadsTableName: options.tableOverride || undefined,
              markSkips: options.markSkips,
              verboseErrors: options.verboseErrors,
              maxVerboseErrors: options.maxVerboseErrors,
              targetIds: options.targetIds
            }
          ),
          // Client timeout
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Client timeout')), maxClientMinutes * 60 * 1000)
          )
        ]);

        // Success - update status
        const clientDuration = formatDuration(Date.now() - clientStartTime);
        const postsScored = clientResult.totalPostsScored || 0;
        
        await setJobStatus(client.clientId, 'post_scoring', 'COMPLETED', jobId, {
          duration: clientDuration,
          count: postsScored
        });
        
        console.log(`✅ ${client.clientName}: ${postsScored} posts scored in ${clientDuration}`);
        totalSuccessful++;
        totalProcessed += postsScored;

      } catch (error) {
        // Handle client failure or timeout
        const clientDuration = formatDuration(Date.now() - clientStartTime);
        const isTimeout = error.message.includes('timeout');
        const status = isTimeout ? 'CLIENT_TIMEOUT_KILLED' : 'FAILED';
        
        await setJobStatus(client.clientId, 'post_scoring', status, jobId, {
          duration: clientDuration,
          count: 0
        });
        
        console.error(`❌ ${client.clientName} ${isTimeout ? 'TIMEOUT' : 'FAILED'}: ${error.message}`);
        totalFailed++;
      }
    }

    // Final summary
    const totalDuration = formatDuration(Date.now() - startTime);
    console.log(`🎉 Fire-and-forget post scoring completed: ${jobId}`);
    console.log(`📊 Summary: ${totalSuccessful} successful, ${totalFailed} failed, ${totalProcessed} posts scored, ${totalDuration}`);

  } catch (error) {
    console.error(`❌ Fatal error in background post scoring ${jobId}:`, error.message);
  }
}