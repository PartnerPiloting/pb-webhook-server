// test-scoring-logic.js
// Test the logic that determines when to send "no leads scored" emails

require('dotenv').config();
const clientService = require('./services/clientService');
const Airtable = require('airtable');

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

        console.log(`   📊 Checking scored leads since ${yesterdayISO}`);

        let scoredCount = 0;

        // Query the Candidates Scored - last 24 hours view
        await base('Leads').select({
            view: 'Candidates Scored - last 24 hours'
        }).eachPage((records, fetchNextPage) => {
            scoredCount += records.length;
            console.log(`   📋 Found ${records.length} records in this page`);
            fetchNextPage();
        });

        console.log(`   ✅ Total: ${scoredCount} leads scored in last 24 hours`);
        return scoredCount;

    } catch (error) {
        console.error(`   ❌ Error checking scored leads for ${clientData.clientId}:`, error.message);
        return 0;
    }
}

async function testScoringLogic() {
    console.log("🔍 Testing Scoring Logic for Email Alerts");
    console.log("=========================================\n");

    try {
        // Get all active clients with service level >= 2 (have scoring service)
        const activeClients = await clientService.getAllActiveClients();
        const scoringClients = activeClients.filter(client => client.serviceLevel >= 2);
        
        console.log(`📋 Found ${scoringClients.length} active clients with scoring service (level >= 2)\n`);

        const results = {
            totalClients: scoringClients.length,
            clientsWithScoring: 0,
            clientsWithoutScoring: 0,
            clientsWithEmail: 0,
            clientsWithoutEmail: 0,
            wouldSendEmail: 0,
            details: []
        };

        // Check each client's scoring activity
        for (const client of scoringClients) {
            console.log(`🔍 Checking: ${client.clientName} (${client.clientId})`);
            console.log(`   📧 Email: ${client.clientEmailAddress || 'Not configured'}`);
            
            const scoredCount = await getScoredLeadsCount24h(client);
            const hasEmail = client.clientEmailAddress && client.clientEmailAddress.trim() !== '';
            
            const clientResult = {
                clientId: client.clientId,
                clientName: client.clientName,
                clientEmail: client.clientEmailAddress,
                scoredLeads24h: scoredCount,
                hasEmail: hasEmail,
                needsAlert: scoredCount === 0,
                wouldSendEmail: scoredCount === 0 && hasEmail
            };

            if (scoredCount > 0) {
                results.clientsWithScoring++;
                console.log(`   ✅ ${scoredCount} leads scored - NO alert needed\n`);
            } else {
                results.clientsWithoutScoring++;
                console.log(`   ⚠️  0 leads scored - ALERT needed`);
                
                if (hasEmail) {
                    results.clientsWithEmail++;
                    results.wouldSendEmail++;
                    console.log(`   📧 WOULD SEND EMAIL to ${client.clientEmailAddress}`);
                } else {
                    results.clientsWithoutEmail++;
                    console.log(`   ❌ Cannot send email - no email address configured`);
                }
                console.log("");
            }

            results.details.push(clientResult);
        }

        // Print summary
        console.log("📊 SCORING LOGIC TEST SUMMARY:");
        console.log("===============================");
        console.log(`Total Scoring Clients: ${results.totalClients}`);
        console.log(`Clients with Scoring Activity: ${results.clientsWithScoring}`);
        console.log(`Clients without Scoring Activity: ${results.clientsWithoutScoring}`);
        console.log(`Clients with Email Configured: ${results.clientsWithEmail + results.clientsWithScoring}`);
        console.log(`Emails that WOULD be sent: ${results.wouldSendEmail}`);

        if (results.wouldSendEmail > 0) {
            console.log("\n🚨 CLIENTS THAT WOULD RECEIVE ALERTS:");
            results.details
                .filter(d => d.wouldSendEmail)
                .forEach(d => {
                    console.log(`   - ${d.clientName} (${d.clientId}) → ${d.clientEmail}`);
                });
        } else {
            console.log("\n✅ No alert emails would be sent - all clients have scoring activity or no email configured");
        }

        console.log("\n🧪 To actually send emails, run:");
        console.log("   node scripts/daily-client-alerts/index.js");

        return results;

    } catch (error) {
        console.error("❌ Test failed:", error);
        throw error;
    }
}

// Run the test
if (require.main === module) {
    testScoringLogic()
        .then(() => {
            console.log("\n✅ Scoring logic test completed");
            process.exit(0);
        })
        .catch((error) => {
            console.error("\n❌ Scoring logic test failed:", error);
            process.exit(1);
        });
}

module.exports = { testScoringLogic, getScoredLeadsCount24h };