#!/usr/bin/env node
// scripts/analyze-env-vars.js
// CLI utility to analyze environment variables

const EnvVarAnalyzer = require('../services/envVarAnalyzer');

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'list';
    
    const analyzer = new EnvVarAnalyzer();
    
    console.log('🔍 Environment Variable Analyzer\n');
    
    try {
        switch (command) {
            case 'list': {
                const branch = args[1] || null;
                console.log(`Scanning ${branch || 'current branch'}...\n`);
                
                const vars = analyzer.scanCodeForEnvVars(branch);
                console.log(`Found ${vars.length} environment variables:\n`);
                
                vars.forEach(v => {
                    const value = analyzer.getCurrentValue(v);
                    const status = value ? '✅' : '❌';
                    console.log(`${status} ${v}${value ? ` = ${value.substring(0, 20)}...` : ' (not set)'}`);
                });
                break;
            }
            
            case 'analyze': {
                const varName = args[1];
                if (!varName) {
                    console.error('Error: Please specify a variable name');
                    console.log('Usage: node analyze-env-vars.js analyze VARIABLE_NAME');
                    process.exit(1);
                }
                
                console.log(`Analyzing ${varName}...\n`);
                const result = await analyzer.generateDescription(varName);
                
                console.log(`📝 ${result.name}`);
                console.log(`Current Value: ${result.currentValue || 'Not set'}`);
                console.log(`\nDescription: ${result.description}`);
                console.log(`Effect: ${result.effect}`);
                console.log(`Recommended: ${result.recommended}`);
                console.log(`Category: ${result.category}`);
                console.log(`\nUsed in ${result.usage.length} locations:`);
                result.usage.slice(0, 5).forEach(u => console.log(`  - ${u}`));
                break;
            }
            
            case 'compare': {
                const branch1 = args[1];
                const branch2 = args[2];
                
                if (!branch1 || !branch2) {
                    console.error('Error: Please specify two branch names');
                    console.log('Usage: node analyze-env-vars.js compare BRANCH1 BRANCH2');
                    process.exit(1);
                }
                
                console.log(`Comparing ${branch1} vs ${branch2}...\n`);
                const comparison = analyzer.compareEnvVars(branch1, branch2);
                
                console.log(`📊 Comparison Results:\n`);
                console.log(`✅ Same (${comparison.same.length} vars):`);
                comparison.same.slice(0, 10).forEach(v => console.log(`   ${v}`));
                if (comparison.same.length > 10) {
                    console.log(`   ... and ${comparison.same.length - 10} more`);
                }
                
                if (comparison.onlyInBranch1.length > 0) {
                    console.log(`\n❌ Only in ${branch1} (${comparison.onlyInBranch1.length} vars):`);
                    comparison.onlyInBranch1.forEach(v => console.log(`   ${v}`));
                }
                
                if (comparison.onlyInBranch2.length > 0) {
                    console.log(`\n❌ Only in ${branch2} (${comparison.onlyInBranch2.length} vars):`);
                    comparison.onlyInBranch2.forEach(v => console.log(`   ${v}`));
                }
                
                console.log(`\n📈 Summary: ${comparison.summary.same} same, ${comparison.summary.different} different`);
                break;
            }
            
            case 'all': {
                console.log('Analyzing all environment variables (this may take a few minutes)...\n');
                const results = await analyzer.analyzeAll();
                
                // Group by category
                const byCategory = results.reduce((acc, v) => {
                    const cat = v.category || 'other';
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(v);
                    return acc;
                }, {});
                
                Object.entries(byCategory).forEach(([category, vars]) => {
                    console.log(`\n📁 ${category.toUpperCase()} (${vars.length} vars)`);
                    console.log('─'.repeat(60));
                    vars.forEach(v => {
                        console.log(`\n${v.name}`);
                        console.log(`  ${v.description}`);
                        console.log(`  Current: ${v.currentValue || 'Not set'}`);
                    });
                });
                break;
            }
            
            default:
                console.log('Usage:');
                console.log('  node analyze-env-vars.js list [branch]         - List all env vars');
                console.log('  node analyze-env-vars.js analyze VAR_NAME      - Analyze specific var');
                console.log('  node analyze-env-vars.js compare BRANCH1 BRANCH2 - Compare branches');
                console.log('  node analyze-env-vars.js all                   - Analyze all vars');
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();
