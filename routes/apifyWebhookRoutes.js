// routes/apifyWebhookRoutes.js
// Completely rewritten for clean architecture with JobTracking.js
// No legacy code fallbacks, single source of truth for job tracking
// Updated to use jobOrchestrationService for proper service boundaries

const express = require('express');
const router = express.Router();
const { getClientBase } = require('../config/airtableClient');
const { StructuredLogger } = require('../utils/structuredLogger');
const JobTracking = require('../services/jobTracking');
const jobOrchestrationService = require('../services/jobOrchestrationService');
const { createPost } = require('../services/postService');
const { handleClientError } = require('../utils/errorHandler');
const clientService = require('../services/clientService');
const unifiedRunIdService = require('../services/unifiedRunIdService');

// Constants
const WEBHOOK_SECRET = process.env.PB_WEBHOOK_SECRET || 'Diamond9753!!@@pb';

// Default logger
const logger = new StructuredLogger('SYSTEM', null, 'apify_webhook');

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
        
        // Check if a corresponding job record exists in the tracking system
        return await JobTracking.checkClientRunExists({
            runId,
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
        
        // Extract Apify run ID
        apifyRunId = extractRunIdFromPayload(payload);
        if (!apifyRunId) {
            logger.error("No Apify run ID found in payload");
            return res.status(400).json({ success: false, error: 'No Apify run ID found in payload' });
        }
        
        // Determine client ID (from query param, header, or payload)
        clientId = req.query.clientId || req.query.testClient || req.headers['x-client-id'];
        
        // If not provided in query or header, try to find in payload
        if (!clientId) {
            clientId = extractClientIdFromPayload(payload);
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
        
        // CRITICAL FIX: First check if a job record for this run already exists
        // This prevents duplicate processing and ensures we're only updating existing records
        const existingJobId = payload.jobRunId || payload.data?.jobRunId || null;
        
        if (existingJobId) {
            // Validate that the referenced job record actually exists
            const recordExists = await validateRunRecordExists(existingJobId, clientId);
            
            if (!recordExists) {
                logger.error(`Job run record referenced in webhook (${existingJobId}) does not exist for client ${clientId}`);
                return res.status(404).json({ 
                    success: false, 
                    error: 'Job record not found',
                    message: `No active run found for client ${clientId} with run ID ${existingJobId}`
                });
            }
            
            // Use the existing job ID
            jobRunId = existingJobId;
            logger.info(`Using existing job run ID from webhook: ${jobRunId}`);
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
        
        // CRITICAL FIX: Ensure jobRunId is properly validated before passing to background process
        const validatedJobRunId = typeof jobRunId === 'string' ? jobRunId : 
                                 (jobRunId && jobRunId.runId ? jobRunId.runId : String(jobRunId));
        
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
            const normalizedRunId = unifiedRunIdService.normalizeRunId(jobRunId);
            if (!normalizedRunId) {
                logger.error("Cannot update job status: normalized runId is not valid");
            } else {
                await JobTracking.updateJob({
                    runId: normalizedRunId,
                    updates: {
                        status: 'Failed',
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
    // CRITICAL FIX: Ensure jobRunId is properly validated and used as a string in the logger
    const validJobRunId = typeof jobRunId === 'string' ? jobRunId : 
                         (jobRunId && jobRunId.runId ? jobRunId.runId : String(jobRunId));
    
    const clientLogger = new StructuredLogger(clientId, validJobRunId, 'apify_webhook');
    
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
        
        // If no posts found, update tracking and exit
        if (!posts || posts.length === 0) {
            clientLogger.warn(`No posts found in payload for Apify run ${apifyRunId}`);
            
            // Check if this is a standalone run
            const isStandalone = !jobRunId.includes('-');
            
            // Use job orchestration service to handle completion
            await jobOrchestrationService.completeJob({
                jobType: 'apify_post_harvesting',
                runId: jobRunId,
                finalMetrics: {
                    'Total Posts Harvested': 0,
                    'Apify Run ID': apifyRunId || '',
                    'Profiles Submitted for Post Harvesting': payload.targetUrls ? payload.targetUrls.length : 0,
                    'System Notes': 'Completed with no posts found'
                }
            });
            
            // Still update client-specific metrics
            await JobTracking.completeClientProcessing({
                runId: validJobRunId, // CRITICAL FIX: Use validated ID
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
                        status: 'Completed',
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
        
        // Check if this is a standalone run or part of a workflow
        const isStandalone = !jobRunId.includes('-');  // Simple heuristic - parent runs typically have format like YYMMDD-HHMMSS
        
        // Use job orchestration service to handle completion
        await jobOrchestrationService.completeJob({
            jobType: 'apify_post_harvesting',
            runId: jobRunId,
            finalMetrics: {
                'Total Posts Harvested': posts.length,
                'Apify API Costs': posts.length * 0.02, // Estimated cost: $0.02 per post
                'Apify Run ID': apifyRunId || '',
                'Profiles Submitted for Post Harvesting': payload.targetUrls ? payload.targetUrls.length : 0,
                'System Notes': `Successfully processed ${posts.length} posts (${result.success} saved, ${result.errors} errors)`
            }
        });
        
        // Still update client-specific metrics
        await JobTracking.completeClientProcessing({
            runId: jobRunId,
            clientId,
            finalMetrics: {
                'Total Posts Harvested': posts.length,
                'Apify API Costs': posts.length * 0.02,
                'Apify Run ID': apifyRunId || '',
                'System Notes': `Successfully processed ${posts.length} posts (${result.success} saved, ${result.errors} errors)`
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
                    status: 'Completed',
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
        const normalizedRunId = unifiedRunIdService.normalizeRunId(jobRunId);
        if (!normalizedRunId) {
            clientLogger.error(`Unable to normalize run ID: ${jobRunId}. Using original run ID.`);
        }
        await JobTracking.completeClientProcessing({
            runId: normalizedRunId || jobRunId, // Use original ID as fallback
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
                    status: 'Failed',
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
    const log = logger || new StructuredLogger(clientId, null, 'sync_posts');
    
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