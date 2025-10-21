#!/usr/bin/env node
// scripts/document-env-vars.js
// CLI utility to scan, analyze, and document environment variables
// Syncs with Airtable Environment Variables table

require('dotenv').config();
const EnvVarDocumenter = require('../services/envVarDocumenter');
const { table } = require('console');

const COMMANDS = {
    'scan': 'Scan code and sync to Airtable Environment Variables table',
    'export': 'Export documentation to markdown file',
    'obsolete': 'Find variables that can be removed',
    'consolidate': 'Find variables that can be combined',
    'help': 'Show this help message'
};

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'scan';

    console.log('🔧 Environment Variable Documentation Tool');
    console.log('==========================================\n');

    if (command === 'help' || command === '--help' || command === '-h') {
        showHelp();
        return;
    }

    const documenter = new EnvVarDocumenter();

    try {
        switch (command) {
            case 'scan':
                await runScan(documenter);
                break;

            case 'export':
                const outputPath = args[1] || './ENV-VARIABLES-DOCS.md';
                await runExport(documenter, outputPath);
                break;

            case 'obsolete':
                await findObsolete(documenter);
                break;

            case 'consolidate':
                await findConsolidation(documenter);
                break;

            default:
                console.error(`❌ Unknown command: ${command}`);
                console.log('\nUse "npm run doc-env-vars help" to see available commands.\n');
                process.exit(1);
        }

        console.log('\n✅ Command completed successfully!\n');
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (process.env.DEBUG) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

/**
 * Scan codebase and sync to Airtable
 */
async function runScan(documenter) {
    console.log('📊 Scanning codebase for environment variables...\n');
    console.log('This will:');
    console.log('  1. Scan all .js files for process.env references');
    console.log('  2. Generate AI descriptions for each variable');
    console.log('  3. Sync to Airtable Environment Variables table');
    console.log('  4. Identify obsolete variables\n');
    console.log('⏱️  This may take 5-10 minutes depending on number of variables...\n');

    const { stats, obsoleteRecords } = await documenter.scanAndSync();

    console.log('\n📈 Scan Results:');
    console.log('================');
    console.log(`   ✅ Created: ${stats.created} new records`);
    console.log(`   🔄 Updated: ${stats.updated} existing records`);
    console.log(`   ⏭️  Unchanged: ${stats.unchanged} records`);
    console.log(`   ⚠️  Obsolete: ${obsoleteRecords.length} variables no longer in code\n`);

    if (obsoleteRecords.length > 0) {
        console.log('⚠️  Obsolete Variables (found in Airtable but not in code):');
        console.log('─'.repeat(60));
        
        obsoleteRecords.forEach(record => {
            console.log(`\n   Variable: ${record.fields['Variable Name']}`);
            console.log(`   Last Value: ${record.fields['Staging Value'] || '(not set)'}`);
            console.log(`   Last Seen In: ${record.fields['Used In Files'] || 'unknown'}`);
        });
        
        console.log('\n💡 Recommendation:');
        console.log('   Review these variables in Airtable.');
        console.log('   If truly obsolete, update Status field to "Obsolete".');
        console.log('   If still needed, they may be in a branch not yet merged.\n');
    }

    console.log('Next steps:');
    console.log('  1. Check Airtable Environment Variables table');
    console.log('  2. Fill in Production Values from Render dashboard');
    console.log('  3. Review AI descriptions and add business context if needed');
    console.log('  4. Export documentation: npm run doc-env-vars export\n');
}

/**
 * Export to markdown documentation
 */
async function runExport(documenter, outputPath) {
    console.log(`📝 Exporting documentation to ${outputPath}...\n`);
    
    await documenter.exportToMarkdown(outputPath);
    
    console.log(`\n✅ Documentation exported successfully!`);
    console.log(`   File: ${outputPath}`);
    console.log(`\n💡 You can now:`);
    console.log(`   - Share this file with your team`);
    console.log(`   - Add it to your repository documentation`);
    console.log(`   - Use it as a reference for deployment\n`);
}

/**
 * Find obsolete variables
 */
async function findObsolete(documenter) {
    console.log('🔍 Analyzing variables for removal candidates...\n');
    
    const candidates = await documenter.identifyRemovableCandidates();
    
    if (candidates.length === 0) {
        console.log('✅ No obvious removal candidates found!');
        console.log('   All variables appear to be in active use.\n');
        return;
    }

    console.log(`Found ${candidates.length} potential removal candidates:\n`);
    console.log('─'.repeat(80));

    candidates.forEach((candidate, index) => {
        console.log(`\n${index + 1}. ${candidate.name}`);
        console.log(`   Reason: ${candidate.reason || 'Low usage'}`);
        console.log(`   Usage Count: ${candidate.usageCount}`);
        console.log(`   Backup Code Only: ${candidate.backupCodeOnly ? 'Yes' : 'No'}`);
        console.log(`   Locations:`);
        candidate.locations.forEach(loc => {
            console.log(`      - ${loc}`);
        });
    });

    console.log('\n─'.repeat(80));
    console.log('\n⚠️  CAUTION: Review each candidate carefully before removing!');
    console.log('   Variables may be:');
    console.log('   - Required in production but not staging');
    console.log('   - Used in features not yet activated');
    console.log('   - Legacy but still needed for backward compatibility\n');
}

/**
 * Find consolidation opportunities
 */
async function findConsolidation(documenter) {
    console.log('🔍 Looking for consolidation opportunities...\n');
    
    const opportunities = await documenter.findConsolidationOpportunities();
    
    if (opportunities.length === 0) {
        console.log('✅ No obvious consolidation opportunities found!\n');
        return;
    }

    console.log(`Found ${opportunities.length} potential consolidation opportunities:\n`);
    console.log('─'.repeat(80));

    opportunities.forEach((opp, index) => {
        console.log(`\n${index + 1}. Variables with prefix "${opp.prefix}"`);
        console.log(`   Variables (${opp.variables.length}):`);
        opp.variables.forEach((varName, i) => {
            console.log(`      - ${varName}`);
            console.log(`        ${opp.descriptions[i]}`);
        });
        console.log(`\n   💡 ${opp.suggestion}`);
    });

    console.log('\n─'.repeat(80));
    console.log('\n💡 Benefits of consolidation:');
    console.log('   - Easier configuration management');
    console.log('   - Fewer environment variables to maintain');
    console.log('   - Clearer variable organization\n');
}

/**
 * Show help message
 */
function showHelp() {
    console.log('Usage: npm run doc-env-vars [command] [options]\n');
    console.log('Commands:\n');
    
    Object.entries(COMMANDS).forEach(([cmd, description]) => {
        console.log(`  ${cmd.padEnd(15)} ${description}`);
    });

    console.log('\nExamples:\n');
    console.log('  npm run doc-env-vars scan                    # Scan and sync to Airtable');
    console.log('  npm run doc-env-vars export                  # Export to ENV-VARIABLES-DOCS.md');
    console.log('  npm run doc-env-vars export custom.md       # Export to custom file');
    console.log('  npm run doc-env-vars obsolete                # Find removable variables');
    console.log('  npm run doc-env-vars consolidate             # Find consolidation opportunities');
    console.log('\nEnvironment Variables Required:\n');
    console.log('  MASTER_CLIENTS_BASE_ID   - Airtable Master Clients base');
    console.log('  AIRTABLE_API_KEY         - Airtable API key');
    console.log('  GCP_PROJECT_ID           - Google Cloud project (for AI descriptions)');
    console.log('  GCP_LOCATION             - Google Cloud location (for AI descriptions)');
    console.log('\nNotes:\n');
    console.log('  - The scan command generates AI descriptions using Google Gemini');
    console.log('  - This requires valid GCP credentials to be configured');
    console.log('  - The process respects API rate limits with automatic delays');
    console.log('  - Sensitive values (API keys, secrets) are automatically masked in exports\n');
}

// Run the CLI
main();
