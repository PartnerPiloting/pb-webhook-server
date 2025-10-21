#!/usr/bin/env node

/**
 * Diagnostic script to understand why post scoring isn't working
 * 
 * Checks:
 * 1. FIRE_AND_FORGET env var
 * 2. View "Leads with Posts not yet scored" exists and has records
 * 3. Post scoring endpoint authentication
 * 4. Recent run records and their status
 */

require('dotenv').config();

async function main() {
    console.log('='.repeat(80));
    console.log('POST SCORING DIAGNOSTIC TOOL');
    console.log('='.repeat(80));
    console.log('');

    // 1. Check FIRE_AND_FORGET
    console.log('1. FIRE_AND_FORGET Environment Variable:');
    console.log(`   Value: ${process.env.FIRE_AND_FORGET || 'NOT SET'}`);
    console.log(`   Status: ${process.env.FIRE_AND_FORGET === 'true' ? '✅ ENABLED' : '❌ DISABLED - POST SCORING WILL FAIL WITH 501'}`);
    console.log('');

    // 2. Check client configuration
    console.log('2. Checking Guy-Wilson Client Configuration:');
    const { getClientById } = require('./services/clientService');
    const { getClientBase } = require('./config/airtableClient');
    
    const client = await getClientById('Guy-Wilson');
    if (!client) {
        console.log('   ❌ Could not find Guy-Wilson client');
        return;
    }
    
    console.log(`   ✅ Client found: ${client.clientName}`);
    console.log(`   Base ID: ${client.airtableBaseId}`);
    console.log(`   Service Level: ${client.serviceLevel}`);
    console.log('');

    // 3. Check the view exists and has records
    console.log('3. Checking "Leads with Posts not yet scored" view:');
    const clientBase = await getClientBase('Guy-Wilson');
    
    try {
        // First check using the view
        console.log('   Attempting to query view...');
        const viewRecords = await clientBase('Leads').select({
            view: 'Leads with Posts not yet scored',
            maxRecords: 10
        }).firstPage();
        
        console.log(`   ✅ View exists: Found ${viewRecords.length} records in view`);
        
        if (viewRecords.length > 0) {
            const firstRecord = viewRecords[0];
            console.log(`   First record ID: ${firstRecord.id}`);
            console.log(`   Has "Posts Content": ${!!firstRecord.fields['Posts Content']}`);
            console.log(`   Has "Date Posts Scored": ${!!firstRecord.fields['Date Posts Scored']}`);
            console.log(`   Posts Content length: ${firstRecord.fields['Posts Content']?.length || 0} chars`);
        } else {
            console.log('   ⚠️  View exists but has 0 records');
        }
    } catch (viewError) {
        console.log(`   ❌ View query failed: ${viewError.message}`);
        
        // Try fallback query
        console.log('   Trying fallback formula query...');
        try {
            const fallbackRecords = await clientBase('Leads').select({
                filterByFormula: `AND({Posts Content} != '', {Date Posts Scored} = BLANK())`,
                maxRecords: 10
            }).firstPage();
            
            console.log(`   ✅ Fallback query: Found ${fallbackRecords.length} leads with unscored posts`);
        } catch (fallbackError) {
            console.log(`   ❌ Fallback query also failed: ${fallbackError.message}`);
        }
    }
    console.log('');

    // 4. Check recent Client Run Results
    console.log('4. Checking Recent Client Run Results:');
    const airtableService = require('./services/airtableService');
    
    try {
        const recentRuns = await airtableService.getRecentClientRuns('Guy-Wilson', 3);
        console.log(`   Found ${recentRuns.length} recent runs:`);
        
        recentRuns.forEach((run, i) => {
            console.log(`   \n   Run #${i + 1}:`);
            console.log(`   - Run ID: ${run.runId}`);
            console.log(`   - Status: ${run.status}`);
            console.log(`   - Start: ${run.startTime}`);
            console.log(`   - End: ${run.endTime}`);
            console.log(`   - Posts Examined: ${run.postsExamined || 0}`);
            console.log(`   - Posts Scored: ${run.postsScored || 0}`);
            console.log(`   - Post Scoring Tokens: ${run.postScoringTokens || 0}`);
            console.log(`   - System Notes: ${run.systemNotes?.substring(0, 100) || 'None'}`);
        });
    } catch (runError) {
        console.log(`   ❌ Failed to fetch run results: ${runError.message}`);
    }
    console.log('');

    // 5. Check POST SCORING job status fields
    console.log('5. Checking Post Scoring Job Status Fields:');
    try {
        const { getJobStatus } = require('./services/clientService');
        const postScoringStatus = await getJobStatus('Guy-Wilson', 'post_scoring');
        
        if (postScoringStatus) {
            console.log(`   Status: ${postScoringStatus.status || 'None'}`);
            console.log(`   Job ID: ${postScoringStatus.jobId || 'None'}`);
            console.log(`   Last Run Date: ${postScoringStatus.lastRunDate || 'None'}`);
            console.log(`   Last Run Time: ${postScoringStatus.lastRunTime || 'None'}`);
            console.log(`   Posts Scored Last Run: ${postScoringStatus.lastRunCount || 0}`);
        } else {
            console.log('   ❌ No post scoring status found');
        }
    } catch (statusError) {
        console.log(`   ❌ Failed to get job status: ${statusError.message}`);
    }
    console.log('');

    // 6. Test endpoint authentication
    console.log('6. Testing Post Scoring Endpoint Authentication:');
    const secret = process.env.PB_WEBHOOK_SECRET;
    const baseUrl = process.env.RENDER_EXTERNAL_URL || 'https://pb-webhook-server-staging.onrender.com';
    
    console.log(`   Base URL: ${baseUrl}`);
    console.log(`   Secret length: ${secret ? secret.length : 'NOT SET'}`);
    
    if (!secret) {
        console.log('   ❌ PB_WEBHOOK_SECRET not set - authentication will fail');
    } else {
        console.log('   ✅ Secret is configured');
    }
    console.log('');

    console.log('='.repeat(80));
    console.log('DIAGNOSIS COMPLETE');
    console.log('='.repeat(80));
}

main().catch(error => {
    console.error('DIAGNOSTIC FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
});
