#!/usr/bin/env node
/**
 * test-client-membership.js
 * 
 * Quick test script to check membership for a single client
 * Usage: node test-client-membership.js CLIENT_ID
 * Example: node test-client-membership.js client-001
 */

require('dotenv').config();
const pmproService = require('./services/pmproMembershipService');
const clientService = require('./services/clientService');

async function testClientMembership(clientId) {
    try {
        console.log('\n========================================');
        console.log('🔍 Testing Client Membership');
        console.log('========================================\n');

        // Get client
        console.log(`Looking up client: ${clientId}...`);
        const client = await clientService.getClientById(clientId);
        
        if (!client) {
            console.error(`❌ Client not found: ${clientId}`);
            process.exit(1);
        }

        console.log(`✅ Client found: ${client.clientName}`);
        console.log(`   Client ID: ${client.clientId}`);
        console.log(`   Current Status: ${client.status}`);
        console.log(`   WordPress User ID: ${client.wpUserId || 'NOT SET'}`);
        console.log('');

        if (!client.wpUserId) {
            console.error('❌ ERROR: Client has no WordPress User ID configured');
            console.error('   → Status should be: Paused');
            console.error('   → Reason: No WordPress User ID');
            process.exit(1);
        }

        // Test WordPress connection
        console.log('🔍 Testing WordPress connection...');
        const wpTest = await pmproService.testWordPressConnection();
        
        if (!wpTest.success) {
            console.error('❌ WordPress connection failed:', wpTest.error);
            process.exit(1);
        }
        
        console.log('✅ WordPress connection successful');
        console.log(`   Base URL: ${wpTest.baseUrl}`);
        console.log(`   PMPro API: ${wpTest.pmproApiAvailable ? 'Available' : 'Not available (using fallback)'}`);
        console.log('');

        // Check membership
        console.log(`🔍 Checking PMPro membership for WP User ID ${client.wpUserId}...`);
        const membershipCheck = await pmproService.checkUserMembership(client.wpUserId);

        console.log('');
        console.log('========================================');
        console.log('📊 Membership Check Results');
        console.log('========================================\n');

        if (membershipCheck.error) {
            console.error('❌ ERROR:', membershipCheck.error);
            console.error('');
            console.error('Recommendation:');
            console.error('   → Status should be: Paused');
            console.error(`   → Reason: ${membershipCheck.error}`);
        } else if (membershipCheck.hasValidMembership) {
            console.log('✅ VALID MEMBERSHIP FOUND');
            console.log(`   Level ID: ${membershipCheck.levelId}`);
            console.log(`   Level Name: ${membershipCheck.levelName}`);
            console.log('');
            console.log('Recommendation:');
            console.log('   → Status should be: Active');
            console.log(`   → Reason: Valid PMPro membership (Level ${membershipCheck.levelId})`);
        } else {
            console.log('⚠️ NO VALID MEMBERSHIP');
            if (membershipCheck.levelId) {
                console.log(`   Found Level: ${membershipCheck.levelId} (${membershipCheck.levelName})`);
                console.log('   Problem: This level is not in the "Valid PMPro Levels" table');
            } else {
                console.log('   No active PMPro membership found for this user');
            }
            console.log('');
            console.log('Recommendation:');
            console.log('   → Status should be: Paused');
            console.log(`   → Reason: ${membershipCheck.levelId ? `Invalid PMPro level ${membershipCheck.levelId}` : 'No active PMPro membership'}`);
        }

        console.log('');
        console.log('Current vs Recommended:');
        const recommended = membershipCheck.hasValidMembership ? 'Active' : 'Paused';
        if (client.status === recommended) {
            console.log(`   ✅ Status is correct: ${client.status}`);
        } else {
            console.log(`   ⚠️ Status needs update: ${client.status} → ${recommended}`);
        }

        console.log('\n========================================\n');

        process.exit(0);

    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error('\nStack trace:');
        console.error(error.stack);
        process.exit(1);
    }
}

// Get client ID from command line
const clientId = process.argv[2];

if (!clientId) {
    console.error('\n❌ ERROR: Client ID required');
    console.error('\nUsage: node test-client-membership.js CLIENT_ID');
    console.error('Example: node test-client-membership.js client-001\n');
    process.exit(1);
}

testClientMembership(clientId);
