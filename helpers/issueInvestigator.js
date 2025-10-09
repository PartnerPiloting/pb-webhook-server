/* ===================================================================
   issueInvestigator.js - AI-friendly Production Issues investigator
   -------------------------------------------------------------------
   Fetches and analyzes Production Issues for AI chat workflow.
   
   When user asks: "Can you investigate the log issues by severity"
   AI calls: investigateIssues({ severity: 'ERROR' })
   AI gets: Prioritized list with actionable recommendations
   
   This enables conversational debugging workflow:
   User: "What errors do we have?"
   AI: "Found 12 ERROR issues. Top one is 'Unknown field name' (5x).
        Shall I investigate?"
   User: "Yes"
   AI: *analyzes code, proposes fix*
=================================================================== */

const https = require('https');

// Staging API base URL
const STAGING_API = process.env.STAGING_API_URL || 'https://pb-webhook-server-staging.onrender.com';

/* ------------------------------------------------------------------
   Fetch from staging API endpoint
------------------------------------------------------------------ */
function fetchFromAPI(endpoint) {
    return new Promise((resolve, reject) => {
        const url = `${STAGING_API}${endpoint}`;
        
        https.get(url, (res) => {
            let data = '';
            
            res.on('data', chunk => data += chunk);
            
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (err) {
                    reject(new Error(`Failed to parse JSON from ${url}: ${err.message}`));
                }
            });
        }).on('error', reject);
    });
}

/* ------------------------------------------------------------------
   Investigate Production Issues and return AI-friendly summary
------------------------------------------------------------------ */
async function investigateIssues(options = {}) {
    const {
        severity = 'ERROR',     // Focus on errors by default
        days = 7,               // Last 7 days
        limit = 100,            // Max issues to fetch
        client = null,
        runId = null
    } = options;
    
    // Build query params
    const params = new URLSearchParams();
    if (severity) params.append('severity', severity);
    if (days) params.append('days', days.toString());
    if (limit) params.append('limit', limit.toString());
    if (client) params.append('client', client);
    if (runId) params.append('runId', runId);
    
    const endpoint = `/api/analyze-issues?${params.toString()}`;
    
    console.log(`\n🔍 Fetching issues from: ${STAGING_API}${endpoint}\n`);
    
    const data = await fetchFromAPI(endpoint);
    
    if (!data.success) {
        throw new Error(data.error || 'Failed to fetch issues');
    }
    
    if (data.total === 0) {
        return {
            summary: `✅ No ${severity} issues found in the last ${days} days. All clear!`,
            total: 0,
            issues: []
        };
    }
    
    // Extract top issues with enhanced context
    const topIssues = (data.topIssues || []).slice(0, 10).map((issue, idx) => {
        // Identify likely file locations based on error pattern
        const fileHints = inferFileLocations(issue.pattern, issue.message);
        
        // Determine if this is a recurring issue (appears in multiple runs)
        const isRecurring = issue.examples.length > 1;
        
        // Priority score: frequency * severity weight * recurrence factor
        const severityWeight = issue.severity === 'ERROR' ? 2 : 1;
        const recurrenceFactor = isRecurring ? 1.5 : 1;
        const priorityScore = issue.count * severityWeight * recurrenceFactor;
        
        return {
            rank: idx + 1,
            pattern: issue.pattern,
            severity: issue.severity,
            count: issue.count,
            percentage: issue.percentage,
            message: issue.message,
            examples: issue.examples,
            isRecurring,
            fileHints,
            priorityScore: Math.round(priorityScore)
        };
    });
    
    // Sort by priority score
    topIssues.sort((a, b) => b.priorityScore - a.priorityScore);
    
    // Build AI-friendly summary
    const summary = buildSummary(data, topIssues, severity, days);
    
    return {
        summary,
        total: data.total,
        severity,
        days,
        bySeverity: data.bySeverity,
        topIssues,
        recommended: topIssues[0] // Top priority issue to start with
    };
}

/* ------------------------------------------------------------------
   Infer likely file locations based on error pattern
------------------------------------------------------------------ */
function inferFileLocations(pattern, message) {
    const hints = [];
    
    // Airtable field errors
    if (pattern.includes('Unknown field name') || message.includes('Unknown field name')) {
        hints.push('routes/apiAndJobRoutes.js (post-scoring Airtable updates)');
        hints.push('services/airtableService.js (field mapping)');
        hints.push('Check Production Issues table field names match code');
    }
    
    // Record not found errors
    if (pattern.includes('Record not found') || message.includes('Record not found')) {
        hints.push('services/leadService.js (lead lookups)');
        hints.push('routes/apiAndJobRoutes.js (client/lead queries)');
        hints.push('Verify record IDs are correct');
    }
    
    // Failed to create/update
    if (pattern.includes('Failed to') && (message.includes('create') || message.includes('update'))) {
        hints.push('services/airtableService.js (CRUD operations)');
        hints.push('Check Airtable API permissions and field validation');
    }
    
    // Batch scoring failures
    if (pattern.includes('batch') || message.includes('batch')) {
        hints.push('batchScorer.js (batch processing logic)');
        hints.push('routes/apiAndJobRoutes.js (batch endpoints)');
    }
    
    // AI scoring errors
    if (message.includes('Gemini') || message.includes('OpenAI') || message.includes('scoring')) {
        hints.push('singleScorer.js (AI scoring)');
        hints.push('config/geminiClient.js (Gemini setup)');
    }
    
    // Generic fallback
    if (hints.length === 0) {
        hints.push('Search codebase for error message text');
    }
    
    return hints;
}

/* ------------------------------------------------------------------
   Build conversational summary for AI
------------------------------------------------------------------ */
function buildSummary(data, topIssues, severity, days) {
    const lines = [];
    
    lines.push(`📊 Production Issues Analysis (${severity} severity, last ${days} days)`);
    lines.push('');
    lines.push(`Total ${severity} issues: ${data.total}`);
    
    if (data.bySeverity) {
        lines.push('');
        lines.push('Breakdown by severity:');
        Object.entries(data.bySeverity).forEach(([sev, count]) => {
            const icon = sev === 'ERROR' ? '❌' : sev === 'WARNING' ? '⚠️' : 'ℹ️';
            lines.push(`  ${icon} ${sev}: ${count}`);
        });
    }
    
    lines.push('');
    lines.push(`Top ${Math.min(topIssues.length, 5)} issues by priority:`);
    lines.push('');
    
    topIssues.slice(0, 5).forEach((issue, idx) => {
        const icon = issue.severity === 'ERROR' ? '❌' : '⚠️';
        const recurring = issue.isRecurring ? ' 🔄 RECURRING' : '';
        
        lines.push(`${idx + 1}. ${icon} ${issue.pattern}${recurring}`);
        lines.push(`   Count: ${issue.count} (${issue.percentage}%) | Priority: ${issue.priorityScore}`);
        lines.push(`   Message: ${issue.message.substring(0, 150)}${issue.message.length > 150 ? '...' : ''}`);
        
        if (issue.fileHints.length > 0) {
            lines.push(`   Likely files: ${issue.fileHints[0]}`);
        }
        
        lines.push('');
    });
    
    if (topIssues.length > 0) {
        const top = topIssues[0];
        lines.push('💡 RECOMMENDATION:');
        lines.push(`   Start with #1: "${top.pattern}"`);
        lines.push(`   This is ${top.isRecurring ? 'a recurring issue' : 'happening'} with ${top.count} occurrences.`);
        if (top.fileHints.length > 0) {
            lines.push(`   Check: ${top.fileHints[0]}`);
        }
        lines.push('');
        lines.push('   Ready to investigate this issue?');
    }
    
    return lines.join('\n');
}

/* ------------------------------------------------------------------
   Get detailed information about a specific issue
------------------------------------------------------------------ */
async function getIssueDetails(pattern, options = {}) {
    const issues = await investigateIssues(options);
    
    const issue = issues.topIssues.find(i => 
        i.pattern === pattern || 
        i.pattern.includes(pattern) ||
        i.message.includes(pattern)
    );
    
    if (!issue) {
        return {
            found: false,
            message: `No issue found matching "${pattern}"`
        };
    }
    
    return {
        found: true,
        issue,
        details: {
            pattern: issue.pattern,
            severity: issue.severity,
            count: issue.count,
            percentage: issue.percentage,
            message: issue.message,
            examples: issue.examples,
            fileHints: issue.fileHints,
            isRecurring: issue.isRecurring,
            priorityScore: issue.priorityScore
        }
    };
}

/* ------------------------------------------------------------------
   Exports
------------------------------------------------------------------ */
module.exports = {
    investigateIssues,
    getIssueDetails
};

/* ------------------------------------------------------------------
   CLI Usage (for testing)
------------------------------------------------------------------ */
if (require.main === module) {
    const severity = process.argv[2] || 'ERROR';
    const days = parseInt(process.argv[3]) || 7;
    
    investigateIssues({ severity, days })
        .then(result => {
            console.log(result.summary);
            console.log('\n' + '='.repeat(80));
            console.log(`\n📋 Full data available in result.topIssues array (${result.topIssues.length} issues)`);
        })
        .catch(err => {
            console.error('❌ Error:', err.message);
            process.exit(1);
        });
}
