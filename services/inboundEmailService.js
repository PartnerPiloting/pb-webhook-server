// services/inboundEmailService.js
// Inbound email processing service for BCC-to-CRM functionality
// Handles client authentication via email, lead lookup, and note updates
// 
// REFACTORED: Uses existing clientService and airtableClient patterns
// Uses full email body (body-plain) to capture entire thread including lead's replies

require('dotenv').config();
const { createLogger } = require('../utils/contextLogger');
const { parseConversation } = require('../utils/messageParser');
const { updateSection } = require('../utils/notesSectionManager');
const clientService = require('./clientService');
const { createBaseInstance } = require('../config/airtableClient');

// Create module-level logger
const logger = createLogger({ 
    runId: 'INBOUND-EMAIL', 
    clientId: 'SYSTEM', 
    operation: 'inbound-email-service' 
});

/**
 * Find client by sender email address
 * Uses existing clientService.getAllClients() to avoid code duplication
 * @param {string} senderEmail - The FROM email address
 * @returns {Promise<Object|null>} Client object or null if not found
 */
async function findClientByEmail(senderEmail) {
    const normalizedEmail = senderEmail.toLowerCase().trim();
    
    // Use existing clientService - it already fetches all client data including emails
    const allClients = await clientService.getAllClients();
    
    for (const client of allClients) {
        // Check primary email
        const primaryEmail = (client.clientEmailAddress || '').toLowerCase().trim();
        if (primaryEmail === normalizedEmail) {
            logger.info(`Found client ${client.clientId} via primary email ${normalizedEmail}`);
            return client;
        }
        
        // Check alternative emails if the field exists
        // Note: clientService may need to expose this field - for now check rawRecord
        if (client.rawRecord) {
            const altEmails = client.rawRecord.get('Alternative Email Addresses') || '';
            const altEmailList = altEmails.split(';').map(e => e.trim().toLowerCase()).filter(e => e);
            if (altEmailList.includes(normalizedEmail)) {
                logger.info(`Found client ${client.clientId} via alternative email ${normalizedEmail}`);
                return client;
            }
        }
    }

    logger.warn(`No client found for email: ${normalizedEmail}`);
    return null;
}

/**
 * Find lead by email in client's Airtable base
 * Uses createBaseInstance from airtableClient to get client's base
 * @param {Object} client - Client object with airtableBaseId
 * @param {string} leadEmail - Email to search for
 * @returns {Promise<Object|null>} Lead record or null
 */
async function findLeadByEmail(client, leadEmail) {
    if (!client.airtableBaseId) {
        throw new Error(`Client ${client.clientId} has no Airtable base configured`);
    }

    const normalizedEmail = leadEmail.toLowerCase().trim();
    
    // Use existing airtableClient pattern
    const clientBase = createBaseInstance(client.airtableBaseId);

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
 * Parses the FULL email thread (including quoted replies from the lead)
 * Format: DD-MM-YY HH:MM AM/PM - SenderName - message
 * @param {Object} client - Client object
 * @param {Object} lead - Lead object (with id, notes)
 * @param {Object} emailData - Email data including full body
 * @returns {Promise<Object>} Updated lead
 */
async function updateLeadWithEmail(client, lead, emailData) {
    const { subject, bodyPlain, bodyHtml, senderName } = emailData;

    // Use existing airtableClient pattern
    const clientBase = createBaseInstance(client.airtableBaseId);

    // Use client's timezone for reference date
    let referenceDate = new Date();
    const clientTimezone = client.timezone;
    if (clientTimezone) {
        try {
            const clientDateStr = new Date().toLocaleString('en-US', { timeZone: clientTimezone });
            referenceDate = new Date(clientDateStr);
        } catch (e) {
            logger.warn(`Invalid timezone ${clientTimezone}, using server time`);
        }
    }

    // Use the FULL email body (body-plain) which includes quoted replies from the lead
    // This is critical - we need the whole thread, not just the new message
    const emailContent = bodyPlain || bodyHtml || '';
    
    // Get client's first name for parsing (identifies "me" messages)
    const clientFirstName = client.clientFirstName || client.clientName?.split(' ')[0] || 'Me';
    
    logger.info(`Parsing email thread with clientFirstName: ${clientFirstName}`);
    logger.info(`Email content length: ${emailContent.length} chars`);
    
    // Parse the full email thread using the existing parser
    // This will extract all messages including the lead's quoted replies
    const parsedResult = await parseConversation(emailContent, {
        clientFirstName,
        referenceDate,
        newestFirst: true,
        forceFormat: 'email'  // Force email parsing mode
    });

    // Build content: subject once at top, then all parsed messages
    let processedContent = '';
    if (subject) {
        processedContent = `Subject: ${subject}\n`;
    }
    
    // Use parsed result or fall back to raw content
    if (parsedResult.formatted && parsedResult.formatted.trim()) {
        processedContent += parsedResult.formatted;
    } else {
        // Fallback: format the new message with sender name from headers
        const timestamp = formatTimestamp(referenceDate);
        processedContent += `${timestamp} - ${senderName} - ${emailContent.replace(/\n+/g, ' ').substring(0, 500)}`;
    }

    // Update the Email section in notes - REPLACE mode
    // We replace because the new email contains the full thread history
    const noteUpdateResult = updateSection(lead.notes || '', 'email', processedContent, { 
        append: false, 
        replace: true 
    });

    // Calculate follow-up date (+14 days)
    const followUpDate = new Date(referenceDate);
    followUpDate.setDate(followUpDate.getDate() + 14);
    const followUpDateStr = followUpDate.toISOString().split('T')[0];

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

    logger.info(`Updated lead ${lead.id} with ${parsedResult.messageCount || 1} messages, follow-up: ${followUpDateStr}`);

    return {
        id: lead.id,
        updatedFields: Object.keys(updates),
        followUpDate: followUpDateStr,
        messageCount: parsedResult.messageCount || 1,
        usedAI: parsedResult.usedAI
    };
}

/**
 * Format a date as DD-MM-YY HH:MM AM/PM
 */
function formatTimestamp(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    
    let hours = date.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${day}-${month}-${year} ${hours}:${minutes} ${ampm}`;
}

/**
 * Send error notification email to sender
        'Follow-Up Date': followUpDateStr
    };

    const updatedRecords = await clientBase('Leads').update([
        { id: lead.id, fields: updates }
    ]);

    if (!updatedRecords || updatedRecords.length === 0) {
        throw new Error('Failed to update lead record');
    }

    logger.info(`Updated lead ${lead.id} with email from ${senderName}, follow-up: ${followUpDateStr}`);

    return {
        id: lead.id,
        updatedFields: Object.keys(updates),
        followUpDate: followUpDateStr,
        senderName
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
 * Extract sender name from email From header
 * @param {string} fromHeader - e.g. "Guy Wilson <guyralphwilson@gmail.com>"
 * @returns {string} The sender's name, or email if no name found
 */
function extractSenderName(fromHeader) {
    if (!fromHeader) return 'Unknown';
    
    // Pattern: "Name <email@example.com>"
    const nameMatch = fromHeader.match(/^([^<]+)</);
    if (nameMatch) {
        return nameMatch[1].trim();
    }
    
    // If just an email, extract the part before @
    const emailMatch = fromHeader.match(/([^@]+)@/);
    if (emailMatch) {
        return emailMatch[1].trim();
    }
    
    return fromHeader.trim();
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
        // Extract sender name from From header for proper attribution
        const senderName = extractSenderName(from || sender);
        
        // Use bodyPlain (full email with quoted thread) NOT strippedText
        // This captures the entire conversation including lead's replies
        const result = await updateLeadWithEmail(client, lead, {
            subject,
            bodyPlain,  // Full email body with quoted replies from lead
            bodyHtml,
            timestamp,
            senderName
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

module.exports = {
    processInboundEmail,
    findClientByEmail,
    findLeadByEmail,
    updateLeadWithEmail,
    sendErrorNotification,
    validateMailgunSignature,
    extractRecipientEmail
};
