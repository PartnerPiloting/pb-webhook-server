#!/usr/bin/env node
/**
 * Auto-Analyze Latest Smart Resume Run
 * 
 * This script:
 * 1. Connects to Job Tracking table
 * 2. Finds the most recent run
 * 3. Gets the runId and start time
 * 4. Fetches Render logs from that time onwards
 * 5. Analyzes the logs locally (no need to wait for server)
 * 6. Shows you what happened step-by-step
 * 
 * Usage: node auto-analyze-latest-run.js
 */

require('dotenv').config();
const { getMasterClientsBase } = require('./config/airtableClient');
const RenderLogService = require('./services/renderLogService');
const { filterLogs, generateSummary } = require('./services/logFilterService');

const JOB_TRACKING_TABLE = 'Job Tracking';

async function getLatestRun() {
    console.log('\n📊 Step 1: Finding latest run in Job Tracking table...\n');
    
    const masterBase = getMasterClientsBase();
    
    // Get most recent record sorted by Start Time
    const records = await masterBase(JOB_TRACKING_TABLE)
        .select({
            maxRecords: 1,
            sort: [{ field: 'Start Time', direction: 'desc' }],
            filterByFormula: "AND({Run ID} != '', {Start Time} != '')"
        })
        .firstPage();
    
    if (!records || records.length === 0) {
        throw new Error('No runs found in Job Tracking table');
    }
    
    const record = records[0];
    const runId = record.get('Run ID');
    const startTime = record.get('Start Time');
    const endTime = record.get('End Time');
    const status = record.get('Status');
    
    console.log('✅ Found latest run:');
    console.log(`   Run ID: ${runId}`);
    console.log(`   Start Time: ${startTime}`);
    console.log(`   End Time: ${endTime || 'Still running...'}`);
    console.log(`   Status: ${status}`);
    
    return { runId, startTime, endTime, status };
}

async function fetchRenderLogs(startTime, endTime) {
    console.log('\n📥 Step 2: Fetching Render logs...\n');
    
    const renderService = new RenderLogService();
    const serviceId = process.env.RENDER_SERVICE_ID;
    
    // If still running, fetch up to now
    const logEndTime = endTime || new Date().toISOString();
    
    console.log(`   Service ID: ${serviceId}`);
    console.log(`   Time range: ${startTime} to ${logEndTime}`);
    
    const result = await renderService.getServiceLogs(serviceId, {
        startTime,
        endTime: logEndTime,
        limit: 10000
    });
    
    console.log(`   ✅ Retrieved ${result.logs.length} log lines`);
    
    return result.logs;
}

function convertLogsToText(logs) {
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

function analyzeSmartResumeFlow(logText, runId) {
    console.log('\n🔍 Step 3: Analyzing smart-resume flow...\n');
    
    const checks = {
        endpointCalled: false,
        lockAcquired: false,
        backgroundStarted: false,
        scriptLoaded: false,
        scriptCompleted: false,
        autoAnalysisStarted: false,
        autoAnalysisCompleted: false,
        runIdExtracted: null,
        errors: []
    };
    
    const lines = logText.split('\n');
    
    for (const line of lines) {
        // Check for endpoint hit
        if (line.includes('GET request received for /smart-resume-client-by-client') || 
            line.includes('smart_resume_get')) {
            checks.endpointCalled = true;
        }
        
        // Check for lock acquired
        if (line.includes('Smart resume lock acquired')) {
            checks.lockAcquired = true;
        }
        
        // Check for background processing started
        if (line.includes('Smart resume background processing started') || 
            line.includes('🎯')) {
            checks.backgroundStarted = true;
        }
        
        // Check for script loading
        if (line.includes('Loading smart resume module') || 
            line.includes('MODULE_DEBUG: Script loading')) {
            checks.scriptLoaded = true;
        }
        
        // Check for script completion
        if (line.includes('Smart resume completed successfully') || 
            line.includes('SCRIPT_END: Module execution completed')) {
            checks.scriptCompleted = true;
        }
        
        // Check for auto-analysis start
        if (line.includes('Starting automatic log analysis') || 
            line.includes('🔍 Analyzing logs for specific runId')) {
            checks.autoAnalysisStarted = true;
        }
        
        // Check for auto-analysis completion
        if (line.includes('Log analysis complete') || 
            line.includes('errors saved to Production Issues')) {
            checks.autoAnalysisCompleted = true;
        }
        
        // Extract runId if mentioned
        if (line.includes('Script returned runId:')) {
            const match = line.match(/Script returned runId:\s*(\S+)/);
            if (match) {
                checks.runIdExtracted = match[1];
            }
        }
        
        // Collect errors
        if (line.includes('[ERROR]') || line.includes('ERROR:')) {
            checks.errors.push(line);
        }
    }
    
    return checks;
}

function printFlowAnalysis(checks) {
    console.log('📋 Smart Resume Flow Analysis:');
    console.log('━'.repeat(60));
    
    console.log(`   1. Endpoint called:           ${checks.endpointCalled ? '✅' : '❌'}`);
    console.log(`   2. Lock acquired:             ${checks.lockAcquired ? '✅' : '❌'}`);
    console.log(`   3. Background started:        ${checks.backgroundStarted ? '✅' : '❌'}`);
    console.log(`   4. Script loaded:             ${checks.scriptLoaded ? '✅' : '❌'}`);
    console.log(`   5. Script completed:          ${checks.scriptCompleted ? '✅' : '❌'}`);
    console.log(`   6. Auto-analysis started:     ${checks.autoAnalysisStarted ? '✅' : '❌'}`);
    console.log(`   7. Auto-analysis completed:   ${checks.autoAnalysisCompleted ? '✅' : '❌'}`);
    
    if (checks.runIdExtracted) {
        console.log(`\n   📝 Extracted runId: ${checks.runIdExtracted}`);
    }
    
    if (checks.errors.length > 0) {
        console.log(`\n   ⚠️  Found ${checks.errors.length} error lines`);
    }
    
    console.log('━'.repeat(60));
}

function identifyProblem(checks) {
    console.log('\n🔍 Diagnosis:\n');
    
    if (!checks.endpointCalled) {
        console.log('❌ PROBLEM: Endpoint was never called or logs are missing');
        console.log('   Solution: Check if you called the right URL');
        return;
    }
    
    if (!checks.lockAcquired) {
        console.log('❌ PROBLEM: Lock was not acquired (another job running?)');
        console.log('   Solution: Check /smart-resume-status endpoint');
        return;
    }
    
    if (!checks.backgroundStarted) {
        console.log('❌ PROBLEM: Background processing never started');
        console.log('   Solution: Check if setImmediate() is working or if server crashed');
        return;
    }
    
    if (!checks.scriptLoaded) {
        console.log('❌ PROBLEM: Smart resume script failed to load');
        console.log('   Solution: Check for module loading errors in logs');
        return;
    }
    
    if (!checks.scriptCompleted) {
        console.log('⚠️  PROBLEM: Script started but never completed');
        console.log('   Possible causes:');
        console.log('   - Script still running (check Job Tracking status)');
        console.log('   - Script crashed mid-execution');
        console.log('   - Timeout or memory issue');
        return;
    }
    
    if (!checks.autoAnalysisStarted) {
        console.log('❌ PROBLEM: Auto-analysis never started after script completed');
        console.log('   Solution: Check finally block in executeSmartResume');
        return;
    }
    
    if (!checks.autoAnalysisCompleted) {
        console.log('⚠️  PROBLEM: Auto-analysis started but failed');
        console.log('   Solution: Check for errors in analyzeRecentLogs');
        return;
    }
    
    console.log('✅ SUCCESS: Complete flow executed!');
    console.log('   All steps completed successfully.');
}

async function analyzeLogsForErrors(logText, runId) {
    console.log('\n📊 Step 4: Analyzing for errors...\n');
    
    const issues = filterLogs(logText, {
        deduplicateIssues: true,
        contextSize: 25,
        runIdFilter: runId
    });
    
    const summary = generateSummary(issues);
    
    console.log(`   Found ${issues.length} unique issues:`);
    console.log(`   - Critical: ${summary.critical}`);
    console.log(`   - Errors: ${summary.error}`);
    console.log(`   - Warnings: ${summary.warning}`);
    
    if (issues.length > 0) {
        console.log('\n   📋 Issue Details:');
        console.log('   ' + '━'.repeat(58));
        
        issues.slice(0, 5).forEach((issue, idx) => {
            console.log(`\n   ${idx + 1}. [${issue.severity}] ${issue.patternMatched}`);
            console.log(`      Message: ${issue.errorMessage.substring(0, 100)}...`);
            console.log(`      Time: ${issue.timestamp.toISOString()}`);
        });
        
        if (issues.length > 5) {
            console.log(`\n   ... and ${issues.length - 5} more issues`);
        }
    }
    
    return { issues, summary };
}

async function main() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 AUTO-ANALYZE LATEST SMART RESUME RUN');
    console.log('='.repeat(70));
    
    try {
        // Step 1: Get latest run from Job Tracking
        const runInfo = await getLatestRun();
        
        // Step 2: Fetch Render logs
        const logs = await fetchRenderLogs(runInfo.startTime, runInfo.endTime);
        const logText = convertLogsToText(logs);
        
        // Step 3: Analyze smart-resume flow
        const flowChecks = analyzeSmartResumeFlow(logText, runInfo.runId);
        printFlowAnalysis(flowChecks);
        
        // Step 4: Identify problems
        identifyProblem(flowChecks);
        
        // Step 5: Analyze for actual errors
        const errorAnalysis = await analyzeLogsForErrors(logText, runInfo.runId);
        
        // Step 6: Summary
        console.log('\n' + '='.repeat(70));
        console.log('📊 SUMMARY');
        console.log('='.repeat(70));
        console.log(`   Run ID: ${runInfo.runId}`);
        console.log(`   Status: ${runInfo.status}`);
        console.log(`   Flow completed: ${flowChecks.autoAnalysisCompleted ? 'YES ✅' : 'NO ❌'}`);
        console.log(`   Errors found: ${errorAnalysis.issues.length}`);
        console.log(`   Should be in Production Issues table: ${flowChecks.autoAnalysisCompleted ? 'YES' : 'NO'}`);
        console.log('='.repeat(70) + '\n');
        
    } catch (error) {
        console.error('\n❌ Script failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { main };
