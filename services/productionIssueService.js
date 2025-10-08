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
   * @returns {Promise<Object>} - Analysis results
   */
  async analyzeRecentLogs(options = {}) {
    const {
      minutes = 60,
      serviceId = process.env.RENDER_SERVICE_ID,
    } = options;

    logger.info( `Analyzing last ${minutes} minutes of logs`);

    try {
      // Fetch logs from Render
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();
      
      logger.debug( 'Fetching logs from Render API...');
      const logData = await this.renderLogService.getServiceLogs(serviceId, {
        startTime,
        endTime,
        limit: 10000,
      });

      // Convert log data to text
      const logText = this.convertLogsToText(logData.logs || []);
      
      logger.debug( `Filtering ${logText.split('\n').length} log lines for issues...`);
      
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

      logger.info('analyzeRecentLogs', `Analysis complete: ${summary.critical} critical, ${summary.error} errors, ${summary.warning} warnings`);

      return {
        success: true,
        summary,
        issues: issues.length,
        createdRecords: createdRecords.length,
        timeRange: { startTime, endTime },
      };

    } catch (error) {
      logger.error('analyzeRecentLogs', `Analysis failed: ${error.message}`);
      throw error;
    }
  }

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
   * @returns {Promise<Array>} - Created Airtable records
   */
  async createProductionIssues(issues) {
    if (issues.length === 0) {
      logger.debug('createProductionIssues', 'No issues to create');
      return [];
    }

    logger.info( `Creating ${issues.length} Production Issue records`);

    const createdRecords = [];
    const errors = [];

    for (const issue of issues) {
      try {
        const record = await this.createProductionIssue(issue);
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
   * @returns {Promise<Object>} - Created Airtable record
   */
  async createProductionIssue(issue) {
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
