// services/emailNotificationService.js
// Client email notification service using Mailgun and templates
// Handles sending templated emails to clients with admin BCC

require('dotenv').config();
const { createLogger } = require('../utils/contextLogger');

// Create module-level logger for email notification service
const logger = createLogger({ 
    runId: 'SYSTEM', 
    clientId: 'SYSTEM', 
    operation: 'email-notification-service' 
});
const emailTemplateService = require('./emailTemplateService');
const https = require('https');
const querystring = require('querystring');

/**
 * Send email via Mailgun REST API using native Node.js https
 * @param {Object} emailData - Email data object
 * @returns {Promise<Object>} Response from Mailgun
 */
async function sendMailgunEmail(emailData) {
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
        throw new Error("Mailgun not configured - missing API key or domain");
    }

    return new Promise((resolve, reject) => {
        const data = querystring.stringify(emailData);
        const auth = Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64');
        
        const options = {
            hostname: 'api.mailgun.net',
            port: 443,
            path: `/v3/${process.env.MAILGUN_DOMAIN}/messages`,
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsedData = JSON.parse(responseData);
                        resolve(parsedData);
                    } catch (error) {
                        resolve({ id: 'unknown', message: responseData });
    logCriticalError(error, { operation: 'unknown', isSearch: true }).catch(() => {});
                    }
                } else {
                    reject(new Error(`Mailgun API error: ${res.statusCode} - ${responseData}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(data);
        req.end();
    });
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

        logger.info(`Preparing templated email for client ${clientData.clientId} using template ${templateId}`);

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

        logger.info(`Sending email to ${clientData.clientEmailAddress} with BCC to ${adminEmail}`);
        logger.info(`Subject: ${processedTemplate.subject}`);

        // Send the email via Mailgun REST API
        const result = await sendMailgunEmail(emailData);

        logger.info(`✅ Email sent successfully to ${clientData.clientEmailAddress}`);
        logger.info(`Mailgun ID: ${result.id}`);
        logger.info(`Message: ${result.message}`);

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
        logger.error(`❌ Error sending templated email to ${clientData.clientEmailAddress || 'unknown'}:`, error);
    logCriticalError(error, { operation: 'unknown' }).catch(() => {});
        
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
    logger.info(`Starting bulk email send to ${clientDataList.length} clients using template ${templateId}`);
    
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
                logger.info(`✅ ${results.successful}/${results.total}: Sent to ${clientData.clientEmailAddress}`);
            } else {
                results.failed++;
                results.errors.push({
                    clientId: clientData.clientId,
                    email: clientData.clientEmailAddress,
                    error: result.error
                });
                logger.info(`❌ ${results.failed}/${results.total}: Failed for ${clientData.clientEmailAddress}: ${result.error}`);
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
            logger.error(`Unexpected error for ${clientData.clientEmailAddress}:`, { error: error.message, stack: error.stack });
        }
    }

    logger.info(`📊 Bulk email complete: ${results.successful} successful, ${results.failed} failed`);
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

        logger.info(`✅ Alert email sent: ${subject}`);
        return { success: true, mailgunId: result.id, message: result.message };

    } catch (error) {
        logger.error(`❌ Error sending alert email:`, error);
        return { success: false, error: error.message };
    await logCriticalError(error, { operation: 'unknown' }).catch(() => {});
    }
}

module.exports = {
    sendTemplatedEmail,
    sendBulkTemplatedEmails,
    sendAlertEmail,
    sendMailgunEmail
};