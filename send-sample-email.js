// send-sample-email.js
// Send a sample "no leads scored today" email to test the system

require('dotenv').config();
const clientService = require('./services/clientService');
const emailNotificationService = require('./services/emailNotificationService');

async function sendSampleEmail() {
    console.log("📧 Sending Sample Email Test");
    console.log("============================\n");

    try {
        // Get first client with email address
        const activeClients = await clientService.getAllActiveClients();
        const clientsWithEmail = activeClients.filter(c => c.clientEmailAddress);
        
        if (clientsWithEmail.length === 0) {
            console.log("❌ No clients with email addresses found");
            return;
        }

        const testClient = clientsWithEmail[0]; // Dean Hobin
        
        console.log(`📋 Sending test email to: ${testClient.clientName}`);
        console.log(`📧 Email address: ${testClient.clientEmailAddress}`);
        console.log(`🔄 BCC: guyralphwilson@gmail.com`);
        console.log(`📝 Template: no-leads-scored-today`);
        console.log("");

        // Send the email
        const result = await emailNotificationService.sendTemplatedEmail(
            testClient,
            'no-leads-scored-today'
        );

        if (result.success) {
            console.log("✅ Sample email sent successfully!");
            console.log(`📨 Mailgun ID: ${result.mailgunId}`);
            console.log(`📧 Sent to: ${result.recipient}`);
            console.log(`📧 BCC to: ${result.bcc}`);
            console.log(`📝 Subject: ${result.subject}`);
            console.log("");
            console.log("🎉 Check your email inboxes!");
            console.log(`   - ${testClient.clientEmailAddress} (main recipient)`);
            console.log(`   - guyralphwilson@gmail.com (BCC copy)`);
        } else {
            console.log("❌ Email failed to send:");
            console.log(`Error: ${result.error}`);
        }

    } catch (error) {
        console.error("❌ Test failed:", error);
    }
}

// Run the test
if (require.main === module) {
    sendSampleEmail()
        .then(() => {
            console.log("\n✅ Sample email test completed");
            process.exit(0);
        })
        .catch((error) => {
            console.error("\n❌ Sample email test failed:", error);
            process.exit(1);
        });
}

module.exports = { sendSampleEmail };