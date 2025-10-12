// services/productionIssueService.js
/**
 * Service for managing Production Issues in Airtable
 * Integrates Render logs, pattern filtering, and Airtable storage
 */

const { filterLogs, generateSummary } = require('./logFilterService');
const RenderLogService = require('./renderLogService');
const StackTraceService = require('./stackTraceService');
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
    // Lazy initialization - only create RenderLogService when needed
    // This prevents crashes when RENDER_API_KEY is missing but service isn't used
    this._renderLogService = null;
    this.masterBase = getMasterClientsBase();
  }

  /**
   * Get or create RenderLogService instance (lazy initialization)
   */
  get renderLogService() {
    if (!this._renderLogService) {
      this._renderLogService = new RenderLogService();
    }
    return this._renderLogService;
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
      
      // Fetch logs from Render with pagination (to get ALL logs, not just first 1000)
      logger.debug('Fetching logs from Render API with pagination...');
      
      let allLogs = [];
      let hasMore = true;
      let currentStartTime = startTime;
      let pageCount = 0;
      const maxPages = 10; // Safety limit
      
      while (hasMore && pageCount < maxPages) {
        pageCount++;
        
        const result = await this.renderLogService.getServiceLogs(serviceId, {
          startTime: currentStartTime,
          endTime,
          limit: 1000
        });
        
        allLogs = allLogs.concat(result.logs || []);
        
        hasMore = result.hasMore;
        if (hasMore && result.nextStartTime) {
          currentStartTime = result.nextStartTime;
        }
      }
      
      logger.debug(`Fetched ${allLogs.length} total logs across ${pageCount} pages`);

      // Capture last log timestamp for Phase 2 catch-up logic
      let lastLogTimestamp = null;
      if (allLogs.length > 0) {
        // Get timestamp of the last log entry
        const lastLog = allLogs[allLogs.length - 1];
        lastLogTimestamp = lastLog.timestamp || endTime; // Fallback to endTime if no timestamp
        logger.debug(`Last log timestamp: ${lastLogTimestamp}`);
      }

      // Convert log data to text
      let logText = this.convertLogsToText(allLogs);
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
        lastLogTimestamp, // Include for Phase 2 catch-up storage
        runId: runId || null,
      };

    } catch (error) {
      logger.error('analyzeRecentLogs', `Analysis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get time window from Job Tracking table for a given runId
   * @param {string} runId - Run ID to look up (may include client suffix)
   * @returns {Promise<Object>} - Object with startTime and endTime (ISO format)
   */
  async getTimeWindowFromJobTracking(runId) {
    try {
      const { JobTracking } = require('./jobTracking');
      const runIdSystem = require('./runIdSystem');
      
      // Strip client suffix if present - Job Tracking uses base Run ID only
      // Example: "251012-085512-Guy-Wilson" → "251012-085512"
      const baseRunId = runIdSystem.getBaseRunId(runId);
      
      // Look up job record using base Run ID
      const jobRecord = await JobTracking.getJobById(baseRunId);
      
      if (!jobRecord || !jobRecord.fields) {
        throw new Error(`Job Tracking record not found for runId: ${baseRunId} (original: ${runId})`);
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
   * Analyze logs from a specific timestamp (continuous streaming approach)
   * This method replaces the Phase 1 + Phase 2 approach with a single continuous scan
   * @param {Object} options - Analysis options
   * @param {string} options.startTimestamp - ISO timestamp to start from (where previous run left off)
   * @param {string} options.runId - Current run ID (for logging purposes)
   * @returns {Promise<Object>} - Analysis results
   */
  async analyzeLogsFromTimestamp(options = {}) {
    const {
      startTimestamp,
      runId = null,
      serviceId = process.env.RENDER_SERVICE_ID,
    } = options;

    if (!startTimestamp) {
      throw new Error('startTimestamp is required for analyzeLogsFromTimestamp');
    }

    try {
      const endTime = new Date().toISOString(); // Analyze up to now
      
      logger.info(`Continuous streaming analysis: ${startTimestamp} → ${endTime}${runId ? ` (current run: ${runId})` : ''}`);
      
      // Fetch logs from Render with pagination
      logger.debug('Fetching logs from Render API with pagination...');
      
      let allLogs = [];
      let hasMore = true;
      let currentStartTime = startTimestamp;
      let pageCount = 0;
      const maxPages = 10; // Safety limit
      
      while (hasMore && pageCount < maxPages) {
        pageCount++;
        
        const result = await this.renderLogService.getServiceLogs(serviceId, {
          startTime: currentStartTime,
          endTime,
          limit: 1000
        });
        
        allLogs = allLogs.concat(result.logs || []);
        
        hasMore = result.hasMore;
        if (hasMore && result.nextStartTime) {
          currentStartTime = result.nextStartTime;
        }
      }
      
      logger.debug(`Fetched ${allLogs.length} total logs across ${pageCount} pages`);

      // Capture last log timestamp for next run to continue from
      let lastLogTimestamp = null;
      if (allLogs.length > 0) {
        const lastLog = allLogs[allLogs.length - 1];
        lastLogTimestamp = lastLog.timestamp || endTime;
        logger.debug(`Last log timestamp: ${lastLogTimestamp}`);
      }

      // Convert log data to text
      let logText = this.convertLogsToText(allLogs);
      const totalLines = logText.split('\n').length;
      
      logger.debug(`Processing ${totalLines} log lines (no runId filter - will extract from errors)`);
      
      // Filter logs for issues WITHOUT runId filtering
      // This allows us to catch errors from ALL runs in this time window
      // Each error will be tagged with its own Run ID extracted from the log message
      const issues = filterLogs(logText, {
        deduplicateIssues: true,
        contextSize: 25,
        runIdFilter: null, // No filter - catch all errors and extract their Run IDs
      });

      logger.debug(`Found ${issues.length} unique issues across all runs in time window`);

      // Create Airtable records
      // Note: createProductionIssues will use the Run ID extracted from each error message
      const createdRecords = await this.createProductionIssues(issues, null);

      // Generate summary
      const summary = generateSummary(issues);

      logger.info('analyzeLogsFromTimestamp', `Analysis complete: ${summary.critical} critical, ${summary.error} errors, ${summary.warning} warnings`);

      return {
        success: true,
        summary,
        issues: issues.length,
        createdRecords: createdRecords.length,
        timeRange: { startTime: startTimestamp, endTime, source: 'continuous-streaming' },
        lastLogTimestamp, // Store this for next run to continue from
        runId: runId || null,
      };

    } catch (error) {
      logger.error('analyzeLogsFromTimestamp', `Analysis failed: ${error.message}`);
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
    
    // DEBUG: Log all issue error messages to trace what we're trying to save
    logger.debug('createProductionIssues', `Issues to create (first 25 chars of each):`);
    issues.forEach((issue, idx) => {
      logger.debug('createProductionIssues', `  ${idx + 1}. [${issue.severity}] ${issue.errorMessage.substring(0, 80)}...`);
    });

    const createdRecords = [];
    const errors = [];

    for (const issue of issues) {
      try {
        const record = await this.createProductionIssue(issue, runId);
        createdRecords.push(record);
        logger.debug('createProductionIssues', `✓ Created: ${issue.errorMessage.substring(0, 60)}...`);
      } catch (error) {
        logger.warn('createProductionIssues', `Failed to create record: ${error.message}`);
        logger.warn('createProductionIssues', `  Issue was: ${issue.errorMessage.substring(0, 80)}...`);
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

    // Add Run ID - prioritize issue.runId (extracted from error message), fall back to parameter
    const finalRunId = issue.runId || runId;
    if (finalRunId) {
      fields[FIELDS.RUN_ID] = finalRunId;
      
      // Look up Stream from Job Tracking table if Run ID is available
      try {
        const JobTracking = require('./jobTracking');
        const { JOB_TRACKING_FIELDS } = require('../constants/airtableUnifiedConstants');
        const jobRecord = await JobTracking.getJobById(finalRunId);
        
        if (jobRecord && jobRecord.fields && jobRecord.fields[JOB_TRACKING_FIELDS.STREAM]) {
          fields[FIELDS.STREAM] = jobRecord.fields[JOB_TRACKING_FIELDS.STREAM];
        }
      } catch (lookupError) {
        // Stream lookup failed - not critical, just log and continue
        logger.debug(`Could not look up Stream for Run ID ${finalRunId}: ${lookupError.message}`);
      }
    }

    // Optional fields
    if (issue.stackTrace) {
      fields[FIELDS.STACK_TRACE] = issue.stackTrace.substring(0, 100000);
    }
    
    // Look up stack trace from Stack Traces table if timestamp marker found
    if (issue.stackTraceTimestamp) {
      try {
        const stackTraceService = new StackTraceService();
        const stackTrace = await stackTraceService.lookupStackTrace(issue.stackTraceTimestamp);
        
        if (stackTrace) {
          logger.debug('createProductionIssue', `Found stack trace for timestamp: ${issue.stackTraceTimestamp}`);
          fields[FIELDS.STACK_TRACE] = stackTrace.substring(0, 100000);
        } else {
          logger.debug('createProductionIssue', `No stack trace found for timestamp: ${issue.stackTraceTimestamp}`);
        }
      } catch (lookupError) {
        // Stack trace lookup failed - not critical, just log and continue
        logger.debug('createProductionIssue', `Failed to lookup stack trace: ${lookupError.message}`);
      }
    }

    if (issue.runType) {
      fields[FIELDS.RUN_TYPE] = issue.runType;
    }

    // Only set stream from issue if we didn't already get it from Job Tracking
    if (!fields[FIELDS.STREAM] && issue.stream) {
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
      // Fetch logs from Render with pagination
      logger.debug( 'Fetching logs from Render API with pagination...');
      
      let allLogs = [];
      let hasMore = true;
      let currentStartTime = startTime.toISOString();
      let pageCount = 0;
      const maxPages = 10;
      
      while (hasMore && pageCount < maxPages) {
        pageCount++;
        
        const result = await this.renderLogService.getServiceLogs(serviceId, {
          startTime: currentStartTime,
          endTime: endTime.toISOString(),
          limit: 1000
        });
        
        allLogs = allLogs.concat(result.logs || []);
        
        hasMore = result.hasMore;
        if (hasMore && result.nextStartTime) {
          currentStartTime = result.nextStartTime;
        }
      }
      
      logger.debug(`Fetched ${allLogs.length} total logs across ${pageCount} pages`);

      // Convert to text
      const allLogsText = this.convertLogsToText(allLogs);
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

  /**
   * Phase 2 Catch-Up Logic: Analyze logs from previous run for missed errors
   * Looks up previous run's Last Analyzed Log Timestamp, fetches logs since then,
   * and extracts errors that should have been caught in the original run.
   * 
   * @param {string} previousRunId - Run ID of the previous run to check for missed errors
   * @param {string} currentRunId - Current run ID (for logging only)
   * @returns {Promise<Object>} - Catch-up results with back-filled errors
   */
  async catchUpPreviousRun(previousRunId, currentRunId) {
    logger.info(`🔄 PHASE 2 CATCH-UP: Checking previous run ${previousRunId} for missed errors...`);

    try {
      const { JOB_TRACKING_FIELDS } = require('../constants/airtableUnifiedConstants');
      const JobTracking = require('./jobTracking');

      // 1. Get previous run's Job Tracking record
      const previousJobRecord = await JobTracking.getJobById(previousRunId);
      
      if (!previousJobRecord || !previousJobRecord.fields) {
        logger.warn(`⚠️ Previous run ${previousRunId} not found in Job Tracking - skipping catch-up`);
        return { success: false, reason: 'Previous run not found', backFilledErrors: 0 };
      }

      // 2. Check if previous run has Last Analyzed Log Timestamp
      const lastAnalyzedTimestamp = previousJobRecord.fields[JOB_TRACKING_FIELDS.LAST_ANALYZED_LOG_ID];
      
      if (!lastAnalyzedTimestamp) {
        logger.info(`ℹ️ Previous run ${previousRunId} has no Last Analyzed Log Timestamp - nothing to catch up`);
        return { success: true, reason: 'No previous analysis', backFilledErrors: 0 };
      }

      logger.info(`📍 Previous run last analyzed timestamp: ${lastAnalyzedTimestamp}`);

      // 3. Get previous run's time window
      const startTime = previousJobRecord.fields[JOB_TRACKING_FIELDS.START_TIME];
      let endTime = previousJobRecord.fields[JOB_TRACKING_FIELDS.END_TIME];

      if (!startTime) {
        logger.warn(`⚠️ Previous run ${previousRunId} missing Start Time - skipping catch-up`);
        return { success: false, reason: 'Missing start time', backFilledErrors: 0 };
      }

      // Handle missing end time (job crashed or still running)
      if (!endTime) {
        logger.warn(`⚠️ Previous run ${previousRunId} missing End Time, using start + 30 minutes`);
        const startDate = new Date(startTime);
        endTime = new Date(startDate.getTime() + 30 * 60 * 1000).toISOString();
      }

      logger.info(`⏰ Previous run time window: ${startTime} to ${endTime}`);

      // 4. Fetch logs from Render starting AFTER lastAnalyzedTimestamp
      // Only get logs that were written after the auto-analyzer ran
      logger.info(`🔍 Fetching logs from Render after timestamp: ${lastAnalyzedTimestamp}...`);
      
      const result = await this.renderLogService.getServiceLogs(process.env.RENDER_SERVICE_ID, {
        startTime: lastAnalyzedTimestamp, // Start from last analyzed timestamp
        endTime,
        limit: 1000
      });

      const newLogs = result.logs || [];
      logger.info(`📥 Fetched ${newLogs.length} new logs since last analysis`);

      if (newLogs.length === 0) {
        logger.info(`✅ No new logs found - previous run was fully analyzed`);
        return { success: true, reason: 'No new logs', backFilledErrors: 0 };
      }

      // 5. Convert logs to text and filter for errors
      const logText = this.convertLogsToText(newLogs);
      
      // Filter logs for issues matching the PREVIOUS run ID (not current run)
      const issues = filterLogs(logText, {
        deduplicateIssues: true,
        contextSize: 25,
        runIdFilter: previousRunId, // CRITICAL: Tag errors with original run ID
      });

      logger.info(`🔍 Found ${issues.length} missed errors from previous run ${previousRunId}`);

      if (issues.length === 0) {
        return { success: true, reason: 'No missed errors found', backFilledErrors: 0 };
      }

      // 6. Create Production Issue records with PREVIOUS run ID (back-fill)
      const createdRecords = await this.createProductionIssues(issues, previousRunId);

      logger.info(`✅ PHASE 2 CATCH-UP: Back-filled ${createdRecords.length} errors for previous run ${previousRunId}`);

      return {
        success: true,
        previousRunId,
        currentRunId,
        backFilledErrors: createdRecords.length,
        summary: generateSummary(issues),
        records: createdRecords,
      };

    } catch (error) {
      logger.error(`❌ PHASE 2 CATCH-UP FAILED: ${error.message}`);
      throw error;
    }
  }
}

module.exports = ProductionIssueService;
