/**
 * services/jobOrchestrationService.js
 * 
 * Central service for job orchestration and lifecycle management.
 * This service enforces proper service boundaries by being the ONLY place 
 * that creates job tracking records.
 */

const JobTracking = require('./jobTracking');
const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');
const { STATUS_VALUES } = require('../constants/airtableConstants');
const unifiedRunIdService = require('./unifiedRunIdService');

// Default logger with safe creation
const logger = createSafeLogger('SYSTEM', null, 'job_orchestration_service');

// In-memory store to track active jobs by type
const activeJobs = new Map();

/**
 * Start a new job of the specified type
 * This is the ONLY function that should create job tracking records
 * 
 * @param {Object} params - Job parameters
 * @param {string} params.jobType - Type of job (e.g., 'post_scoring', 'lead_scoring', 'apify_post_harvesting')
 * @param {string} [params.clientId] - Optional client ID if job is for a specific client
 * @param {Object} [params.initialData={}] - Initial data for the job record
 * @param {Object} [params.options={}] - Additional options
 * @returns {Promise<Object>} Job info including runId
 */
async function startJob(params) {
    const { jobType, clientId, initialData = {}, options = {} } = params;
    const log = options.logger || logger;
    
    // Check if this job type is already running
    if (isJobRunning(jobType)) {
        log.warn(`Job of type ${jobType} is already running. Cannot start another.`);
        const existingJobInfo = activeJobs.get(jobType);
        return {
            runId: existingJobInfo.runId,
            alreadyRunning: true,
            message: `Job of type ${jobType} is already running (started at ${existingJobInfo.startTime})`,
            startTime: existingJobInfo.startTime
        };
    }
    
    // Generate a new run ID - this is the ONLY place run IDs should be generated for jobs
    const runId = JobTracking.generateRunId();
    log.info(`Generated run ID ${runId} for job type ${jobType}`);
    
    // Enhanced initial data with timestamp - don't use 'Job Type' field as it doesn't exist
    const enhancedInitialData = {
        ...initialData,
        'System Notes': initialData['System Notes'] 
            ? `${initialData['System Notes']}\nJob started by orchestration service for ${jobType}.` 
            : `Job started by orchestration service for ${jobType}.`
    };
    
    // Create the job tracking record - the ONLY place this should happen
    // CRITICAL FIX: Store jobType in System Notes, not as a field
    // The Job Type field doesn't exist in Airtable schema
    const jobRecord = await JobTracking.createJob({
        runId,
        initialData: {
            ...enhancedInitialData,
            'System Notes': `${enhancedInitialData['System Notes'] || ''}\nJob Type: ${jobType}`
        },
        options
    });
    
    // If this is for a specific client, create client run record
    if (clientId) {
        await JobTracking.createClientRun({
            runId,
            clientId,
            initialData: {
                // Remove Job Type field that doesn't exist
                'System Notes': `Processing ${jobType} for client ${clientId}`
            },
            options
        });
    }
    
    // Store in active jobs
    activeJobs.set(jobType, {
        runId,
        startTime: new Date().toISOString(),
        jobType,
        clientId
    });
    
    return {
        runId,
        startTime: new Date().toISOString(),
        jobType,
        clientId
    };
}

/**
 * Check if a job of the specified type is currently running
 * 
 * @param {string} jobType - Type of job to check
 * @returns {boolean} True if job is running
 */
function isJobRunning(jobType) {
    return activeJobs.has(jobType);
}

/**
 * Get information about a currently running job
 * 
 * @param {string} jobType - Type of job to check
 * @returns {Object|null} Job info or null if not running
 */
function getRunningJobInfo(jobType) {
    return activeJobs.get(jobType) || null;
}

/**
 * Complete a job and update its tracking record
 * 
 * @param {Object} params - Completion parameters
 * @param {string} params.jobType - Type of job being completed
 * @param {string} params.runId - Run ID of the job
 * @param {Object} [params.finalMetrics={}] - Final metrics for the job
 * @param {string} [params.status=STATUS_VALUES.COMPLETED] - Final status
 * @param {Object} [params.options={}] - Additional options
 * @returns {Promise<Object>} Updated job info
 */
async function completeJob(params) {
    const { 
        jobType, 
        runId, 
        finalMetrics = {}, 
        status = STATUS_VALUES.COMPLETED,
        options = {} 
    } = params;
    const log = options.logger || logger;
    
    // Verify this is an active job
    const activeJob = activeJobs.get(jobType);
    if (!activeJob) {
        log.warn(`No active job found for type ${jobType} with runId ${runId}`);
    } else if (activeJob.runId !== runId) {
        log.warn(`Active job for type ${jobType} has different runId (${activeJob.runId}) than requested (${runId})`);
    }
    
    // Standard system notes for job completion
    const endTime = new Date().toISOString();
    const systemNotes = finalMetrics['System Notes'] 
        ? `${finalMetrics['System Notes']}\nJob completed at ${endTime}` 
        : `Job completed at ${endTime}`;
    
    // Update the job tracking record
    await JobTracking.updateJob({
        runId,
        updates: {
            status,
            endTime,
            'System Notes': systemNotes,
            ...finalMetrics
        },
        options
    });
    
    // Remove from active jobs
    activeJobs.delete(jobType);
    
    return {
        runId,
        jobType,
        endTime,
        status
    };
}

module.exports = {
    startJob,
    isJobRunning,
    getRunningJobInfo,
    completeJob
};