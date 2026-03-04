/**
 * Client Run Results diagnostic - shared logic for CLI and API
 * Returns structured JSON for both use cases
 */
const { getMasterClientsBase } = require('../config/airtableClient');
const { MASTER_TABLES, CLIENT_RUN_FIELDS, JOB_TRACKING_FIELDS } = require('../constants/airtableUnifiedConstants');
const runIdSystem = require('../services/runIdSystem');

/**
 * Parse Progress Logs to compute wall clock and total processing time
 * Progress Log format: [HH:mm:ss] Message (e.g. [12:01:28] ✅ Lead Scoring: Completed (10/10, 195s, 123 tokens))
 */
function computeProcessingTimeFromProgressLogs(progressLogs) {
  const result = { wallClockSeconds: null, totalComputeSeconds: null, formatted: null };
  if (!progressLogs || progressLogs.length === 0) return result;

  const allText = progressLogs.join('\n');
  const timestampRe = /\[(\d{1,2}):(\d{2}):(\d{2})\]/g;
  const durationRe = /(\d+)s/g; // Match "195s", "5s" etc. in Completed lines

  let minSec = Infinity;
  let maxSec = -Infinity;
  let match;
  while ((match = timestampRe.exec(allText)) !== null) {
    const sec = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
    minSec = Math.min(minSec, sec);
    maxSec = Math.max(maxSec, sec);
  }

  let totalCompute = 0;
  while ((match = durationRe.exec(allText)) !== null) {
    totalCompute += parseInt(match[1], 10);
  }

  if (minSec !== Infinity && maxSec !== -Infinity) {
    result.wallClockSeconds = maxSec - minSec;
  }
  if (totalCompute > 0) {
    result.totalComputeSeconds = totalCompute;
  }

  const parts = [];
  if (result.wallClockSeconds != null) {
    const m = Math.floor(result.wallClockSeconds / 60);
    const s = result.wallClockSeconds % 60;
    result.wallClockFormatted = m > 0 ? `${m}m ${s}s` : `${s}s`;
    parts.push(`Wall clock: ${result.wallClockFormatted}`);
  }
  if (result.totalComputeSeconds != null) {
    const m = Math.floor(result.totalComputeSeconds / 60);
    const s = result.totalComputeSeconds % 60;
    parts.push(`Total compute: ${m}m ${s}s`);
  }
  result.formatted = parts.length ? parts.join(' | ') : null;

  return result;
}

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
        sort: [{ field: JOB_TRACKING_FIELDS.RUN_ID, direction: 'desc' }],
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
          progressLogPreview: hasProgressLog ? progressLog.trim().split('\n').slice(-3).join('\n') : null,
          progressLogFull: hasProgressLog ? progressLog : null
        };
      });

      const withProgressLog = records.filter(r => r.hasProgressLog).length;
      const withMetrics = records.filter(r => r.hasMetrics).length;

      // Compute total processing time from Progress Log
      const timing = computeProcessingTimeFromProgressLogs(records.map(r => r.progressLogFull).filter(Boolean));

      result.clientRunResults.records = records.map(({ progressLogFull, ...r }) => r);
      result.clientRunResults.summary = {
        total: records.length,
        withProgressLog,
        withMetrics
      };
      result.clientRunResults.processingTime = timing;

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
      sort: [{ field: JOB_TRACKING_FIELDS.RUN_ID, direction: 'desc' }],
      maxRecords: 1
    }).firstPage();
    return records?.[0]?.get(JOB_TRACKING_FIELDS.RUN_ID) || null;
  } catch {
    return null;
  }
}

/**
 * Get processing time for the previous run (for email report)
 * Current run's jobs haven't finished when email is sent, so we show the prior run's timing
 */
async function getPreviousRunProcessingTime(currentRunId) {
  try {
    const masterBase = getMasterClientsBase();
    const baseRunId = runIdSystem.getBaseRunId(currentRunId) || currentRunId;

    // Get runs with Run ID < current (older runs), sorted desc to get most recent older run
    const records = await masterBase(MASTER_TABLES.JOB_TRACKING).select({
      filterByFormula: `AND({Stream} >= 1, {${JOB_TRACKING_FIELDS.RUN_ID}} < '${baseRunId}')`,
      sort: [{ field: JOB_TRACKING_FIELDS.RUN_ID, direction: 'desc' }],
      maxRecords: 1
    }).firstPage();

    const prevRunId = records?.[0]?.get(JOB_TRACKING_FIELDS.RUN_ID);
    if (!prevRunId) return null;

    const result = await runDiagnostic(prevRunId);
    const pt = result.clientRunResults?.processingTime;
    if (!pt?.wallClockFormatted && !pt?.formatted) return null;
    return {
      runId: prevRunId,
      formatted: pt.wallClockFormatted || pt.formatted,
      fullFormatted: pt.formatted
    };
  } catch {
    return null;
  }
}

module.exports = { runDiagnostic, getPreviousRunProcessingTime };
