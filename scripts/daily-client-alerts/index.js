// scripts/daily-client-alerts/index.js
// Daily client alert system - checks for clients with no scored leads in last 24 hours
// Sends templated emails to clients with BCC to admin

require('dotenv').config();
const clientService = require('../../services/clientService');
const emailNotificationService = require('../../services/emailNotificationService');
const Airtable = require('airtable');

// Template ID for "no leads scored today" emails
const NO_LEADS_TEMPLATE_ID = 'no-leads-scored-today';

/**
 * Get scored leads count for a client in the last 24 hours
 * @param {Object} clientData - Client data with airtableBaseId
 * @returns {Promise<number>} Number of leads scored in last 24 hours
 */
async function getScoredLeadsCount24h(clientData) {
    try {
        if (!clientData.airtableBaseId) {
            console.log(`⚠️  No Airtable Base ID for client ${clientData.clientId}`);
            return 0;
        }

        // Connect to client's Airtable base
        const base = clientService.getClientBase(clientData.airtableBaseId);
        
        // Calculate 24 hours ago timestamp
        const now = new Date();
        const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        const yesterdayISO = yesterday.toISOString();

        console.log(`Checking scored leads for ${clientData.clientId} since ${yesterdayISO}`);

        let scoredCount = 0;

        // Query the Candidates Scored - last 24 hours view
        await base('Leads').select({
            view: 'Candidates Scored - last 24 hours'
        }).eachPage((records, fetchNextPage) => {
            scoredCount += records.length;
            fetchNextPage();
        });

        console.log(`📊 Client ${clientData.clientId}: ${scoredCount} leads scored in last 24 hours`);
        return scoredCount;

    } catch (error) {
        console.error(`❌ Error checking scored leads for ${clientData.clientId}:`, error);
        // Return 0 to be safe - we'd rather send an unnecessary email than miss a real issue
        return 0;
    }
}

/**
 * Check all active service level 2+ clients for scoring activity
 * @returns {Promise<Object>} Results summary
 */
async function checkClientScoringActivity() {
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
            errors: []
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
                    emailError: null
                };

                if (scoredCount > 0) {
                    results.clientsWithScoring++;
                    console.log(`✅ ${client.clientName}: ${scoredCount} leads scored - no alert needed`);
                } else {
                    results.clientsWithoutScoring++;
                    console.log(`⚠️  ${client.clientName}: 0 leads scored - alert needed`);
                    
                    if (hasEmail) {
                        results.clientsWithEmail++;
                        
                        // Send alert email
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
 */
async function sendAdminSummary(results) {
    try {
        console.log("\n📊 Preparing admin summary email...");

        const summaryHtml = `
        <h2>Daily Client Scoring Activity Report</h2>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-AU', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        })}</p>
        
        <h3>Summary</h3>
        <ul>
            <li><strong>Total Scoring Clients:</strong> ${results.totalClients}</li>
            <li><strong>Clients with Scoring Activity:</strong> ${results.clientsWithScoring}</li>
            <li><strong>Clients without Scoring Activity:</strong> ${results.clientsWithoutScoring}</li>
            <li><strong>Alert Emails Sent:</strong> ${results.emailsSent}</li>
            <li><strong>Email Failures:</strong> ${results.emailsFailed}</li>
        </ul>

        <h3>Clients Without Scoring Activity (Last 24 Hours)</h3>
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
                .map(d => `
                <tr>
                    <td style="padding: 8px;">${d.clientName} (${d.clientId})</td>
                    <td style="padding: 8px;">${d.clientEmail || 'No email'}</td>
                    <td style="padding: 8px;">${d.emailSent ? '✅ Yes' : '❌ No'}</td>
                    <td style="padding: 8px;">${d.emailError ? `Error: ${d.emailError}` : d.emailSent ? 'Success' : 'No email address'}</td>
                </tr>
                `).join('')}
        </table>
        ` : '<p><em>All clients had scoring activity in the last 24 hours.</em></p>'}

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
        // Check all clients for scoring activity
        const results = await checkClientScoringActivity();
        
        // Log summary
        console.log("\n📊 DAILY CHECK SUMMARY:");
        console.log(`Total Scoring Clients: ${results.totalClients}`);
        console.log(`Clients with Activity: ${results.clientsWithScoring}`);
        console.log(`Clients without Activity: ${results.clientsWithoutScoring}`);
        console.log(`Alert Emails Sent: ${results.emailsSent}`);
        console.log(`Email Failures: ${results.emailsFailed}`);
        
        // Send admin summary
        await sendAdminSummary(results);
        
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
    getScoredLeadsCount24h,
    sendAdminSummary
};