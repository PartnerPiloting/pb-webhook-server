// services/inboundEmailService.js
// Inbound email processing service for BCC-to-CRM functionality
// Handles client authentication via email, lead lookup, and note updates

require('dotenv').config();
const Airtable = require('airtable');
const { createLogger } = require('../utils/contextLogger');
const { parseConversation } = require('../utils/messageParser');
const { updateSection } = require('../utils/notesSectionManager');
const { CLIENT_FIELDS } = require('../constants/airtableUnifiedConstants');

// Create module-level logger
const logger = createLogger({ 
    runId: 'INBOUND-EMAIL', 
    clientId: 'SYSTEM', 
    operation: 'inbound-email-service' 
});

// Cache for clients (same pattern as clientService)
let clientsCache = null;
let clientsCacheTimestamp = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if cache is still valid
 */
function isCacheValid() {
    if (!clientsCache || !clientsCacheTimestamp) return false;
    return (Date.now() - clientsCacheTimestamp) < CACHE_DURATION_MS;
}

/**
 * Get all clients from Master Clients base
 * @returns {Promise<Array>} Array of client records with email info
 */
async function getAllClientsWithEmails() {
    if (isCacheValid()) {
        return clientsCache;
    }

    if (!process.env.MASTER_CLIENTS_BASE_ID || !process.env.AIRTABLE_API_KEY) {
        throw new Error("Missing MASTER_CLIENTS_BASE_ID or AIRTABLE_API_KEY");
    }

    Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);

    const clients = [];
    await masterBase('Clients').select({
        filterByFormula: `{Status} = "Active"`
    }).eachPage((records, fetchNextPage) => {
        records.forEach(record => {
            const clientId = record.get(CLIENT_FIELDS.CLIENT_ID);
            const primaryEmail = record.get(CLIENT_FIELDS.CLIENT_EMAIL_ADDRESS) || '';
            const alternativeEmails = record.get('Alternative Email Addresses') || '';
            const airtableBaseId = record.get(CLIENT_FIELDS.AIRTABLE_BASE_ID);
            const clientName = record.get(CLIENT_FIELDS.CLIENT_NAME) || '';
            const clientFirstName = record.get(CLIENT_FIELDS.CLIENT_FIRST_NAME) || clientName.split(' ')[0] || 'Client';
            const timezone = record.get(CLIENT_FIELDS.TIMEZONE) || 'Australia/Sydney';

            // Parse alternative emails (semicolon-separated)
            const altEmailList = alternativeEmails
                .split(';')
                .map(e => e.trim().toLowerCase())
                .filter(e => e.length > 0);

            // Combine primary + alternatives into one list
            const allEmails = [primaryEmail.toLowerCase().trim(), ...altEmailList].filter(e => e);

            clients.push({
                id: record.id,
                clientId,
                clientName,
                clientFirstName,
                airtableBaseId,
                primaryEmail: primaryEmail.toLowerCase().trim(),
                alternativeEmails: altEmailList,
                allEmails,
                timezone
            });
        });
        fetchNextPage();
    });

    // Update cache
    clientsCache = clients;
    clientsCacheTimestamp = Date.now();

    logger.info(`Loaded ${clients.length} clients with email info`);
    return clients;
}

/**
 * Find client by sender email address
 * @param {string} senderEmail - The FROM email address
 * @returns {Promise<Object|null>} Client object or null if not found
 */
async function findClientByEmail(senderEmail) {
    const normalizedEmail = senderEmail.toLowerCase().trim();
    const clients = await getAllClientsWithEmails();

    for (const client of clients) {
        if (client.allEmails.includes(normalizedEmail)) {
            logger.info(`Found client ${client.clientId} for email ${normalizedEmail}`);
            return client;
        }
    }

    logger.warn(`No client found for email: ${normalizedEmail}`);
    return null;
}

/**
 * Find lead by email in client's Airtable base
 * @param {Object} client - Client object with airtableBaseId
 * @param {string} leadEmail - Email to search for
 * @returns {Promise<Object|null>} Lead record or null
 */
async function findLeadByEmail(client, leadEmail) {
    if (!client.airtableBaseId) {
        throw new Error(`Client ${client.clientId} has no Airtable base configured`);
    }

    const normalizedEmail = leadEmail.toLowerCase().trim();
    
    Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
    const clientBase = Airtable.base(client.airtableBaseId);

    try {
        // Search for lead by email
        const records = await clientBase('Leads').select({
            filterByFormula: `LOWER({Email}) = "${normalizedEmail}"`,
            maxRecords: 1
        }).firstPage();

        if (records && records.length > 0) {
            const lead = records[0];
            logger.info(`Found lead ${lead.id} with email ${normalizedEmail} for client ${client.clientId}`);
            return {
                id: lead.id,
                firstName: lead.fields['First Name'] || '',
                lastName: lead.fields['Last Name'] || '',
                email: lead.fields['Email'] || '',
                notes: lead.fields['Notes'] || '',
                followUpDate: lead.fields['Follow-Up Date'] || null
            };
        }

        logger.warn(`No lead found with email ${normalizedEmail} for client ${client.clientId}`);
        return null;

    } catch (error) {
        logger.error(`Error searching for lead: ${error.message}`);
        throw error;
    }
}

/**
 * Update lead with email content
 * @param {Object} client - Client object
 * @param {Object} lead - Lead object (with id, notes)
 * @param {Object} emailData - Parsed email data
 * @returns {Promise<Object>} Updated lead
 */
async function updateLeadWithEmail(client, lead, emailData) {
    const { subject, bodyPlain, bodyHtml } = emailData;

    Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
    const clientBase = Airtable.base(client.airtableBaseId);

    // Use client's timezone for reference date
    let referenceDate = new Date();
    if (client.timezone) {
        try {
            const clientDateStr = new Date().toLocaleString('en-US', { timeZone: client.timezone });
            referenceDate = new Date(clientDateStr);
        } catch (e) {
            logger.warn(`Invalid timezone ${client.timezone}, using server time`);
        }
    }

    // Parse the email content using existing parser
    const emailContent = bodyPlain || bodyHtml || '';
    const parsedResult = await parseConversation(emailContent, {
        clientFirstName: client.clientFirstName,
        referenceDate,
        newestFirst: true,
        forceFormat: 'email'
    });

    // Prepare content with subject line
    let processedContent = '';
    if (subject) {
        processedContent = `Subject: ${subject}\n\n`;
    }
    processedContent += parsedResult.formatted || emailContent;

    // Update the Email section in notes (append mode to preserve history)
    const noteUpdateResult = updateSection(lead.notes || '', 'email', processedContent, { 
        append: true, 
        replace: false 
    });

    // Calculate follow-up date (+14 days)
    const followUpDate = new Date(referenceDate);
    followUpDate.setDate(followUpDate.getDate() + 14);
    const followUpDateStr = followUpDate.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Update the lead
    const updates = {
        'Notes': noteUpdateResult.notes,
        'Follow-Up Date': followUpDateStr
    };

    const updatedRecords = await clientBase('Leads').update([
        { id: lead.id, fields: updates }
    ]);

    if (!updatedRecords || updatedRecords.length === 0) {
        throw new Error('Failed to update lead record');
    }

    logger.info(`Updated lead ${lead.id} with email content, follow-up: ${followUpDateStr}`);

    return {
        id: lead.id,
        updatedFields: Object.keys(updates),
        followUpDate: followUpDateStr,
        messageCount: parsedResult.messageCount || 1,
        usedAI: parsedResult.usedAI
    };
}

/**
 * Send error notification email to sender
 * @param {string} toEmail - Recipient email
 * @param {string} errorType - 'client_not_found' or 'lead_not_found'
 * @param {Object} context - Additional context (leadEmail, etc.)
 */
async function sendErrorNotification(toEmail, errorType, context = {}) {
    const https = require('https');
    const querystring = require('querystring');

    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
        logger.error('Cannot send error notification - Mailgun not configured');
        return { sent: false, error: 'Mailgun not configured' };
    }

    const subjects = {
        client_not_found: '❌ Email Not Recognized - ASH Portal',
        lead_not_found: '❌ Lead Not Found - ASH Portal'
    };

    const bodies = {
        client_not_found: `Hi,

We received your email but couldn't match your email address (${toEmail}) to an active client account.

If you believe this is an error, please contact your coach or reply to this email.

Best,
ASH Portal Team`,

        lead_not_found: `Hi,

We received your email but couldn't find a lead with the email address: ${context.leadEmail || 'unknown'}

Please check:
1. The lead exists in your dashboard
2. The lead has an email address saved
3. You're emailing the correct person

If you need help, contact your coach.

Best,
ASH Portal Team`
    };

    const emailData = {
        from: `ASH Portal <noreply@${process.env.MAILGUN_DOMAIN}>`,
        to: toEmail,
        subject: subjects[errorType] || 'Email Processing Error',
        text: bodies[errorType] || 'An error occurred processing your email.'
    };

    return new Promise((resolve) => {
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
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    logger.info(`Error notification sent to ${toEmail} (${errorType})`);
                    resolve({ sent: true, mailgunId: responseData });
                } else {
                    logger.error(`Failed to send notification: ${res.statusCode} ${responseData}`);
                    resolve({ sent: false, error: responseData });
                }
            });
        });

        req.on('error', (error) => {
            logger.error(`Error sending notification: ${error.message}`);
            resolve({ sent: false, error: error.message });
        });

        req.write(data);
        req.end();
    });
}

/**
 * Extract recipient email from various email headers
 * @param {Object} mailgunData - Raw Mailgun webhook data
 * @returns {string|null} The lead's email address
 */
function extractRecipientEmail(mailgunData) {
    // Mailgun provides the "To" header which contains the lead's email
    // The BCC (our tracking address) comes in as "recipient"
    // Note: Mailgun sends To in different places depending on content-type
    
    // Try multiple locations where Mailgun might put the To header
    const toHeader = mailgunData.To || 
                     mailgunData.to || 
                     (mailgunData.message && mailgunData.message.headers && mailgunData.message.headers.to) ||
                     '';
    
    logger.info(`Extracting recipient from To header: "${toHeader}"`);
    
    // Parse email from "Name <email@example.com>" format
    const emailMatch = toHeader.match(/<([^>]+)>/) || toHeader.match(/([^\s<,]+@[^\s>,]+)/);
    
    if (emailMatch) {
        logger.info(`Extracted email: ${emailMatch[1]}`);
        return emailMatch[1].toLowerCase().trim();
    }

    // If To is just a plain email
    if (toHeader.includes('@')) {
        return toHeader.toLowerCase().trim();
    }

    logger.warn(`Could not extract email from To header: "${toHeader}"`);
    return null;
}

/**
 * Main processing function for inbound emails
 * @param {Object} mailgunData - Parsed Mailgun webhook payload
 * @returns {Promise<Object>} Processing result
 */
async function processInboundEmail(mailgunData) {
    // Log all top-level keys to understand the payload structure
    logger.info(`Mailgun payload keys: ${Object.keys(mailgunData).join(', ')}`);
    
    const {
        sender,
        from,
        subject,
        'body-plain': bodyPlain,
        'body-html': bodyHtml,
        'stripped-text': strippedText,
        recipient, // The BCC address that received this
        To,
        timestamp
    } = mailgunData;

    const senderEmail = sender || from || '';
    const leadEmail = extractRecipientEmail(mailgunData);

    logger.info(`Processing inbound email from ${senderEmail} to ${leadEmail || 'unknown'}`);
    logger.info(`BCC recipient: ${recipient}`);
    logger.info(`Subject: ${subject}`);
    logger.info(`Raw To field: ${To || mailgunData.to || '(not found at top level)'}`);

    // Step 1: Find client by sender email
    const client = await findClientByEmail(senderEmail);
    
    if (!client) {
        await sendErrorNotification(senderEmail, 'client_not_found', {});
        return {
            success: false,
            error: 'client_not_found',
            message: `No client found for sender email: ${senderEmail}`
        };
    }

    // Step 2: Find lead by recipient email
    if (!leadEmail) {
        await sendErrorNotification(senderEmail, 'lead_not_found', { leadEmail: 'could not extract' });
        return {
            success: false,
            error: 'lead_email_missing',
            message: 'Could not extract recipient email from message'
        };
    }

    const lead = await findLeadByEmail(client, leadEmail);
    
    if (!lead) {
        await sendErrorNotification(senderEmail, 'lead_not_found', { leadEmail });
        return {
            success: false,
            error: 'lead_not_found',
            message: `No lead found with email ${leadEmail} for client ${client.clientId}`
        };
    }

    // Step 3: Update lead with email content
    try {
        const result = await updateLeadWithEmail(client, lead, {
            subject,
            bodyPlain: strippedText || bodyPlain,
            bodyHtml,
            timestamp
        });

        return {
            success: true,
            clientId: client.clientId,
            clientName: client.clientName,
            leadId: lead.id,
            leadName: `${lead.firstName} ${lead.lastName}`.trim(),
            leadEmail,
            followUpDate: result.followUpDate,
            messageCount: result.messageCount,
            usedAI: result.usedAI
        };

    } catch (updateError) {
        logger.error(`Failed to update lead: ${updateError.message}`);
        return {
            success: false,
            error: 'update_failed',
            message: updateError.message
        };
    }
}

/**
 * Validate Mailgun webhook signature
 * @param {string} timestamp - Mailgun timestamp
 * @param {string} token - Mailgun token
 * @param {string} signature - Mailgun signature
 * @returns {boolean} True if valid
 */
function validateMailgunSignature(timestamp, token, signature) {
    if (!process.env.MAILGUN_WEBHOOK_SIGNING_KEY) {
        logger.warn('MAILGUN_WEBHOOK_SIGNING_KEY not set - skipping signature validation');
        return true; // Allow in development
    }

    const crypto = require('crypto');
    const encodedToken = crypto
        .createHmac('sha256', process.env.MAILGUN_WEBHOOK_SIGNING_KEY)
        .update(timestamp.concat(token))
        .digest('hex');

    return encodedToken === signature;
}

/**
 * Clear the clients cache (useful for testing)
 */
function clearCache() {
    clientsCache = null;
    clientsCacheTimestamp = null;
    logger.info('Inbound email service cache cleared');
}

module.exports = {
    processInboundEmail,
    findClientByEmail,
    findLeadByEmail,
    updateLeadWithEmail,
    sendErrorNotification,
    validateMailgunSignature,
    extractRecipientEmail,
    clearCache
};
