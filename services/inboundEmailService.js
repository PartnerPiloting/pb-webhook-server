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

// Import email-reply-parser for robust email thread parsing
const EmailReplyParser = require('email-reply-parser');

/**
 * Parse email thread using email-reply-parser library
 * Falls back to our custom parser if the library fails
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
    
    logger.info(`parseGmailThread: Processing ${body.length} chars`);
    
    try {
        // Use email-reply-parser library for robust parsing
        const email = new EmailReplyParser().read(body);
        const fragments = email.getFragments();
        
        logger.info(`email-reply-parser found ${fragments.length} fragments`);
        
        // Pattern to extract sender and date from quote headers
        // "On Thu, 22 Jan 2026 at 22:47, Tania Wilson <email> wrote:"
        const quoteHeaderPattern = /On\s+(?:\w+,?\s+)?(\d{1,2}\s+\w+\s+\d{4})\s+at\s+(\d{1,2}:\d{2}),?\s+([^<]+?)\s*<[^>]+>\s*wrote:/i;
        
        let lastQuotedSender = null;
        let lastQuotedDate = null;
        
        for (const fragment of fragments) {
            const content = fragment.getContent().trim();
            if (!content) continue;
            
            // Check if this fragment contains a quote header
            const headerMatch = content.match(quoteHeaderPattern);
            
            if (fragment.isQuoted()) {
                // This is quoted content - find who said it
                if (headerMatch) {
                    lastQuotedSender = headerMatch[3].trim();
                    lastQuotedDate = parseQuotedDate(headerMatch[1], headerMatch[2]);
                }
                
                // Extract the actual message (remove the "On ... wrote:" header)
                let messageText = content;
                if (headerMatch) {
                    messageText = content.substring(content.indexOf('wrote:') + 6).trim();
                }
                
                // Clean up quote prefixes and signatures
                messageText = messageText
                    .split('\n')
                    .map(line => line.replace(/^>+\s?/, '').trim())
                    .filter(line => line && !line.match(/^On\s+.+wrote:\s*$/i))
                    .join(' ')
                    .trim();
                
                messageText = removeSignature(messageText);
                
                if (messageText && lastQuotedSender) {
                    messages.push({
                        date: lastQuotedDate?.date || formatTimestamp(referenceDate).date,
                        time: lastQuotedDate?.time || '12:00 PM',
                        sender: lastQuotedSender,
                        message: messageText
                    });
                    logger.info(`Quoted message from ${lastQuotedSender}: "${messageText.substring(0, 50)}..."`);
                }
            } else if (!fragment.isSignature() && !fragment.isHidden()) {
                // This is new/visible content from the sender
                let messageText = content;
                
                // If there's a quote header in the visible part, split at it
                if (headerMatch) {
                    messageText = content.substring(0, content.search(quoteHeaderPattern)).trim();
                    lastQuotedSender = headerMatch[3].trim();
                    lastQuotedDate = parseQuotedDate(headerMatch[1], headerMatch[2]);
                }
                
                messageText = removeSignature(messageText);
                
                if (messageText) {
                    const timestamp = formatTimestamp(referenceDate);
                    messages.push({
                        date: timestamp.date,
                        time: timestamp.time,
                        sender: senderName,
                        message: messageText.replace(/\n+/g, ' ').trim()
                    });
                    logger.info(`New message from ${senderName}: "${messageText.substring(0, 50)}..."`);
                }
            }
        }
        
        if (messages.length > 0) {
            logger.info(`email-reply-parser: Extracted ${messages.length} messages successfully`);
            return messages;
        }
        
        // Fall through to fallback if no messages extracted
        logger.warn('email-reply-parser returned no messages, using fallback');
        
    } catch (err) {
        logger.warn(`email-reply-parser failed: ${err.message}, using fallback parser`);
    }
    
    // Fallback: Use our custom state machine parser
    return parseGmailThreadFallback(body, senderName, referenceDate);
}

/**
 * Fallback parser using state machine approach
 * Used when email-reply-parser fails or returns no results
 */
function parseGmailThreadFallback(body, senderName, referenceDate) {
    const messages = [];
    
    logger.info('Using fallback parser');
    
    // Pattern for Gmail quote headers (with optional > prefixes):
    const quoteHeaderPattern = /^>*\s*On\s+(?:\w+,?\s+)?(\d{1,2}\s+\w+\s+\d{4})\s+at\s+(\d{1,2}:\d{2}),?\s+([^<]+?)\s*<[^>]+>\s*wrote:\s*$/i;
    
    const lines = body.split('\n');
    
    let currentMessage = [];
    let currentSender = senderName;
    let currentDate = formatTimestamp(referenceDate);
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        const headerMatch = trimmedLine.match(quoteHeaderPattern);
        
        if (headerMatch) {
            if (currentMessage.length > 0) {
                let msgText = removeSignature(currentMessage.join(' ').trim());
                if (msgText) {
                    messages.push({
                        date: currentDate.date,
                        time: currentDate.time,
                        sender: currentSender,
                        message: msgText
                    });
                }
            }
            
            currentSender = headerMatch[3].trim();
            currentDate = parseQuotedDate(headerMatch[1], headerMatch[2]);
            currentMessage = [];
            continue;
        }
        
        if (currentMessage.length === 0 && !trimmedLine) continue;
        
        const cleanLine = line.replace(/^>+\s?/, '').trim();
        
        if (cleanLine === '--' || cleanLine === '-- ') {
            if (currentMessage.length > 0) {
                let msgText = removeSignature(currentMessage.join(' ').trim());
                if (msgText) {
                    messages.push({
                        date: currentDate.date,
                        time: currentDate.time,
                        sender: currentSender,
                        message: msgText
                    });
                }
                currentMessage = [];
            }
            continue;
        }
        
        if (cleanLine) currentMessage.push(cleanLine);
    }
    
    if (currentMessage.length > 0) {
        let msgText = removeSignature(currentMessage.join(' ').trim());
        if (msgText) {
            messages.push({
                date: currentDate.date,
                time: currentDate.time,
                sender: currentSender,
                message: msgText
            });
        }
    }
    
    logger.info(`Fallback parser: Extracted ${messages.length} messages`);
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
 * Extract all CC email addresses from Mailgun data
 * @param {Object} mailgunData - Raw Mailgun webhook data
 * @returns {Array<{email: string, name: string}>} Array of CC recipients
 */
function extractCcRecipients(mailgunData) {
    const ccHeader = mailgunData.Cc || 
                     mailgunData.cc || 
                     (mailgunData.message && mailgunData.message.headers && mailgunData.message.headers.cc) ||
                     '';
    
    if (!ccHeader) {
        return [];
    }
    
    logger.info(`Extracting CC recipients from: "${ccHeader}"`);
    
    const recipients = [];
    
    // CC can be comma-separated: "Name1 <email1>, Name2 <email2>"
    // Split by comma, but be careful of commas inside names
    const parts = ccHeader.split(/,(?=(?:[^<]*<[^>]*>)*[^<]*$)/);
    
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        
        // Extract email and name
        const emailMatch = trimmed.match(/<([^>]+)>/);
        const nameMatch = trimmed.match(/^([^<]+)</);
        
        if (emailMatch) {
            recipients.push({
                email: emailMatch[1].toLowerCase().trim(),
                name: nameMatch ? nameMatch[1].trim() : emailMatch[1].split('@')[0]
            });
        } else if (trimmed.includes('@')) {
            // Plain email without name
            recipients.push({
                email: trimmed.toLowerCase().trim(),
                name: trimmed.split('@')[0]
            });
        }
    }
    
    logger.info(`Extracted ${recipients.length} CC recipients: ${recipients.map(r => r.email).join(', ')}`);
    return recipients;
}

/**
 * Detect if email is a forwarded message
 * @param {string} body - Email body
 * @returns {boolean}
 */
function isForwardedEmail(body) {
    if (!body) return false;
    
    // Common forward patterns
    const forwardPatterns = [
        /---------- Forwarded message ---------/i,
        /-------- Original Message --------/i,
        /Begin forwarded message:/i,
        /-----Original Message-----/i,
        /Forwarded message from/i
    ];
    
    return forwardPatterns.some(pattern => pattern.test(body));
}

/**
 * Extract original recipients from a forwarded email
 * Parses the forwarded headers to find who the email was originally sent to
 * @param {string} body - Email body containing forwarded content
 * @returns {{to: Array<{email: string, name: string}>, cc: Array<{email: string, name: string}>, from: string|null, subject: string|null}}
 */
function extractForwardedRecipients(body) {
    const result = { to: [], cc: [], from: null, subject: null };
    
    if (!body) return result;
    
    // Find the forwarded header block
    // Gmail: "---------- Forwarded message ---------"
    // Then: "From: Name <email>"
    //       "Date: ..."
    //       "Subject: ..."
    //       "To: Name <email>, Name2 <email2>"
    //       "Cc: ..."
    
    // Extract To: line from forwarded headers
    // Pattern handles multi-line To headers
    const toPatterns = [
        /\nTo:\s*([^\n]+(?:\n\s+[^\n]+)*)/i,  // Standard "To:" header
        /\nTo:\s*(.+?)(?=\n(?:Cc|Subject|Date|From):|\n\n)/is  // Until next header
    ];
    
    for (const pattern of toPatterns) {
        const toMatch = body.match(pattern);
        if (toMatch) {
            const toLine = toMatch[1].replace(/\n\s+/g, ' ').trim();
            logger.info(`Forwarded email - found To line: "${toLine}"`);
            
            // Parse all email addresses from the To line
            const emailMatches = toLine.matchAll(/<([^>]+)>/g);
            for (const match of emailMatches) {
                const email = match[1].toLowerCase().trim();
                // Try to extract name before the <email>
                const beforeEmail = toLine.substring(0, toLine.indexOf(match[0])).split(',').pop()?.trim() || '';
                result.to.push({
                    email,
                    name: beforeEmail || email.split('@')[0]
                });
            }
            
            // Also try plain emails without angle brackets
            if (result.to.length === 0) {
                const plainEmails = toLine.match(/[^\s<,]+@[^\s>,]+/g);
                if (plainEmails) {
                    for (const email of plainEmails) {
                        result.to.push({
                            email: email.toLowerCase().trim(),
                            name: email.split('@')[0]
                        });
                    }
                }
            }
            break;
        }
    }
    
    // Extract Cc: line similarly
    const ccMatch = body.match(/\nCc:\s*([^\n]+(?:\n\s+[^\n]+)*)/i);
    if (ccMatch) {
        const ccLine = ccMatch[1].replace(/\n\s+/g, ' ').trim();
        logger.info(`Forwarded email - found Cc line: "${ccLine}"`);
        
        const emailMatches = ccLine.matchAll(/<([^>]+)>/g);
        for (const match of emailMatches) {
            result.cc.push({
                email: match[1].toLowerCase().trim(),
                name: ''
            });
        }
    }
    
    // Extract original From for attribution
    const fromMatch = body.match(/\nFrom:\s*([^\n<]+)<([^>]+)>/i) || 
                      body.match(/\nFrom:\s*([^\n]+)/i);
    if (fromMatch) {
        result.from = fromMatch[2] || fromMatch[1]?.trim();
        logger.info(`Forwarded email - original sender: ${result.from}`);
    }
    
    // Extract subject
    const subjectMatch = body.match(/\nSubject:\s*([^\n]+)/i);
    if (subjectMatch) {
        result.subject = subjectMatch[1].trim();
    }
    
    logger.info(`Forwarded email parsing: found ${result.to.length} To recipients, ${result.cc.length} Cc recipients`);
    return result;
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
    let leadEmail = extractRecipientEmail(mailgunData);

    logger.info(`Processing inbound email from ${senderEmail} to ${leadEmail || 'unknown'}`);
    logger.info(`BCC recipient: ${recipient}`);
    logger.info(`Subject: ${subject}`);
    logger.info(`Raw To field: ${To || mailgunData.to || '(not found at top level)'}`);

    // Check if this is a forwarded email (To is our tracking address)
    // This happens when user forgot to BCC and forwards the sent email to track it
    const isForward = isForwardedEmail(bodyPlain);
    const toIsTrackingAddress = leadEmail && recipient && 
        (leadEmail.toLowerCase() === recipient.toLowerCase() || 
         leadEmail.includes('track@') || 
         leadEmail.includes('mail.australiansidehustles'));
    
    let forwardedRecipients = null;
    if (isForward && toIsTrackingAddress) {
        logger.info('Detected forwarded email sent to tracking address - extracting original recipients');
        forwardedRecipients = extractForwardedRecipients(bodyPlain);
        
        if (forwardedRecipients.to.length > 0) {
            logger.info(`Forwarded email: original To recipients: ${forwardedRecipients.to.map(r => r.email).join(', ')}`);
            // Use the first original recipient as the primary lead
            leadEmail = forwardedRecipients.to[0].email;
        } else {
            logger.warn('Forwarded email detected but could not extract original recipients');
        }
    }

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

    // Step 2: Collect all potential leads (To + CC)
    const potentialLeads = [];
    
    // If this was a forwarded email, use the extracted recipients
    if (forwardedRecipients && forwardedRecipients.to.length > 0) {
        for (const fwdTo of forwardedRecipients.to) {
            potentialLeads.push({ email: fwdTo.email, name: fwdTo.name, source: 'forwarded-to' });
        }
        for (const fwdCc of forwardedRecipients.cc) {
            if (!potentialLeads.some(p => p.email === fwdCc.email)) {
                potentialLeads.push({ email: fwdCc.email, name: fwdCc.name, source: 'forwarded-cc' });
            }
        }
        logger.info(`Using ${potentialLeads.length} recipients from forwarded email`);
    } else {
        // Normal BCC flow - add primary recipient (To)
        if (leadEmail) {
            potentialLeads.push({ email: leadEmail, source: 'to' });
        }
        
        // Add CC recipients
        const ccRecipients = extractCcRecipients(mailgunData);
        for (const cc of ccRecipients) {
            // Skip if it's our tracking address or already in the list
            if (cc.email === recipient?.toLowerCase() || cc.email === leadEmail) {
                continue;
            }
            potentialLeads.push({ email: cc.email, name: cc.name, source: 'cc' });
        }
    }
    
    logger.info(`Processing ${potentialLeads.length} potential leads (To + CC)`);
    
    
    if (potentialLeads.length === 0) {
        logger.info('No potential leads found in To or CC - ignoring');
        return {
            success: false,
            error: 'no_recipients',
            message: 'No recipients found to process',
            ignored: true
        };
    }

    // Step 3: Process each potential lead
    const senderName = extractSenderName(from || sender);
    const results = {
        success: true,
        clientId: client.clientId,
        clientName: client.clientName,
        leadsUpdated: [],
        leadsNotFound: [],
        errors: []
    };
    
    for (const potential of potentialLeads) {
        const lead = await findLeadByEmail(client, potential.email);
        
        if (!lead) {
            // Silently skip - not a lead in the system
            logger.info(`${potential.source.toUpperCase()} recipient ${potential.email} is not a lead - skipping`);
            results.leadsNotFound.push({ email: potential.email, source: potential.source });
            continue;
        }
        
        // Update this lead with email content
        try {
            const result = await updateLeadWithEmail(client, lead, {
                subject,
                bodyPlain,
                bodyHtml,
                timestamp,
                senderName
            });
            
            results.leadsUpdated.push({
                leadId: lead.id,
                leadName: `${lead.firstName} ${lead.lastName}`.trim(),
                leadEmail: potential.email,
                source: potential.source,
                followUpDate: result.followUpDate,
                messageCount: result.messageCount
            });
            
            logger.info(`Updated ${potential.source.toUpperCase()} lead ${lead.id} (${potential.email})`);
            
        } catch (updateError) {
            logger.error(`Failed to update lead ${potential.email}: ${updateError.message}`);
            results.errors.push({
                email: potential.email,
                source: potential.source,
                error: updateError.message
            });
        }
    }
    
    // Determine overall success
    results.success = results.leadsUpdated.length > 0;
    results.totalProcessed = potentialLeads.length;
    results.totalUpdated = results.leadsUpdated.length;
    
    if (results.leadsUpdated.length === 0 && results.leadsNotFound.length === potentialLeads.length) {
        // None of the recipients were leads - this is fine, just ignore
        logger.info('No recipients were leads in the system - ignoring email');
        results.ignored = true;
    }
    
    return results;
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
    extractRecipientEmail,
    extractCcRecipients,
    isForwardedEmail,
    extractForwardedRecipients
};
