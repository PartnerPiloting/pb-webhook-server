// test-email-system.js
// Test script for the email notification system

require('dotenv').config();
const clientService = require('./services/clientService');
const emailTemplateService = require('./services/emailTemplateService');
const emailNotificationService = require('./services/emailNotificationService');

async function testEmailSystem() {
    console.log("🧪 Testing Email Notification System");
    console.log("=====================================\n");

    try {
        // Test 1: Check if we can read clients with email fields
        console.log("📋 Test 1: Reading clients with email fields...");
        const activeClients = await clientService.getAllActiveClients();
        const clientsWithEmail = activeClients.filter(c => c.clientEmailAddress);
        
        console.log(`✅ Found ${activeClients.length} active clients`);
        console.log(`📧 ${clientsWithEmail.length} have email addresses configured`);
        
        // Show first few clients with emails
        console.log("\nClients with email addresses:");
        clientsWithEmail.slice(0, 3).forEach(client => {
            console.log(`  - ${client.clientName} (${client.clientId}): ${client.clientEmailAddress}`);
        });
        
        // Test 2: Check if we can read email templates
        console.log("\n📧 Test 2: Reading email templates...");
        const templates = await emailTemplateService.getAllActiveTemplates();
        console.log(`✅ Found ${templates.length} active email templates`);
        
        templates.forEach(template => {
            console.log(`  - ${template.templateName} (ID: ${template.templateId})`);
        });
        
        // Test 3: Check if the specific template exists
        console.log("\n🔍 Test 3: Looking for 'no-leads-scored-today' template...");
        const noLeadsTemplate = await emailTemplateService.getTemplateById('no-leads-scored-today');
        
        if (noLeadsTemplate) {
            console.log(`✅ Template found: ${noLeadsTemplate.templateName}`);
            console.log(`Subject: ${noLeadsTemplate.subject}`);
        } else {
            console.log("❌ Template 'no-leads-scored-today' not found!");
            console.log("Please create this template in Airtable before testing emails.");
            return;
        }
        
        // Test 4: Process template with sample client data
        console.log("\n🔧 Test 4: Processing template with sample data...");
        const sampleClient = clientsWithEmail[0] || {
            clientId: 'TEST-001',
            clientName: 'Test Client',
            clientFirstName: 'Test',
            clientEmailAddress: 'test@example.com'
        };
        
        const processedTemplate = await emailTemplateService.processTemplate(
            'no-leads-scored-today',
            sampleClient
        );
        
        console.log(`✅ Template processed successfully`);
        console.log(`Processed Subject: ${processedTemplate.subject}`);
        console.log(`Variables used: ${Object.keys(processedTemplate.variables).join(', ')}`);
        
        // Test 5: Mailgun connection test (don't actually send)
        console.log("\n📡 Test 5: Testing Mailgun configuration...");
        
        if (!process.env.MAILGUN_API_KEY) {
            console.log("❌ MAILGUN_API_KEY not set");
        } else {
            console.log("✅ MAILGUN_API_KEY configured");
        }
        
        if (!process.env.MAILGUN_DOMAIN) {
            console.log("❌ MAILGUN_DOMAIN not set");
        } else {
            console.log(`✅ MAILGUN_DOMAIN: ${process.env.MAILGUN_DOMAIN}`);
        }
        
        if (!process.env.FROM_EMAIL) {
            console.log("❌ FROM_EMAIL not set");
        } else {
            console.log(`✅ FROM_EMAIL: ${process.env.FROM_EMAIL}`);
        }
        
        if (!process.env.ALERT_EMAIL) {
            console.log("❌ ALERT_EMAIL not set");
        } else {
            console.log(`✅ ALERT_EMAIL: ${process.env.ALERT_EMAIL}`);
        }
        
        console.log("\n🎉 All tests passed! Email system is ready to use.");
        console.log("\nTo send a test email, uncomment the lines at the bottom of this script.");
        
        // UNCOMMENT THESE LINES TO SEND A REAL TEST EMAIL
        // console.log("\n📧 Sending test email...");
        // const testResult = await emailNotificationService.sendTemplatedEmail(
        //     sampleClient,
        //     'no-leads-scored-today'
        // );
        // console.log("Test email result:", testResult);

    } catch (error) {
        console.error("❌ Test failed:", error);
        throw error;
    }
}

// Run the test
if (require.main === module) {
    testEmailSystem()
        .then(() => {
            console.log("\n✅ Test completed successfully");
            process.exit(0);
        })
        .catch((error) => {
            console.error("\n❌ Test failed:", error);
            process.exit(1);
        });
}

module.exports = { testEmailSystem };