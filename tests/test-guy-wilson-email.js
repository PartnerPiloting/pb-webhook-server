// test-guy-wilson-email.js
// Send test email only to Guy Wilson

require('dotenv').config();
const clientService = require('./services/clientService');
const emailNotificationService = require('./services/emailNotificationService');

async function sendTestEmailToGuy() {
    console.log("📧 Sending Test Email to Guy Wilson Only");
    console.log("========================================\n");

    try {
        // Get Guy Wilson's client data
        const activeClients = await clientService.getAllActiveClients();
        const guyWilson = activeClients.find(c => c.clientId === 'Guy-Wilson');
        
        if (!guyWilson) {
            console.log("❌ Guy Wilson client not found");
            return;
        }

        if (!guyWilson.clientEmailAddress) {
            console.log("❌ Guy Wilson doesn't have an email address configured");
            return;
        }

        console.log(`📋 Found client: ${guyWilson.clientName}`);
        console.log(`📧 Email address: ${guyWilson.clientEmailAddress}`);
        console.log(`🔄 BCC: guyralphwilson@gmail.com`);
        console.log(`📝 Template: no-leads-scored-today`);
        console.log("");

        // Send the test email
        const result = await emailNotificationService.sendTemplatedEmail(
            guyWilson,
            'no-leads-scored-today'
        );

        if (result.success) {
            console.log("✅ Test email sent successfully to Guy Wilson!");
            console.log(`📨 Mailgun ID: ${result.mailgunId}`);
            console.log(`📧 Sent to: ${result.recipient}`);
            console.log(`📧 BCC to: ${result.bcc}`);
            console.log(`📝 Subject: ${result.subject}`);
            console.log("");
            console.log("🎉 Check both inboxes:");
            console.log(`   - ${guyWilson.clientEmailAddress} (main recipient)`);
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
    sendTestEmailToGuy()
        .then(() => {
            console.log("\n✅ Guy Wilson test email completed");
            process.exit(0);
        })
        .catch((error) => {
            console.error("\n❌ Guy Wilson test email failed:", error);
            process.exit(1);
        });
}

module.exports = { sendTestEmailToGuy };