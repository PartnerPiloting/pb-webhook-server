/* ===================================================================
   analyze-production-issues.js - Analyze Production Issues table
   -------------------------------------------------------------------
   Permanent utility to analyze errors captured in Production Issues:
   - Group by severity (ERROR vs WARNING)
   - Group by pattern matched
   - Show frequency counts
   - Identify most critical issues to fix
   - Support filtering by date range, run ID, client
   
   Usage:
     node analyze-production-issues.js                    # All errors
     node analyze-production-issues.js --runId=251009-... # Specific run
     node analyze-production-issues.js --days=7           # Last 7 days
     node analyze-production-issues.js --severity=ERROR   # Only errors
     node analyze-production-issues.js --client=Guy-Wilson # Specific client
=================================================================== */

const Airtable = require('airtable');

// Initialize Airtable
const MASTER_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID || 'appuSM90MqrdM1e4U';
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(MASTER_BASE_ID);

/* ------------------------------------------------------------------
   Parse command-line arguments
------------------------------------------------------------------ */
function parseArgs() {
  const args = {
    runId: null,
    days: null,
    severity: null,
    client: null,
    limit: 1000
  };

  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--runId=')) args.runId = arg.split('=')[1];
    else if (arg.startsWith('--days=')) args.days = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--severity=')) args.severity = arg.split('=')[1];
    else if (arg.startsWith('--client=')) args.client = arg.split('=')[1];
    else if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1]);
  });

  return args;
}

/* ------------------------------------------------------------------
   Build Airtable filter formula based on arguments
------------------------------------------------------------------ */
function buildFilter(args) {
  const conditions = [];

  if (args.runId) {
    conditions.push(`{Run ID} = '${args.runId}'`);
  }

  if (args.days) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - args.days);
    const isoDate = cutoffDate.toISOString().split('T')[0];
    conditions.push(`IS_AFTER({Timestamp}, '${isoDate}')`);
  }

  if (args.severity) {
    conditions.push(`{Severity} = '${args.severity}'`);
  }

  if (args.client) {
    conditions.push(`FIND('${args.client}', {Client ID})`);
  }

  if (conditions.length === 0) return '';
  if (conditions.length === 1) return conditions[0];
  return `AND(${conditions.join(', ')})`;
}

/* ------------------------------------------------------------------
   Fetch all Production Issues matching filter
------------------------------------------------------------------ */
async function fetchIssues(filterFormula, limit) {
  const issues = [];
  
  const queryOptions = {
    maxRecords: limit,
    sort: [{ field: 'Timestamp', direction: 'desc' }]
  };

  if (filterFormula) {
    queryOptions.filterByFormula = filterFormula;
  }

  const query = base('Production Issues').select(queryOptions);

  await query.eachPage((records, fetchNextPage) => {
    records.forEach(record => {
      issues.push({
        id: record.id,
        runId: record.get('Run ID') || 'N/A',
        timestamp: record.get('Timestamp'),
        severity: record.get('Severity') || 'UNKNOWN',
        pattern: record.get('Pattern Matched') || 'UNKNOWN',
        message: record.get('Error Message') || '',
        stream: record.get('Stream') || '',
        clientId: record.get('Client ID') || 'N/A'
      });
    });
    fetchNextPage();
  });

  return issues;
}

/* ------------------------------------------------------------------
   Classify if a warning is actionable or noise
------------------------------------------------------------------ */
function classifyWarning(message) {
  const lowerMessage = message.toLowerCase();
  
  // Noise patterns - check FIRST to catch false positives early
  const noisePatterns = [
    /deprecated|deprecation/i,
    /\[DEBUG\]|\[INFO\].*debug/i,
    /npm WARN|peer dep/i,
    /experimental feature/i,
    /development mode/i,
    // False positive: "429" in run IDs like "251009-121429" or timestamps
    // These are INFO logs about run records, not rate limit errors
    /run id.*\d{6}-\d{6}.*429|record rec\w+.*429.*run id/i
  ];
  
  // Check if it's noise first (early exit to avoid false positives)
  for (const noisePattern of noisePatterns) {
    if (noisePattern.test(message)) {
      return { isActionable: false, reason: 'Debug/info/deprecation noise' };
    }
  }
  
  // Actionable patterns - these need investigation/fixing
  // IMPORTANT: These only run AFTER noise filtering above
  const actionablePatterns = [
    // Context-aware 429 pattern - must have HTTP/status/error/rate context
    { pattern: /(?:http|status|error|rate).*429|429.*(?:error|limit|quota|too many)/i, reason: 'Rate limiting' },
    { pattern: /auth.*fail|unauthorized|forbidden|invalid.*token|access.*denied/i, reason: 'Authentication failure' },
    { pattern: /validation.*error|invalid.*data|schema.*error|missing required/i, reason: 'Data validation error' },
    { pattern: /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i, reason: 'Timeout issue' },
    { pattern: /out of memory|ENOMEM|heap.*limit|memory.*exceeded/i, reason: 'Resource exhaustion' },
    { pattern: /connection.*refused|ECONNREFUSED|network.*error|ENOTFOUND/i, reason: 'Network/connectivity issue' },
    { pattern: /database.*error|query.*failed|deadlock/i, reason: 'Database error' },
    { pattern: /quota.*exceeded|limit.*reached/i, reason: 'Quota/limit exceeded' }
  ];
  
  // Check if it's noise first (early exit)
  for (const noisePattern of noisePatterns) {
    if (noisePattern.test(message)) {
      return { isActionable: false, reason: 'Debug/info/deprecation noise' };
    }
  }
  
  // Check if it matches actionable patterns
  for (const { pattern, reason } of actionablePatterns) {
    if (pattern.test(message)) {
      return { isActionable: true, reason };
    }
  }
  
  // Default: if no pattern matches, consider it potentially actionable (cautious approach)
  return { isActionable: true, reason: 'Unclassified warning - review manually' };
}

/* ------------------------------------------------------------------
   Group issues by various dimensions
------------------------------------------------------------------ */
function analyzeIssues(issues) {
  const analysis = {
    total: issues.length,
    bySeverity: {},
    byPattern: {},
    byClient: {},
    byRunId: {},
    uniqueMessages: new Map(),
    actionableWarnings: [],
    noiseWarnings: []
  };

  issues.forEach(issue => {
    // By severity
    analysis.bySeverity[issue.severity] = (analysis.bySeverity[issue.severity] || 0) + 1;

    // By pattern
    analysis.byPattern[issue.pattern] = (analysis.byPattern[issue.pattern] || 0) + 1;

    // By client
    analysis.byClient[issue.clientId] = (analysis.byClient[issue.clientId] || 0) + 1;

    // By run ID
    analysis.byRunId[issue.runId] = (analysis.byRunId[issue.runId] || 0) + 1;
    
    // Classify warnings as actionable or noise
    if (issue.severity === 'WARNING') {
      const classification = classifyWarning(issue.message);
      if (classification.isActionable) {
        analysis.actionableWarnings.push({
          ...issue,
          classificationReason: classification.reason
        });
      } else {
        analysis.noiseWarnings.push({
          ...issue,
          classificationReason: classification.reason
        });
      }
    }

    // Unique messages (first 100 chars as key)
    const msgKey = issue.message.substring(0, 100);
    if (!analysis.uniqueMessages.has(msgKey)) {
      analysis.uniqueMessages.set(msgKey, {
        count: 0,
        fullMessage: issue.message,
        severity: issue.severity,
        pattern: issue.pattern,
        examples: []
      });
    }
    const entry = analysis.uniqueMessages.get(msgKey);
    entry.count++;
    if (entry.examples.length < 3) {
      entry.examples.push({
        runId: issue.runId,
        timestamp: issue.timestamp,
        clientId: issue.clientId
      });
    }
  });

  return analysis;
}

/* ------------------------------------------------------------------
   Print analysis report
------------------------------------------------------------------ */
function printReport(analysis, args) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 PRODUCTION ISSUES ANALYSIS');
  console.log('='.repeat(80));
  
  // Filters applied
  console.log('\n🔍 FILTERS APPLIED:');
  if (args.runId) console.log(`   Run ID: ${args.runId}`);
  if (args.days) console.log(`   Days: Last ${args.days} days`);
  if (args.severity) console.log(`   Severity: ${args.severity}`);
  if (args.client) console.log(`   Client: ${args.client}`);
  if (!args.runId && !args.days && !args.severity && !args.client) {
    console.log('   None (showing all errors)');
  }

  console.log(`\n📈 TOTAL ISSUES: ${analysis.total}`);

  // By Severity
  console.log('\n📊 BY SEVERITY:');
  const severities = Object.entries(analysis.bySeverity).sort((a, b) => b[1] - a[1]);
  severities.forEach(([severity, count]) => {
    const pct = ((count / analysis.total) * 100).toFixed(1);
    const icon = severity === 'ERROR' ? '❌' : severity === 'WARNING' ? '⚠️' : 'ℹ️';
    console.log(`   ${icon} ${severity.padEnd(10)} ${count.toString().padStart(4)} (${pct}%)`);
  });

  // By Pattern
  console.log('\n🔍 BY PATTERN (Top 10):');
  const patterns = Object.entries(analysis.byPattern)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  patterns.forEach(([pattern, count], idx) => {
    const pct = ((count / analysis.total) * 100).toFixed(1);
    const shortPattern = pattern.length > 40 ? pattern.substring(0, 37) + '...' : pattern;
    console.log(`   ${(idx + 1).toString().padStart(2)}. ${shortPattern.padEnd(40)} ${count.toString().padStart(4)} (${pct}%)`);
  });

  // By Client
  console.log('\n👥 BY CLIENT:');
  const clients = Object.entries(analysis.byClient).sort((a, b) => b[1] - a[1]);
  clients.forEach(([client, count]) => {
    const pct = ((count / analysis.total) * 100).toFixed(1);
    console.log(`   ${client.padEnd(20)} ${count.toString().padStart(4)} (${pct}%)`);
  });

  // Unique Messages (Top Issues)
  console.log('\n🔥 TOP ISSUES BY FREQUENCY:');
  const topIssues = Array.from(analysis.uniqueMessages.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15);
  
  topIssues.forEach(([msgKey, data], idx) => {
    const pct = ((data.count / analysis.total) * 100).toFixed(1);
    const icon = data.severity === 'ERROR' ? '❌' : '⚠️';
    console.log(`\n${icon} #${idx + 1}: ${data.pattern} (${data.count}x, ${pct}%)`);
    console.log(`   Message: ${data.fullMessage.substring(0, 200)}${data.fullMessage.length > 200 ? '...' : ''}`);
    console.log(`   Examples:`);
    data.examples.forEach(ex => {
      console.log(`     - ${ex.runId} | ${ex.timestamp} | ${ex.clientId}`);
    });
  });

  // By Run ID
  console.log('\n📅 BY RUN ID (Latest 10):');
  const runs = Object.entries(analysis.byRunId)
    .sort((a, b) => b[0].localeCompare(a[0])) // Sort by run ID desc (most recent first)
    .slice(0, 10);
  runs.forEach(([runId, count]) => {
    console.log(`   ${runId.padEnd(20)} ${count.toString().padStart(4)} errors`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('💡 NEXT STEPS:');
  console.log('   1. Review top issues by frequency');
  console.log('   2. Prioritize ERROR severity over WARNING');
  console.log('   3. Focus on patterns affecting multiple runs');
  console.log('   4. Use --runId to drill down into specific runs');
  console.log('   5. Use --severity=ERROR to focus on critical issues only');
  console.log('='.repeat(80) + '\n');
}

/* ------------------------------------------------------------------
   Main execution
------------------------------------------------------------------ */
async function main() {
  try {
    console.log('🔍 Analyzing Production Issues...\n');

    const args = parseArgs();
    const filterFormula = buildFilter(args);

    if (filterFormula) {
      console.log(`📋 Filter: ${filterFormula}\n`);
    }

    const issues = await fetchIssues(filterFormula, args.limit);

    if (issues.length === 0) {
      console.log('❌ No issues found matching the filter criteria.');
      return;
    }

    const analysis = analyzeIssues(issues);
    printReport(analysis, args);

  } catch (error) {
    console.error('❌ Error analyzing Production Issues:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { analyzeIssues, fetchIssues, classifyWarning };
