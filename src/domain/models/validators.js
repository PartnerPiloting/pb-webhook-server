/**
 * validators.js
 * Business rule validators
 * Ensures data integrity and business logic compliance
 */

const { STATUS, SERVICE_LEVELS, LIMITS } = require('./constants');

/**
 * Custom validation error with field context
 */
class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

const validators = {
  /**
   * Validate client configuration
   */
  validateClient(client) {
    if (!client.clientId) {
      throw new ValidationError('Client ID is required', 'clientId');
    }
    
    if (!client.clientName) {
      throw new ValidationError('Client name is required', 'clientName');
    }
    
    if (client.serviceLevel && !Object.values(SERVICE_LEVELS).includes(Number(client.serviceLevel))) {
      throw new ValidationError(`Invalid service level: ${client.serviceLevel}`, 'serviceLevel');
    }
    
    if (client.status && client.status !== 'Active' && client.status !== 'Inactive') {
      throw new ValidationError(`Invalid client status: ${client.status}`, 'status');
    }
    
    return true;
  },
  
  /**
   * Validate run record status transitions
   */
  validateStatusTransition(currentStatus, newStatus, processType = 'RUN_RECORD') {
    const validStatuses = STATUS[processType];
    if (!validStatuses) {
      throw new ValidationError(`Unknown process type: ${processType}`, 'processType');
    }
    
    // Check if new status is valid
    if (!Object.values(validStatuses).includes(newStatus)) {
      throw new ValidationError(`Invalid status for ${processType}: ${newStatus}`, 'status');
    }
    
    // Define valid transitions
    const transitions = {
      [STATUS.RUN_RECORD.RUNNING]: [STATUS.RUN_RECORD.COMPLETED, STATUS.RUN_RECORD.FAILED, STATUS.RUN_RECORD.PARTIAL],
      [STATUS.RUN_RECORD.COMPLETED]: [], // Terminal state
      [STATUS.RUN_RECORD.FAILED]: [], // Terminal state
      [STATUS.RUN_RECORD.PARTIAL]: [STATUS.RUN_RECORD.COMPLETED, STATUS.RUN_RECORD.FAILED]
    };
    
    // If current status exists, check if transition is valid
    if (currentStatus && transitions[currentStatus]) {
      const allowedTransitions = transitions[currentStatus];
      if (allowedTransitions.length > 0 && !allowedTransitions.includes(newStatus)) {
        throw new ValidationError(
          `Invalid status transition from ${currentStatus} to ${newStatus}`, 
          'statusTransition'
        );
      }
    }
    
    return true;
  },
  
  /**
   * Validate batch size
   */
  validateBatchSize(size, processType) {
    const maxSize = LIMITS[`${processType}_BATCH_SIZE`];
    if (maxSize && size > maxSize) {
      throw new ValidationError(
        `Batch size ${size} exceeds maximum of ${maxSize} for ${processType}`,
        'batchSize'
      );
    }
    if (size < 1) {
      throw new ValidationError('Batch size must be at least 1', 'batchSize');
    }
    return true;
  },
  
  /**
   * Validate run ID format
   */
  validateRunId(runId) {
    // Format: YYYY-MM-DD-HH-MM-SS-clientId
    const runIdPattern = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[\w-]+$/;
    if (!runIdPattern.test(runId)) {
      throw new ValidationError(
        `Invalid run ID format: ${runId}. Expected: YYYY-MM-DD-HH-MM-SS-clientId`,
        'runId'
      );
    }
    return true;
  },
  
  /**
   * Check if client should get post harvesting
   */
  shouldHarvestPosts(client) {
    return Number(client.serviceLevel) >= SERVICE_LEVELS.STANDARD;
  },
  
  /**
   * Check if client should get post scoring
   * (Same as post harvesting - both require service level 2+)
   */
  shouldScorePosts(client) {
    return Number(client.serviceLevel) >= SERVICE_LEVELS.STANDARD;
  },

  /**
   * Check if client is eligible for lead scoring
   * (All active clients get lead scoring)
   */
  shouldScoreLeads(client) {
    return client.status === 'Active';
  },
  
  /**
   * Check if processing is stuck (exceeded timeout)
   * Used for both lead and post processing status checks
   */
  isProcessingStuck(lastCheckTime, timeoutMinutes = LIMITS.PROCESSING_STATUS_TIMEOUT_MINUTES) {
    if (!lastCheckTime) return false;
    const lastCheck = new Date(lastCheckTime);
    const now = new Date();
    const diffMinutes = (now - lastCheck) / (1000 * 60);
    return diffMinutes > timeoutMinutes;
  },
  
  /**
   * Check if a lead is eligible for post harvesting
   * Based on the complex rules in apifyProcessRoutes.js
   */
  isLeadEligibleForHarvesting(lead, FIELDS, STATUS) {
    // Must have LinkedIn URL
    if (!lead[FIELDS.LEADS.LINKEDIN_URL]) return false;
    
    // Must not be actioned already
    if (lead[FIELDS.LEADS.POSTS_ACTIONED]) return false;
    
    // Must not have been post-scored already
    if (lead[FIELDS.LEADS.DATE_POSTS_SCORED]) return false;
    
    // Check harvest status
    const status = lead[FIELDS.LEADS.POSTS_HARVEST_STATUS];
    
    // Permanently skip 'No Posts' status
    if (status === STATUS.POST_HARVESTING.NO_POSTS) return false;
    
    // Accept if Pending, blank, or Processing but stuck
    if (!status || status === '' || status === STATUS.POST_HARVESTING.PENDING) return true;
    
    if (status === STATUS.POST_HARVESTING.PROCESSING) {
      return this.isProcessingStuck(lead[FIELDS.LEADS.LAST_POST_CHECK_AT]);
    }
    
    return false;
  }
};

module.exports = {
  ValidationError,
  ...validators
};