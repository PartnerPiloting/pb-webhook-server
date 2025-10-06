const { logCriticalError } = require("../utils/errorLogger");
/**
 * services/jobMetricsService.js
 * 
 * Service for reliably aggregating and processing job metrics.
 * This service provides robust handling of metrics collection, validation,
 * and aggregation to ensure accurate reporting.
 */

const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');
const { JobTracking } = require('./jobTracking');
const runIdSystem = require('./runIdSystem');
const errorHandling = require('./jobTrackingErrorHandling');

// Import field name constants from unified constants file
const { 
  MASTER_TABLES,
  CLIENT_RUN_FIELDS, 
  JOB_TRACKING_FIELDS,
  CLIENT_RUN_STATUS_VALUES
} = require('../constants/airtableUnifiedConstants');

// Default logger - using safe creation
const logger = createSafeLogger('SYSTEM', null, 'job_metrics_service');

/**
 * Field definitions for metrics
 * Each metric has:
 * - name: The display name of the metric
 * - field: The Airtable field name
 * - type: The expected data type
 * - aggregate: How to aggregate this metric (sum, max, min, last)
 * - defaultValue: Default value if missing
 * - validate: Function to validate the value
 */
const METRIC_FIELDS = {
  LEADS_PROCESSED: {
    name: 'Leads Processed',
    field: 'Leads Processed',
    type: 'number',
    aggregate: 'sum',
    defaultValue: 0,
    validate: value => !isNaN(Number(value))
  },
  POSTS_PROCESSED: {
    name: 'Posts Processed',
    field: 'Posts Processed',
    type: 'number',
    aggregate: 'sum',
    defaultValue: 0,
    validate: value => !isNaN(Number(value))
  },
  PROFILES_EXAMINED: {
    name: 'Profiles Examined for Scoring',
    field: 'Profiles Examined for Scoring',
    type: 'number',
    aggregate: 'sum',
    defaultValue: 0,
    validate: value => !isNaN(Number(value))
  },
  PROFILES_SCORED: {
    name: 'Profiles Successfully Scored',
    field: 'Profiles Successfully Scored',
    type: 'number',
    aggregate: 'sum',
    defaultValue: 0,
    validate: value => !isNaN(Number(value))
  },
  POSTS_HARVESTED: {
    name: 'Total Posts Harvested',
    field: 'Total Posts Harvested',
    type: 'number',
    aggregate: 'sum',
    defaultValue: 0,
    validate: value => !isNaN(Number(value))
  },
  POSTS_EXAMINED: {
    name: 'Posts Examined for Scoring',
    field: 'Posts Examined for Scoring',
    type: 'number',
    aggregate: 'sum',
    defaultValue: 0,
    validate: value => !isNaN(Number(value))
  },
  POSTS_SCORED: {
    name: 'Posts Successfully Scored',
    field: 'Posts Successfully Scored',
    type: 'number',
    aggregate: 'sum',
    defaultValue: 0,
    validate: value => !isNaN(Number(value))
  },
  PROFILE_TOKENS: {
    name: 'Profile Scoring Tokens',
    field: 'Profile Scoring Tokens',
    type: 'number',
    aggregate: 'sum',
    defaultValue: 0,
    validate: value => !isNaN(Number(value))
  },
  POST_TOKENS: {
    name: 'Post Scoring Tokens',
    field: 'Post Scoring Tokens',
    type: 'number',
    aggregate: 'sum',
    defaultValue: 0,
    validate: value => !isNaN(Number(value))
  },
  TOTAL_TOKENS: {
    name: 'Total Tokens',
    field: 'Total Tokens',
    type: 'number',
    aggregate: 'sum',
    defaultValue: 0,
    validate: value => !isNaN(Number(value))
  },
  START_TIME: {
    name: 'Start Time',
    field: 'Start Time',
    type: 'datetime',
    aggregate: 'min',
    defaultValue: null,
    validate: value => !isNaN(Date.parse(value))
  },
  END_TIME: {
    name: 'End Time',
    field: 'End Time',
    type: 'datetime',
    aggregate: 'max',
    defaultValue: null,
    validate: value => !isNaN(Date.parse(value))
  },
  STATUS: {
    name: 'Status',
    field: 'Status',
    type: 'string',
    aggregate: 'last',
    defaultValue: 'Unknown',
    validate: value => typeof value === 'string' && [
      CLIENT_RUN_STATUS_VALUES.RUNNING, 
      CLIENT_RUN_STATUS_VALUES.COMPLETED, 
      CLIENT_RUN_STATUS_VALUES.FAILED, 
      CLIENT_RUN_STATUS_VALUES.NO_LEADS
    ].includes(value)
  }
};

/**
 * Normalize metric values based on their type definition
 * @param {string} metricKey - Key of the metric in METRIC_FIELDS
 * @param {*} value - Value to normalize
 * @returns {*} Normalized value
 */
function normalizeMetricValue(metricKey, value) {
  const metricDef = METRIC_FIELDS[metricKey];
  if (!metricDef) {
    return value; // No definition, return as-is
  }
  
  // Handle nullish values
  if (value === null || value === undefined) {
    return metricDef.defaultValue;
  }
  
  // Handle type conversion
  switch (metricDef.type) {
    case 'number':
      const num = Number(value);
      return isNaN(num) ? metricDef.defaultValue : num;
      
    case 'datetime':
      try {
        // Ensure it's a valid date string
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          return metricDef.defaultValue;
        }
        return value;
      } catch (e) {
        logCriticalError(e, { context: 'Date validation failed (using default)', service: 'jobMetricsService.js' }).catch(() => {});
        return metricDef.defaultValue;
      }
      
    case 'string':
      return String(value);
      
    default:
      return value;
  }
}

/**
 * Validate a set of metrics against their definitions
 * @param {Object} metrics - Metrics object to validate
 * @param {Object} [options] - Additional options
 * @returns {Object} Validation result with valid and invalid metrics
 */
function validateMetrics(metrics, options = {}) {
  const log = options.logger || logger;
  const validMetrics = {};
  const invalidMetrics = {};
  
  for (const [key, value] of Object.entries(metrics)) {
    const metricKey = Object.keys(METRIC_FIELDS).find(
      k => METRIC_FIELDS[k].field === key || METRIC_FIELDS[k].name === key
    );
    
    if (metricKey) {
      const metricDef = METRIC_FIELDS[metricKey];
      const normalizedValue = normalizeMetricValue(metricKey, value);
      
      if (metricDef.validate(normalizedValue)) {
        validMetrics[metricDef.field] = normalizedValue;
      } else {
        log.warn(`Invalid metric value for ${key}: ${value}`);
        invalidMetrics[metricDef.field] = {
          originalValue: value,
          reason: 'Validation failed',
          defaultUsed: metricDef.defaultValue
        };
        validMetrics[metricDef.field] = metricDef.defaultValue;
      }
    } else {
      // Pass through metrics that don't have definitions
      validMetrics[key] = value;
    }
  }
  
  return { validMetrics, invalidMetrics };
}

/**
 * Aggregate metrics from multiple records
 * @param {Array} records - Array of records with metrics
 * @param {Object} [options] - Additional options
 * @returns {Object} Aggregated metrics
 */
function aggregateMetrics(records, options = {}) {
  const log = options.logger || logger;
  
  if (!records || records.length === 0) {
    log.warn('No records provided for metric aggregation');
    return {};
  }
  
  log.debug(`Aggregating metrics from ${records.length} records`);
  
  const aggregated = {};
  
  // Initialize with default values
  Object.keys(METRIC_FIELDS).forEach(key => {
    const metricDef = METRIC_FIELDS[key];
    if (metricDef.aggregate === 'sum') {
      aggregated[metricDef.field] = 0;
    }
  });
  
  // Aggregate metrics based on their type
  records.forEach(record => {
    Object.keys(METRIC_FIELDS).forEach(key => {
      const metricDef = METRIC_FIELDS[key];
      const fieldName = metricDef.field;
      let rawValue;
      
      // Handle both record.get() (Airtable) and regular object access
      if (typeof record.get === 'function') {
        rawValue = record.get(fieldName);
      } else {
        rawValue = record[fieldName];
      }
      
      const value = normalizeMetricValue(key, rawValue);
      
      if (value !== null && value !== undefined) {
        switch (metricDef.aggregate) {
          case 'sum':
            aggregated[fieldName] = (aggregated[fieldName] || 0) + value;
            break;
            
          case 'min':
            if (aggregated[fieldName] === undefined || value < aggregated[fieldName]) {
              aggregated[fieldName] = value;
            }
            break;
            
          case 'max':
            if (aggregated[fieldName] === undefined || value > aggregated[fieldName]) {
              aggregated[fieldName] = value;
            }
            break;
            
          case 'last':
            aggregated[fieldName] = value;
            break;
        }
      }
    });
  });
  
  // Add derived metrics
  aggregated['Clients Processed'] = records.length;
  aggregated['Clients With Errors'] = records.filter(r => {
    const status = typeof r.get === 'function' ? r.get(CLIENT_RUN_FIELDS.STATUS) : r.Status;
    return status === CLIENT_RUN_STATUS_VALUES.FAILED;
  }).length;
  
  return aggregated;
}

/**
 * Update metrics for a client run
 * @param {Object} params - Parameters for updating client metrics
 * @param {string} params.runId - Run ID
 * @param {string} params.clientId - Client ID
 * @param {Object} params.metrics - Metrics to update
 * @param {Object} [params.options] - Options including logger
 * @returns {Promise<Object>} - The updated record
 */
async function updateClientMetrics(params) {
  const { runId, clientId, metrics, options = {} } = params;
  const log = options.logger || logger;
  
  if (!runId || !clientId) {
    log.error("Run ID and Client ID are required to update client metrics");
    throw new Error("Run ID and Client ID are required to update client metrics");
  }
  
  try {
    // First validate the metrics
    const { validMetrics, invalidMetrics } = validateMetrics(metrics, { logger: log });
    
    // Log any invalid metrics
    if (Object.keys(invalidMetrics).length > 0) {
      log.warn(`Found ${Object.keys(invalidMetrics).length} invalid metrics for client ${clientId}`);
    }
    
    // Update the client run record
    return await JobTracking.updateClientRun({
      runId,
      clientId,
      updates: validMetrics,
      options: { 
        logger: log,
        source: 'job_metrics_service' 
      }
    });
  } catch (error) {
    // Handle different types of errors
    await logCriticalError(error, { context: 'Client metrics update failed', service: 'jobMetricsService.js' }).catch(() => {});
    if (error.statusCode === 404 || (error.message && error.message.includes('not found'))) {
      const result = errorHandling.handleRecordNotFound(runId, clientId, { logger: log });
      
      if (result.shouldCreate) {
        log.info(`Creating new client metrics record for ${clientId} with run ID ${runId}`);
        return await JobTracking.createClientRun({
          runId,
          clientId,
          initialData: metrics,
          options: { 
            logger: log,
            source: 'job_metrics_service' 
          }
        });
      }
    }
    
    log.error(`Error updating client metrics: ${error.message}`);
    throw error;
  }
}

/**
 * Complete metrics for a client run
 * @param {Object} params - Parameters for completing client run metrics
 * @param {string} params.runId - Run ID
 * @param {string} params.clientId - Client ID
 * @param {Object} params.metrics - Final metrics
 * @param {boolean} [params.success=true] - Whether the run was successful
 * @param {Object} [params.options] - Options including logger
 * @returns {Promise<Object>} - The completed record
 */
async function completeClientMetrics(params) {
  const { runId, clientId, metrics = {}, success = true, options = {} } = params;
  const log = options.logger || logger;
  
  try {
    // First validate the metrics
    const { validMetrics } = validateMetrics(metrics, { logger: log });
    
    // Add end time and status - ensure status is one of the allowed values
    let status = CLIENT_RUN_STATUS_VALUES.COMPLETED;
    if (!success) {
      status = CLIENT_RUN_STATUS_VALUES.FAILED;
    } else if (validMetrics['Leads Processed'] === 0 && validMetrics['Posts Processed'] === 0) {
      status = CLIENT_RUN_STATUS_VALUES.NO_LEADS;
    }
    
    const finalMetrics = {
      ...validMetrics,
      'End Time': new Date().toISOString(),
      'Status': status
    };
    
    // Complete the client run record
    return await JobTracking.completeClientRun({
      runId,
      clientId,
      metrics: finalMetrics,
      options: { 
        logger: log,
        source: 'job_metrics_service' 
      }
    });
  } catch (error) {
    log.error(`Error completing client metrics: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'jobMetricsService.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Update aggregate metrics for a job
 * @param {Object} params - Parameters for updating job aggregates
 * @param {string} params.runId - Run ID for the job
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} - The updated record
 */
async function updateJobAggregateMetrics(params) {
  const { runId, options = {} } = params;
  const log = options.logger || logger;
  
  if (!runId) {
    log.error("Run ID is required to update job aggregate metrics");
    throw new Error("Run ID is required to update job aggregate metrics");
  }
  
  try {
    // Convert to standard format
    const standardizedRunId = runIdSystem.validateAndStandardizeRunId(runId);
    if (!standardizedRunId) {
      const result = errorHandling.handleInvalidRunId(runId, { logger: log });
      
      if (result.shouldAbort) {
        throw new Error(`Invalid run ID format: ${runId}`);
      }
      return null;
    }
    
    // Use the unified job tracking repository to aggregate and update metrics
    return await JobTracking.updateAggregateMetrics({
      runId: standardizedRunId,
      options: { 
        logger: log,
        source: 'job_metrics_service' 
      }
    });
  } catch (error) {
    log.error(`Error updating aggregate metrics: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'jobMetricsService.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Complete metrics for a job run
 * @param {Object} params - Parameters for completing job metrics
 * @param {string} params.runId - Run ID for the job
 * @param {boolean} [params.success=true] - Whether the job completed successfully
 * @param {string} [params.notes=''] - Completion notes
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} - The updated record
 */
async function completeJobMetrics(params) {
  const { runId, success = true, notes = '', options = {} } = params;
  const log = options.logger || logger;
  
  if (!runId) {
    log.error("Run ID is required to complete job metrics");
    throw new Error("Run ID is required to complete job metrics");
  }
  
  try {
    // First update aggregate metrics
    await updateJobAggregateMetrics({ runId, options });
    
    // Then complete the job with final status
    return await JobTracking.completeJob({
      runId,
      status: success ? CLIENT_RUN_STATUS_VALUES.COMPLETED : CLIENT_RUN_STATUS_VALUES.FAILED,
      systemNotes: notes,
      options: { 
        logger: log,
        source: 'job_metrics_service' 
      }
    });
  } catch (error) {
    log.error(`Error completing job metrics: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'jobMetricsService.js' }).catch(() => {});
    throw error;
  }
}

module.exports = {
  METRIC_FIELDS,
  validateMetrics,
  normalizeMetricValue,
  aggregateMetrics,
  updateClientMetrics,
  completeClientMetrics,
  updateJobAggregateMetrics,
  completeJobMetrics
};