// routes/apifyWebhookRoutes.js
// Completely rewritten for clean architecture with JobTracking.js
// No legacy code fallbacks, single source of truth for job tracking
// Updated to use jobOrchestrationService for proper service boundaries

const express = require('express');
const router = express.Router();
const { getClientBase } = require('../config/airtableClient');
const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');
const JobTracking = require('../services/jobTracking');
const jobOrchestrationService = require('../services/jobOrchestrationService');
const { createPost } = require('../services/postService');
const { handleClientError } = require('../utils/errorHandler');
const clientService = require('../services/clientService');
const unifiedRunIdService = require('../services/unifiedRunIdService');
// Import the validator utility
const { validateAndNormalizeRunId, validateAndNormalizeClientId } = require('../utils/runIdValidator');

// Constants
const WEBHOOK_SECRET = process.env.PB_WEBHOOK_SECRET || 'Diamond9753!!@@pb';

// Default logger - using safe logger creation
const logger = createSafeLogger('SYSTEM', null, 'apify_webhook');

/**
 * Webhook authentication middleware
 * Ensures requests have proper authorization
 */
function authenticateWebhook(req, res, next) {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader || authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
        logger.error("Authentication failed - invalid token");
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    next();
}

/**
 * The main webhook handler for Apify post harvesting
 * Receives webhook data, extracts posts, saves to Airtable
 */
/**
 * Validate that a run record exists before processing webhook
 * This is critical to ensure we don't try to update non-existent records
 * @param {string} runId - The run ID to check
 * @param {string} clientId - The client ID
 * @returns {Promise<boolean>} - Whether the record exists
 */
async function validateRunRecordExists(runId, clientId) {
    try {
        if (!runId || !clientId) {
            logger.error(`Cannot validate run record: missing runId=${runId} or clientId=${clientId}`);
            return false;
        }
        
        // First standardize the run ID using JobTracking's standardization function
        const standardizedRunId = JobTracking.standardizeRunId(runId);
        
        if (!standardizedRunId) {
            logger.error(`Failed to standardize run ID: ${runId}`);
            return false;
        }
        
        // Check if a corresponding job record exists in the tracking system using standardized run ID
        return await JobTracking.checkClientRunExists({
            runId: standardizedRunId,
            clientId,
            options: {
                source: 'apify_webhook_validation'
            }
        });
    } catch (error) {
        logger.error(`Error validating run record existence: ${error.message}`);
        return false;
    }
}

async function apifyWebhookHandler(req, res) {
    const startTime = new Date();
    let clientId = null;
    let apifyRunId = null;
    let jobRunId = null;
    
    try {
        const payload = req.body;
        
        // First, look for our system-generated jobRunId which is the most important identifier
        // This is what our code should be using for processing
        jobRunId = payload.jobRunId || payload.data?.jobRunId || null;
        
        if (jobRunId) {
            logger.info(`Found system-generated job run ID in webhook payload: ${jobRunId}`);
        }
        
        // Extract Apify run ID (only as a fallback or for logging)
        apifyRunId = extractRunIdFromPayload(payload);
        if (!apifyRunId) {
            if (!jobRunId) {
                // Only error if we don't have either ID
                logger.error("No Apify run ID or job run ID found in payload");
                return res.status(400).json({ success: false, error: 'No run ID found in payload' });
            } else {
                // Log but continue if we have jobRunId
                logger.warn("No Apify run ID found in payload, but we have jobRunId so continuing");
            }
        }
        
        // Determine client ID (from query param, header, or payload)
        clientId = req.query.clientId || req.query.testClient || req.headers['x-client-id'];
        
        // If not provided in query or header, try to find in payload
        if (!clientId) {
            clientId = extractClientIdFromPayload(payload);
        }
        
        // CRITICAL FIX: If still no client ID, try to resolve it from the Apify run record
        if (!clientId && apifyRunId) {
            try {
                logger.info(`Attempting to resolve client ID from Apify run: ${apifyRunId}`);
                // Import the apifyRunsService to look up the client ID
                const apifyRunsService = require('../services/apifyRunsService');
                
                // Get the run record which contains clientId
                const runRecord = await apifyRunsService.getApifyRun(apifyRunId);
                
                if (runRecord && runRecord.clientId) {
                    clientId = runRecord.clientId;
                    logger.info(`Successfully resolved client ID ${clientId} from Apify run ${apifyRunId}`);
                }
            } catch (err) {
                logger.error(`Failed to resolve client ID from Apify run: ${err.message}`);
            }
        }
        
        if (!clientId) {
            logger.error(`No client ID found for Apify run ${apifyRunId}`);
            return res.status(400).json({ success: false, error: 'Client ID is required' });
        }
        
        logger.info(`Processing webhook for Apify run ${apifyRunId}, client ${clientId}`);
        
        // Send immediate 200 response to avoid Apify retries
        // This is important as Apify will retry failed webhooks
        res.status(200).json({ 
            success: true, 
            message: `Processing webhook for Apify run ${apifyRunId}, client ${clientId}` 
        });
        
        // We already extracted jobRunId at the beginning, now we just need to validate it exists
        // and is properly formatted
        
        if (jobRunId) {
            // Validate that the referenced job record actually exists
            const recordExists = await validateRunRecordExists(jobRunId, clientId);
            
            if (!recordExists) {
                logger.error(`Job run record referenced in webhook (${jobRunId}) does not exist for client ${clientId}`);
                
                // Instead of failing, try to find the record by Apify Run ID as a fallback
                if (apifyRunId) {
                    logger.info(`Attempting to find job run record by Apify run ID: ${apifyRunId}`);
                    
                    // Try to get system run ID from apifyRunsService by Apify run ID
                    try {
                        const apifyRunsService = require('../services/apifyRunsService');
                        const apifyRecord = await apifyRunsService.getApifyRun(apifyRunId);
                        
                        if (apifyRecord && apifyRecord.runId) {
                            // If we found the record, use its Run ID instead
                            jobRunId = apifyRecord.runId;
                            logger.info(`Found system run ID ${jobRunId} from Apify record for ${apifyRunId}`);
                            
                            // Re-validate with the found ID
                            const refetchedRecordExists = await validateRunRecordExists(jobRunId, clientId);
                            if (!refetchedRecordExists) {
                                logger.error(`Found system run ID ${jobRunId} but it still doesn't exist in job tracking`);
                                return res.status(404).json({ 
                                    success: false, 
                                    error: 'Job record not found even after Apify lookup',
                                    message: `No active run found for client ${clientId} with any available run ID`
                                });
                            }
                        } else {
                            logger.error(`No Apify record found for Apify run ID: ${apifyRunId}`);
                        }
                    } catch (lookupError) {
                        logger.error(`Error looking up Apify record: ${lookupError.message}`);
                    }
                }
                
                // If we still don't have a valid jobRunId, return error
                if (!jobRunId || !(await validateRunRecordExists(jobRunId, clientId))) {
                    return res.status(404).json({ 
                        success: false, 
                        error: 'Job record not found',
                        message: `No active run found for client ${clientId} with run ID ${jobRunId}`
                    });
                }
            }
            
            logger.info(`Using validated job run ID from webhook: ${jobRunId}`);
        } else {
            // Start a new job using the orchestration service if no job ID was provided
            const jobInfo = await jobOrchestrationService.startJob({
                jobType: 'apify_post_harvesting',
                clientId,
                initialData: {
                    'System Notes': `Processing Apify webhook for run ${apifyRunId}, client ${clientId}`,
                    'Apify Run ID': apifyRunId
                }
            });
            
            // Use the run ID generated by the orchestration service
            jobRunId = jobInfo.runId;
            logger.info(`Using newly created job run ID: ${jobRunId} from orchestration service`);
        }
        
        // CRITICAL FIX: Enforce strict run ID handling - no normalization, preserve exact format
        // This maintains the single-source-of-truth principle for run IDs
        let validatedJobRunId;
        
        if (typeof jobRunId === 'string') {
            // Use string value directly without any transformation
            validatedJobRunId = jobRunId;
            logger.info(`Using string job run ID as-is: ${validatedJobRunId}`);
        } else if (jobRunId && jobRunId.runId) {
            // Extract runId property
            validatedJobRunId = jobRunId.runId;
            logger.info(`Extracted job run ID from object: ${validatedJobRunId}`);
        } else {
            // Convert to string but log a warning about non-standard input
            validatedJobRunId = String(jobRunId);
            logger.warn(`Converted non-standard job run ID to string: ${validatedJobRunId} (original type: ${typeof jobRunId})`);
        }
        
        logger.info(`Using validated job run ID: ${validatedJobRunId} for webhook processing`);
        
        // Track profiles submitted for harvesting
        try {
            // Update client metrics for Apify run initialization
            const profilesSubmitted = payload.targetUrls ? payload.targetUrls.length : 
                                      (payload.data?.targetUrls ? payload.data.targetUrls.length : 0);
            
            // Get specific logger for this operation
            const metricsLogger = createSafeLogger(clientId, validatedJobRunId, 'apify_metrics');
            
            metricsLogger.info(`Updating metrics for ${profilesSubmitted} profiles submitted to Apify run ${apifyRunId}`);
            
            // Use JobTracking service to update client metrics
            await JobTracking.updateClientMetrics({
                runId: validatedJobRunId,
                clientId,
                metrics: {
                    'Profiles Submitted for Post Harvesting': profilesSubmitted,
                    'Apify Run ID': apifyRunId,
                    'System Notes': `Apify run ${apifyRunId} started for ${profilesSubmitted} profiles at ${new Date().toISOString()}`
                },
                options: {
                    source: 'apify_webhook_start',
                    logger: metricsLogger
                }
            });
            
            metricsLogger.info(`Successfully updated metrics for Apify run initialization`);
        } catch (metricsError) {
            logger.error(`Failed to update initial Apify metrics: ${metricsError.message}`);
            // Continue processing even if metrics update fails
        }

        // Process the webhook in background with validated runId
        processWebhook(payload, apifyRunId, clientId, validatedJobRunId).catch(error => {
            logger.error(`Background processing failed: ${error.message}`, { error });
        });
        
    } catch (error) {
        logger.error(`Error in webhook handler: ${error.message}`, { error });
        
        // Only send response if not already sent
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
        
        // Update job tracking record if it was created
        if (jobRunId) {
            // Additional validation to ensure the jobRunId is properly defined
            const normalizedRunId = jobRunId ? unifiedRunIdService.normalizeRunId(jobRunId) : null;
            if (!normalizedRunId) {
                logger.error("Cannot update job status: normalized runId is not valid");
            } else {
                await JobTracking.updateJob({
                    runId: normalizedRunId,
                    updates: {
                        Status: 'Failed',  // FIXED: Capitalized Status field name
                        endTime: new Date().toISOString(),
                        error: error.message
                    }
                }).catch(updateError => {
                    logger.error(`Failed to update job record: ${updateError.message}`);
                });
            }
        }
    }
}

/**
 * Normalize LinkedIn profile URL to ensure consistent format
 * @param {string} url - The URL to normalize
 * @returns {string} - Normalized URL
 */
function normalizeLinkedInProfileURL(url) {
    try {
        if (!url) return '';
        
        // Remove query parameters
        const baseUrl = url.split('?')[0];
        
        // Remove trailing slash if present
        const cleanUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        
        // Parse the path components
        const parts = cleanUrl.split('/').filter(p => p);
        // Get the last two parts (usually 'in' and the profile ID)
        const lastParts = parts.slice(-2);
        
        if (parts.length >= 2 && ['in', 'company'].includes(parts[0])) {
            // Reconstruct in recent-activity format
            return `https://www.linkedin.com/${parts[0]}/${parts[1]}/recent-activity/all/`;
        }
        return url;
    } catch (e) {
        console.error(`Error normalizing LinkedIn URL ${url}: ${e.message}`);
        return url;
    }
}

/**
 * Extract Apify run ID from webhook payload
 * @param {Object} payload - Webhook payload
 * @returns {string|null} - Extracted run ID or null
 */
function extractRunIdFromPayload(payload) {
    try {
        if (!payload) return null;
        
        // Try standard Apify webhook format
        if (payload.resource && payload.resource.actorRunId) {
            return payload.resource.actorRunId;
        }
        
        // Try custom payload format
        if (payload.actorRunId) {
            return payload.actorRunId;
        }
        
        // Try webhook data object format
        if (payload.data && payload.data.actorRunId) {
            return payload.data.actorRunId;
        }
        
        // Try legacy webhook format
        if (payload.webhookData && payload.webhookData.actorRunId) {
            return payload.webhookData.actorRunId;
        }
        
        // Try even more nested formats
        if (payload.data && payload.data.resource && payload.data.resource.actorRunId) {
            return payload.data.resource.actorRunId;
        }
        
        // Last resort: check eventData
        if (payload.eventData && payload.eventData.actorRunId) {
            return payload.eventData.actorRunId;
        }
        
        return null;
    } catch (error) {
        logger.error(`Error extracting Apify run ID: ${error.message}`);
        return null;
    }
}

/**
 * Extract client ID from webhook payload
 * @param {Object} payload - Webhook payload
 * @returns {string|null} - Extracted client ID or null
 */
function extractClientIdFromPayload(payload) {
    try {
        if (!payload) return null;
        
        // Try standard payload client ID fields
        if (payload.clientId) return payload.clientId;
        if (payload.data && payload.data.clientId) return payload.data.clientId;
        if (payload.userData && payload.userData.clientId) return payload.userData.clientId;
        if (payload.meta && payload.meta.clientId) return payload.meta.clientId;
        
        // Try to extract from URLs if present
        if (payload.requestUrl) {
            const urlParams = new URL(payload.requestUrl).searchParams;
            const clientId = urlParams.get('clientId');
            if (clientId) return clientId;
        }
        
        // Try custom payload paths
        if (payload.data && payload.data.userData && payload.data.userData.clientId) {
            return payload.data.userData.clientId;
        }
        
        return null;
    } catch (error) {
        logger.error(`Error extracting client ID: ${error.message}`);
        return null;
    }
}

/**
 * Extract posts from webhook payload
 * @param {Object} payload - Webhook payload
 * @returns {Array} - Extracted posts array
 */
function extractPostsFromPayload(payload) {
    try {
        if (!payload) return [];
        
        // Check different possible locations for posts data
        if (Array.isArray(payload)) {
            return payload;
        }
        
        if (payload.data && Array.isArray(payload.data)) {
            return payload.data;
        }
        
        if (payload.posts && Array.isArray(payload.posts)) {
            return payload.posts;
        }
        
        if (payload.result && Array.isArray(payload.result)) {
            return payload.result;
        }
        
        if (payload.result && payload.result.posts && Array.isArray(payload.result.posts)) {
            return payload.result.posts;
        }
        
        if (payload.data && payload.data.posts && Array.isArray(payload.data.posts)) {
            return payload.data.posts;
        }
        
        if (payload.data && payload.data.result && Array.isArray(payload.data.result)) {
            return payload.data.result;
        }
        
        if (payload.items && Array.isArray(payload.items)) {
            return payload.items;
        }
        
        logger.warn('No posts array found in payload structure');
        return [];
    } catch (error) {
        logger.error(`Error extracting posts: ${error.message}`);
        return [];
    }
}

/**
 * Process the webhook payload
 * @param {Object} payload - The webhook payload
 * @param {string} apifyRunId - The Apify run ID
 * @param {string} clientId - The client ID
 * @param {string} jobRunId - The job run ID
 * @returns {Promise<void>} - Processing promise
 */
async function processWebhook(payload, apifyRunId, clientId, jobRunId) {
    // Use the safe logger helper to avoid object-as-string errors
    const clientLogger = createSafeLogger(clientId, jobRunId, 'apify_webhook');
    
    try {
        clientLogger.info(`Starting background processing for Apify run ${apifyRunId}`);
        
        // Get client's Airtable base
        const client = await clientService.getClientById(clientId);
        if (!client) {
            throw new Error(`Client ${clientId} not found`);
        }
        
        const clientBase = await getClientBase(clientId);
        if (!clientBase) {
            throw new Error(`Airtable base not found for client ${clientId}`);
        }
        
        // Extract posts from payload
        const posts = extractPostsFromPayload(payload);
        clientLogger.info(`Extracted ${posts.length} posts from payload`);
        
        // Determine profiles submitted count from payload
        const profilesSubmitted = payload.targetUrls ? payload.targetUrls.length : 
                               (payload.data?.targetUrls ? payload.data.targetUrls.length : 0);
        
        // If no posts found, update tracking and exit
        if (!posts || posts.length === 0) {
            clientLogger.warn(`No posts found in payload for Apify run ${apifyRunId}`);
            
            // Check if this is a standalone run
            const isStandalone = !jobRunId.includes('-');
            
            // Prepare metrics
            const harvestMetrics = {
                'Total Posts Harvested': 0,
                'Apify Run ID': apifyRunId || '',
                'Profiles Submitted for Post Harvesting': profilesSubmitted,
                'System Notes': `Completed Apify run ${apifyRunId} with no posts found at ${new Date().toISOString()}`
            };
            
            // Update client metrics with harvest results
            clientLogger.info(`Updating client metrics with harvest results: 0 posts harvested from ${profilesSubmitted} profiles`);
            
            try {
                // Update client metrics with standardized field names from constants
                await JobTracking.updateClientMetrics({
                    runId: jobRunId,
                    clientId,
                    metrics: harvestMetrics,
                    options: {
                        source: 'apify_webhook_complete',
                        logger: clientLogger
                    }
                });
                clientLogger.info(`Successfully updated client metrics for harvest results`);
            } catch (metricsError) {
                clientLogger.error(`Failed to update harvest metrics: ${metricsError.message}`);
                // Continue processing even if metrics update fails
            }
            
            // Use job orchestration service to handle completion
            await jobOrchestrationService.completeJob({
                jobType: 'apify_post_harvesting',
                runId: jobRunId,
                finalMetrics: harvestMetrics
            });
            
            // Still update client-specific metrics
            await JobTracking.completeClientProcessing({
                runId: jobRunId,
                clientId,
                finalMetrics: {
                    'Total Posts Harvested': 0,
                    'Apify Run ID': apifyRunId || '',
                    'Profiles Submitted for Post Harvesting': payload.targetUrls ? payload.targetUrls.length : 0,
                    'System Notes': 'Completed with no posts found'
                },
                options: {
                    source: 'apify_webhook_handler_no_posts',
                    isStandalone: isStandalone
                }
            });
            
            // Update job tracking record
            // Additional validation to ensure the jobRunId is properly defined
            const normalizedMainRunId = unifiedRunIdService.normalizeRunId(jobRunId);
            if (!normalizedMainRunId) {
                clientLogger.error("Cannot update job status: normalized runId is not valid");
            } else {
                await JobTracking.updateJob({
                    runId: normalizedMainRunId,
                    updates: {
                        Status: 'Completed',  // FIXED: Capitalized Status field name
                        endTime: new Date().toISOString(),
                        'System Notes': 'Completed with no posts found'
                    }
                });
            }
            
            return;
        }
        
        clientLogger.info(`Found ${posts.length} posts to process`);
        
        // Save posts to Airtable
        const result = await syncPBPostsToAirtable(posts, clientBase, clientId, clientLogger);
                               
        // Prepare harvest metrics
        const harvestMetrics = {
            'Total Posts Harvested': posts.length,
            'Apify API Costs': posts.length * 0.02, // Estimated cost: $0.02 per post
            'Apify Run ID': apifyRunId || '',
            'Profiles Submitted for Post Harvesting': profilesSubmitted,
            'System Notes': `Successfully processed ${posts.length} posts (${result.success} saved, ${result.errors} errors) at ${new Date().toISOString()}`
        };
        
        // Update client metrics with harvest results
        clientLogger.info(`Updating client metrics with harvest results: ${posts.length} posts harvested from ${profilesSubmitted} profiles`);
        
        try {
            // Update client metrics with standardized field names
            await JobTracking.updateClientMetrics({
                runId: jobRunId,
                clientId,
                metrics: harvestMetrics,
                options: {
                    source: 'apify_webhook_complete',
                    logger: clientLogger
                }
            });
            clientLogger.info(`Successfully updated client metrics for harvest results`);
        } catch (metricsError) {
            clientLogger.error(`Failed to update harvest metrics: ${metricsError.message}`);
            // Continue processing even if metrics update fails
        }
        
        // Use job orchestration service to handle completion
        await jobOrchestrationService.completeJob({
            jobType: 'apify_post_harvesting',
            runId: jobRunId,
            finalMetrics: harvestMetrics
        });
        
        // Complete client processing
        await JobTracking.completeClientProcessing({
            runId: jobRunId,
            clientId,
            finalMetrics: harvestMetrics
        });
        
        // Update job tracking record
        // Additional validation to ensure the jobRunId is properly defined
        const normalizedMainRunId = unifiedRunIdService.normalizeRunId(jobRunId);
        if (!normalizedMainRunId) {
            clientLogger.error("Cannot update job status: normalized runId is not valid");
        } else {
            await JobTracking.updateJob({
                runId: normalizedMainRunId,
                updates: {
                    Status: 'Completed',  // FIXED: Capitalized Status field name
                    endTime: new Date().toISOString(),
                    'Items Processed': posts.length,
                    'System Notes': `Successfully processed ${posts.length} posts for client ${clientId}`
                }
            });
        }
        
        clientLogger.info(`Processing complete: ${result.success} posts saved, ${result.errors} errors`);
    } catch (error) {
        clientLogger.error(`Error processing webhook: ${error.message}`, { error });
        
        // Check if this is a standalone run or part of a workflow
        const isStandalone = !jobRunId.includes('-');  // Simple heuristic - parent runs typically have format like YYMMDD-HHMMSS
        
        // Complete client processing with failure status
        // FIXED: Validate and normalize the jobRunId using our utility
        const safeRunId = validateAndNormalizeRunId(jobRunId);
        
        // Now use our utility to ensure we have a valid string
        let normalizedRunId;
        try {
            normalizedRunId = unifiedRunIdService.normalizeRunId(safeRunId);
            if (!normalizedRunId) {
                clientLogger.error(`Unable to normalize run ID: ${safeRunId}. Using original run ID.`);
            }
        } catch (normError) {
            clientLogger.error(`Error normalizing run ID: ${normError.message}. Using original run ID.`);
        }
        
        await JobTracking.completeClientProcessing({
            runId: normalizedRunId || safeRunId || jobRunId, // Use best available ID
            clientId,
            finalMetrics: {
                failed: true,
                errors: 1,
                'System Notes': `Failed: ${error.message}`,
                'Apify Run ID': apifyRunId || ''
            },
            options: {
                source: 'apify_webhook_handler_error',
                isStandalone: isStandalone
            }
        }).catch(updateError => {
            clientLogger.error(`Failed to complete client processing: ${updateError.message}`);
        });
        
        // Update job tracking record with error
        // Additional validation to ensure the jobRunId is properly defined
        const normalizedMainRunId = unifiedRunIdService.normalizeRunId(jobRunId);
        if (!normalizedMainRunId) {
            clientLogger.error("Cannot update job status: normalized runId is not valid");
        } else {
            await JobTracking.updateJob({
                runId: normalizedMainRunId,
                updates: {
                    Status: 'Failed',  // FIXED: Capitalized Status field name
                    endTime: new Date().toISOString(),
                    'System Notes': `Error: ${error.message}`
                }
            }).catch(updateError => {
                clientLogger.error(`Failed to update job tracking record: ${updateError.message}`);
            });
        }
        
        throw error; // Re-throw for caller handling
    }
}

/**
 * Sync posts to Airtable
 * @param {Array} posts - Posts to sync
 * @param {Object} clientBase - Client Airtable base
 * @param {string} clientId - Client ID
 * @param {Object} logger - Logger instance
 * @returns {Promise<Object>} - Result statistics
 */
async function syncPBPostsToAirtable(posts, clientBase, clientId, logger = null) {
    const log = logger || createSafeLogger(clientId, null, 'sync_posts');
    
    if (!posts || posts.length === 0) {
        log.warn('No posts to sync');
        return { success: 0, errors: 0 };
    }
    
    log.info(`Syncing ${posts.length} posts to Airtable`);
    
    let success = 0;
    let errors = 0;
    
    // Process each post
    for (const post of posts) {
        try {
            // Normalize fields for consistency
            const normalizedPost = {
                // Core post data
                'Post ID': post.postId || post.id || `pb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                'Post URL': post.postUrl || post.url || '',
                'Post Date': post.postDate || post.date || post.timestamp || new Date().toISOString(),
                'Post Text': post.text || post.content || post.postContent || '',
                
                // Author data
                'Author Name': post.authorName || (post.author && post.author.name) || '',
                'Author URL': normalizeLinkedInProfileURL(post.authorUrl || (post.author && post.author.url) || ''),
                'Author ID': post.authorId || (post.author && post.author.id) || '',
                'Profile URL': normalizeLinkedInProfileURL(post.profileUrl || post.authorUrl || (post.author && post.author.url) || ''),
                
                // Media data
                'Has Image': !!post.hasImage || !!(post.images && post.images.length > 0),
                'Image URLs': Array.isArray(post.images) ? post.images.join(', ') : (post.imageUrl || ''),
                
                // Engagement metrics
                'Like Count': post.likeCount || post.likes || 0,
                'Comment Count': post.commentCount || post.comments || 0,
                'Share Count': post.shareCount || post.shares || 0,
                
                // Metadata
                'Created At': new Date().toISOString(),
                'Source': 'Apify API',
                'System Notes': `Imported via Apify webhook`
            };
            
            // Create post in Airtable
            await clientBase('Posts').create(normalizedPost);
            success++;
            log.debug(`Successfully created post: ${normalizedPost['Post ID']}`);
        } catch (error) {
            errors++;
            log.error(`Error creating post: ${error.message}`, { error });
        }
    }
    
    log.info(`Sync complete: ${success} posts created, ${errors} errors`);
    return { success, errors };
}

// Register routes
router.post('/webhook', authenticateWebhook, apifyWebhookHandler);

// Debug endpoint
router.get('/webhook/status', (req, res) => {
    res.json({ status: 'active', version: '2.0' });
});

module.exports = router;