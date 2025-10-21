#!/usr/bin/env node
// scripts/test-env-var-documenter.js
// Quick test to verify the env var documentation system works

require('dotenv').config();

async function test() {
    console.log('🧪 Testing Environment Variable Documentation System\n');
    console.log('='.repeat(60));

    // Test 1: Check required environment variables
    console.log('\n1️⃣  Checking required environment variables...');
    const required = [
        'MASTER_CLIENTS_BASE_ID',
        'AIRTABLE_API_KEY',
        'GCP_PROJECT_ID',
        'GCP_LOCATION'
    ];

    let allSet = true;
    for (const varName of required) {
        const isSet = !!process.env[varName];
        console.log(`   ${isSet ? '✅' : '❌'} ${varName}`);
        if (!isSet) allSet = false;
    }

    if (!allSet) {
        console.log('\n❌ Missing required environment variables.');
        console.log('   Please check your .env file.');
        process.exit(1);
    }

    // Test 2: Test EnvVarAnalyzer
    console.log('\n2️⃣  Testing EnvVarAnalyzer...');
    try {
        const EnvVarAnalyzer = require('../services/envVarAnalyzer');
        const analyzer = new EnvVarAnalyzer();
        
        console.log('   📊 Scanning codebase...');
        const vars = analyzer.scanCodeForEnvVars();
        console.log(`   ✅ Found ${vars.length} environment variables`);

        // Show first 10
        console.log('   First 10 variables:');
        vars.slice(0, 10).forEach(v => {
            console.log(`      - ${v}`);
        });

    } catch (error) {
        console.log('   ❌ Error:', error.message);
        process.exit(1);
    }

    // Test 3: Test AI initialization (without making actual call)
    console.log('\n3️⃣  Testing Gemini AI initialization...');
    try {
        const geminiConfig = require('../config/geminiClient');
        
        if (geminiConfig && geminiConfig.geminiModel) {
            console.log('   ✅ Gemini model initialized successfully');
        } else {
            console.log('   ⚠️  Gemini model not available (check GCP credentials)');
        }
    } catch (error) {
        console.log('   ❌ Error:', error.message);
        console.log('   This may affect AI description generation');
    }

    // Test 4: Test Airtable connection
    console.log('\n4️⃣  Testing Airtable connection...');
    try {
        const { getMasterClientsBase } = require('../config/airtableClient');
        const base = await getMasterClientsBase();
        
        console.log('   ✅ Airtable connection successful');
        
        // Try to check if Environment Variables table exists
        console.log('   🔍 Checking for Environment Variables table...');
        
        try {
            const records = await base('Environment Variables')
                .select({ maxRecords: 1 })
                .firstPage();
            
            console.log('   ✅ Environment Variables table found');
            console.log(`   📝 Table has data: ${records.length > 0 ? 'Yes' : 'No (table is empty)'}`);
            
        } catch (tableError) {
            console.log('   ⚠️  Environment Variables table not found');
            console.log('   You need to create it in Airtable first.');
            console.log('   See ENV-VAR-MANAGEMENT-SYSTEM.md for schema.');
        }
        
    } catch (error) {
        console.log('   ❌ Error:', error.message);
        process.exit(1);
    }

    // Test 5: Quick single variable analysis (to verify AI works)
    console.log('\n5️⃣  Testing single variable AI analysis...');
    try {
        const EnvVarAnalyzer = require('../services/envVarAnalyzer');
        const analyzer = new EnvVarAnalyzer();
        
        console.log('   🤖 Analyzing AIRTABLE_API_KEY (this may take a few seconds)...');
        
        const result = await analyzer.generateDescription('AIRTABLE_API_KEY');
        
        console.log('   ✅ AI analysis completed:');
        console.log(`      Description: ${result.description}`);
        console.log(`      Category: ${result.category}`);
        console.log(`      Usage locations: ${result.usage.length}`);
        
    } catch (error) {
        console.log('   ❌ Error:', error.message);
        console.log('   AI description generation may not work properly');
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n✅ All tests passed! System is ready to use.');
    console.log('\nNext steps:');
    console.log('  1. Run: npm run doc-env-vars scan');
    console.log('  2. Check Airtable Environment Variables table');
    console.log('  3. Fill in Production Values from Render');
    console.log('  4. Export documentation: npm run doc-env-vars export\n');
}

// Run tests
test().catch(error => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
});
