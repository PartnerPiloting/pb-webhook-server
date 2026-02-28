// scripts/daily-client-alerts/index.js
// Daily client alert system - checks for clients with no scored leads in last 72 hours
// Sends templated emails to clients with BCC to admin

require('dotenv').config();
const clientService = require('../../services/clientService');
const emailNotificationService = require('../../services/emailNotificationService');
const airtableClient = require('../../config/airtableClient');
const { MASTER_TABLES } = require('../../constants/airtableUnifiedConstants');

// Template ID for "no leads scored in 72 hours" emails
const NO_LEADS_TEMPLATE_ID = 'no-leads-scored-72-hours';

/** Hours to look back for a completed scoring run (technical glitch detection) */
const PIPELINE_HEALTH_HOURS = 48;

/**
 * Check if scoring pipeline ran successfully in the last N hours (technical glitch detection).
 * Returns { healthy: boolean, lastCompletedRun: object|null, systemNotes: string|null, message: string }
 */
async function checkScoringPipelineHealth() {
    try {
        const base = airtableClient.getMasterClientsBase();
        const cutoff = new Date(Date.now() - PIPELINE_HEALTH_HOURS * 60 * 60 * 1000).toISOString();

        const records = await base(MASTER_TABLES.JOB_TRACKING).select({
            filterByFormula: `AND({Status} = 'Completed', IS_AFTER({Start Time}, '${cutoff}'))`,
            maxRecords: 1,
            sort: [{ field: 'Start Time', direction: 'desc' }]
        }).firstPage();

        if (records && records.length > 0) {
            const r = records[0];
            const systemNotes = r.get('System Notes') || '';
            return {
                healthy: true,
                lastCompletedRun: { runId: r.get('Run ID'), startTime: r.get('Start Time') },
                systemNotes,
                message: `Pipeline healthy: last completed run ${r.get('Run ID')} at ${r.get('Start Time')}`
            };
        }

        return {
            healthy: false,
            lastCompletedRun: null,
            systemNotes: null,
            message: `No completed scoring run in last ${PIPELINE_HEALTH_HOURS} hours - possible technical glitch`
        };
    } catch (error) {
        console.error('❌ Error checking pipeline health:', error);
        return {
            healthy: false,
            lastCompletedRun: null,
            systemNotes: null,
            message: `Pipeline health check failed: ${error.message}`
        };
    }
}

/**
 * Parse Job Tracking System Notes to extract per-client leads processed.
 * Format: "ClientName: N leads" or "ClientName: N leads (failed); "
 * @param {string} systemNotes - Raw System Notes from Job Tracking
 * @returns {Object} Map of clientName (trimmed) -> leadsProcessed (number)
 */
function parseJobTrackingClientNotes(systemNotes) {
    const map = {};
    if (!systemNotes || typeof systemNotes !== 'string') return map;
    // Match "ClientName: N leads" or "ClientName: N leads (failed)"
    const regex = /([^:]+):\s*(\d+)\s+leads(?:\s+\(failed\))?/g;
    let m;
    while ((m = regex.exec(systemNotes)) !== null) {
        const clientName = m[1].trim();
        const leads = parseInt(m[2], 10);
        map[clientName] = leads;
    }
    return map;
}

/**
 * Get scored leads count for a client in the last 72 hours
 * @param {Object} clientData - Client data with airtableBaseId
 * @returns {Promise<number>} Number of leads scored in last 72 hours
 */
async function getScoredLeadsCount24h(clientData) {
    try {
        if (!clientData.airtableBaseId) {
            console.log(`⚠️  No Airtable Base ID for client ${clientData.clientId}`);
            return 0;
        }

        // Connect to client's Airtable base
        const base = clientService.getClientBase(clientData.airtableBaseId);
        
        // Calculate 72 hours ago timestamp
        const now = new Date();
        const threeDaysAgo = new Date(now.getTime() - (72 * 60 * 60 * 1000));
        const threeDaysAgoISO = threeDaysAgo.toISOString();

        console.log(`Checking scored leads for ${clientData.clientId} since ${threeDaysAgoISO}`);

        let scoredCount = 0;

        // Query leads directly with filter for records scored in last 72 hours
        // Filter: Date Scored exists AND is greater than 72 hours ago
        await base('Leads').select({
            filterByFormula: `AND(
                {Date Scored} != '',
                IS_AFTER({Date Scored}, '${threeDaysAgoISO}')
            )`
        }).eachPage((records, fetchNextPage) => {
            scoredCount += records.length;
            fetchNextPage();
        });

        console.log(`📊 Client ${clientData.clientId}: ${scoredCount} leads scored in last 72 hours`);
        return scoredCount;

    } catch (error) {
        console.error(`❌ Error checking scored leads for ${clientData.clientId}:`, error);
        // Return 0 to be safe - we'd rather send an unnecessary email than miss a real issue
        return 0;
    }
}

/**
 * Check if client has ever had any leads scored (used to skip early-onboarding clients).
 * @param {Object} clientData - Client data with airtableBaseId
 * @returns {Promise<boolean>} True if at least one lead has ever been scored
 */
async function hasEverHadLeadsScored(clientData) {
    try {
        if (!clientData.airtableBaseId) return true; // Can't check - err on side of sending (don't miss valid alerts)
        const base = clientService.getClientBase(clientData.airtableBaseId);
        const records = await base('Leads').select({
            filterByFormula: `{Date Scored} != ''`,
            maxRecords: 1
        }).firstPage();
        return records && records.length > 0;
    } catch (error) {
        console.error(`❌ Error checking ever-scored for ${clientData.clientId}:`, error);
        return true; // Can't check - err on side of sending (don't miss valid alerts)
    }
}

/**
 * Look up client in jobTrackingNotes map (case-insensitive, trimmed)
 * @param {Object} jobTrackingNotes - Map of clientName -> leadsProcessed
 * @param {string} clientName - Client name to look up
 * @returns {number|null} leadsProcessed if found, null otherwise
 */
function getLeadsFromJobTracking(jobTrackingNotes, clientName) {
    if (!jobTrackingNotes || typeof jobTrackingNotes !== 'object') return null;
    const key = (clientName || '').trim();
    if (jobTrackingNotes[key] !== undefined) return jobTrackingNotes[key];
    const keyLower = key.toLowerCase();
    for (const k of Object.keys(jobTrackingNotes)) {
        if (k.trim().toLowerCase() === keyLower) return jobTrackingNotes[k];
    }
    return null;
}

/**
 * Check all active service level 2+ clients for scoring activity
 * @param {Object} options - Options
 * @param {boolean} options.suppressClientAlerts - If true, do not send client emails (e.g. when technical glitch detected)
 * @param {Object} options.jobTrackingNotes - Map of clientName -> leadsProcessed from most recent completed run
 * @returns {Promise<Object>} Results summary
 */
async function checkClientScoringActivity(options = {}) {
    const { suppressClientAlerts = false, jobTrackingNotes = {} } = options;
    try {
        console.log("🔍 Starting daily client scoring activity check...");
        
        // Get all active clients with service level >= 2 (have scoring service)
        const activeClients = await clientService.getAllActiveClients();
        const scoringClients = activeClients.filter(client => client.serviceLevel >= 2);
        
        console.log(`Found ${scoringClients.length} active clients with scoring service (level >= 2)`);

        const results = {
            totalClients: scoringClients.length,
            clientsWithScoring: 0,
            clientsWithoutScoring: 0,
            clientsWithEmail: 0,
            clientsWithoutEmail: 0,
            emailsSent: 0,
            emailsFailed: 0,
            details: [],
            errors: [],
            suppressedClients: []
        };

        // Check each client's scoring activity
        for (const client of scoringClients) {
            try {
                console.log(`\n📋 Checking client: ${client.clientName} (${client.clientId})`);
                
                const scoredCount = await getScoredLeadsCount24h(client);
                const hasEmail = client.clientEmailAddress && client.clientEmailAddress.trim() !== '';
                
                const clientResult = {
                    clientId: client.clientId,
                    clientName: client.clientName,
                    clientEmail: client.clientEmailAddress,
                    scoredLeads24h: scoredCount,
                    hasEmail: hasEmail,
                    needsAlert: scoredCount === 0,
                    emailSent: false,
                    emailError: null,
                    suppressed: false,
                    suppressReason: null,
                    ourLeadsProcessed: null
                };

                if (scoredCount > 0) {
                    results.clientsWithScoring++;
                    console.log(`✅ ${client.clientName}: ${scoredCount} leads scored - no alert needed`);
                } else {
                    results.clientsWithoutScoring++;
                    console.log(`⚠️  ${client.clientName}: 0 leads scored - alert needed`);
                    
                    if (hasEmail) {
                        results.clientsWithEmail++;
                        
                        if (suppressClientAlerts) {
                            clientResult.suppressed = true;
                            clientResult.suppressReason = 'Pipeline unhealthy (technical glitch suspected)';
                            results.suppressedClients.push({ clientName: client.clientName, clientId: client.clientId, reason: clientResult.suppressReason });
                            console.log(`⏸️  Suppressing client alert (technical glitch suspected)`);
                        } else {
                            const ourLeads = getLeadsFromJobTracking(jobTrackingNotes, client.clientName);
                            if (ourLeads === null) {
                                // Client not in Job Tracking - we didn't process them
                                clientResult.suppressed = true;
                                clientResult.suppressReason = 'Not in Job Tracking (we did not process them)';
                                results.suppressedClients.push({ clientName: client.clientName, clientId: client.clientId, reason: clientResult.suppressReason });
                                console.log(`⏸️  Suppressing: client not in Job Tracking`);
                            } else if (ourLeads > 0) {
                                // Discrepancy: we scored leads but their data shows 0
                                clientResult.suppressed = true;
                                clientResult.suppressReason = `Discrepancy: we scored ${ourLeads} leads but their data shows 0`;
                                clientResult.ourLeadsProcessed = ourLeads;
                                results.suppressedClients.push({ clientName: client.clientName, clientId: client.clientId, reason: clientResult.suppressReason, ourLeads });
                                console.log(`⏸️  Suppressing: discrepancy - we scored ${ourLeads} leads`);
                            } else {
                                // Client in notes with 0 leads - check if they've ever had leads scored (skip early onboarding)
                                const everScored = await hasEverHadLeadsScored(client);
                                if (!everScored) {
                                    clientResult.suppressed = true;
                                    clientResult.suppressReason = 'Never had leads scored - early onboarding';
                                    results.suppressedClients.push({ clientName: client.clientName, clientId: client.clientId, reason: clientResult.suppressReason });
                                    console.log(`⏸️  Suppressing: never had leads scored (early onboarding)`);
                                } else {
                                    // Legitimate: they've had leads scored before, now 0 - send email (e.g. Paul-Faix situation)
                                    clientResult.ourLeadsProcessed = 0;
                                    console.log(`📧 Sending no-leads alert to ${client.clientEmailAddress}`);
                                    const emailResult = await emailNotificationService.sendTemplatedEmail(
                                        client,
                                        NO_LEADS_TEMPLATE_ID
                                    );
                                    if (emailResult.success) {
                                        results.emailsSent++;
                                        clientResult.emailSent = true;
                                        console.log(`✅ Alert email sent to ${client.clientEmailAddress}`);
                                    } else {
                                        results.emailsFailed++;
                                        clientResult.emailError = emailResult.error;
                                        console.log(`❌ Failed to send alert email: ${emailResult.error}`);
                                    }
                                }
                            }
                        }
                    } else {
                        results.clientsWithoutEmail++;
                        console.log(`⚠️  ${client.clientName}: No email address configured - cannot send alert`);
                    }
                }

                results.details.push(clientResult);

            } catch (error) {
                console.error(`❌ Error processing client ${client.clientId}:`, error);
                results.errors.push({
                    clientId: client.clientId,
                    clientName: client.clientName,
                    error: error.message
                });
            }
        }

        return results;

    } catch (error) {
        console.error("❌ Error in daily client scoring check:", error);
        throw error;
    }
}

/**
 * Send admin summary email about the daily check
 * @param {Object} results - Results from checkClientScoringActivity
 * @param {Object} options - Options
 * @param {Object} options.pipelineHealth - Result from checkScoringPipelineHealth
 */
async function sendAdminSummary(results, options = {}) {
    try {
        console.log("\n📊 Preparing admin summary email...");
        const { pipelineHealth } = options;
        const pipelineSection = pipelineHealth && !pipelineHealth.healthy
            ? `<p style="color: #b45309;"><strong>⚠️ Technical glitch detected:</strong> ${pipelineHealth.message}. Client alerts were suppressed.</p>`
            : pipelineHealth ? `<p style="color: #059669;"><strong>✅ Pipeline healthy:</strong> ${pipelineHealth.message}</p>` : '';

        const summaryHtml = `
        <h2>Daily Client Scoring Activity Report</h2>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-AU', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        })}</p>
        ${pipelineSection}
        
        <h3>Summary</h3>
        <ul>
            <li><strong>Total Scoring Clients:</strong> ${results.totalClients}</li>
            <li><strong>Clients with Scoring Activity:</strong> ${results.clientsWithScoring}</li>
            <li><strong>Clients without Scoring Activity:</strong> ${results.clientsWithoutScoring}</li>
            <li><strong>Alert Emails Sent:</strong> ${results.emailsSent}</li>
            <li><strong>Email Failures:</strong> ${results.emailsFailed}</li>
        </ul>

        <h3>Clients Without Scoring Activity (Last 72 Hours)</h3>
        ${results.clientsWithoutScoring > 0 ? `
        <table border="1" style="border-collapse: collapse; width: 100%;">
            <tr style="background-color: #f2f2f2;">
                <th style="padding: 8px; text-align: left;">Client</th>
                <th style="padding: 8px; text-align: left;">Email</th>
                <th style="padding: 8px; text-align: left;">Alert Sent</th>
                <th style="padding: 8px; text-align: left;">Status</th>
            </tr>
            ${results.details
                .filter(d => d.needsAlert)
                .map(d => {
                    let status = d.emailError ? `Error: ${d.emailError}` : d.emailSent ? 'Success' : 'No email address';
                    if (d.suppressed) status = `Suppressed: ${d.suppressReason}`;
                    else if (d.emailSent && d.ourLeadsProcessed !== undefined) status = `Success (we processed them, ${d.ourLeadsProcessed} leads scored)`;
                    return `
                <tr>
                    <td style="padding: 8px;">${d.clientName} (${d.clientId})</td>
                    <td style="padding: 8px;">${d.clientEmail || 'No email'}</td>
                    <td style="padding: 8px;">${d.emailSent ? '✅ Yes' : d.suppressed ? '⏸️ Suppressed' : '❌ No'}</td>
                    <td style="padding: 8px;">${status}</td>
                </tr>
                `;
                }).join('')}
        </table>
        ` : '<p><em>All clients had scoring activity in the last 48 hours.</em></p>'}

        ${results.suppressedClients && results.suppressedClients.length > 0 ? `
        <h3>Suppressed Client Emails (No-Leads Email Not Sent)</h3>
        <p><em>These clients would have received a "no leads scored" email but we suppressed it. Review to ensure we are not falsely suppressing.</em></p>
        <table border="1" style="border-collapse: collapse; width: 100%;">
            <tr style="background-color: #fef3c7;">
                <th style="padding: 8px; text-align: left;">Client</th>
                <th style="padding: 8px; text-align: left;">Reason</th>
            </tr>
            ${results.suppressedClients.map(s => `
            <tr>
                <td style="padding: 8px;">${s.clientName} (${s.clientId})</td>
                <td style="padding: 8px;">${s.reason}</td>
            </tr>
            `).join('')}
        </table>
        ` : ''}

        ${results.errors.length > 0 ? `
        <h3>Errors</h3>
        <ul>
            ${results.errors.map(e => `<li><strong>${e.clientName} (${e.clientId}):</strong> ${e.error}</li>`).join('')}
        </ul>
        ` : ''}

        <hr>
        <p><small>Generated by Daily Client Alerts System at ${new Date().toLocaleString('en-AU')}</small></p>
        `;

        const subject = `Daily Client Scoring Report - ${results.clientsWithoutScoring} alerts sent`;
        
        await emailNotificationService.sendAlertEmail(subject, summaryHtml);
        console.log("✅ Admin summary email sent");

    } catch (error) {
        console.error("❌ Error sending admin summary:", error);
    }
}

/**
 * Main execution function
 */
async function main() {
    console.log("🚀 Starting Daily Client Alerts System");
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
        // Technical glitch detection: check if pipeline ran successfully in last 48h
        const pipelineHealth = await checkScoringPipelineHealth();
        console.log(`📊 Pipeline health: ${pipelineHealth.message}`);
        
        if (!pipelineHealth.healthy) {
            await emailNotificationService.sendAlertEmail(
                '⚠️ Scoring Pipeline: Possible Technical Glitch',
                `<h2>Technical Glitch Detection</h2>
                <p><strong>${pipelineHealth.message}</strong></p>
                <p>No completed scoring run found in Job Tracking in the last ${PIPELINE_HEALTH_HOURS} hours.</p>
                <p>Client alerts have been <strong>suppressed</strong> to avoid misleading "no leads scored" emails.</p>
                <p><strong>Action:</strong> Investigate Render logs and Job Tracking. Fix before the 3-day window expires.</p>
                <p><em>Generated at ${new Date().toISOString()}</em></p>`
            );
            console.log('📧 Admin alert sent - client alerts suppressed');
        }

        // Parse Job Tracking notes for per-client validation (only when pipeline healthy)
        const jobTrackingNotes = pipelineHealth.healthy && pipelineHealth.systemNotes
            ? parseJobTrackingClientNotes(pipelineHealth.systemNotes)
            : {};

        // Check all clients for scoring activity (suppress client emails if pipeline unhealthy)
        const results = await checkClientScoringActivity({
            suppressClientAlerts: !pipelineHealth.healthy,
            jobTrackingNotes
        });
        
        // Log summary
        console.log("\n📊 DAILY CHECK SUMMARY:");
        console.log(`Total Scoring Clients: ${results.totalClients}`);
        console.log(`Clients with Activity: ${results.clientsWithScoring}`);
        console.log(`Clients without Activity: ${results.clientsWithoutScoring}`);
        console.log(`Alert Emails Sent: ${results.emailsSent}`);
        console.log(`Email Failures: ${results.emailsFailed}`);
        
        // Send admin summary (include pipeline health context)
        await sendAdminSummary(results, { pipelineHealth });
        
        console.log("\n✅ Daily Client Alerts System completed successfully");
        
        return results;

    } catch (error) {
        console.error("❌ Daily Client Alerts System failed:", error);
        
        // Send error alert to admin
        try {
            await emailNotificationService.sendAlertEmail(
                "❌ Daily Client Alerts System Failed",
                `<h2>Daily Client Alerts System Error</h2>
                <p><strong>Error:</strong> ${error.message}</p>
                <p><strong>Stack:</strong></p>
                <pre>${error.stack}</pre>
                <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>`
            );
        } catch (emailError) {
            console.error("❌ Failed to send error alert:", emailError);
        }
        
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    main()
        .then(() => {
            console.log("Script completed");
            process.exit(0);
        })
        .catch((error) => {
            console.error("Script failed:", error);
            process.exit(1);
        });
}

module.exports = {
    main,
    checkClientScoringActivity,
    checkScoringPipelineHealth,
    parseJobTrackingClientNotes,
    getScoredLeadsCount24h,
    hasEverHadLeadsScored,
    sendAdminSummary
};