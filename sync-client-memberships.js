#!/usr/bin/env node
/**
 * sync-client-memberships.js
 * 
 * Standalone script to sync client statuses based on WordPress PMPro memberships
 * Can be run manually or scheduled as a cron job
 * 
 * Usage:
 *   node sync-client-memberships.js
 * 
 * Or via npm:
 *   npm run sync-memberships
 */

require('dotenv').config();
const pmproService = require('./services/pmproMembershipService');
const clientService = require('./services/clientService');
const { createLogger } = require('./utils/contextLogger');
const Airtable = require('airtable');
const { MASTER_TABLES, CLIENT_FIELDS } = require('./constants/airtableUnifiedConstants');

const logger = createLogger({ 
    runId: 'membership-sync-cli', 
    clientId: 'SYSTEM', 
    operation: 'sync-memberships' 
});

/**
 * Update client status in Airtable
 */
async function updateClientStatus(recordId, newStatus, reason, expiryDate = null) {
    try {
        Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
        const base = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
        
        // Log the reason to console instead of trying to write to Comment field
        console.log(`[MEMBERSHIP_SYNC] Updating client ${recordId}: Status → ${newStatus} (${reason})${expiryDate ? `, Expiry → ${expiryDate}` : ''}`);
        
        const updateFields = {
            [CLIENT_FIELDS.STATUS]: newStatus
        };
        
        // Add expiry date if provided (null will clear the field)
        if (expiryDate !== undefined) {
            updateFields[CLIENT_FIELDS.EXPIRY_DATE] = expiryDate;
        }
        
        await base(MASTER_TABLES.CLIENTS).update(recordId, updateFields);
        
        return true;
    } catch (error) {
        console.error(`[ERROR] Failed to update client status:`, error.message);
        throw error;
    }
}

/**
 * Main sync function
 */
async function syncClientMemberships() {
    console.log('\n========================================');
    console.log('🔄 PMPro Membership Sync');
    console.log('========================================\n');
    
    try {
        // Validate environment
        if (!process.env.MASTER_CLIENTS_BASE_ID) {
            throw new Error('MASTER_CLIENTS_BASE_ID not configured');
        }
        if (!process.env.WP_BASE_URL) {
            throw new Error('WP_BASE_URL not configured');
        }
        if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD) {
            throw new Error('WordPress admin credentials not configured');
        }

        logger.info('✅ Environment validated');

        // Test WordPress connection
        console.log('🔍 Testing WordPress connection...');
        const wpTest = await pmproService.testWordPressConnection();
        
        if (!wpTest.success) {
            throw new Error(`WordPress connection failed: ${wpTest.error}`);
        }
        
        console.log('✅ WordPress connection successful');
        console.log(`   - Base URL: ${wpTest.baseUrl}`);
        console.log(`   - PMPro API: ${wpTest.pmproApiAvailable ? 'Available' : 'Not available (will use fallback)'}`);
        console.log('');

        // Get all clients
        console.log('📋 Fetching all clients from Master Clients base...');
        const allClients = await clientService.getAllClients();
        console.log(`✅ Found ${allClients.length} clients\n`);

        const results = {
            total: allClients.length,
            processed: 0,
            activated: 0,
            paused: 0,
            errors: 0,
            skipped: 0,
            details: []
        };

        // Process each client
        for (let i = 0; i < allClients.length; i++) {
            const client = allClients[i];
            const clientId = client.clientId;
            const clientName = client.clientName;
            const wpUserId = client.wpUserId;
            const currentStatus = client.status;
            const statusManagement = (client.statusManagement || 'Automatic').toString().trim();

            console.log(`\n[${i + 1}/${allClients.length}] ${clientName} (${clientId})`);
            console.log('─'.repeat(60));

            // Skip if Status Management is set to "Manual" (case-insensitive)
            if (statusManagement.toLowerCase() === 'manual') {
                console.log(`⏭️ SKIPPING: Status Management set to "Manual"`);
                console.log(`   Current Status: ${currentStatus} (manually managed)`);
                results.skipped++;
                results.details.push({
                    clientId,
                    clientName,
                    action: 'skipped',
                    reason: 'Status Management set to Manual',
                    status: currentStatus
                });
                continue;
            }

            // Check if WordPress User ID exists
            if (!wpUserId || wpUserId === 0) {
                console.error(`❌ ERROR: No WordPress User ID configured`);
                console.error(`   → Setting Status to Paused`);
                
                await updateClientStatus(client.id, 'Paused', 'No WordPress User ID configured', null);
                
                results.paused++;
                results.errors++;
                results.processed++;
                results.details.push({
                    clientId,
                    clientName,
                    action: 'paused',
                    reason: 'No WordPress User ID',
                    error: true
                });
                continue;
            }

            console.log(`   WP User ID: ${wpUserId}`);

            // Check PMPro membership (pass email for fallback lookup if user_id returns nothing)
            const membershipCheck = await pmproService.checkUserMembership(wpUserId, {
                clientEmail: client.clientEmailAddress || null
            });

            if (membershipCheck.error) {
                // FAIL-SAFE: On API/verification error, do NOT change status - leave as-is.
                // Prevents valid members from being incorrectly paused due to timeouts, network blips, etc.
                console.error(`⚠️ Could not verify membership: ${membershipCheck.error}`);
                console.error(`   → SKIPPING - leaving status unchanged (${currentStatus}) - will retry on next sync`);
                
                results.skipped++;
                results.processed++;
                results.details.push({
                    clientId,
                    clientName,
                    action: 'skipped',
                    reason: `API error - could not verify: ${membershipCheck.error}`,
                    status: currentStatus,
                    unverifiable: true
                });
                continue;
            }

            // Determine what the status should be
            const shouldBeActive = membershipCheck.hasValidMembership;
            const newStatus = shouldBeActive ? 'Active' : 'Paused';
            
            // Log membership info
            if (membershipCheck.hasValidMembership) {
                console.log(`   ✅ Valid membership: Level ${membershipCheck.levelId} (${membershipCheck.levelName})`);
                if (membershipCheck.expiryDate) {
                    console.log(`   📅 Expiry Date: ${membershipCheck.expiryDate}`);
                } else {
                    console.log(`   📅 Expiry Date: None (lifetime membership)`);
                }
            } else {
                console.log(`   ⚠️ Invalid or no membership`);
                if (membershipCheck.levelId) {
                    console.log(`   → Has Level ${membershipCheck.levelId} but not in valid levels list`);
                } else {
                    console.log(`   → No active PMPro membership found`);
                }
            }

            // Update if status changed
            if (currentStatus !== newStatus) {
                console.log(`   🔄 Updating status: ${currentStatus} → ${newStatus}`);
                
                const reason = shouldBeActive 
                    ? `Valid PMPro membership (Level ${membershipCheck.levelId})`
                    : (membershipCheck.levelId 
                        ? `Invalid PMPro level ${membershipCheck.levelId}` 
                        : 'No active PMPro membership');
                
                // Include expiry date in the update
                await updateClientStatus(client.id, newStatus, reason, membershipCheck.expiryDate);
                
                if (newStatus === 'Active') {
                    results.activated++;
                    console.log(`   ✅ Status updated to Active`);
                } else {
                    results.paused++;
                    console.log(`   ⏸️ Status updated to Paused`);
                }
                
                results.details.push({
                    clientId,
                    clientName,
                    action: newStatus.toLowerCase(),
                    previousStatus: currentStatus,
                    newStatus: newStatus,
                    reason: reason,
                    membershipLevel: membershipCheck.levelId
                });
            } else {
                console.log(`   ✓ Status unchanged: ${currentStatus}`);
                results.skipped++;
                results.details.push({
                    clientId,
                    clientName,
                    action: 'unchanged',
                    status: currentStatus,
                    membershipLevel: membershipCheck.levelId
                });
            }

            results.processed++;
        }

        // Print summary
        console.log('\n========================================');
        console.log('✅ Membership Sync Complete!');
        console.log('========================================\n');
        console.log(`📊 Summary:`);
        console.log(`   Total clients: ${results.total}`);
        console.log(`   Processed: ${results.processed}`);
        console.log(`   Activated: ${results.activated}`);
        console.log(`   Paused: ${results.paused}`);
        console.log(`   Unchanged: ${results.skipped}`);
        console.log(`   Errors: ${results.errors}`);
        console.log('');

        // Show details of changes
        const changes = results.details.filter(d => d.action === 'active' || d.action === 'paused');
        if (changes.length > 0) {
            console.log('📝 Changes made:');
            changes.forEach(detail => {
                const icon = detail.action === 'active' ? '✅' : '⏸️';
                console.log(`   ${icon} ${detail.clientName}: ${detail.previousStatus} → ${detail.newStatus}`);
                console.log(`      Reason: ${detail.reason}`);
            });
            console.log('');
        }

        // Show errors
        const errors = results.details.filter(d => d.error);
        if (errors.length > 0) {
            console.log('❌ Errors:');
            errors.forEach(detail => {
                console.log(`   ❌ ${detail.clientName}: ${detail.reason}`);
            });
            console.log('');
        }

        // Email admin if any clients were skipped due to API/verification errors (timeout, etc.)
        const unverifiable = results.details.filter(d => d.unverifiable);
        if (unverifiable.length > 0) {
            try {
                const { sendAlertEmail } = require('./services/emailNotificationService');
                const listHtml = unverifiable.map(d =>
                    `<li><strong>${d.clientName}</strong> (${d.clientId}): ${d.reason}</li>`
                ).join('');
                await sendAlertEmail(
                    '⚠️ PMPro Membership Sync: Some Clients Could Not Be Verified',
                    `<h2>WordPress/PMPro API Issues During Sync</h2>
                    <p><strong>${unverifiable.length}</strong> client(s) were skipped because membership could not be verified (timeout, network error, etc.). Their status was left unchanged.</p>
                    <p><strong>Time:</strong> ${new Date().toISOString()}</p>
                    <h3>Affected clients:</h3>
                    <ul>${listHtml}</ul>
                    <p>Consider checking WordPress/PMPro performance. Status will be retried on next sync.</p>`
                );
            } catch (emailErr) {
                console.error('Failed to send unverifiable-clients alert email:', emailErr.message);
            }
        }

        logger.info('✅ Membership sync completed successfully', results);
        process.exit(0);

    } catch (error) {
        console.error('\n========================================');
        console.error('❌ FATAL ERROR');
        console.error('========================================\n');
        console.error(`Error: ${error.message}`);
        console.error(`Stack: ${error.stack}`);
        console.error('');

        logger.error('❌ Membership sync failed', {
            error: error.message,
            stack: error.stack
        });

        // Email admin on sync failure (cron runs this script)
        try {
            const { sendAlertEmail } = require('./services/emailNotificationService');
            await sendAlertEmail(
                '❌ PMPro Membership Sync Failed',
                `<h2>Daily membership sync failed</h2>
                <p><strong>Error:</strong> ${error.message}</p>
                <p><strong>Time:</strong> ${new Date().toISOString()}</p>
                <pre>${error.stack || ''}</pre>
                <p>Check Render logs for details.</p>`
            );
        } catch (emailErr) {
            console.error('Failed to send alert email:', emailErr.message);
        }

        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    syncClientMemberships();
}

module.exports = { syncClientMemberships };
