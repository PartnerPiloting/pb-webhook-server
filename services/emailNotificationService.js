// services/emailNotificationService.js
// Client email notification service using Mailgun and templates
// Handles sending templated emails to clients with admin BCC

require('dotenv').config();
const emailTemplateService = require('./emailTemplateService');

// We need fetch for Mailgun API calls
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

/**
 * Send email via Mailgun REST API (same approach as alertAdmin)
 * @param {Object} emailData - Email data object
 * @returns {Promise<Object>} Response from Mailgun
 */
async function sendMailgunEmail(emailData) {
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
        throw new Error("Mailgun not configured - missing API key or domain");
    }

    const mgUrl = `https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`;
    
    const response = await fetch(mgUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(emailData)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mailgun API error: ${response.status} - ${errorText}`);
    }

    return await response.json();
}

/**
 * Send a templated email to a client with admin BCC
 * @param {Object} clientData - Client data including email and name
 * @param {string} templateId - Email template ID to use
 * @param {Object} options - Additional email options
 * @returns {Promise<Object>} Email sending result
 */
async function sendTemplatedEmail(clientData, templateId, options = {}) {
    try {
        // Validate required client data
        if (!clientData) {
            throw new Error("Client data is required");
        }
        
        if (!clientData.clientEmailAddress) {
            throw new Error(`Client email address is required for ${clientData.clientId || 'unknown client'}`);
        }
        
        if (!templateId) {
            throw new Error("Template ID is required");
        }

        console.log(`Preparing templated email for client ${clientData.clientId} using template ${templateId}`);

        // Process the email template with client data
        const processedTemplate = await emailTemplateService.processTemplate(templateId, clientData);
        
        // Prepare email data for Mailgun
        const fromEmail = process.env.FROM_EMAIL || `noreply@${process.env.MAILGUN_DOMAIN}`;
        const adminEmail = process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com';
        
        const emailData = {
            from: fromEmail,
            to: clientData.clientEmailAddress,
            bcc: adminEmail, // BCC admin on all client emails
            subject: processedTemplate.subject,
            html: processedTemplate.bodyHTML,
            // Add custom headers for tracking
            'h:X-Template-ID': templateId,
            'h:X-Client-ID': clientData.clientId || 'unknown'
        };

        console.log(`Sending email to ${clientData.clientEmailAddress} with BCC to ${adminEmail}`);
        console.log(`Subject: ${processedTemplate.subject}`);

        // Send the email via Mailgun REST API
        const result = await sendMailgunEmail(emailData);

        console.log(`✅ Email sent successfully to ${clientData.clientEmailAddress}`);
        console.log(`Mailgun ID: ${result.id}`);
        console.log(`Message: ${result.message}`);

        return {
            success: true,
            mailgunId: result.id,
            message: result.message,
            recipient: clientData.clientEmailAddress,
            bcc: adminEmail,
            templateId: templateId,
            subject: processedTemplate.subject,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error(`❌ Error sending templated email to ${clientData.clientEmailAddress || 'unknown'}:`, error);
        
        return {
            success: false,
            error: error.message,
            recipient: clientData.clientEmailAddress || 'unknown',
            templateId: templateId,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Send bulk templated emails to multiple clients
 * @param {Array} clientDataList - Array of client data objects
 * @param {string} templateId - Email template ID to use
 * @param {Object} options - Additional email options
 * @returns {Promise<Object>} Bulk sending results summary
 */
async function sendBulkTemplatedEmails(clientDataList, templateId, options = {}) {
    console.log(`Starting bulk email send to ${clientDataList.length} clients using template ${templateId}`);
    
    const results = {
        total: clientDataList.length,
        successful: 0,
        failed: 0,
        results: [],
        errors: []
    };

    // Process each client email
    for (const clientData of clientDataList) {
        try {
            const result = await sendTemplatedEmail(clientData, templateId, options);
            results.results.push(result);
            
            if (result.success) {
                results.successful++;
                console.log(`✅ ${results.successful}/${results.total}: Sent to ${clientData.clientEmailAddress}`);
            } else {
                results.failed++;
                results.errors.push({
                    clientId: clientData.clientId,
                    email: clientData.clientEmailAddress,
                    error: result.error
                });
                console.log(`❌ ${results.failed}/${results.total}: Failed for ${clientData.clientEmailAddress}: ${result.error}`);
            }
            
            // Add delay between emails to avoid rate limiting
            if (results.successful + results.failed < results.total) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
            }
            
        } catch (error) {
            results.failed++;
            results.errors.push({
                clientId: clientData.clientId,
                email: clientData.clientEmailAddress,
                error: error.message
            });
            console.error(`❌ Unexpected error for ${clientData.clientEmailAddress}:`, error);
        }
    }

    console.log(`📊 Bulk email complete: ${results.successful} successful, ${results.failed} failed`);
    return results;
}

/**
 * Send a simple alert email using the existing alertAdmin function pattern
 * @param {string} subject - Email subject
 * @param {string} htmlBody - HTML email body
 * @param {string} recipient - Recipient email (defaults to admin)
 * @returns {Promise<Object>} Email sending result
 */
async function sendAlertEmail(subject, htmlBody, recipient = null) {
    try {
        const adminEmail = process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com';
        const fromEmail = process.env.FROM_EMAIL || `noreply@${process.env.MAILGUN_DOMAIN}`;
        
        const emailData = {
            from: fromEmail,
            to: recipient || adminEmail,
            subject: subject,
            html: htmlBody
        };

        const result = await sendMailgunEmail(emailData);

        console.log(`✅ Alert email sent: ${subject}`);
        return { success: true, mailgunId: result.id, message: result.message };

    } catch (error) {
        console.error(`❌ Error sending alert email:`, error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendTemplatedEmail,
    sendBulkTemplatedEmails,
    sendAlertEmail,
    sendMailgunEmail
};