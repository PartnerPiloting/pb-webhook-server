/**
 * Client Run Results diagnostic - shared logic for CLI and API
 * Returns structured JSON for both use cases
 */
const { getMasterClientsBase } = require('../config/airtableClient');
const { MASTER_TABLES, CLIENT_RUN_FIELDS, JOB_TRACKING_FIELDS } = require('../constants/airtableUnifiedConstants');
const runIdSystem = require('../services/runIdSystem');

/**
 * Run the Client Run Results diagnostic
 * @param {string} [runIdArg] - Optional specific run ID to check
 * @returns {Promise<Object>} Diagnostic result
 */
async function runDiagnostic(runIdArg = null) {
  const result = {
    success: false,
    jobTracking: { runs: [], error: null },
    clientRunResults: { runId: null, records: [], summary: {}, error: null },
    overallStatus: null,
    message: null
  };

  try {
    const masterBase = getMasterClientsBase();

    // 1. Get recent Smart Resume runs from Job Tracking
    try {
      const jobRecords = await masterBase(MASTER_TABLES.JOB_TRACKING).select({
        filterByFormula: runIdArg
          ? `FIND('${runIdArg}', {${JOB_TRACKING_FIELDS.RUN_ID}}) > 0`
          : '{Stream} >= 1',
        sort: [{ field: 'Last Updated', direction: 'desc' }],
        maxRecords: runIdArg ? 5 : 10
      }).firstPage();

      result.jobTracking.runs = (jobRecords || []).map(rec => ({
        runId: rec.get(JOB_TRACKING_FIELDS.RUN_ID),
        stream: rec.get(JOB_TRACKING_FIELDS.STREAM),
        status: rec.get(JOB_TRACKING_FIELDS.STATUS) || 'N/A'
      }));
    } catch (err) {
      result.jobTracking.error = err.message;
      result.message = `Job Tracking error: ${err.message}`;
      return result;
    }

    const targetRunId = runIdArg || (await getMostRecentSmartResumeRunId(masterBase));
    if (!targetRunId) {
      result.message = 'No Job Tracking records found';
      return result;
    }

    result.clientRunResults.runId = targetRunId;

    // 2. Get Client Run Results for the run
    try {
      const baseRunId = runIdSystem.getBaseRunId(targetRunId) || targetRunId;
      const formula = `FIND('${baseRunId}', {${CLIENT_RUN_FIELDS.RUN_ID}}) > 0`;

      const crrRecords = await masterBase(MASTER_TABLES.CLIENT_RUN_RESULTS).select({
        filterByFormula: formula,
        maxRecords: 50
      }).firstPage();

      const records = (crrRecords || []).map(rec => {
        const progressLog = rec.get(CLIENT_RUN_FIELDS.PROGRESS_LOG) || '';
        const profilesScored = rec.get(CLIENT_RUN_FIELDS.PROFILES_SCORED);
        const postsScored = rec.get(CLIENT_RUN_FIELDS.POSTS_SCORED);
        const profileTokens = rec.get(CLIENT_RUN_FIELDS.PROFILE_SCORING_TOKENS);
        const postTokens = rec.get(CLIENT_RUN_FIELDS.POST_SCORING_TOKENS);
        const hasProgressLog = progressLog && progressLog.trim().length > 0;
        const hasMetrics = (profilesScored != null && profilesScored > 0) ||
          (postsScored != null && postsScored > 0) ||
          (profileTokens != null && profileTokens > 0) ||
          (postTokens != null && postTokens > 0);

        return {
          clientId: rec.get(CLIENT_RUN_FIELDS.CLIENT_ID),
          clientName: rec.get(CLIENT_RUN_FIELDS.CLIENT_NAME),
          runId: rec.get(CLIENT_RUN_FIELDS.RUN_ID),
          hasProgressLog,
          hasMetrics,
          profilesScored: profilesScored ?? null,
          postsScored: postsScored ?? null,
          progressLogPreview: hasProgressLog ? progressLog.trim().split('\n').slice(-3).join('\n') : null
        };
      });

      const withProgressLog = records.filter(r => r.hasProgressLog).length;
      const withMetrics = records.filter(r => r.hasMetrics).length;

      result.clientRunResults.records = records;
      result.clientRunResults.summary = {
        total: records.length,
        withProgressLog,
        withMetrics
      };

      result.success = true;

      if (records.length === 0) {
        result.overallStatus = 'no_records';
        result.message = 'No Client Run Results found - records may not be created';
      } else if (withProgressLog === 0) {
        result.overallStatus = 'not_updated';
        result.message = 'Records exist but none have Progress Log - operations not updating';
      } else if (withProgressLog < records.length) {
        result.overallStatus = 'partial';
        result.message = `${records.length - withProgressLog} record(s) not yet updated`;
      } else {
        result.overallStatus = 'ok';
        result.message = 'Client Run Results are being updated correctly';
      }
    } catch (err) {
      result.clientRunResults.error = err.message;
      result.message = `Client Run Results error: ${err.message}`;
    }

    return result;
  } catch (err) {
    result.message = err.message;
    return result;
  }
}

async function getMostRecentSmartResumeRunId(masterBase) {
  try {
    const records = await masterBase(MASTER_TABLES.JOB_TRACKING).select({
      filterByFormula: '{Stream} >= 1',
      sort: [{ field: 'Last Updated', direction: 'desc' }],
      maxRecords: 1
    }).firstPage();
    return records?.[0]?.get(JOB_TRACKING_FIELDS.RUN_ID) || null;
  } catch {
    return null;
  }
}

module.exports = { runDiagnostic };
