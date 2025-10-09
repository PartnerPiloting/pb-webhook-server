#!/usr/bin/env node
/**
 * Reconcile Production Issues table with Render logs for a specific runId
 * 
 * This utility:
 * 1. Fetches all errors from Render logs for the specified runId
 * 2. Fetches all errors from Production Issues table for the same runId
 * 3. Compares them to verify 100% capture rate
 * 4. Shows what's missing, extra, or matched
 * 
 * Usage:
 *   node reconcile-errors.js "251009-100355" "2025-10-09T10:03:00+10:00"
 *   
 * Parameters:
 *   runId: The Run ID from Job Tracking table
 *   startTime: AEST timestamp when the run started (will be converted to UTC)
 */

require('dotenv').config();
const { getMasterClientsBase } = require('./config/airtableClient');
const RenderLogService = require('./services/renderLogService');
const { filterLogs } = require('./services/logFilterService');

// ANSI color codes for better readability
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function convertAESTtoUTC(aestTime) {
    // AEST is UTC+10
    const date = new Date(aestTime);
    return date.toISOString();
}

function normalizeErrorMessage(message) {
    // Remove timestamps, line numbers, and other noise for comparison
    return message
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'TIMESTAMP')
        .replace(/at line \d+/g, 'at line X')
        .replace(/\d+ ms/g, 'X ms')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200); // First 200 chars for comparison
}

async function reconcileErrors(runId, startTime) {
    console.log('\n' + '='.repeat(80));
    console.log(`${colors.bright}🔍 ERROR RECONCILIATION FOR RUN: ${runId}${colors.reset}`);
    console.log('='.repeat(80));
    
    // Convert AEST to UTC
    const utcStartTime = convertAESTtoUTC(startTime);
    console.log(`\n📅 Start Time (AEST): ${startTime}`);
    console.log(`📅 Start Time (UTC):  ${utcStartTime}`);
    
    // Use a fixed 7-minute buffer to capture the run without including later reconciliation activity
    const bufferMinutes = 7;
    const endTime = new Date(new Date(utcStartTime).getTime() + bufferMinutes * 60 * 1000).toISOString();
    
    console.log(`📅 End Time (UTC):    ${endTime} (start + ${bufferMinutes} min)`);
    console.log(`   ${colors.cyan}(7-minute window to capture run only, excluding later activity)${colors.reset}`);

    
    
    // Step 1: Fetch errors from Render logs
    console.log(`\n${colors.cyan}Step 1: Fetching errors from Render logs (${bufferMinutes}-minute window)...${colors.reset}`);
    
    const renderService = new RenderLogService();
    const serviceId = process.env.RENDER_SERVICE_ID;
    
    let allLogs = [];
    let hasMore = true;
    let currentStartTime = utcStartTime;
    let pageCount = 0;
    const maxPages = 10;
    
    while (hasMore && pageCount < maxPages) {
        pageCount++;
        process.stdout.write(`  Fetching page ${pageCount}...`);
        
        const result = await renderService.getServiceLogs(serviceId, {
            startTime: currentStartTime,
            endTime: endTime,
            limit: 1000
        });
        
        allLogs = allLogs.concat(result.logs || []);
        console.log(` ${result.logs?.length || 0} logs`);
        
        hasMore = result.hasMore;
        if (hasMore && result.nextStartTime) {
            currentStartTime = result.nextStartTime;
        }
    }
    
    console.log(`  ${colors.green}✓ Fetched ${allLogs.length} total logs across ${pageCount} pages${colors.reset}`);
    
    // Convert logs to text
    const logText = allLogs
        .map(log => {
            if (typeof log === 'string') return log;
            if (log.message) return `[${log.timestamp || ''}] ${log.message}`;
            return JSON.stringify(log);
        })
        .join('\n');
    
    // Filter for errors with this specific runId
    console.log(`\n  Analyzing logs for errors with runId: ${runId}...`);
    const logErrors = filterLogs(logText, {
        deduplicateIssues: true,
        contextSize: 25,
        runIdFilter: runId
    });
    
    console.log(`  ${colors.green}✓ Found ${logErrors.length} errors in logs${colors.reset}`);
    
    // VALIDATE: Check that ALL errors have the correct runId
    console.log(`\n  ${colors.cyan}Validating runId filtering...${colors.reset}`);
    const runIdPattern = /\[(\d{6}-\d{6}(?:-[\w-]+)?)\]/;
    let correctRunId = 0;
    let wrongRunId = 0;
    let noRunId = 0;
    const wrongRunIdErrors = [];
    
    logErrors.forEach((err, idx) => {
        const runIdMatch = (err.errorMessage || '').match(runIdPattern);
        if (!runIdMatch) {
            noRunId++;
        } else {
            const foundRunId = runIdMatch[1];
            const foundTimestamp = foundRunId.split('-').slice(0, 2).join('-');
            const targetTimestamp = runId.split('-').slice(0, 2).join('-');
            
            if (foundTimestamp === targetTimestamp) {
                correctRunId++;
            } else {
                wrongRunId++;
                wrongRunIdErrors.push({ idx, foundRunId, message: err.errorMessage.substring(0, 100) });
            }
        }
    });
    
    console.log(`    ✓ Correct runId: ${correctRunId}`);
    console.log(`    ${noRunId > 0 ? colors.yellow : ''}No runId: ${noRunId}${noRunId > 0 ? colors.reset : ''}`);
    console.log(`    ${wrongRunId > 0 ? colors.red : ''}Wrong runId: ${wrongRunId}${wrongRunId > 0 ? colors.reset : ''}`);
    
    if (wrongRunId > 0) {
        console.log(`\n    ${colors.red}❌ FILTER BUG: Found errors with wrong runId!${colors.reset}`);
        wrongRunIdErrors.forEach(({ idx, foundRunId, message }) => {
            console.log(`      ${idx + 1}. Expected: ${runId}, Found: ${foundRunId}`);
            console.log(`         ${message}...`);
        });
    }
    
    // Show sample of correctly filtered errors
    console.log(`\n  ${colors.cyan}Sample errors (first 10 with correct runId):${colors.reset}`);
    logErrors.filter(err => {
        const match = (err.errorMessage || '').match(runIdPattern);
        if (!match) return false;
        const foundTimestamp = match[1].split('-').slice(0, 2).join('-');
        const targetTimestamp = runId.split('-').slice(0, 2).join('-');
        return foundTimestamp === targetTimestamp;
    }).slice(0, 10).forEach((err, idx) => {
        const timestamp = err.timestamp || 'Unknown time';
        console.log(`    ${idx + 1}. [${err.severity}] Time: ${timestamp}`);
        console.log(`       ${(err.errorMessage || '').substring(0, 100)}...`);
    });
    
    // Step 2: Fetch errors from Production Issues table
    console.log(`\n${colors.cyan}Step 2: Fetching errors from Production Issues table for Run ID: ${runId}...${colors.reset}`);
    
    const { getMasterClientsBase } = require('./config/airtableClient');
    const masterBase = getMasterClientsBase();
    
    const productionIssues = await masterBase('Production Issues')
        .select({
            filterByFormula: `{Run ID} = '${runId}'`
        })
        .all();
    
    console.log(`  ${colors.green}✓ Found ${productionIssues.length} records with Run ID '${runId}'${colors.reset}`);
    
    // Step 3: Compare and match
    console.log(`\n${colors.cyan}Step 3: Comparing errors...${colors.reset}`);
    
    // Create normalized maps for comparison
    const logErrorMap = new Map();
    logErrors.forEach((err, idx) => {
        const normalized = normalizeErrorMessage(err.errorMessage || err.message || '');
        logErrorMap.set(normalized, { ...err, index: idx });
    });
    
    const tableErrorMap = new Map();
    const tableErrors = productionIssues.map(record => ({
        id: record.id,
        errorMessage: record.get('Error Message') || '',
        errorType: record.get('Error Type') || '',
        severity: record.get('Severity') || '',
        stackTrace: record.get('Stack Trace') || '',
        context: record.get('Context') || '',
        timestamp: record.get('Timestamp') || '',
        runId: record.get('Run ID') || ''
    }));
    
    tableErrors.forEach((err, idx) => {
        const normalized = normalizeErrorMessage(err.errorMessage);
        tableErrorMap.set(normalized, { ...err, index: idx });
    });
    
    // Find matches
    const matched = [];
    const inLogNotInTable = [];
    const inTableNotInLog = [];
    
    // Check what's in logs
    logErrorMap.forEach((logErr, normalizedMsg) => {
        if (tableErrorMap.has(normalizedMsg)) {
            matched.push({
                log: logErr,
                table: tableErrorMap.get(normalizedMsg),
                normalizedMsg
            });
        } else {
            inLogNotInTable.push(logErr);
        }
    });
    
    // Check what's in table but not in logs
    tableErrorMap.forEach((tableErr, normalizedMsg) => {
        if (!logErrorMap.has(normalizedMsg)) {
            inTableNotInLog.push(tableErr);
        }
    });
    
    // Step 4: Report results
    console.log('\n' + '='.repeat(80));
    console.log(`${colors.bright}📊 RECONCILIATION RESULTS${colors.reset}`);
    console.log('='.repeat(80));
    
    console.log(`\n${colors.green}✓ Matched (in both logs and table): ${matched.length}${colors.reset}`);
    console.log(`${colors.red}✗ In logs but NOT in table: ${inLogNotInTable.length}${colors.reset}`);
    console.log(`${colors.yellow}⚠ In table but NOT in logs: ${inTableNotInLog.length}${colors.reset}`);
    
    // Calculate capture rate
    const totalInLogs = logErrors.length;
    const captureRate = totalInLogs > 0 ? ((matched.length / totalInLogs) * 100).toFixed(1) : 0;
    
    console.log(`\n${colors.bright}📈 CAPTURE RATE: ${captureRate}% (${matched.length}/${totalInLogs})${colors.reset}`);
    
    // Show details of mismatches
    if (inLogNotInTable.length > 0) {
        console.log(`\n${colors.red}❌ ERRORS IN LOGS NOT SAVED TO TABLE:${colors.reset}`);
        
        // Separate real errors from noise
        const realErrors = inLogNotInTable.filter(err => 
            (err.severity === 'ERROR' || err.severity === 'CRITICAL') &&
            !err.errorMessage.includes('DEPRECATION WARNING') &&
            !err.errorMessage.includes('Running build command') &&
            !err.errorMessage.includes('Server started')
        );
        
        const warnings = inLogNotInTable.filter(err => err.severity === 'WARNING');
        const other = inLogNotInTable.filter(err => !realErrors.includes(err) && !warnings.includes(err));
        
        console.log(`\n  ${colors.bright}Real Errors (CRITICAL/ERROR):${colors.reset} ${realErrors.length}`);
        realErrors.forEach((err, idx) => {
            console.log(`\n  ${idx + 1}. [${err.severity}] ${err.patternMatched || 'Unknown pattern'}`);
            console.log(`     Message: ${(err.errorMessage || err.message || '').substring(0, 200)}...`);
            console.log(`     Time: ${err.timestamp || 'Unknown'}`);
            console.log(`     Full message: ${(err.errorMessage || err.message || '').substring(0, 500)}`);
        });
        
        if (warnings.length > 0) {
            console.log(`\n  ${colors.yellow}Warnings:${colors.reset} ${warnings.length} (likely noise - deprecations, build logs, etc.)`);
        }
        
        if (other.length > 0) {
            console.log(`\n  ${colors.yellow}Other:${colors.reset} ${other.length}`);
        }
    }
    
    if (inTableNotInLog.length > 0) {
        console.log(`\n${colors.yellow}⚠️  ERRORS IN TABLE NOT FOUND IN LOGS:${colors.reset}`);
        console.log(`    (These might be from deduplication or different runId filter logic)`);
        inTableNotInLog.forEach((err, idx) => {
            console.log(`\n  ${idx + 1}. [${err.severity}] ${err.errorType}`);
            console.log(`     Message: ${err.errorMessage.substring(0, 150)}...`);
            console.log(`     Time: ${err.timestamp}`);
            console.log(`     Record ID: ${err.id}`);
        });
    }
    
    // Show sample matches
    if (matched.length > 0) {
        console.log(`\n${colors.green}✓ SAMPLE MATCHED ERRORS (first 3):${colors.reset}`);
        matched.slice(0, 3).forEach((match, idx) => {
            console.log(`\n  ${idx + 1}. [${match.log.severity || 'UNKNOWN'}] ${match.log.patternMatched || match.table.errorType}`);
            console.log(`     Log message:   ${(match.log.errorMessage || match.log.message || '').substring(0, 100)}...`);
            console.log(`     Table message: ${match.table.errorMessage.substring(0, 100)}...`);
            console.log(`     ${colors.green}✓ Match confirmed${colors.reset}`);
        });
    }
    
    // Summary assessment
    console.log('\n' + '='.repeat(80));
    console.log(`${colors.bright}🎯 ASSESSMENT${colors.reset}`);
    console.log('='.repeat(80));
    
    // Calculate adjusted capture rate (excluding warnings/noise)
    const realErrorsInLogs = logErrors.filter(err => 
        (err.severity === 'ERROR' || err.severity === 'CRITICAL') &&
        !err.errorMessage.includes('DEPRECATION WARNING') &&
        !err.errorMessage.includes('Running build command') &&
        !err.errorMessage.includes('Server started')
    ).length;
    
    const adjustedCaptureRate = realErrorsInLogs > 0 
        ? ((matched.length / realErrorsInLogs) * 100).toFixed(1) 
        : 0;
    
    console.log(`\n${colors.cyan}Raw capture rate:${colors.reset} ${captureRate}% (${matched.length}/${totalInLogs} all patterns)`);
    console.log(`${colors.cyan}Adjusted capture rate:${colors.reset} ${adjustedCaptureRate}% (${matched.length}/${realErrorsInLogs} real errors only)`);
    
    if (adjustedCaptureRate >= 95) {
        console.log(`\n${colors.green}✅ EXCELLENT: ${adjustedCaptureRate}% capture rate!${colors.reset}`);
        console.log(`   Phase 1 goal achieved: errors are being saved to Production Issues table.`);
    } else if (adjustedCaptureRate >= 80) {
        console.log(`\n${colors.yellow}⚠️  GOOD: ${adjustedCaptureRate}% capture rate${colors.reset}`);
        console.log(`   Some errors missing. Review the "Real Errors" section above.`);
    } else {
        console.log(`\n${colors.red}❌ POOR: ${adjustedCaptureRate}% capture rate${colors.reset}`);
        console.log(`   Significant errors not being saved. Investigation needed.`);
    }
    
    if (inTableNotInLog.length > 0) {
        console.log(`\n${colors.yellow}Note:${colors.reset} ${inTableNotInLog.length} errors in table but not in logs.`);
        console.log(`   This is normal if they were deduplicated or from different runId filter logic.`);
    }
    
    console.log('\n' + '='.repeat(80) + '\n');
    
    // Return structured data for programmatic use
    return {
        runId,
        startTime: utcStartTime,
        stats: {
            totalInLogs: logErrors.length,
            totalInTable: productionIssues.length,
            matched: matched.length,
            inLogNotInTable: inLogNotInTable.length,
            inTableNotInLog: inTableNotInLog.length,
            captureRate: parseFloat(captureRate)
        },
        errors: {
            matched,
            inLogNotInTable,
            inTableNotInLog
        }
    };
}

// CLI entry point
async function main() {
    const runId = process.argv[2];
    const startTime = process.argv[3];
    
    if (!runId || !startTime) {
        console.error('\n❌ Usage: node reconcile-errors.js <runId> <startTime>');
        console.error('\nExample:');
        console.error('  node reconcile-errors.js "251009-100355" "2025-10-09T20:03:00+10:00"');
        console.error('\nParameters:');
        console.error('  runId:     The Run ID from Job Tracking table');
        console.error('  startTime: AEST timestamp (e.g., 2025-10-09T20:03:00+10:00 for 8:03 PM AEST)');
        console.error('');
        process.exit(1);
    }
    
    try {
        await reconcileErrors(runId, startTime);
        process.exit(0);
    } catch (error) {
        console.error(`\n${colors.red}❌ Reconciliation failed:${colors.reset}`, error);
        console.error(error.stack);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { reconcileErrors };
