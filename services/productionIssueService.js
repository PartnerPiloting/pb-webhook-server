// services/productionIssueService.js
/**
 * Service for managing Production Issues in Airtable
 * Integrates Render logs, pattern filtering, and Airtable storage
 */

const { filterLogs, generateSummary } = require('./logFilterService');
const RenderLogService = require('./renderLogService');
const { getMasterClientsBase } = require('../config/airtableClient');
const { createSafeLogger } = require('../utils/loggerHelper');

const logger = createSafeLogger('PRODUCTION-ISSUES', 'SERVICE');

// Airtable field names for Production Issues table
const PRODUCTION_ISSUES_TABLE = 'Production Issues';
const FIELDS = {
  TIMESTAMP: 'Timestamp',
  SEVERITY: 'Severity',
  PATTERN_MATCHED: 'Pattern Matched',
  ERROR_MESSAGE: 'Error Message',
  CONTEXT: 'Context',
  STACK_TRACE: 'Stack Trace',
  RUN_ID: 'Run ID',
  RUN_TYPE: 'Run Type',
  STREAM: 'Stream',
  CLIENT: 'Client ID',
  SERVICE_FUNCTION: 'Service/Function',
  STATUS: 'Status',
  FIXED_TIME: 'Fixed Time',
  FIX_NOTES: 'Fix Notes',
  FIX_COMMIT: 'Fix Commit',
  RENDER_LOG_URL: 'Render Log URL',
  OCCURRENCES: 'Occurrences',
  FIRST_SEEN: 'First Seen',
  LAST_SEEN: 'Last Seen',
};

class ProductionIssueService {
  constructor() {
    this.renderLogService = new RenderLogService();
    this.masterBase = getMasterClientsBase();
  }

  /**
   * Analyze recent logs and create Production Issue records
   * @param {Object} options - Analysis options
   * @param {string} options.runId - Optional run ID to filter logs and look up time window from Job Tracking
   * @param {number} options.minutes - Minutes to analyze (fallback if no runId or Job Tracking lookup fails)
   * @param {string} options.startTime - Override start time (ISO format)
   * @param {string} options.endTime - Override end time (ISO format)
   * @returns {Promise<Object>} - Analysis results
   */
  async analyzeRecentLogs(options = {}) {
    const {
      runId = null,
      minutes = 60,
      startTime: overrideStartTime = null,
      endTime: overrideEndTime = null,
      serviceId = process.env.RENDER_SERVICE_ID,
    } = options;

    let startTime, endTime, timeSource;

    try {
      // Determine time window based on input
      if (overrideStartTime && overrideEndTime) {
        // Manual override provided
        startTime = overrideStartTime;
        endTime = overrideEndTime;
        timeSource = 'manual-override';
        logger.info(`Using manual time override: ${startTime} to ${endTime}`);
      } else if (runId) {
        // Look up time window from Job Tracking table
        logger.info(`Looking up time window for runId: ${runId}`);
        const timeWindow = await this.getTimeWindowFromJobTracking(runId);
        startTime = timeWindow.startTime;
        endTime = timeWindow.endTime;
        timeSource = 'job-tracking';
        logger.info(`Retrieved time window from Job Tracking: ${startTime} to ${endTime}`);
      } else {
        // Fallback: use minutes parameter
        endTime = new Date().toISOString();
        startTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();
        timeSource = 'minutes-fallback';
        logger.info(`Using fallback time window (last ${minutes} minutes): ${startTime} to ${endTime}`);
      }

      logger.info(`Analyzing logs${runId ? ` for runId: ${runId}` : ''} (${timeSource})`);
      
      // Fetch logs from Render
      logger.debug('Fetching logs from Render API...');
      const logData = await this.renderLogService.getServiceLogs(serviceId, {
        startTime,
        endTime,
        limit: 10000,
      });

      // Convert log data to text
      let logText = this.convertLogsToText(logData.logs || []);
      const totalLines = logText.split('\n').length;
      
      if (runId) {
        logger.debug(`Processing ${totalLines} log lines with runId filter: ${runId}`);
      } else {
        logger.debug(`Processing ${totalLines} log lines (no runId filter)`);
      }
      
      // Filter logs for issues (filterLogs will handle runId filtering of errors and context)
      const issues = filterLogs(logText, {
        deduplicateIssues: true,
        contextSize: 25,
        runIdFilter: runId, // Pass runId for filtering errors and context
      });

      logger.debug(`Found ${issues.length} unique issues${runId ? ` matching runId ${runId}` : ''}`);

      // Create Airtable records
      const createdRecords = await this.createProductionIssues(issues, runId);

      // Generate summary
      const summary = generateSummary(issues);

      logger.info('analyzeRecentLogs', `Analysis complete: ${summary.critical} critical, ${summary.error} errors, ${summary.warning} warnings`);

      return {
        success: true,
        summary,
        issues: issues.length,
        createdRecords: createdRecords.length,
        timeRange: { startTime, endTime, source: timeSource },
        runId: runId || null,
      };

    } catch (error) {
      logger.error('analyzeRecentLogs', `Analysis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get time window from Job Tracking table for a given runId
   * @param {string} runId - Run ID to look up
   * @returns {Promise<Object>} - Object with startTime and endTime (ISO format)
   */
  async getTimeWindowFromJobTracking(runId) {
    try {
      const { JobTracking } = require('./jobTracking');
      
      // Look up job record
      const jobRecord = await JobTracking.getJobById(runId);
      
      if (!jobRecord || !jobRecord.fields) {
        throw new Error(`Job Tracking record not found for runId: ${runId}`);
      }

      const { JOB_TRACKING_FIELDS } = require('../constants/airtableUnifiedConstants');
      const startTime = jobRecord.fields[JOB_TRACKING_FIELDS.START_TIME];
      let endTime = jobRecord.fields[JOB_TRACKING_FIELDS.END_TIME];

      if (!startTime) {
        throw new Error(`Start time not found in Job Tracking record for runId: ${runId}`);
      }

      // Handle missing end time (job crashed or still running)
      if (!endTime) {
        logger.warn(`End time missing for runId ${runId}, using start + 30 minutes or now`);
        const startDate = new Date(startTime);
        const thirtyMinutesLater = new Date(startDate.getTime() + 30 * 60 * 1000);
        const now = new Date();
        
        // Use whichever is earlier: 30 minutes after start or now
        endTime = (thirtyMinutesLater < now ? thirtyMinutesLater : now).toISOString();
      }

      return {
        startTime: new Date(startTime).toISOString(), // Convert to ISO UTC
        endTime: new Date(endTime).toISOString(),
      };

    } catch (error) {
      logger.error(`Failed to get time window from Job Tracking: ${error.message}`);
      throw error;
    }
  }

  /**
   * Filter log text to only include lines with the specified runId
   * Uses hybrid approach: includes matching runId + lines without ANY runId pattern
   * @param {string} logText - Raw log text
  /**
   * Analyze logs from provided text (manual paste)
   * @param {string} logText - Raw log text
   * @returns {Promise<Object>} - Analysis results
   */
  async analyzeLogText(logText) {
    logger.info( `Analyzing provided log text (${logText.length} chars)`);

    try {
      // Filter logs for issues
      const issues = filterLogs(logText, {
        deduplicateIssues: true,
        contextSize: 25,
      });

      logger.debug( `Found ${issues.length} unique issues`);

      // Create Airtable records
      const createdRecords = await this.createProductionIssues(issues);

      // Generate summary
      const summary = generateSummary(issues);

      logger.info('analyzeLogText', `Analysis complete: ${summary.critical} critical, ${summary.error} errors, ${summary.warning} warnings`);

      return {
        success: true,
        summary,
        issues: issues.length,
        createdRecords: createdRecords.length,
      };

    } catch (error) {
      logger.error('analyzeLogText', `Analysis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create Production Issue records in Airtable
   * @param {Array} issues - Filtered issues from logFilterService
   * @param {string} runId - Optional run ID to associate with all issues
   * @returns {Promise<Array>} - Created Airtable records
   */
  async createProductionIssues(issues, runId = null) {
    if (issues.length === 0) {
      logger.debug('createProductionIssues', 'No issues to create');
      return [];
    }

    logger.info( `Creating ${issues.length} Production Issue records${runId ? ` for runId: ${runId}` : ''}`);

    const createdRecords = [];
    const errors = [];

    for (const issue of issues) {
      try {
        const record = await this.createProductionIssue(issue, runId);
        createdRecords.push(record);
      } catch (error) {
        logger.warn('createProductionIssues', `Failed to create record: ${error.message}`);
        errors.push({ issue, error: error.message });
      }
    }

    if (errors.length > 0) {
      logger.warn('createProductionIssues', `${errors.length} records failed to create`);
    }

    logger.info('createProductionIssues', `Created ${createdRecords.length} of ${issues.length} records`);

    return createdRecords;
  }

  /**
   * Create a single Production Issue record
   * @param {Object} issue - Issue object from logFilterService
   * @param {string} runId - Optional run ID to associate with the issue
   * @returns {Promise<Object>} - Created Airtable record
   */
  async createProductionIssue(issue, runId = null) {
    const fields = {
      [FIELDS.TIMESTAMP]: issue.timestamp.toISOString(),
      [FIELDS.SEVERITY]: issue.severity,
      [FIELDS.PATTERN_MATCHED]: issue.patternMatched || 'Unknown pattern',
      [FIELDS.ERROR_MESSAGE]: issue.errorMessage.substring(0, 100000), // Airtable limit
      [FIELDS.CONTEXT]: issue.context.substring(0, 100000), // Airtable limit
      [FIELDS.STATUS]: 'NEW',
      [FIELDS.OCCURRENCES]: issue.occurrences || 1,
      [FIELDS.FIRST_SEEN]: issue.firstSeen.toISOString(),
      [FIELDS.LAST_SEEN]: issue.lastSeen.toISOString(),
    };

    // Add Run ID if provided
    if (runId) {
      fields[FIELDS.RUN_ID] = runId;
    }

    // Optional fields
    if (issue.stackTrace) {
      fields[FIELDS.STACK_TRACE] = issue.stackTrace.substring(0, 100000);
    }

    if (issue.runType) {
      fields[FIELDS.RUN_TYPE] = issue.runType;
    }

    if (issue.stream) {
      fields[FIELDS.STREAM] = parseInt(issue.stream, 10);
    }

    if (issue.service) {
      fields[FIELDS.SERVICE_FUNCTION] = issue.service;
    }

    if (issue.clientId) {
      fields[FIELDS.CLIENT] = issue.clientId; // Store client name/ID as text
    }

    const record = await this.masterBase(PRODUCTION_ISSUES_TABLE).create(fields);
    return record;
  }

  /**
   * Convert Render log array to text format
   * @param {Array} logs - Array of log objects from Render API
   * @returns {string} - Log text
   */
  convertLogsToText(logs) {
    if (!Array.isArray(logs)) {
      return String(logs);
    }

    return logs
      .map(log => {
        if (typeof log === 'string') return log;
        if (log.message) return `[${log.timestamp || ''}] ${log.message}`;
        return JSON.stringify(log);
      })
      .join('\n');
  }

  /**
   * Get all Production Issues with filters
   * @param {Object} filters - Filtering options
   * @returns {Promise<Array>} - Production Issue records
   */
  async getProductionIssues(filters = {}) {
    const {
      status = null,
      severity = null,
      limit = 100,
    } = filters;

    let formula = '';
    const conditions = [];

    if (status) {
      conditions.push(`{${FIELDS.STATUS}} = '${status}'`);
    }

    if (severity) {
      conditions.push(`{${FIELDS.SEVERITY}} = '${severity}'`);
    }

    if (conditions.length > 0) {
      formula = `AND(${conditions.join(', ')})`;
    }

    const query = this.masterBase(PRODUCTION_ISSUES_TABLE).select({
      maxRecords: limit,
      sort: [{ field: FIELDS.TIMESTAMP, direction: 'desc' }],
    });

    if (formula) {
      query.filterByFormula = formula;
    }

    const records = await query.all();
    return records;
  }

  /**
   * Update a Production Issue record
   * @param {string} recordId - Airtable record ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} - Updated record
   */
  async updateProductionIssue(recordId, updates) {
    const record = await this.masterBase(PRODUCTION_ISSUES_TABLE).update(recordId, updates);
    return record;
  }

  /**
   * Mark an issue as fixed
   * @param {string} recordId - Airtable record ID
   * @param {Object} fixInfo - Fix information
   * @returns {Promise<Object>} - Updated record
   */
  async markAsFixed(recordId, fixInfo = {}) {
    const {
      fixNotes = '',
      commitHash = '',
    } = fixInfo;

    const updates = {
      [FIELDS.STATUS]: 'FIXED',
      [FIELDS.FIXED_TIME]: new Date().toISOString(), // Datetime field
      [FIELDS.FIX_NOTES]: fixNotes,
    };

    if (commitHash) {
      updates[FIELDS.FIX_COMMIT] = commitHash;
    }

    return this.updateProductionIssue(recordId, updates);
  }

  /**
   * Analyze logs for a specific run ID
   * @param {Object} options - Analysis options
   * @param {string} options.runId - Run ID to analyze (e.g., "251008-143015")
   * @param {Date} options.startTime - Actual start time of the run
   * @param {Date} options.endTime - Actual end time of the run
   * @param {number} options.stream - Stream number (1, 2, or 3)
   * @param {string} options.serviceId - Render service ID (optional)
   * @returns {Promise<Object>} - Analysis results
   */
  async analyzeRunLogs(options = {}) {
    const {
      runId,
      startTime,
      endTime,
      stream = 1,
      serviceId = process.env.RENDER_SERVICE_ID,
    } = options;

    // Validate required parameters
    if (!runId) {
      throw new Error('runId is required for log analysis');
    }

    if (!startTime || !endTime) {
      throw new Error('startTime and endTime are required for log analysis');
    }

    logger.info( `Analyzing logs for run ${runId} (stream ${stream})`);
    logger.debug('analyzeRunLogs', `Time window: ${startTime.toISOString()} to ${endTime.toISOString()}`);

    try {
      // Fetch logs from Render for the exact time window
      logger.debug( 'Fetching logs from Render API...');
      const logData = await this.renderLogService.getServiceLogs(serviceId, {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        limit: 10000,
      });

      // Convert to text
      const allLogsText = this.convertLogsToText(logData.logs || []);
      const allLogLines = allLogsText.split('\n');
      
      logger.debug( `Fetched ${allLogLines.length} total log lines from time window`);

      if (allLogLines.length === 0) {
        logger.warn('analyzeRunLogs', `No logs found in time window`);
        return {
          success: true,
          runId,
          stream,
          message: 'No logs found in time window',
          issuesFound: 0,
          createdRecords: 0,
        };
      }

      // Analyze ALL logs in the time window (no filtering by runId)
      // With structured logging, every line will have [runId] prefix, so we get complete coverage
      logger.debug( 'Running pattern matching on all logs in time window...');
      const issues = filterLogs(allLogsText, {
        deduplicateIssues: true,
        contextSize: 25,
      });

      logger.debug( `Found ${issues.length} unique issues`);

      // Enrich issues with run metadata
      const enrichedIssues = issues.map(issue => ({
        ...issue,
        runType: 'smart-resume',
        stream: stream,
      }));

      // Create Production Issue records
      const createdRecords = await this.createProductionIssues(enrichedIssues);

      const summary = generateSummary(enrichedIssues);

      logger.info('analyzeRunLogs', `Analysis complete: ${createdRecords.length} Production Issues created`);

      return {
        success: true,
        runId,
        stream,
        summary,
        issuesFound: issues.length,
        createdRecords: createdRecords.length,
        records: createdRecords,
      };

    } catch (error) {
      logger.error('analyzeRunLogs', `Analysis failed: ${error.message}`);
      throw error;
    }
  }
}

module.exports = ProductionIssueService;
