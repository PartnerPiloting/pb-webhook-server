/**
 * scripts/verify-status-consistency.js
 * 
 * Script to verify that all status values used in the codebase
 * match the allowed values in Airtable
 */

const fs = require('fs');
const path = require('path');

// Define the allowed status values in Airtable
const ALLOWED_STATUSES = [
    'Running',
    'Completed', 
    'Failed',
    'No Leads To Score'
];

// Files to check
const filesToCheck = [
    'services/jobMetricsService.js',
    'services/unifiedJobTrackingRepository.js',
    'services/jobTrackingErrorHandling.js',
    'batchScorer.js',
    'postBatchScorer.js',
    'services/airtableServiceSimple.js',
    'services/runRecordAdapterSimple.js',
    'routes/apiAndJobRoutes.js'
];

// Patterns that should NOT exist
const bannedPatterns = [
    'completed_with_errors',
    'Completed With Errors',
    'Completed with errors',
    'completed with errors',
    'Skipped', // Should use 'No Leads To Score' instead
    'Error',   // Should use 'Failed' instead
    'error',   // Should use 'failed' instead (lowercase)
    'No leads to process' // Should use 'No Leads To Score'
];

console.log('=== Verifying Status Consistency ===\n');

let issues = [];

filesToCheck.forEach(filePath => {
    const fullPath = path.join(__dirname, '..', filePath);
    if (!fs.existsSync(fullPath)) {
        console.warn(`⚠️ File not found: ${filePath}`);
        return;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');

    // Check for banned patterns
    bannedPatterns.forEach(pattern => {
        lines.forEach((line, index) => {
            if (line.includes(pattern) && 
                !line.includes('//') && 
                !line.includes('verify-status-consistency.js') &&
                !line.includes('* Script to verify')) {
                issues.push({
                    file: filePath,
                    line: index + 1,
                    pattern: pattern,
                    content: line.trim()
                });
            }
        });
    });

    console.log(`✓ Checked ${filePath}`);
});

console.log('\n=== Results ===\n');

if (issues.length === 0) {
    console.log('✅ All status values are consistent with Airtable schema!');
} else {
    console.log(`❌ Found ${issues.length} inconsistencies:\n`);
    issues.forEach(issue => {
        console.log(`File: ${issue.file}:${issue.line}`);
        console.log(`Pattern: "${issue.pattern}"`);
        console.log(`Line: ${issue.content}`);
        console.log('---');
    });
}

console.log('\n=== Allowed Status Values ===');
ALLOWED_STATUSES.forEach(status => {
    console.log(`  • ${status}`);
});