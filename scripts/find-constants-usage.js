/**
 * scripts/find-constants-usage.js
 * 
 * Simple script to find files that need constants migration
 */

const fs = require('fs');
const path = require('path');

function findJsFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        // Skip certain directories
        if (stat.isDirectory()) {
            if (!['node_modules', '.git', 'build', 'dist'].includes(file)) {
                findJsFiles(filePath, fileList);
            }
        } else if (file.endsWith('.js')) {
            fileList.push(filePath);
        }
    });
    
    return fileList;
}

function checkFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const issues = [];
        
        // Check for old imports
        if (content.includes('constants/airtableConstants') ||
            content.includes('constants/airtableFields') ||
            content.includes('constants/airtableSimpleConstants')) {
            issues.push('Uses old constants import');
        }
        
        // Check for hardcoded field names
        const hardcodedPatterns = [
            /['"]Status['"]/,
            /['"]Run ID['"]/,
            /['"]Client ID['"]/,
            /['"]Total Posts Harvested['"]/,
            /['"]System Notes['"]/
        ];
        
        hardcodedPatterns.forEach(pattern => {
            if (pattern.test(content)) {
                issues.push(`Hardcoded: ${pattern.source}`);
            }
        });
        
        return issues;
    } catch (error) {
        return [`Error reading file: ${error.message}`];
    }
}

// Main execution
console.log('Scanning for files that need migration...\n');

const jsFiles = findJsFiles('.');
let filesNeedingUpdate = 0;
let filesByPriority = {
    high: [],
    medium: [],
    low: []
};

// Define file priority patterns
const highPriorityPatterns = [
    /services\/airtableService/,
    /services\/airtableServiceSimple/,
    /services\/clientService/,
    /services\/leadService/,
    /services\/jobOrchestrationService/
];

const mediumPriorityPatterns = [
    /routes\/api/,
    /routes\/apify/,
    /routes\/webhook/
];

jsFiles.forEach(file => {
    const issues = checkFile(file);
    if (issues.length > 0) {
        filesNeedingUpdate++;
        
        // Determine priority
        let priority = 'low';
        if (highPriorityPatterns.some(pattern => pattern.test(file))) {
            priority = 'high';
        } else if (mediumPriorityPatterns.some(pattern => pattern.test(file))) {
            priority = 'medium';
        }
        
        filesByPriority[priority].push({
            file,
            issues
        });
    }
});

// Display results by priority
console.log('\n=== HIGH PRIORITY FILES ===');
filesByPriority.high.forEach(item => {
    console.log(`\n📁 ${item.file}`);
    item.issues.forEach(issue => console.log(`   ⚠️  ${issue}`));
});

console.log('\n=== MEDIUM PRIORITY FILES ===');
filesByPriority.medium.forEach(item => {
    console.log(`\n📁 ${item.file}`);
    item.issues.forEach(issue => console.log(`   ⚠️  ${issue}`));
});

console.log('\n=== LOW PRIORITY FILES ===');
filesByPriority.low.forEach(item => {
    console.log(`\n📁 ${item.file}`);
    item.issues.forEach(issue => console.log(`   ⚠️  ${issue}`));
});

console.log(`\n\nTotal files scanned: ${jsFiles.length}`);
console.log(`Files needing update: ${filesNeedingUpdate}`);
console.log(`  - High priority: ${filesByPriority.high.length}`);
console.log(`  - Medium priority: ${filesByPriority.medium.length}`);
console.log(`  - Low priority: ${filesByPriority.low.length}`);