// services/inboundEmailService.js
// Inbound email processing service for BCC-to-CRM functionality
// Handles client authentication via email, lead lookup, and note updates
// 
// REFACTORED: Uses existing clientService and airtableClient patterns
// Uses full email body (body-plain) to capture entire thread including lead's replies

require('dotenv').config();
const { createLogger } = require('../utils/contextLogger');
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
 * Parse a Gmail email body with quoted replies
 * Format:
 *   New message at top
 *   
 *   On Thu, 22 Jan 2026 at 22:47, Tania Wilson <email@example.com> wrote:
 *   > Quoted reply from previous message
 *   >
 *   > On Thu, 22 Jan 2026 at 22:46, Guy Wilson <email@example.com> wrote:
 *   >> Earlier message
 * 
 * @param {string} body - The full email body
 * @param {string} senderName - Name of the person who sent this email (from headers)
 * @param {Date} referenceDate - Current date for the new message
 * @returns {Array<{date: string, time: string, sender: string, message: string}>}
 */
function parseGmailThread(body, senderName, referenceDate) {
    const messages = [];
    
    if (!body || !body.trim()) {
        return messages;
    }
    
    // Pattern for Gmail quote headers: "On Day, DD Mon YYYY at HH:MM, Name <email> wrote:"
    const quoteHeaderPattern = /On\s+(?:\w+,?\s+)?(\d{1,2}\s+\w+\s+\d{4})\s+at\s+(\d{1,2}:\d{2}),?\s+([^<]+?)\s*<[^>]+>\s*wrote:/gi;
    
    // Split by quote headers
    const parts = body.split(quoteHeaderPattern);
    
    logger.info(`parseGmailThread: Split into ${parts.length} parts`);
    
    // First part is the new message (before any "On ... wrote:")
    if (parts[0]) {
        let newMessage = parts[0].trim();
        
        // Remove signature
        newMessage = removeSignature(newMessage);
        
        if (newMessage) {
            const timestamp = formatTimestamp(referenceDate);
            messages.push({
                date: timestamp.date,
                time: timestamp.time,
                sender: senderName,
                message: newMessage.replace(/\n+/g, ' ').trim()
            });
            logger.info(`New message from ${senderName}: "${newMessage.substring(0, 50)}..."`);
        }
    }
    
    // Remaining parts come in groups of 4: [content, date, time, sender, content, date, time, sender, ...]
    // Actually the regex captures 3 groups: date, time, sender
    // So parts are: [newMsg, date1, time1, sender1, quotedContent1, date2, time2, sender2, quotedContent2, ...]
    for (let i = 1; i < parts.length; i += 4) {
        const dateStr = parts[i];
        const timeStr = parts[i + 1];
        const quotedSender = parts[i + 2];
        const quotedContent = parts[i + 3];
        
        if (!quotedContent) continue;
        
        // Remove quote prefixes (> or >>)
        let cleanContent = quotedContent
            .split('\n')
            .map(line => line.replace(/^>+\s?/, '').trim())
            .filter(line => line && !line.match(/^On\s+.+wrote:$/i)) // Remove nested quote headers
            .join(' ')
            .trim();
        
        // Remove signature from quoted content
        cleanContent = removeSignature(cleanContent);
        
        if (!cleanContent) continue;
        
        // Parse the date
        const parsedDate = parseQuotedDate(dateStr, timeStr);
        
        messages.push({
            date: parsedDate.date,
            time: parsedDate.time,
            sender: quotedSender.trim(),
            message: cleanContent
        });
        
        logger.info(`Quoted message from ${quotedSender}: "${cleanContent.substring(0, 50)}..."`);
    }
    
    return messages;
}

/**
 * Remove email signature from message
 */
function removeSignature(text) {
    if (!text) return '';
    
    // Remove signature block (-- followed by newline)
    let result = text.replace(/\n--\s*\n[\s\S]*$/, '').trim();
    
    // Remove common sign-offs at end
    result = result.replace(/\n(?:Kind Regards|Best Regards|Regards|Cheers|Thanks|Best|Warmly|Sincerely),?\s*[\s\S]*$/i, '').trim();
    
    return result;
}

/**
 * Parse date from Gmail quote header
 * @param {string} dateStr - e.g., "22 Jan 2026"
 * @param {string} timeStr - e.g., "22:47"
 * @returns {{date: string, time: string}}
 */
function parseQuotedDate(dateStr, timeStr) {
    try {
        // Parse "22 Jan 2026"
        const dateMatch = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
        if (dateMatch) {
            const day = dateMatch[1].padStart(2, '0');
            const monthName = dateMatch[2];
            const year = dateMatch[3].slice(-2);
            
            const months = {
                'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
                'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
                'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
            };
            const month = months[monthName.toLowerCase().substring(0, 3)] || '01';
            
            // Parse time "22:47" to "10:47 PM"
            let time = '12:00 PM';
            if (timeStr) {
                const timeParts = timeStr.match(/(\d{1,2}):(\d{2})/);
                if (timeParts) {
                    let hours = parseInt(timeParts[1], 10);
                    const minutes = timeParts[2];
                    const ampm = hours >= 12 ? 'PM' : 'AM';
                    hours = hours % 12 || 12;
                    time = `${hours}:${minutes} ${ampm}`;
                }
            }
            
            return { date: `${day}-${month}-${year}`, time };
        }
    } catch (e) {
        logger.warn(`Failed to parse date "${dateStr}" "${timeStr}": ${e.message}`);
    }
    
    return { date: formatTimestamp(new Date()).date, time: '12:00 PM' };
}

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
    const emailContent = bodyPlain || bodyHtml || '';
    
    logger.info(`Parsing email thread for ${senderName}`);
    logger.info(`Email content length: ${emailContent.length} chars`);
    logger.info(`Email preview: ${emailContent.substring(0, 200).replace(/\n/g, '\\n')}`);
    
    // Parse the Gmail thread format (handles quoted replies with "On ... wrote:" markers)
    const messages = parseGmailThread(emailContent, senderName, referenceDate);
    
    logger.info(`Parsed ${messages.length} messages from email thread`);

    // Build content: subject once at top, then all parsed messages (newest first)
    let processedContent = '';
    if (subject) {
        processedContent = `Subject: ${subject}\n`;
    }
    
    // Format messages
    if (messages.length > 0) {
        const formattedLines = messages.map(msg => 
            `${msg.date} ${msg.time} - ${msg.sender} - ${msg.message}`
        );
        processedContent += formattedLines.join('\n');
    } else {
        // Fallback: format the new message with sender name from headers
        const timestamp = formatTimestamp(referenceDate);
        const cleanContent = removeSignature(emailContent).replace(/\n+/g, ' ').substring(0, 500);
        processedContent += `${timestamp.date} ${timestamp.time} - ${senderName} - ${cleanContent}`;
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

    logger.info(`Updated lead ${lead.id} with ${messages.length} messages, follow-up: ${followUpDateStr}`);

    return {
        id: lead.id,
        updatedFields: Object.keys(updates),
        followUpDate: followUpDateStr,
        messageCount: messages.length
    };
}

/**
 * Format a date as DD-MM-YY and HH:MM AM/PM
 * @returns {{date: string, time: string}}
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
    
    return {
        date: `${day}-${month}-${year}`,
        time: `${hours}:${minutes} ${ampm}`
    };
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
        // Silently ignore - recipient is not a lead in the system
        // This is expected behavior when client auto-BCCs all emails
        // No error notification needed - just skip it
        logger.info(`Recipient ${leadEmail} is not a lead for client ${client.clientId} - ignoring (not an error)`);
        return {
            success: false,
            error: 'lead_not_found',
            message: `Recipient not a lead - ignored`,
            ignored: true  // Flag to indicate this was intentionally skipped
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
