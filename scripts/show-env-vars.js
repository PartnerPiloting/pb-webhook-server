#!/usr/bin/env node
// scripts/show-env-vars.js
// Quick viewer for current environment variables
// No scanning, just shows what's currently set

require('dotenv').config();

function main() {
    const args = process.argv.slice(2);
    const filter = args[0]?.toUpperCase();

    console.log('📊 Current Environment Variables\n');
    console.log('='.repeat(80));

    // Get all env vars (excluding npm and node internals)
    const envVars = Object.keys(process.env)
        .filter(key => !key.startsWith('npm_') && !key.startsWith('NODE_'))
        .filter(key => !filter || key.includes(filter))
        .sort();

    if (envVars.length === 0) {
        console.log('\n❌ No environment variables found matching:', filter || 'any');
        process.exit(0);
    }

    console.log(`\nFound ${envVars.length} environment variables${filter ? ` matching "${filter}"` : ''}:\n`);

    // Group by prefix
    const grouped = {};
    envVars.forEach(key => {
        const prefix = key.split('_')[0];
        if (!grouped[prefix]) grouped[prefix] = [];
        grouped[prefix].push(key);
    });

    // Display grouped
    Object.entries(grouped).sort().forEach(([prefix, keys]) => {
        console.log(`\n📁 ${prefix.toUpperCase()} (${keys.length}):`);
        console.log('─'.repeat(80));

        keys.forEach(key => {
            const value = process.env[key];
            const masked = shouldMask(key) ? maskValue(value) : value;
            const truncated = masked.length > 60 ? masked.substring(0, 57) + '...' : masked;
            
            console.log(`   ${key.padEnd(35)} = ${truncated}`);
        });
    });

    console.log('\n' + '='.repeat(80));
    console.log(`\nTotal: ${envVars.length} variables\n`);

    // Show helpful tips
    console.log('💡 Tips:');
    console.log('   - Filter by keyword: node scripts/show-env-vars.js AIRTABLE');
    console.log('   - Full documentation: npm run doc-env-vars scan');
    console.log('   - Export markdown: npm run doc-env-vars export\n');
}

function shouldMask(key) {
    const sensitive = ['KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'CREDENTIALS', 'PRIVATE', 'AUTH'];
    return sensitive.some(pattern => key.includes(pattern));
}

function maskValue(value) {
    if (!value || value.length <= 10) return '***';
    return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
}

main();
