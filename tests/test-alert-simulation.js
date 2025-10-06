// test-alert-simulation.js
// Simulate the daily client alerts system with mock data to test email logic

require('dotenv').config();
const clientService = require('./services/clientService');
const emailNotificationService = require('./services/emailNotificationService');

async function simulateClientAlerts() {
    console.log("🎭 Simulating Daily Client Alerts System");
    console.log("========================================\n");

    try {
        // Get real client data
        const activeClients = await clientService.getAllActiveClients();
        const scoringClients = activeClients.filter(client => client.serviceLevel >= 2);
        
        console.log(`📋 Found ${scoringClients.length} active clients with scoring service\n`);

        // Simulate different scenarios
        const scenarios = [
            {
                name: "Normal Day - All Clients Have Scoring",
                mockData: scoringClients.map(c => ({ ...c, scoredLeads24h: Math.floor(Math.random() * 50) + 10 }))
            },
            {
                name: "Problem Day - Some Clients Have No Scoring", 
                mockData: scoringClients.map((c, index) => ({ 
                    ...c, 
                    scoredLeads24h: index === 0 ? 0 : Math.floor(Math.random() * 30) + 5 
                }))
            },
            {
                name: "Major Issue - No Clients Have Scoring",
                mockData: scoringClients.map(c => ({ ...c, scoredLeads24h: 0 }))
            }
        ];

        for (const scenario of scenarios) {
            console.log(`🎭 SCENARIO: ${scenario.name}`);
            console.log("=" + "=".repeat(scenario.name.length + 10));

            const results = {
                totalClients: scenario.mockData.length,
                clientsWithScoring: 0,
                clientsWithoutScoring: 0,
                emailsToSend: 0,
                clientsWithoutEmail: 0
            };

            scenario.mockData.forEach(client => {
                const hasEmail = client.clientEmailAddress && client.clientEmailAddress.trim() !== '';
                const needsAlert = client.scoredLeads24h === 0;

                if (client.scoredLeads24h > 0) {
                    results.clientsWithScoring++;
                    console.log(`✅ ${client.clientName}: ${client.scoredLeads24h} leads - OK`);
                } else {
                    results.clientsWithoutScoring++;
                    if (hasEmail) {
                        results.emailsToSend++;
                        console.log(`🚨 ${client.clientName}: 0 leads - WOULD SEND EMAIL to ${client.clientEmailAddress}`);
                    } else {
                        results.clientsWithoutEmail++;
                        console.log(`⚠️  ${client.clientName}: 0 leads - No email address configured`);
                    }
                }
            });

            console.log(`\n📊 Summary:`);
            console.log(`   Clients with activity: ${results.clientsWithScoring}`);
            console.log(`   Clients needing alerts: ${results.clientsWithoutScoring}`);
            console.log(`   Emails that would be sent: ${results.emailsToSend}`);
            console.log(`   Clients without email: ${results.clientsWithoutEmail}\n`);
        }

        // Test actually sending one alert email (to yourself)
        console.log("🧪 TESTING ACTUAL EMAIL SEND");
        console.log("=============================");
        
        const testClient = {
            clientId: 'TEST-CLIENT',
            clientName: 'Test Client',
            clientFirstName: 'Test',
            clientEmailAddress: 'guyralphwilson@gmail.com' // Send to yourself for testing
        };

        console.log(`📧 Sending test alert email to yourself (${testClient.clientEmailAddress})`);
        console.log("This simulates what a client would receive when they have 0 scored leads.\n");

        const emailResult = await emailNotificationService.sendTemplatedEmail(
            testClient,
            'no-leads-scored-today'
        );

        if (emailResult.success) {
            console.log("✅ Test alert email sent successfully!");
            console.log(`📨 Mailgun ID: ${emailResult.mailgunId}`);
            console.log(`📧 Sent to: ${emailResult.recipient}`);
            console.log(`📧 BCC to: ${emailResult.bcc}`);
            console.log(`📝 Subject: ${emailResult.subject}`);
            console.log("\n🎉 Check your email - this is what clients would receive!");
        } else {
            console.log("❌ Test email failed:");
            console.log(`Error: ${emailResult.error}`);
        }

    } catch (error) {
        console.error("❌ Simulation failed:", error);
        throw error;
    }
}

// Run the simulation
if (require.main === module) {
    simulateClientAlerts()
        .then(() => {
            console.log("\n✅ Alert simulation completed");
            process.exit(0);
        })
        .catch((error) => {
            console.error("\n❌ Alert simulation failed:", error);
            process.exit(1);
        });
}

module.exports = { simulateClientAlerts };