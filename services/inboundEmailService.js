// services/inboundEmailService.js
// Inbound email processing service for BCC-to-CRM functionality
// Handles client authentication via email, lead lookup, and note updates
// 
// REFACTORED: Uses existing clientService and airtableClient patterns
// Uses full email body (body-plain) to capture entire thread including lead's replies

require('dotenv').config();
const { createLogger } = require('../utils/contextLogger');
const { updateSection, getSection } = require('../utils/notesSectionManager');
const { logNotesChange } = require('../utils/notesAuditLogger');
const clientService = require('./clientService');
const { createBaseInstance } = require('../config/airtableClient');

// Create module-level logger
const logger = createLogger({ 
    runId: 'INBOUND-EMAIL', 
    clientId: 'SYSTEM', 
    operation: 'inbound-email-service' 
});

// Per-lead lock to serialize concurrent updates (prevents race overwrites)
const leadUpdateLocks = new Map();
async function withLeadLock(leadId, fn) {
    const existing = leadUpdateLocks.get(leadId) || Promise.resolve();
    const ourPromise = existing.then(() => fn()).finally(() => leadUpdateLocks.delete(leadId));
    leadUpdateLocks.set(leadId, ourPromise);
    return ourPromise;
}

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

    // Re-fetch lead to get latest notes (avoids overwriting when multiple emails or other updates)
    let currentNotes = lead.notes || '';
    try {
        const freshRecord = await clientBase('Leads').find(lead.id);
        currentNotes = freshRecord.get('Notes') || freshRecord.fields?.['Notes'] || currentNotes;
    } catch (fetchErr) {
        logger.warn(`Could not re-fetch lead ${lead.id} for latest notes, using cached: ${fetchErr.message}`);
    }
    const existingEmailSection = getSection(currentNotes, 'email');
    logger.info(`[EMAIL-DEBUG] lead=${lead.id} notesLen=${(currentNotes || '').length} hasEmailHeader=${(currentNotes || '').includes('=== EMAIL CORRESPONDENCE ===')} existingEmailLen=${existingEmailSection.length}`);

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

    // Update the Email section in notes - APPEND mode
    // Each new email thread is appended; multiple threads are kept as separate blocks
    const noteUpdateResult = updateSection(currentNotes, 'email', processedContent, { 
        append: true, 
        replace: false 
    });
    if (noteUpdateResult.skippedDuplicate) {
        logger.info(`Skipped duplicate email for lead ${lead.id} (${lead.email}) - subject matched`);
        logger.info(`[EMAIL-DEBUG] result: SKIPPED - no update needed`);
        // CRITICAL: Don't update the lead at all when skipping duplicate
        // This prevents any risk of data loss from parse/rebuild cycle
        return {
            id: lead.id,
            updatedFields: [],
            followUpDate: null,
            messageCount: 0,
            skippedDuplicate: true
        };
    }
    logger.info(`[EMAIL-DEBUG] result: lineCount old=${noteUpdateResult.lineCount?.old} new=${noteUpdateResult.lineCount?.new} ${noteUpdateResult.lineCount?.new > noteUpdateResult.lineCount?.old ? 'APPENDED' : noteUpdateResult.lineCount?.new < noteUpdateResult.lineCount?.old ? 'DECREASED' : 'UNCHANGED'}`);

    // Calculate follow-up date (+14 days)
    const followUpDate = new Date(referenceDate);
    followUpDate.setDate(followUpDate.getDate() + 14);
    const followUpDateStr = followUpDate.toISOString().split('T')[0];

    // Update the lead
    const updates = {
        'Notes': noteUpdateResult.notes,
        'Follow-Up Date': followUpDateStr
    };

    // AUDIT: Log every Notes modification
    logNotesChange({
        leadId: lead.id,
        leadEmail: lead.email,
        source: 'inbound-email',
        notesBefore: currentNotes,
        notesAfter: noteUpdateResult.notes,
        metadata: { 
            subject: subject,
            messagesCount: messages.length,
            skippedDuplicate: noteUpdateResult.skippedDuplicate || false
        }
    });

    // CRITICAL DEBUG: Log exactly what we're sending to Airtable
    const notesToWrite = noteUpdateResult.notes;
    const hasEmailHeader = notesToWrite.includes('=== EMAIL CORRESPONDENCE ===');
    const emailHeaderPos = notesToWrite.indexOf('=== EMAIL CORRESPONDENCE ===');
    const emailSeparatorCount = (notesToWrite.match(/---EMAIL-THREAD---/g) || []).length;
    logger.info(`[AIRTABLE-WRITE] lead=${lead.id} notesLen=${notesToWrite.length} hasEmailHeader=${hasEmailHeader} emailHeaderPos=${emailHeaderPos} separatorCount=${emailSeparatorCount}`);
    logger.info(`[AIRTABLE-WRITE] first200="${notesToWrite.substring(0, 200).replace(/\n/g, '\\n')}"`);
    logger.info(`[AIRTABLE-WRITE] last200="${notesToWrite.substring(notesToWrite.length - 200).replace(/\n/g, '\\n')}"`);
    // Also log around the email header
    if (emailHeaderPos !== -1) {
        const emailSnippet = notesToWrite.substring(emailHeaderPos, emailHeaderPos + 300);
        logger.info(`[AIRTABLE-WRITE] emailSection="${emailSnippet.replace(/\n/g, '\\n')}"`);
    }

    const updatedRecords = await clientBase('Leads').update([
        { id: lead.id, fields: updates }
    ]);

    if (!updatedRecords || updatedRecords.length === 0) {
        throw new Error('Failed to update lead record');
    }

    // CRITICAL: Verify what Airtable actually returned
    const returnedNotes = updatedRecords[0]?.fields?.['Notes'] || updatedRecords[0]?.get?.('Notes') || '(not in response)';
    const returnedLen = typeof returnedNotes === 'string' ? returnedNotes.length : 0;
    const sentLen = notesToWrite.length;
    if (returnedLen !== sentLen && returnedLen > 0) {
        logger.error(`[AIRTABLE-VERIFY] MISMATCH! sent=${sentLen} returned=${returnedLen} diff=${sentLen - returnedLen}`);
        logger.error(`[AIRTABLE-VERIFY] returned first200="${String(returnedNotes).substring(0, 200).replace(/\n/g, '\\n')}"`);
    } else {
        logger.info(`[AIRTABLE-VERIFY] OK: sent=${sentLen} returned=${returnedLen}`);
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
 * @param {string} errorType - 'client_not_found' | 'lead_not_found' | 'leads_not_found'
 * @param {Object} context - Additional context (leadEmail, leadsNotFound, clientName, etc.)
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
        lead_not_found: '❌ Lead Not Found - ASH Portal',
        leads_not_found: '📧 Email not logged – lead not found'
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
ASH Portal Team`,

        leads_not_found: (() => {
            const leads = context.leadsNotFound || [];
            const recipientLines = leads.map(l =>
                l.name ? `${l.name} (${l.email})` : l.email
            ).join('\n• ');
            const recipientBlock = recipientLines ? `• ${recipientLines}` : '• (unknown)';
            return `Hi${context.clientName ? ` ${context.clientName}` : ''},

We received your BCC email but couldn't match the recipient(s) to any leads in your dashboard.

**Recipient(s):**
${recipientBlock}

This can happen when:
• The lead isn't in your dashboard yet
• The email in their profile doesn't match the one you used
• The name matches more than one lead, so we couldn't be sure which one

**What to do:** Add the lead to your dashboard, or update their email address to match what you're using.

Best,
ASH Portal Team`;
        })()
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
 * Send lead-not-found email with ref code (simple direct path - proven to work)
 * Uses same Mailgun pattern as test-ref-code endpoint.
 * @param {string} toEmail - Recipient email
 * @param {Array} leadsNotFound - [{ email, name, source }]
 * @param {string} clientName - Client first name for greeting
 * @returns {Promise<{sent: boolean, ref?: string}>}
 */
async function sendLeadNotFoundEmail(toEmail, leadsNotFound = [], clientName = '') {
    const https = require('https');
    const querystring = require('querystring');

    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
        logger.error('Cannot send lead-not-found email - Mailgun not configured');
        return { sent: false };
    }

    const ref = Math.random().toString(36).substring(2, 6).toUpperCase();
    const recipientLines = (leadsNotFound || []).map(l =>
        l.name ? `${l.name} (${l.email})` : l.email
    ).join('\n• ');
    const recipientBlock = recipientLines ? `• ${recipientLines}` : '• (unknown)';

    const subject = `📧 Email not logged – lead not found (Ref: ${ref})`;
    const body = `Hi${clientName ? ` ${clientName}` : ''},

We received your BCC email but couldn't match the recipient(s) to any leads in your dashboard.

**Recipient(s):**
${recipientBlock}

This can happen when:
• The lead isn't in your dashboard yet
• The email in their profile doesn't match the one you used
• The name matches more than one lead, so we couldn't be sure which one

**What to do:** Add the lead to your dashboard, or update their email address to match what you're using.

Best,
ASH Portal Team

Ref: ${ref}`;

    logger.info(`LEAD_NOT_FOUND: Sending to ${toEmail}, ref=${ref}, recipients=${(leadsNotFound || []).map(l => l.email).join(', ')}`);

    const emailData = {
        from: `ASH Portal <noreply@${process.env.MAILGUN_DOMAIN}>`,
        to: toEmail,
        subject,
        text: body
    };

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

    return new Promise((resolve) => {
        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    logger.info(`Lead-not-found email sent to ${toEmail} (Ref: ${ref})`);
                    resolve({ sent: true, ref });
                } else {
                    logger.error(`Failed to send lead-not-found email: ${res.statusCode} ${responseData}`);
                    resolve({ sent: false });
                }
            });
        });

        req.on('error', (error) => {
            logger.error(`Error sending lead-not-found email: ${error.message}`);
            resolve({ sent: false });
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
 * Extract display name from email header value (e.g. "Duncan Murcott <email@example.com>")
 * Parses from top of header - the part before the angle brackets
 * @param {string} headerValue - Raw header value like "Duncan Murcott <duncan@example.com>"
 * @returns {string|null} The display name or null if not present
 */
function extractNameFromEmailHeader(headerValue) {
    if (!headerValue || typeof headerValue !== 'string') return null;
    const trimmed = headerValue.trim();
    const match = trimmed.match(/^([^<]+)</);
    if (match) {
        const name = match[1].trim().replace(/^["']|["']$/g, '');
        return name.length >= 2 ? name : null;
    }
    return null;
}

/**
 * Extract recipient name from To header for name-based lead fallback
 * @param {Object} mailgunData - Raw Mailgun webhook data
 * @returns {string|null} The recipient's display name from To header
 */
function extractRecipientName(mailgunData) {
    const toHeader = mailgunData.To || mailgunData.to ||
        (mailgunData.message && mailgunData.message.headers && mailgunData.message.headers.to) ||
        '';
    return extractNameFromEmailHeader(toHeader);
}

/**
 * Extract lead name from email body when headers lack it.
 * Parses thread top-to-bottom for "On ... Name <email> wrote:" patterns.
 * @param {string} bodyPlain - Email body text
 * @param {string} recipientEmail - Email to match (case-insensitive)
 * @returns {string|null} Display name if found in thread, else null
 */
function extractNameFromBodyForRecipient(bodyPlain, recipientEmail) {
    if (!bodyPlain || !recipientEmail) return null;
    const emailLower = recipientEmail.toLowerCase().trim();
    // Match "On ... Name <email> wrote:" or "Name <email> wrote:" - Gmail/Outlook style
    const pattern = /(?:On\s+[^:]+:\s*)?([^<\n]+?)\s*<([^>]+)>\s*wrote:/gi;
    let match;
    while ((match = pattern.exec(bodyPlain)) !== null) {
        const name = match[1].trim().replace(/^["']|["']$/g, '');
        const email = match[2].toLowerCase().trim();
        if (email === emailLower && name.length >= 2) {
            return name;
        }
    }
    return null;
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
 * Extract CC header from Mailgun message-headers (JSON array of [name, value] pairs)
 * @param {string} messageHeaders - Raw message-headers string from Mailgun
 * @returns {string|null} CC header value or null
 */
function extractCcFromMessageHeaders(messageHeaders) {
    if (!messageHeaders || typeof messageHeaders !== 'string') return null;
    try {
        const headers = JSON.parse(messageHeaders);
        if (!Array.isArray(headers)) return null;
        for (const pair of headers) {
            if (Array.isArray(pair) && pair.length >= 2) {
                const name = (pair[0] || '').toString().trim();
                if (name.toLowerCase() === 'cc') {
                    return (pair[1] || '').toString().trim() || null;
                }
            }
        }
    } catch (e) {
        logger.warn(`Failed to parse message-headers for CC: ${e.message}`);
    }
    return null;
}

/**
 * Extract all CC email addresses from Mailgun data
 * Checks top-level Cc/cc, then message-headers JSON
 * @param {Object} mailgunData - Raw Mailgun webhook data
 * @returns {Array<{email: string, name: string}>} Array of CC recipients
 */
function extractCcRecipients(mailgunData) {
    let ccHeader = mailgunData.Cc || 
                  mailgunData.cc || 
                  (mailgunData.message && mailgunData.message.headers && mailgunData.message.headers.cc) ||
                  '';
    if (!ccHeader && mailgunData['message-headers']) {
        ccHeader = extractCcFromMessageHeaders(mailgunData['message-headers']) || '';
    }
    
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

// ============================================
// MEETING NOTE-TAKER PROCESSING
// Handles forwarded emails from Fathom, Otter, Fireflies, etc.
// ============================================

/**
 * Known meeting note-taker services and their sender patterns
 */
const MEETING_NOTETAKER_PATTERNS = {
    fathom: {
        senderDomains: ['fathom.video'],
        subjectPatterns: [/meeting with/i],
        provider: 'Fathom'
    },
    otter: {
        senderDomains: ['otter.ai'],
        subjectPatterns: [/meeting notes/i, /transcript/i],
        provider: 'Otter.ai'
    },
    fireflies: {
        senderDomains: ['fireflies.ai'],
        subjectPatterns: [/meeting/i, /notes/i],
        provider: 'Fireflies'
    },
    tldv: {
        senderDomains: ['tldv.io'],
        subjectPatterns: [/meeting/i],
        provider: 'tl;dv'
    },
    grain: {
        senderDomains: ['grain.com', 'grain.co'],
        subjectPatterns: [/meeting/i, /recording/i],
        provider: 'Grain'
    }
};

/**
 * Detect if email is from a meeting note-taker service
 * @param {string} fromEmail - Sender email or original sender in forwarded email
 * @param {string} subject - Email subject
 * @param {string} bodyPlain - Plain text body
 * @returns {{isMeetingNotetaker: boolean, provider: string|null}}
 */
function detectMeetingNotetaker(fromEmail, subject, bodyPlain) {
    const lowerFrom = (fromEmail || '').toLowerCase();
    const lowerSubject = (subject || '').toLowerCase();
    const lowerBody = (bodyPlain || '').toLowerCase();
    
    // Check against known providers
    for (const [key, config] of Object.entries(MEETING_NOTETAKER_PATTERNS)) {
        // Check sender domain
        const domainMatch = config.senderDomains.some(domain => 
            lowerFrom.includes(domain) || lowerBody.includes(`@${domain}`)
        );
        
        // Check subject patterns
        const subjectMatch = config.subjectPatterns.some(pattern => 
            pattern.test(subject)
        );
        
        if (domainMatch || (subjectMatch && lowerBody.includes(config.provider.toLowerCase()))) {
            logger.info(`Detected meeting note-taker: ${config.provider}`);
            return { isMeetingNotetaker: true, provider: config.provider };
        }
    }
    
    // Generic detection for unknown providers
    // Look for common meeting-related patterns
    const genericPatterns = [
        /meeting with\s+([^<\n]+)/i,
        /call with\s+([^<\n]+)/i,
        /meeting recording/i,
        /meeting summary/i,
        /meeting transcript/i
    ];
    
    const hasGenericPattern = genericPatterns.some(p => p.test(subject) || p.test(bodyPlain));
    const hasMeetingLink = /https?:\/\/[^\s]+\/(call|meeting|record|view)/i.test(bodyPlain);
    
    if (hasGenericPattern && hasMeetingLink) {
        logger.info('Detected generic meeting note-taker email');
        return { isMeetingNotetaker: true, provider: 'Meeting Notes' };
    }
    
    return { isMeetingNotetaker: false, provider: null };
}

/**
 * Parse meeting note-taker email to extract contact name, meeting link, and details
 * @param {string} subject - Email subject
 * @param {string} bodyPlain - Plain text body
 * @param {string} bodyHtml - HTML body (optional, for link extraction)
 * @param {string} provider - Detected provider name
 * @returns {{contactName: string|null, alternateNames: Array, meetingLink: string|null, duration: string|null, date: string|null, company: string|null}}
 */
function htmlToStructuredText(html) {
    if (!html || typeof html !== 'string') return '';
    try {
        return html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')
            .replace(/<(div|p|li|tr|h[1-6])[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    } catch (e) {
        logger.warn(`htmlToStructuredText failed: ${e.message}`);
        return '';
    }
}

function parseMeetingNotetakerEmail(subject, bodyPlain, bodyHtml, provider) {
    const result = {
        contactName: null,
        contactEmail: null,  // Email address if "Meeting with email@domain.com"
        alternateNames: [],  // Additional names to try (e.g., full name vs nickname)
        firstNameOnly: null, // First name when we only have that (e.g., "Michelle" with company domain)
        meetingLink: null,
        duration: null,
        date: null,
        company: null,
        // Rich content from meeting notes
        actionItems: null,       // Action items with assignees
        meetingSummary: null     // Full meeting summary (contains Purpose, Takeaways, Topics, Next Steps)
    };
    
    let body = bodyPlain || '';
    const html = bodyHtml || '';
    // For Fathom: if plain text lacks structure, try HTML conversion (Fathom sends HTML emails)
    if (provider === 'fathom' && html.length > 200) {
        const htmlText = htmlToStructuredText(html);
        const plainHasStructure = /Meeting Purpose|Key Takeaways|Meeting Summary/i.test(body);
        const htmlHasStructure = /Meeting Purpose|Key Takeaways|Meeting Summary/i.test(htmlText);
        if (htmlHasStructure && (!plainHasStructure || htmlText.length > body.length * 1.2)) {
            logger.info('Using HTML-derived text for Fathom (better structure)');
            body = htmlText;
        }
    }
    
    // Email regex for detection
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    // Extract contact info from subject
    // Patterns handle: "Meeting with X", "Recap of your meeting with X", "Call with X"
    // The key is to extract what comes AFTER "meeting with" or "call with"
    const subjectNamePatterns = [
        // "meeting with X" or "your meeting with X" - capture everything after
        /(?:your\s+)?meeting with\s+(.+?)\s*$/i,
        // "call with X"
        /call with\s+(.+?)\s*$/i
    ];
    
    // Clean and normalize subject - remove newlines and extra whitespace
    const cleanSubject = (subject || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    logger.info(`Parsing meeting email, clean subject: "${cleanSubject}"`);
    
    let subjectName = null;
    
    // Simple approach: find "with" and take everything after it
    // Works for: "Meeting with Agnes Caruso", "Recap of your meeting with Agnes Caruso", etc.
    const withIndex = cleanSubject.toLowerCase().lastIndexOf(' with ');
    if (withIndex !== -1) {
        let extracted = cleanSubject.substring(withIndex + 6).trim(); // +6 for " with "
        logger.info(`Found "with" at index ${withIndex}, extracted: "${extracted}"`);
        
        // Clean up the extracted name
        extracted = extracted.replace(/\s*[-–—]\s*\d+\s*mins?.*$/i, ''); // Remove duration suffix
        extracted = extracted.replace(/\s*\([^)]+\)\s*$/, ''); // Remove parenthetical
        extracted = extracted.replace(/[<>]/g, '').trim();
        extracted = extracted.replace(/[.,;:!?]+$/, '').trim();
        // Remove any line breaks that might have snuck in
        extracted = extracted.replace(/[\r\n]+/g, ' ').trim();
        
        logger.info(`After cleanup: "${extracted}"`);
        
        if (extracted.length > 1 && extracted.length < 60 && !extracted.toLowerCase().includes('meeting')) {
            // Check if it's an email address
            if (emailRegex.test(extracted)) {
                result.contactEmail = extracted.toLowerCase();
                const domain = extracted.split('@')[1];
                if (domain && !domain.match(/^(gmail|yahoo|hotmail|outlook|live|icloud|me)\./i)) {
                    result.company = domain;
                }
                logger.info(`Found contact email in subject: ${result.contactEmail}`);
            } else {
                subjectName = extracted;
                
                // Check if this looks like a company name rather than a person
                const looksLikeCompany = (
                    /^[A-Z]{2,}/.test(extracted) ||  // Starts with multiple caps like "TEAMSolutions"
                    /\b(group|inc|ltd|llc|corp|company|co|solutions|tech|consulting)\b/i.test(extracted) ||  // Contains company suffix
                    !/\s/.test(extracted)  // Single word (likely company name)
                );
                
                if (looksLikeCompany) {
                    result.company = extracted;
                    logger.info(`Subject "${extracted}" looks like company name, not setting as contact`);
                } else {
                    result.contactName = extracted;
                    logger.info(`Found contact name in subject: "${result.contactName}"`);
                }
            }
        }
    } else {
        logger.info(`No "with" found in subject: "${cleanSubject}"`);
    }
    
    // Fallback: "Recap for 'X Meeting'" - extract X when subject has generic Fathom format
    // Handles impromptu meetings where Zoom uses "Impromptu Zoom Meeting" but Fathom body has "Akil Merchant Meeting"
    if (!result.contactName && !subjectName) {
        const recapMatch = cleanSubject.match(/Recap for\s+['"](.+?)['"]\s*$/i);
        if (recapMatch) {
            let quoted = recapMatch[1].trim();
            // Strip trailing " Meeting" if present
            if (/^\s*Meeting\s*$/i.test(quoted)) {
                quoted = '';
            } else {
                quoted = quoted.replace(/\s+Meeting\s*$/i, '').trim();
            }
            // Skip generic meeting titles (impromptu, zoom, sync, standup, etc.)
            const genericWords = /\b(impromptu|zoom|google|teams|sync|standup|weekly|daily|review|call|catch.?up|check.?in)\b/i;
            if (quoted && quoted.length >= 3 && !genericWords.test(quoted) && /\s/.test(quoted)) {
                // Looks like "FirstName LastName" (has space, not generic)
                result.contactName = quoted;
                logger.info(`Found contact name from Recap subject: "${result.contactName}"`);
            }
        }
    }
    
    // Look for full name in email body (Fathom shows "Rick Van Driel and Guy meeting" as heading)
    // This catches cases where subject has company name but body has actual person names
    const bodyNamePatterns = [
        // Fathom: "Rick Van Driel and Guy meeting" or "Agnieszka Caruso meeting" as a heading line
        // Must NOT start with Meeting/Call/Recap (those are headings, not names)
        /^(?!(?:Meeting|Call|Recap|Your)\b)([A-Z][a-zà-ÿ]+(?:\s+[A-Za-zà-ÿ-]+)*(?:\s+and\s+[A-Z][a-zà-ÿ]+)?)\s+meeting\s*$/im,
        // Generic: "FirstName LastName" on its own line - but NOT "Meeting With" etc.
        /^(?!(?:Meeting|Call|Recap|Your|View|Watch|Listen)\b)([A-Z][a-zà-ÿ]+\s+[A-Z][a-zà-ÿ]+)\s*$/m
    ];
    
    for (const pattern of bodyNamePatterns) {
        const match = body.match(pattern);
        if (match) {
            let bodyName = match[1].trim();
            logger.info(`Found potential name in body: "${bodyName}"`);
            
            // Check if this contains multiple people: "Rick Van Driel and Guy"
            // Split on " and " to extract individual names
            if (bodyName.toLowerCase().includes(' and ')) {
                const people = bodyName.split(/\s+and\s+/i);
                logger.info(`Detected multiple people in meeting: ${people.join(', ')}`);
                
                // First person is usually the primary contact (the external person)
                // Second person is often the client (e.g., "Guy")
                for (let i = 0; i < people.length; i++) {
                    const personName = people[i].trim();
                    // Skip single names that are likely the client's first name
                    if (personName.split(/\s+/).length >= 2) {
                        // This looks like a full name (FirstName LastName)
                        if (!result.contactName) {
                            result.contactName = personName;
                            logger.info(`Primary contact from body: "${personName}"`);
                        } else if (personName !== result.contactName) {
                            result.alternateNames.push(personName);
                            logger.info(`Alternate contact from body: "${personName}"`);
                        }
                    }
                }
                continue; // Don't process as single name
            }
            
            // Single person name
            // If body name is different from subject name, add as alternate
            if (bodyName && bodyName !== subjectName) {
                // Check if it's a longer/fuller version of the same person
                // e.g., "Agnes Caruso" vs "Agnieszka Caruso"
                const bodyParts = bodyName.split(/\s+/);
                const subjectParts = (subjectName || '').split(/\s+/);
                
                // Same last name but different first name = likely nickname vs full name
                if (subjectParts.length >= 2 && bodyParts.length >= 2 &&
                    bodyParts[bodyParts.length - 1].toLowerCase() === subjectParts[subjectParts.length - 1].toLowerCase()) {
                    // Body name is likely the full name, use it as primary
                    result.contactName = bodyName;
                    if (subjectName) {
                        result.alternateNames.push(subjectName);
                    }
                    logger.info(`Found full name "${bodyName}" in body (subject had "${subjectName}")`);
                } else if (!result.contactName) {
                    result.contactName = bodyName;
                } else {
                    result.alternateNames.push(bodyName);
                }
            }
            break;
        }
    }
    
    // If we still don't have a contact name, search more aggressively in the body
    // This handles "Meeting with TEAMSolutions Group" where subject gives company, body gives person
    if (!result.contactName) {
        logger.info(`No contact name yet, searching body more aggressively`);
        
        // Look for "FirstName LastName and OtherName meeting" pattern
        const aggressivePattern = /^([A-Z][a-z]+(?:\s+(?:Van\s+)?[A-Za-z-]+)+)\s+(?:and\s+[A-Z][a-z]+\s+)?meeting/im;
        const aggressiveMatch = body.match(aggressivePattern);
        if (aggressiveMatch) {
            const foundName = aggressiveMatch[1].trim();
            // Extract just the first person if there's "and"
            const firstPerson = foundName.split(/\s+and\s+/i)[0].trim();
            if (firstPerson.split(/\s+/).length >= 2) {
                result.contactName = firstPerson;
                logger.info(`Found person name in body: "${firstPerson}"`);
            }
        }
    }
    
    // Fallback: "FirstName LastName Meeting" anywhere in body (handles impromptu meetings where
    // Fathom uses calendar title in subject but actual meeting name in body, e.g. "Akil Merchant Meeting")
    if (!result.contactName) {
        const nameMeetingPattern = /\b([A-Z][a-zà-ÿ]+(?:\s+[A-Za-zà-ÿ-]+)+)\s+Meeting\b/g;
        const genericWords = /\b(impromptu|zoom|google|teams|sync|standup|weekly|daily|review|call)\b/i;
        let bestMatch = null;
        for (const match of body.matchAll(nameMeetingPattern)) {
            const name = match[1].trim();
            if (name.split(/\s+/).length >= 2 && !genericWords.test(name) && name.length < 40) {
                bestMatch = name;
                logger.info(`Found "X Meeting" pattern in body: "${name}"`);
                break; // Use first valid match
            }
        }
        if (bestMatch) {
            result.contactName = bestMatch;
        }
    }
    
    // If subject name looks like a domain, extract company
    if (subjectName && subjectName.includes('.') && !subjectName.includes(' ')) {
        result.company = subjectName;
        result.contactName = null; // Clear it, it's not a real name
        
        // When subject is a domain, look for a single first name in the body
        // Fathom format: "Meeting with domain.com\nFirstName\nDate • duration"
        // The first name appears on its own line right after the meeting header
        // For forwarded emails, we need to find the name AFTER the domain mention
        const firstNamePattern = /^([A-Z][a-z]+)\s*$/m;
        const bodyLines = body.split('\n').map(l => l.trim()).filter(l => l);
        
        // Find where "Meeting with domain" appears in the body content (not the forwarded Subject: header)
        // We need to find the ACTUAL Fathom content, not the forwarded email headers
        let startIndex = 0;
        for (let i = 0; i < bodyLines.length; i++) {
            const line = bodyLines[i];
            // Skip forwarded email header lines
            if (line.toLowerCase().startsWith('subject:') ||
                line.toLowerCase().startsWith('from:') ||
                line.toLowerCase().startsWith('to:') ||
                line.toLowerCase().startsWith('date:') ||
                line.toLowerCase().startsWith('cc:') ||
                line.startsWith('---')) {
                continue;
            }
            // Look for the Fathom-style "Meeting with domain" line
            if (line.toLowerCase().includes('meeting with') && line.includes(subjectName)) {
                startIndex = i + 1; // Start looking from the line AFTER this
                logger.info(`Found "Meeting with ${subjectName}" at line ${i}, starting name search from line ${startIndex}`);
                break;
            }
        }
        
        // Look in the next few lines after the domain for a capitalized single name
        for (let i = startIndex; i < Math.min(startIndex + 5, bodyLines.length); i++) {
            const line = bodyLines[i];
            // Skip lines that look like headers, dates, or the domain itself
            if (line.toLowerCase().includes('meeting') || 
                line.toLowerCase().includes('call') ||
                line.includes(subjectName) ||
                /\d{4}/.test(line) ||  // Has a year
                /\d+\s*mins?/.test(line) ||  // Has duration
                line.startsWith('---') ||  // Forward separator
                line.toLowerCase().startsWith('from:') ||
                line.toLowerCase().startsWith('to:') ||
                line.toLowerCase().startsWith('subject:') ||
                line.toLowerCase().startsWith('date:')) {
                continue;
            }
            
            const nameMatch = line.match(firstNamePattern);
            if (nameMatch) {
                result.firstNameOnly = nameMatch[1];
                logger.info(`Found first name only in body: "${result.firstNameOnly}" (company: ${result.company})`);
                break;
            }
        }
    }
    
    // Extract meeting link - be specific to avoid grabbing header/logo links
    // Priority: actual meeting/call links, avoid UTM-tagged homepage links
    const linkPatterns = [
        // Fathom specific: View Meeting link (in HTML, it's an anchor)
        /href=["'](https?:\/\/fathom\.video\/call\/[^"']+)/i,
        /href=["'](https?:\/\/fathom\.video\/[^"']*share[^"']*)/i,
        // Plain text: "View Meeting" followed by URL
        /View Meeting[:\s]*\n?\s*(https?:\/\/fathom\.video\/(?:call|share)[^\s<>"]+)/i,
        // Otter specific
        /href=["'](https?:\/\/(?:app\.)?otter\.ai\/[^"']*(?:note|meeting|transcript)[^"']*)/i,
        /(https?:\/\/(?:app\.)?otter\.ai\/[^\s<>"]*(?:note|meeting|transcript)[^\s<>"]*)/i,
        // Fireflies specific  
        /href=["'](https?:\/\/(?:app\.)?fireflies\.ai\/[^"']*(?:view|meeting)[^"']*)/i,
        /(https?:\/\/(?:app\.)?fireflies\.ai\/[^\s<>"]*(?:view|meeting)[^\s<>"]*)/i,
        // tl;dv specific
        /href=["'](https?:\/\/tldv\.io\/[^"']*(?:app|meeting)[^"']*)/i,
        // Grain specific
        /href=["'](https?:\/\/grain\.(?:com|co)\/[^"']*(?:share|recording)[^"']*)/i,
        // Generic: any URL with /call/, /meeting/, /share/, /recording/ in path (not query params)
        /href=["'](https?:\/\/[^"']+\/(?:call|meeting|share|recording)\/[^"']+)/i
    ];
    
    for (const pattern of linkPatterns) {
        const match = html.match(pattern) || body.match(pattern);
        if (match) {
            const link = match[1];
            // Skip if it's just a homepage with UTM params
            if (!link.match(/^https?:\/\/[^\/]+\/?\?/)) {
                result.meetingLink = link;
                logger.info(`Found meeting link: ${link}`);
                break;
            }
        }
    }
    
    // Fallback: if we still don't have a link, try to find any fathom/otter/etc URL
    // that doesn't look like a homepage/marketing link
    if (!result.meetingLink) {
        const fallbackPattern = /(https?:\/\/(?:fathom\.video|app\.otter\.ai|app\.fireflies\.ai|tldv\.io|grain\.com|grain\.co)\/[^\s<>"]+)/gi;
        const allLinks = [...(body.matchAll(fallbackPattern) || []), ...(html.matchAll(fallbackPattern) || [])];
        for (const match of allLinks) {
            const link = match[1];
            // Skip homepage/UTM links
            if (!link.includes('utm_campaign') && !link.match(/^https?:\/\/[^\/]+\/?$/)) {
                result.meetingLink = link;
                logger.info(`Found meeting link (fallback): ${link}`);
                break;
            }
        }
    }
    
    // Extract duration
    const durationPatterns = [
        /(\d+)\s*mins?/i,
        /(\d+)\s*minutes?/i,
        /duration[:\s]+(\d+)/i
    ];
    
    for (const pattern of durationPatterns) {
        const match = subject.match(pattern) || body.match(pattern);
        if (match) {
            result.duration = `${match[1]} mins`;
            break;
        }
    }
    
    // Extract date from email body
    const datePatterns = [
        /(\w+\s+\d{1,2},?\s+\d{4})/i,  // January 27, 2026
        /(\d{1,2}\/\d{1,2}\/\d{2,4})/,  // 27/1/2026
        /(\d{1,2}-\d{1,2}-\d{2,4})/     // 27-1-2026
    ];
    
    for (const pattern of datePatterns) {
        const match = body.match(pattern);
        if (match) {
            result.date = match[1];
            break;
        }
    }
    
    // ============================================
    // EXTRACT RICH CONTENT FROM MEETING NOTES
    // ============================================
    
    // Helper to clean up text formatting from email
    const cleanMeetingText = (text) => {
        if (!text) return text;
        return text
            // Remove timestamp URLs (including angle bracket wrapped ones)
            .replace(/<?https?:\/\/[^\s>\n]*[?&]timestamp=[^\s>\n]*/gi, '')
            .replace(/<https?:\/\/fathom\.video[^>\n]*>/gi, '')
            // Remove "General Template Customize • Change Template" and similar junk
            .replace(/General Template.*$/gim, '')
            .replace(/Customize.*Change Template/gi, '')
            .replace(/^[•\-]\s*Change Template\s*$/gim, '')  // Standalone "Change Template" bullet
            .replace(/^[^\n]*Change Template[^\n]*$/gim, '')  // Any line containing "Change Template"
            .replace(/^[•\-]\s*Customize\s*$/gim, '')  // Standalone "Customize" bullet
            // Remove email quote markers (> at start of line or standalone >)
            .replace(/^\s*>\s*$/gm, '')  // Standalone > on a line
            .replace(/^\s*>\s*/gm, '')   // > at start of lines
            // Clean up markdown-style bold (*text* -> text)
            .replace(/\*([^*]+)\*/g, '$1')
            // Remove excessive leading whitespace while preserving structure
            .replace(/^[ \t]{4,}/gm, '  ')  // Reduce deep indentation to 2 spaces max
            // Clean up weird bullet formatting
            .replace(/^\s*-\s*$/gm, '')  // Remove standalone dashes
            // Fix missing space after period before capital letter (e.g., "revenue.App" -> "revenue. App")
            .replace(/\.([A-Z])/g, '. $1')
            // Fix numbered lists that got joined (e.g., "HTML.1." -> "HTML.\n1.")
            .replace(/\.(\d+)\.\s/g, '.\n$1. ')
            // Join broken lines (line ending with lowercase/comma continues on next line starting with lowercase)
            .replace(/([a-z,])\n\s{0,3}([a-z])/g, '$1 $2')
            // Collapse multiple newlines
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    };
    
    // Extract Action Items section (ends at Meeting Summary)
    const actionItemsMatch = body.match(/ACTION ITEMS[^\n]*\n([\s\S]*?)(?=MEETING SUMMARY|$)/i);
    if (actionItemsMatch) {
        let actionText = actionItemsMatch[1].trim();
        
        // Pre-process: remove timestamp URLs and clean up
        actionText = actionText
            .replace(/<?https?:\/\/[^\s>\n]*[?&]timestamp=[^\s>\n]*/gi, '')
            .replace(/<https?:\/\/fathom\.video[^>\n]*>/gi, '')
            .replace(/\[image:[^\]]*\]/gi, '')
            .replace(/View Meeting.*$/gim, '')
            .replace(/Ask Fathom.*$/gim, '');
        
        // Join continuation lines (lines that start with lowercase or are short fragments)
        // This fixes "build AI sales page via\nAI-generated HTML" -> single line
        actionText = actionText.replace(/([a-z])\n\s*([A-Z][a-z]+-?[a-z]*(?:\s|$))/g, '$1 $2');
        
        const lines = actionText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const cleanedItems = [];
        let currentTask = '';
        
        for (const line of lines) {
            // Skip empty or junk lines
            if (line.length < 3) continue;
            if (line.match(/^[•\-]\s*$/)) continue;
            
            // Check if this looks like an assignee name
            // Pattern: "FirstName LastName" or "FirstName van LastName" - typically 2-3 words, < 25 chars
            // Must be title case (not all caps, not all lowercase)
            const isAssignee = /^[A-Z][a-z]+(?:\s+(?:van\s+|de\s+|Van\s+|De\s+)?[A-Z][a-z]+)+$/i.test(line) && 
                               line.length < 25 && 
                               line.split(/\s+/).length >= 2 &&
                               line.split(/\s+/).length <= 4;
            
            if (isAssignee && currentTask) {
                // Combine task with assignee
                cleanedItems.push(`• ${currentTask} — ${line}`);
                currentTask = '';
            } else {
                // This is task text
                const cleanLine = line.replace(/^[•\-]\s*/, '').trim();
                
                if (currentTask && cleanLine.length > 0) {
                    // Check if this continues the previous task (starts lowercase or is a fragment)
                    if (/^[a-z]/.test(cleanLine) || cleanLine.length < 20) {
                        currentTask += ' ' + cleanLine;
                    } else {
                        // New task - save previous one without assignee
                        cleanedItems.push(`• ${currentTask}`);
                        currentTask = cleanLine;
                    }
                } else if (cleanLine.length > 0) {
                    currentTask = cleanLine;
                }
            }
        }
        if (currentTask) {
            cleanedItems.push(`• ${currentTask}`);
        }
        
        result.actionItems = cleanedItems.join('\n');
        logger.info(`Extracted ${cleanedItems.length} action items`);
        
        // Use assignee names as contact fallback (e.g. "— Akil Merchant" or "assigned to Akil Merchant")
        if (!result.contactName && result.actionItems) {
            const assigneePatterns = [
                /[—–-]\s*([A-Z][a-zà-ÿ]+(?:\s+[A-Za-zà-ÿ-]+)+)\s*$/gm,
                /assigned to\s+([A-Z][a-zà-ÿ]+(?:\s+[A-Za-zà-ÿ-]+)+)/gi
            ];
            const clientFirstNames = ['guy', 'desiree']; // Skip if assignee is likely the client
            for (const pattern of assigneePatterns) {
                for (const match of result.actionItems.matchAll(pattern)) {
                    const name = match[1].trim();
                    if (name.split(/\s+/).length >= 2 && name.length < 30) {
                        const first = name.split(/\s+/)[0].toLowerCase();
                        if (!clientFirstNames.includes(first)) {
                            result.contactName = name;
                            logger.info(`Found contact from action items assignee: "${name}"`);
                            break;
                        }
                    }
                }
                if (result.contactName) break;
            }
        }
    }
    
    // Extract Meeting Summary section (contains Purpose, Key Takeaways, Topics, Next Steps)
    const summaryMatch = body.match(/MEETING SUMMARY[^\n]*\n([\s\S]*?)(?=\[image:|View Meeting|Ask Fathom|$)/i);
    if (summaryMatch) {
        let summaryText = summaryMatch[1];
        
        // Clean up the text first
        summaryText = cleanMeetingText(summaryText);
        
        // Format main section headers (flexible: match at line start, with/without trailing newline)
        summaryText = summaryText
            .replace(/(^|\n)\s*Meeting Purpose\s*(?=\n|$)/gim, '$1\n━━━ MEETING PURPOSE ━━━\n')
            .replace(/(^|\n)\s*Key Takeaways\s*(?=\n|$)/gim, '$1\n━━━ KEY TAKEAWAYS ━━━\n')
            .replace(/(^|\n)\s*Topics\s*(?=\n|$)/gim, '$1\n━━━ TOPICS ━━━\n')
            .replace(/(^|\n)\s*Next Steps\s*(?=\n|$)/gim, '$1\n━━━ NEXT STEPS ━━━\n');
        
        // Format sub-section headers (like "WordPress Page Creation", "Go-to-Market & Networking")
        // These are lines that are capitalized words, end of line, not bullet points
        summaryText = summaryText.replace(/^([A-Z][A-Za-z'&\-\s]{5,50})\s*$/gm, (match, p1) => {
            // Don't convert if it's already a section header or looks like a sentence
            if (p1.match(/^━━━/) || p1.match(/\.\s*$/) || p1.split(/\s+/).length > 8) {
                return match;
            }
            return `\n▸ ${p1.trim()}`;
        });
        
        // Clean up bullet points - normalize to •
        summaryText = summaryText
            .replace(/^\s*[-]\s+/gm, '• ')
            .replace(/^\s{2,}•/gm, '  •')  // Keep some indentation for nested bullets
            // Numbered lists
            .replace(/^\s*(\d+)\.\s+/gm, '$1. ')
            // Final cleanup
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        
        result.meetingSummary = summaryText;
        logger.info(`Extracted meeting summary (${result.meetingSummary.length} chars)`);
    }
    
    // AGGRESSIVE final cleanup - remove common prefixes and ensure clean names
    const cleanupName = (name) => {
        if (!name) return name;
        let cleaned = name
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            // Remove "Meeting with", "Call with", "Recap of your meeting with", etc.
            .replace(/^(?:recap\s+of\s+)?(?:your\s+)?(?:meeting|call)\s+with\s+/i, '')
            .trim();
        return cleaned;
    };
    
    if (result.contactName) {
        result.contactName = cleanupName(result.contactName);
        logger.info(`Final contactName after cleanup: "${result.contactName}"`);
    }
    result.alternateNames = result.alternateNames
        .map(n => cleanupName(n))
        .filter(n => n && n.length > 1);
    
    logger.info(`Parsed meeting note-taker email: name="${result.contactName}", alternates=${JSON.stringify(result.alternateNames)}, link="${result.meetingLink}", duration="${result.duration}"`);
    return result;
}

/**
 * Normalize a name for comparison by removing hyphens, apostrophes, and extra spaces
 * This allows "Van Driel" to match "Van-Driel", "O'Brien" to match "OBrien", etc.
 * @param {string} name - The name to normalize
 * @returns {string} Normalized name (lowercase, no punctuation)
 */
function normalizeName(name) {
    if (!name) return '';
    return name
        .toLowerCase()
        .replace(/[-''`]/g, ' ')  // Replace hyphens/apostrophes with spaces
        .replace(/\s+/g, ' ')     // Collapse multiple spaces
        .trim();
}

/**
 * Find lead by name in client's Airtable base
 * Returns match info including whether there were multiple matches
 * Uses normalized comparison to handle variations like "Van-Driel" vs "Van Driel"
 * @param {Object} client - Client object with airtableBaseId
 * @param {string} contactName - Name to search for
 * @param {string} company - Optional company/domain to help match
 * @returns {Promise<{lead: Object|null, allMatches: Array, matchType: string}>}
 *   matchType: 'unique' | 'narrowed' | 'ambiguous' | 'none'
 */
async function findLeadByName(client, contactName, company = null) {
    const result = { lead: null, allMatches: [], matchType: 'none' };
    
    if (!client.airtableBaseId) {
        throw new Error(`Client ${client.clientId} has no Airtable base configured`);
    }
    
    if (!contactName || contactName.trim().length < 2) {
        logger.warn('Contact name too short for lead lookup');
        return result;
    }
    
    const clientBase = createBaseInstance(client.airtableBaseId);
    const nameParts = contactName.trim().split(/\s+/);
    
    // Normalize the search name for comparison
    const normalizedSearchFirst = normalizeName(nameParts[0]);
    const normalizedSearchLast = nameParts.length >= 2 
        ? normalizeName(nameParts.slice(1).join(' ')) 
        : '';
    
    logger.info(`Normalized search: first="${normalizedSearchFirst}", last="${normalizedSearchLast}"`);
    
    try {
        // Build search formula - use SUBSTITUTE to remove hyphens for comparison
        // This allows "Van Driel" to match "Van-Driel"
        let filterFormula;
        
        if (nameParts.length >= 2) {
            const firstName = nameParts[0];
            const lastName = nameParts.slice(1).join(' ');
            // Normalize both sides: remove hyphens from Airtable value and search value
            // SUBSTITUTE({Last Name}, "-", " ") replaces hyphens with spaces in the stored value
            filterFormula = `AND(
                LOWER(SUBSTITUTE({First Name}, "-", " ")) = "${normalizedSearchFirst}",
                LOWER(SUBSTITUTE(SUBSTITUTE({Last Name}, "-", " "), "'", "")) = "${normalizedSearchLast.replace(/'/g, '')}"
            )`;
        } else {
            // Single name - search in both fields
            filterFormula = `OR(
                LOWER(SUBSTITUTE({First Name}, "-", " ")) = "${normalizedSearchFirst}",
                LOWER(SUBSTITUTE({Last Name}, "-", " ")) = "${normalizedSearchFirst}"
            )`;
        }
        
        logger.info(`Searching for lead by name: "${contactName}" with formula: ${filterFormula}`);
        
        let records = await clientBase('Leads').select({
            filterByFormula: filterFormula,
            maxRecords: 10
        }).firstPage();
        
        // FALLBACK: If no match and last name has multiple parts (e.g., "Van Driel"),
        // try searching for just the last word (e.g., "Driel") which would match "Van-Driel"
        if ((!records || records.length === 0) && nameParts.length >= 2) {
            const lastNameParts = nameParts.slice(1); // Everything after first name
            
            if (lastNameParts.length >= 2) {
                // Multi-word last name like "Van Driel" - try just the last word "Driel"
                const lastWord = lastNameParts[lastNameParts.length - 1].toLowerCase();
                logger.info(`No exact match. Trying fallback: first="${normalizedSearchFirst}", last name CONTAINS "${lastWord}"`);
                
                // Use FIND to search for last word anywhere in last name
                // FIND returns position (1+) if found, 0 if not found
                const fallbackFormula = `AND(
                    LOWER({First Name}) = "${normalizedSearchFirst}",
                    FIND("${lastWord}", LOWER({Last Name})) > 0
                )`;
                
                logger.info(`Fallback formula: ${fallbackFormula}`);
                
                records = await clientBase('Leads').select({
                    filterByFormula: fallbackFormula,
                    maxRecords: 10
                }).firstPage();
                
                if (records && records.length > 0) {
                    logger.info(`Fallback search found ${records.length} lead(s) with last name containing "${lastWord}"`);
                }
            }
        }
        
        if (!records || records.length === 0) {
            logger.warn(`No lead found with name "${contactName}" for client ${client.clientId}`);
            return result;
        }
        
        // Map all records to lead objects
        result.allMatches = records.map(record => ({
            id: record.id,
            firstName: record.fields['First Name'] || '',
            lastName: record.fields['Last Name'] || '',
            email: record.fields['Email'] || '',
            company: record.fields['Company'] || '',
            linkedinUrl: record.fields['LinkedIn Profile URL'] || '',
            notes: record.fields['Notes'] || '',
            followUpDate: record.fields['Follow-Up Date'] || null
        }));
        
        // Case 1: Exactly one match - perfect!
        if (records.length === 1) {
            result.lead = result.allMatches[0];
            result.matchType = 'unique';
            logger.info(`Found unique lead ${result.lead.id} with name "${contactName}"`);
            return result;
        }
        
        // Case 2: Multiple matches - try to narrow down
        logger.info(`Found ${records.length} leads with name "${contactName}" - attempting to narrow down`);
        
        // Try to narrow by company/domain from the meeting email
        if (company) {
            const companyLower = company.toLowerCase().replace(/\.[^.]+$/, ''); // Remove TLD
            
            for (const lead of result.allMatches) {
                const linkedIn = (lead.linkedinUrl || '').toLowerCase();
                const leadCompany = (lead.company || '').toLowerCase();
                const leadEmail = (lead.email || '').toLowerCase();
                
                if (linkedIn.includes(companyLower) || 
                    leadCompany.includes(companyLower) ||
                    leadEmail.includes(companyLower)) {
                    result.lead = lead;
                    result.matchType = 'narrowed';
                    logger.info(`Narrowed to lead ${lead.id} by company match "${company}"`);
                    return result;
                }
            }
        }
        
        // Case 3: Could not narrow down - ambiguous
        result.matchType = 'ambiguous';
        logger.warn(`Could not narrow down ${records.length} leads with name "${contactName}"`);
        return result;
        
    } catch (error) {
        logger.error(`Error searching for lead by name: ${error.message}`);
        throw error;
    }
}

/**
 * Find lead by first name only + company domain
 * Used when Fathom shows "Meeting with domain.com" and just a first name (e.g., "Michelle")
 * @param {Object} client - Client object with airtableBaseId
 * @param {string} firstName - First name to search for
 * @param {string} domain - Company domain (e.g., "discoveryouredge.com.au")
 * @returns {Promise<{lead: Object|null, allMatches: Array, matchType: string}>}
 */
async function findLeadByFirstNameAndDomain(client, firstName, domain) {
    const result = { lead: null, allMatches: [], matchType: 'none' };
    
    if (!client.airtableBaseId) {
        throw new Error(`Client ${client.clientId} has no Airtable base configured`);
    }
    
    if (!firstName || firstName.trim().length < 2) {
        logger.warn('First name too short for lead lookup');
        return result;
    }
    
    const clientBase = createBaseInstance(client.airtableBaseId);
    const normalizedFirst = normalizeName(firstName);
    
    // Extract domain parts for matching
    // "discoveryouredge.com.au" -> "discoveryouredge"
    const domainName = domain.toLowerCase().replace(/\.[^.]+(\.[^.]+)?$/, ''); // Remove TLD(s)
    
    logger.info(`Searching for lead: firstName="${normalizedFirst}", domain="${domainName}"`);
    
    try {
        // Search for matching first name
        const filterFormula = `LOWER(SUBSTITUTE({First Name}, "-", " ")) = "${normalizedFirst}"`;
        
        let records = await clientBase('Leads').select({
            filterByFormula: filterFormula,
            maxRecords: 20
        }).firstPage();
        
        if (!records || records.length === 0) {
            logger.warn(`No leads found with first name "${firstName}"`);
            return result;
        }
        
        logger.info(`Found ${records.length} leads with first name "${firstName}", filtering by domain "${domainName}"`);
        
        // Filter by domain - check email and company fields
        const domainMatches = records.filter(record => {
            const email = (record.fields['Email'] || '').toLowerCase();
            const company = (record.fields['Company'] || '').toLowerCase();
            const linkedin = (record.fields['LinkedIn Profile URL'] || '').toLowerCase();
            
            return email.includes(domainName) || 
                   company.includes(domainName) ||
                   linkedin.includes(domainName);
        });
        
        if (domainMatches.length === 0) {
            logger.warn(`No leads with first name "${firstName}" match domain "${domainName}"`);
            return result;
        }
        
        // Map matches to lead objects
        result.allMatches = domainMatches.map(record => ({
            id: record.id,
            firstName: record.fields['First Name'] || '',
            lastName: record.fields['Last Name'] || '',
            email: record.fields['Email'] || '',
            company: record.fields['Company'] || '',
            linkedinUrl: record.fields['LinkedIn Profile URL'] || '',
            notes: record.fields['Notes'] || '',
            followUpDate: record.fields['Follow-Up Date'] || null
        }));
        
        if (domainMatches.length === 1) {
            result.lead = result.allMatches[0];
            result.matchType = 'unique';
            logger.info(`Found unique lead ${result.lead.id}: ${result.lead.firstName} ${result.lead.lastName} (matched by first name + domain)`);
            return result;
        }
        
        // Multiple matches with same first name at same domain - ambiguous
        result.matchType = 'ambiguous';
        logger.warn(`Found ${domainMatches.length} leads with first name "${firstName}" at domain "${domainName}"`);
        return result;
        
    } catch (error) {
        logger.error(`Error searching for lead by first name + domain: ${error.message}`);
        throw error;
    }
}

/**
 * Find lead by company domain only (fallback when no name is extracted)
 * Used when Fathom shows "Meeting with domain.com" but we can't extract a name
 * @param {Object} client - Client object with airtableBaseId
 * @param {string} domain - Company domain (e.g., "timeandfocus.com.au")
 * @returns {Promise<{lead: Object|null, allMatches: Array, matchType: string}>}
 */
async function findLeadByDomainOnly(client, domain) {
    const result = { lead: null, allMatches: [], matchType: 'none' };
    
    if (!client.airtableBaseId) {
        throw new Error(`Client ${client.clientId} has no Airtable base configured`);
    }
    
    // Skip common personal email domains - too many matches
    const personalDomains = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 
                            'live.com', 'msn.com', 'aol.com', 'protonmail.com', 'mail.com'];
    const domainLower = domain.toLowerCase();
    if (personalDomains.some(pd => domainLower.includes(pd))) {
        logger.info(`Skipping domain-only search for personal email domain: ${domain}`);
        return result;
    }
    
    const clientBase = createBaseInstance(client.airtableBaseId);
    
    // Extract domain name for matching (remove TLDs)
    // "timeandfocus.com.au" -> "timeandfocus"
    const domainName = domainLower.replace(/\.[^.]+(\.[^.]+)?$/, '');
    
    logger.info(`Searching for lead by domain only: "${domainName}" (from ${domain})`);
    
    try {
        // Search for leads where email contains this domain
        const filterFormula = `FIND("${domainName}", LOWER({Email})) > 0`;
        
        let records = await clientBase('Leads').select({
            filterByFormula: filterFormula,
            maxRecords: 10
        }).firstPage();
        
        if (!records || records.length === 0) {
            logger.warn(`No leads found with domain "${domainName}" in email`);
            return result;
        }
        
        logger.info(`Found ${records.length} leads with domain "${domainName}" in email`);
        
        // Map matches to lead objects
        result.allMatches = records.map(record => ({
            id: record.id,
            firstName: record.fields['First Name'] || '',
            lastName: record.fields['Last Name'] || '',
            email: record.fields['Email'] || '',
            company: record.fields['Company'] || '',
            linkedinUrl: record.fields['LinkedIn Profile URL'] || '',
            notes: record.fields['Notes'] || '',
            followUpDate: record.fields['Follow-Up Date'] || null
        }));
        
        if (records.length === 1) {
            result.lead = result.allMatches[0];
            result.matchType = 'unique';
            logger.info(`Found unique lead ${result.lead.id}: ${result.lead.firstName} ${result.lead.lastName} (matched by domain only)`);
            return result;
        }
        
        // Multiple matches at same domain - ambiguous
        result.matchType = 'ambiguous';
        logger.warn(`Found ${records.length} leads at domain "${domainName}" - ambiguous`);
        return result;
        
    } catch (error) {
        logger.error(`Error searching for lead by domain only: ${error.message}`);
        throw error;
    }
}

/**
 * Update lead with meeting notes (concise format with link)
 * @param {Object} client - Client object
 * @param {Object} lead - Lead object (with id, notes)
 * @param {Object} meetingData - Parsed meeting data
 * @param {string} provider - Note-taker provider name
 * @returns {Promise<Object>} Update result
 */
async function updateLeadWithMeetingNotes(client, lead, meetingData, provider) {
    const clientBase = createBaseInstance(client.airtableBaseId);
    
    // Check for duplicate - if meeting link already exists in notes, skip
    if (meetingData.meetingLink && lead.notes) {
        // Extract the base URL without query params for comparison
        const baseLinkMatch = meetingData.meetingLink.match(/^(https?:\/\/[^?#]+)/);
        const baseLink = baseLinkMatch ? baseLinkMatch[1] : meetingData.meetingLink;
        
        if (lead.notes.includes(baseLink)) {
            logger.info(`Meeting link ${baseLink} already exists in notes - skipping duplicate`);
            return {
                success: true,
                duplicate: true,
                leadId: lead.id,
                leadName: `${lead.firstName} ${lead.lastName}`.trim(),
                message: 'Meeting notes already saved (duplicate skipped)'
            };
        }
    }
    
    // Format timestamp - prefer meeting date from Fathom when available for consistency with header
    let timestamp;
    if (meetingData.date) {
        // Use Fathom's date format (e.g. "February 17, 2026") to match the header line
        timestamp = meetingData.date;
    } else {
        const clientTimezone = client.timezone || 'Australia/Brisbane';
        try {
            timestamp = new Date().toLocaleString('en-AU', { 
                timeZone: clientTimezone,
                day: '2-digit',
                month: '2-digit', 
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        } catch (e) {
            timestamp = new Date().toLocaleString('en-AU');
        }
    }
    
    // Build clean meeting note entry
    const separator = '═══════════════════════════════════════════════════════';
    
    // Header line with name, date, duration
    let headerParts = [`📹 ${meetingData.contactName || 'Meeting'}`];
    if (meetingData.date) {
        headerParts.push(meetingData.date);
    }
    if (meetingData.duration) {
        headerParts.push(meetingData.duration);
    }
    
    let noteEntry = `${separator}\n${headerParts.join(' | ')}\n${separator}`;
    
    // Action Items (with assignees)
    if (meetingData.actionItems) {
        noteEntry += `\n\n✅ ACTION ITEMS\n${meetingData.actionItems}`;
    }
    
    // Meeting Summary (contains Purpose, Key Takeaways, Topics, Next Steps - all in one clean block)
    if (meetingData.meetingSummary) {
        noteEntry += `\n\n📝 MEETING NOTES\n${meetingData.meetingSummary}`;
    }
    
    // Meeting Link
    if (meetingData.meetingLink) {
        noteEntry += `\n\n🔗 View full meeting: ${meetingData.meetingLink}`;
    }
    
    // Add a subtle footer with timestamp
    noteEntry += `\n\n[Recorded ${timestamp}]`;
    
    // Update the MEETING section in notes (append mode)
    const updateResult = updateSection(lead.notes || '', 'meeting', noteEntry, { 
        append: true, 
        newlinesBefore: 1 
    });
    
    // updateSection returns { notes, previousContent, lineCount } - we need just the notes string
    const updatedNotes = updateResult.notes;
    
    try {
        await clientBase('Leads').update(lead.id, {
            'Notes': updatedNotes
        });
        
        logger.info(`Updated lead ${lead.id} with meeting notes from ${provider}`);
        
        return {
            success: true,
            leadId: lead.id,
            leadName: `${lead.firstName} ${lead.lastName}`.trim(),
            provider: provider,
            meetingLink: meetingData.meetingLink
        };
        
    } catch (error) {
        logger.error(`Failed to update lead with meeting notes: ${error.message}`);
        throw error;
    }
}

/**
 * Process a meeting note-taker email
 * @param {Object} client - Client object
 * @param {Object} emailData - Email data (subject, bodyPlain, bodyHtml, etc.)
 * @param {string} provider - Detected provider name
 * @returns {Promise<Object>} Processing result
 */
async function processMeetingNotetakerEmail(client, emailData, provider) {
    const { subject, bodyPlain, bodyHtml } = emailData;
    
    logger.info(`Processing ${provider} meeting note-taker email for client ${client.clientId}`);
    logger.info(`Subject: "${subject}"`);
    logger.info(`Body length: ${(bodyPlain || '').length} chars`);
    
    // Wrap everything in try-catch to ensure we always respond
    let meetingData = null;
    try {
        // Parse the email to extract meeting details
        meetingData = parseMeetingNotetakerEmail(subject, bodyPlain, bodyHtml, provider);
    } catch (parseError) {
        logger.error(`Error parsing meeting email: ${parseError.message}`);
        return {
            success: false,
            error: 'parse_error',
            message: `Failed to parse meeting email: ${parseError.message}`
        };
    }
    
    if (!meetingData.contactName && !meetingData.contactEmail && !meetingData.company && !meetingData.firstNameOnly && meetingData.alternateNames.length === 0) {
        logger.warn('No contact info extracted from meeting email');
        return {
            success: false,
            error: 'no_contact_info',
            message: 'Could not extract contact name or email from meeting note-taker email'
        };
    }
    
    try {
        let lead = null;
        let matchedBy = null;
        
        // PRIORITY 1: Try email lookup first (most reliable)
        if (meetingData.contactEmail) {
            logger.info(`Trying to find lead by email: "${meetingData.contactEmail}"`);
            lead = await findLeadByEmail(client, meetingData.contactEmail);
            
            if (lead) {
                matchedBy = `email (${meetingData.contactEmail})`;
                logger.info(`Found lead ${lead.id} by email: ${meetingData.contactEmail}`);
            } else {
                logger.info(`No lead found with email ${meetingData.contactEmail}, falling back to name search`);
            }
        }
        
        // PRIORITY 2: Try name lookup if email didn't match
        if (!lead) {
            // Build list of names to try: primary name first, then alternates
            const namesToTry = [];
            if (meetingData.contactName) {
                namesToTry.push(meetingData.contactName);
            }
            if (meetingData.alternateNames && meetingData.alternateNames.length > 0) {
                namesToTry.push(...meetingData.alternateNames);
            }
            
            if (namesToTry.length > 0) {
                logger.info(`Will try ${namesToTry.length} name(s): ${namesToTry.join(', ')}`);
                
                // Try each name until we find a match
                let searchResult = null;
                let matchedName = null;
                
                for (const nameToTry of namesToTry) {
                    logger.info(`Trying to find lead by name: "${nameToTry}"`);
                    searchResult = await findLeadByName(client, nameToTry, meetingData.company);
                    
                    if (searchResult.matchType !== 'none') {
                        matchedName = nameToTry;
                        logger.info(`Found match with name "${nameToTry}" (matchType: ${searchResult.matchType})`);
                        break;
                    }
                    logger.info(`No match for "${nameToTry}", trying next...`);
                }
                
                // Handle name search results
                if (searchResult && searchResult.matchType === 'ambiguous') {
                    // Multiple leads with same name, couldn't narrow down
                    await sendMeetingMultipleLeadsNotification(client.clientEmailAddress, meetingData, provider, searchResult.allMatches);
                    return {
                        success: false,
                        error: 'multiple_leads',
                        message: `Found ${searchResult.allMatches.length} leads named "${matchedName}" - please specify which one`,
                        matches: searchResult.allMatches.map(l => ({
                            id: l.id,
                            name: `${l.firstName} ${l.lastName}`.trim(),
                            company: l.company,
                            email: l.email
                        }))
                    };
                }
                
                if (searchResult && searchResult.matchType !== 'none') {
                    lead = searchResult.lead;
                    matchedBy = `name (${matchedName})`;
                }
            }
        }
        
        // PRIORITY 3: First name only + company domain search
        // When we only have a first name (e.g., "Michelle") and a company domain (e.g., "discoveryouredge.com.au")
        if (!lead && meetingData.firstNameOnly && meetingData.company) {
            logger.info(`Trying first name + company domain search: "${meetingData.firstNameOnly}" at "${meetingData.company}"`);
            
            const searchResult = await findLeadByFirstNameAndDomain(client, meetingData.firstNameOnly, meetingData.company);
            
            if (searchResult.matchType === 'ambiguous') {
                // Multiple leads match first name + domain
                await sendMeetingMultipleLeadsNotification(client.clientEmailAddress, meetingData, provider, searchResult.allMatches);
                return {
                    success: false,
                    error: 'multiple_leads',
                    message: `Found ${searchResult.allMatches.length} leads named "${meetingData.firstNameOnly}" at ${meetingData.company}`,
                    matches: searchResult.allMatches.map(l => ({
                        id: l.id,
                        name: `${l.firstName} ${l.lastName}`.trim(),
                        company: l.company,
                        email: l.email
                    }))
                };
            }
            
            if (searchResult.matchType !== 'none') {
                lead = searchResult.lead;
                matchedBy = `first name + domain (${meetingData.firstNameOnly} at ${meetingData.company})`;
            }
        }
        
        // PRIORITY 4: Domain-only search (fallback when no name could be extracted)
        // When we have a company domain but couldn't extract any name
        if (!lead && meetingData.company && !meetingData.contactName && !meetingData.firstNameOnly) {
            logger.info(`Trying domain-only search: "${meetingData.company}"`);
            
            const searchResult = await findLeadByDomainOnly(client, meetingData.company);
            
            if (searchResult.matchType === 'ambiguous') {
                // Multiple leads at this domain
                await sendMeetingMultipleLeadsNotification(client.clientEmailAddress, meetingData, provider, searchResult.allMatches);
                return {
                    success: false,
                    error: 'multiple_leads',
                    message: `Found ${searchResult.allMatches.length} leads at ${meetingData.company} - please specify which one`,
                    matches: searchResult.allMatches.map(l => ({
                        id: l.id,
                        name: `${l.firstName} ${l.lastName}`.trim(),
                        company: l.company,
                        email: l.email
                    }))
                };
            }
            
            if (searchResult.matchType !== 'none') {
                lead = searchResult.lead;
                matchedBy = `domain only (${meetingData.company})`;
            }
        }
        
        // No match found by email or name
        if (!lead) {
            const searchedFor = meetingData.contactEmail 
                ? `email "${meetingData.contactEmail}"` 
                : `name "${meetingData.contactName || meetingData.alternateNames.join('" or "')}"`;
            logger.warn(`No lead found - searched for: ${searchedFor}`);
            await sendMeetingLeadNotFoundNotification(client.clientEmailAddress, meetingData, provider);
            return {
                success: false,
                error: 'lead_not_found',
                message: `No lead found with ${searchedFor} for ${provider} meeting`
            };
        }
        
        // Update the lead with meeting notes
        logger.info(`Updating lead ${lead.id} (${lead.firstName} ${lead.lastName}) with meeting notes`);
        const updateResult = await updateLeadWithMeetingNotes(client, lead, meetingData, provider);
        
        // Check if this was a duplicate
        if (updateResult.duplicate) {
            logger.info(`Duplicate meeting note detected for ${lead.firstName} ${lead.lastName} - not sending notification`);
            return {
                success: true,
                type: 'meeting_notes_duplicate',
                provider: provider,
                leadId: lead.id,
                leadName: `${lead.firstName} ${lead.lastName}`.trim(),
                meetingLink: meetingData.meetingLink,
                message: 'Duplicate - meeting notes already saved'
            };
        }
        
        // No success email - only notify on failure (lead not found, error, etc.)
        logger.info(`Meeting notes saved for ${lead.firstName} ${lead.lastName} - NOT sending success email (disabled)`);
        return {
            success: true,
            type: 'meeting_notes',
            provider: provider,
            leadId: lead.id,
            leadName: `${lead.firstName} ${lead.lastName}`.trim(),
            meetingLink: meetingData.meetingLink,
            matchedBy: matchedBy
        };
        
    } catch (error) {
        logger.error(`Error processing meeting note-taker email: ${error.message}`);
        logger.error(error.stack);
        
        // Try to send error notification
        try {
            await sendMeetingErrorNotification(client.clientEmailAddress, meetingData, provider, error.message);
        } catch (notifyError) {
            logger.error(`Failed to send error notification: ${notifyError.message}`);
        }
        
        return {
            success: false,
            error: 'processing_error',
            message: error.message
        };
    }
}

/**
 * Send notification when meeting lead is not found
 * @param {string} toEmail - Recipient email
 * @param {Object} meetingData - Parsed meeting data
 * @param {string} provider - Provider name
 */
async function sendMeetingLeadNotFoundNotification(toEmail, meetingData, provider) {
    const https = require('https');
    const querystring = require('querystring');
    
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
        logger.warn('Mailgun not configured - skipping notification');
        return;
    }
    
    // Build list of what we searched for
    const searchedNames = [];
    if (meetingData.contactEmail) {
        searchedNames.push(`Email: ${meetingData.contactEmail}`);
    }
    if (meetingData.contactName) {
        searchedNames.push(`Name: ${meetingData.contactName}`);
    }
    if (meetingData.firstNameOnly) {
        searchedNames.push(`First name: ${meetingData.firstNameOnly}${meetingData.company ? ` (at ${meetingData.company})` : ''}`);
    }
    // If we only have a domain (no name extracted), show that we searched by domain
    if (meetingData.company && !meetingData.contactName && !meetingData.firstNameOnly && !meetingData.contactEmail) {
        searchedNames.push(`Domain search: ${meetingData.company}`);
    }
    if (meetingData.alternateNames && meetingData.alternateNames.length > 0) {
        for (const altName of meetingData.alternateNames) {
            searchedNames.push(`Also tried: ${altName}`);
        }
    }
    
    const emailData = {
        from: `ASH Portal <noreply@${process.env.MAILGUN_DOMAIN}>`,
        to: toEmail,
        subject: `📹 Meeting Note Not Saved - Lead Not Found`,
        text: `Hi,

We received your ${provider} meeting notes but couldn't find a matching lead in your portal.

Searched for:
${searchedNames.length > 0 ? searchedNames.join('\n') : 'Could not extract contact info'}
${meetingData.company ? `\nCompany domain: ${meetingData.company}` : ''}
${meetingData.meetingLink ? `\nMeeting Link: ${meetingData.meetingLink}` : ''}

To save these notes, please:
1. Make sure the lead exists in your dashboard
2. Check that the First Name and Last Name match exactly

You can manually add the meeting link to the lead's notes.

Best,
ASH Portal`
    };
    
    const postData = querystring.stringify(emailData);
    
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.mailgun.net',
            port: 443,
            path: `/v3/${process.env.MAILGUN_DOMAIN}/messages`,
            method: 'POST',
            auth: `api:${process.env.MAILGUN_API_KEY}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    logger.info(`Meeting lead not found notification sent to ${toEmail}`);
                }
                resolve({ sent: res.statusCode < 300 });
            });
        });
        
        req.on('error', () => resolve({ sent: false }));
        req.write(postData);
        req.end();
    });
}

/**
 * Send notification when multiple leads match the meeting contact name
 * @param {string} toEmail - Recipient email
 * @param {Object} meetingData - Parsed meeting data
 * @param {string} provider - Provider name
 * @param {Array} matchingLeads - Array of matching lead objects
 */
async function sendMeetingMultipleLeadsNotification(toEmail, meetingData, provider, matchingLeads) {
    const https = require('https');
    const querystring = require('querystring');
    
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
        logger.warn('Mailgun not configured - skipping notification');
        return;
    }
    
    // Build a list of the matching leads for the email
    const leadList = matchingLeads.map((lead, idx) => {
        const name = `${lead.firstName} ${lead.lastName}`.trim();
        const details = [];
        if (lead.company) details.push(lead.company);
        if (lead.email) details.push(lead.email);
        return `${idx + 1}. ${name}${details.length > 0 ? ` (${details.join(', ')})` : ''}`;
    }).join('\n');
    
    const emailData = {
        from: `ASH Portal <noreply@${process.env.MAILGUN_DOMAIN}>`,
        to: toEmail,
        subject: `📹 Meeting Note Not Saved - Multiple Leads Named "${meetingData.contactName}"`,
        text: `Hi,

We received your ${provider} meeting notes for "${meetingData.contactName}" but found ${matchingLeads.length} leads with that name:

${leadList}

We couldn't determine which one you met with.
${meetingData.meetingLink ? `\nMeeting Link: ${meetingData.meetingLink}` : ''}

Please manually add the meeting notes to the correct lead in your dashboard.

Tip: If the leads have different company names or email domains, we can usually match automatically. The meeting email subject included "${meetingData.company || 'no company info'}".

Best,
ASH Portal`
    };
    
    const postData = querystring.stringify(emailData);
    
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.mailgun.net',
            port: 443,
            path: `/v3/${process.env.MAILGUN_DOMAIN}/messages`,
            method: 'POST',
            auth: `api:${process.env.MAILGUN_API_KEY}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    logger.info(`Multiple leads notification sent to ${toEmail} for ${matchingLeads.length} matches`);
                }
                resolve({ sent: res.statusCode < 300 });
            });
        });
        
        req.on('error', () => resolve({ sent: false }));
        req.write(postData);
        req.end();
    });
}

/**
 * Send notification when meeting notes are saved successfully
 * REMOVED: Success emails disabled per user preference. Only failure emails are sent.
 * (Function deleted - no code path calls it.)
 */

/**
 * Send notification when there's an error processing meeting notes
 * @param {string} toEmail - Recipient email
 * @param {Object} meetingData - Parsed meeting data
 * @param {string} provider - Provider name
 * @param {string} errorMessage - Error description
 */
async function sendMeetingErrorNotification(toEmail, meetingData, provider, errorMessage) {
    const https = require('https');
    const querystring = require('querystring');
    
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
        logger.warn('Mailgun not configured - skipping notification');
        return;
    }
    
    const emailData = {
        from: `ASH Portal <noreply@${process.env.MAILGUN_DOMAIN}>`,
        to: toEmail,
        subject: `❌ Meeting Note Error - ${provider}`,
        text: `Hi,

There was an error processing your ${provider} meeting notes.

Error: ${errorMessage}

Contact: ${meetingData?.contactName || meetingData?.contactEmail || 'Unknown'}
${meetingData?.meetingLink ? `Meeting Link: ${meetingData.meetingLink}` : ''}

Please try forwarding the email again, or manually add the meeting link to the lead's notes.

Best,
ASH Portal`
    };
    
    const postData = querystring.stringify(emailData);
    
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.mailgun.net',
            port: 443,
            path: `/v3/${process.env.MAILGUN_DOMAIN}/messages`,
            method: 'POST',
            auth: `api:${process.env.MAILGUN_API_KEY}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    logger.info(`Meeting error notification sent to ${toEmail}`);
                }
                resolve({ sent: res.statusCode < 300 });
            });
        });
        
        req.on('error', () => resolve({ sent: false }));
        req.write(postData);
        req.end();
    });
}

/**
 * Detect if email is a forwarded message
 * Checks both body content and subject line
 * @param {string} body - Email body
 * @param {string} subject - Email subject (optional)
 * @returns {boolean}
 */
function isForwardedEmail(body, subject = '') {
    // Check subject for forward indicators (Fwd:, FW:, Fwd, etc.)
    if (subject) {
        const subjectForwardPatterns = [
            /^Fwd:/i,
            /^FW:/i,
            /^Fwd\s/i,
            /^\[Fwd\]/i
        ];
        if (subjectForwardPatterns.some(pattern => pattern.test(subject.trim()))) {
            logger.info('Detected forward from subject line');
            return true;
        }
    }
    
    if (!body) return false;
    
    // Common forward patterns in body
    const bodyForwardPatterns = [
        /---------- Forwarded message ---------/i,
        /-------- Original Message --------/i,
        /Begin forwarded message:/i,
        /-----Original Message-----/i,
        /Forwarded message from/i,
        // Also check for forwarded email headers in the body
        /\nFrom:.*\nDate:.*\nSubject:.*\nTo:/is
    ];
    
    if (bodyForwardPatterns.some(pattern => pattern.test(body))) {
        logger.info('Detected forward from body content');
        return true;
    }
    
    return false;
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
    
    // Helper to check if an email is a tracking address (should be skipped)
    const isTrackingAddress = (email) => {
        if (!email) return false;
        const lower = email.toLowerCase();
        return lower.includes('track@') || 
               lower.includes('mail.australiansidehustles') ||
               lower.includes('mail.partnerbuild');
    };
    
    // Helper to extract emails from a line
    const extractEmailsFromLine = (line) => {
        const emails = [];
        // First try angle bracket format: Name <email>
        const bracketMatches = line.matchAll(/<([^>]+@[^>]+)>/g);
        for (const match of bracketMatches) {
            const email = match[1].toLowerCase().trim();
            const beforeEmail = line.substring(0, line.indexOf(match[0])).split(',').pop()?.trim() || '';
            emails.push({
                email,
                name: beforeEmail || email.split('@')[0]
            });
        }
        // If no bracket emails, try plain emails
        if (emails.length === 0) {
            const plainEmails = line.match(/[^\s<,]+@[^\s>,]+/g);
            if (plainEmails) {
                for (const email of plainEmails) {
                    emails.push({
                        email: email.toLowerCase().trim(),
                        name: email.split('@')[0]
                    });
                }
            }
        }
        return emails;
    };
    
    // Find ALL forwarded message blocks (for nested forwards)
    // Gmail: "---------- Forwarded message ---------"
    const forwardMarkerRegex = /-{5,}\s*Forwarded message\s*-{5,}/gi;
    const forwardMarkers = [...body.matchAll(forwardMarkerRegex)];
    logger.info(`Found ${forwardMarkers.length} forwarded message block(s)`);
    
    // Extract To: recipients from ALL forward blocks, filtering out tracking addresses
    const allToRecipients = [];
    
    for (let i = 0; i < forwardMarkers.length; i++) {
        const startIdx = forwardMarkers[i].index;
        const endIdx = i < forwardMarkers.length - 1 ? forwardMarkers[i + 1].index : body.length;
        const block = body.substring(startIdx, endIdx);
        
        // Extract To: from this block
        const toMatch = block.match(/\nTo:\s*([^\n]+(?:\n\s+[^\n]+)*)/i);
        if (toMatch) {
            const toLine = toMatch[1].replace(/\n\s+/g, ' ').trim();
            const emails = extractEmailsFromLine(toLine);
            
            for (const emailObj of emails) {
                if (!isTrackingAddress(emailObj.email)) {
                    logger.info(`Forward block ${i + 1}: found non-tracking To: ${emailObj.email}`);
                    allToRecipients.push(emailObj);
                } else {
                    logger.info(`Forward block ${i + 1}: skipping tracking address To: ${emailObj.email}`);
                }
            }
        }
        
        // Also extract From: from each block (for replies being forwarded)
        const fromMatch = block.match(/\nFrom:\s*(?:[^\n<]*)<([^>]+)>/i);
        if (fromMatch && !isTrackingAddress(fromMatch[1])) {
            // Store the From from deepest block as result.from
            result.from = fromMatch[1].toLowerCase().trim();
        }
    }
    
    // Also look for "On ... <email> wrote:" patterns (quoted replies)
    // This catches the original sender in a reply chain
    const wrotePatterns = [
        /On\s+[^<]+<([^>]+@[^>]+)>\s+wrote:/gi,
        /On\s+.+?,\s+([^\s<]+@[^\s>]+)\s+wrote:/gi
    ];
    
    for (const pattern of wrotePatterns) {
        const matches = [...body.matchAll(pattern)];
        for (const match of matches) {
            const email = match[1].toLowerCase().trim();
            if (!isTrackingAddress(email) && !allToRecipients.some(r => r.email === email)) {
                logger.info(`Found email from quoted reply: ${email}`);
                allToRecipients.push({
                    email,
                    name: email.split('@')[0],
                    source: 'quoted-reply'
                });
            }
        }
    }
    
    // Use all non-tracking recipients
    result.to = allToRecipients;
    
    // Extract Cc: from all blocks
    const ccMatches = body.matchAll(/\nCc:\s*([^\n]+(?:\n\s+[^\n]+)*)/gi);
    for (const ccMatch of ccMatches) {
        const ccLine = ccMatch[1].replace(/\n\s+/g, ' ').trim();
        logger.info(`Forwarded email - found Cc line: "${ccLine}"`);
        
        const emails = extractEmailsFromLine(ccLine);
        for (const emailObj of emails) {
            if (!isTrackingAddress(emailObj.email) && !result.cc.some(c => c.email === emailObj.email)) {
                result.cc.push(emailObj);
            }
        }
    }
    
    // Extract subject from first forward block
    const subjectMatch = body.match(/\nSubject:\s*([^\n]+)/i);
    if (subjectMatch) {
        result.subject = subjectMatch[1].trim();
        logger.info(`Forwarded email - extracted subject: "${result.subject}"`);
    } else {
        logger.info('Forwarded email - no Subject: header found in body');
    }
    
    logger.info(`Forwarded email parsing: found ${result.to.length} To recipients, ${result.cc.length} Cc recipients`);
    if (result.to.length > 0) {
        logger.info(`To recipients: ${result.to.map(r => `${r.email}${r.source ? ` (${r.source})` : ''}`).join(', ')}`);
    }
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
    logger.info(`Body-plain length: ${(bodyPlain || '').length} chars`);
    
    // Debug: Log first 200 chars of body to check for forward markers
    if (bodyPlain) {
        logger.info(`Body preview: ${bodyPlain.substring(0, 200).replace(/\n/g, '\\n')}`);
    } else {
        logger.warn('Body-plain is undefined or empty!');
    }

    // Check if this is a forwarded email (To is our tracking address)
    // This happens when user forgot to BCC and forwards the sent email to track it
    const isForward = isForwardedEmail(bodyPlain, subject);
    const toIsTrackingAddress = leadEmail && recipient && 
        (leadEmail.toLowerCase() === recipient.toLowerCase() || 
         leadEmail.includes('track@') || 
         leadEmail.includes('mail.australiansidehustles'));
    
    // Debug: Log the detection values
    logger.info(`Forward detection: isForward=${isForward}, toIsTrackingAddress=${toIsTrackingAddress}`);
    logger.info(`  leadEmail="${leadEmail}", recipient="${recipient}"`);
    
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

    // Step 1.5: Check if this is a forwarded meeting note-taker email (Fathom, Otter, etc.)
    // Meeting note-takers are detected by sender domain or content patterns
    if (isForward && toIsTrackingAddress) {
        // Check the forwarded content for meeting note-taker patterns
        const meetingDetection = detectMeetingNotetaker(
            forwardedRecipients?.from || '', 
            forwardedRecipients?.subject || subject, 
            bodyPlain
        );
        
        if (meetingDetection.isMeetingNotetaker) {
            logger.info(`🎥 Processing ${meetingDetection.provider} meeting note-taker email`);
            
            // Process as meeting note-taker (lookup by name, not email)
            return await processMeetingNotetakerEmail(client, {
                subject: forwardedRecipients?.subject || subject,
                bodyPlain,
                bodyHtml
            }, meetingDetection.provider);
        }
    }

    // Step 2: Collect all potential leads (To + CC + From for forwarded replies)
    const potentialLeads = [];
    
    // Build list of client's own email addresses to filter out
    const clientEmails = new Set();
    const primaryEmail = (client.clientEmailAddress || '').toLowerCase().trim();
    if (primaryEmail) clientEmails.add(primaryEmail);
    if (client.rawRecord) {
        const altEmails = client.rawRecord.get('Alternative Email Addresses') || '';
        altEmails.split(';').forEach(e => {
            const email = e.trim().toLowerCase();
            if (email) clientEmails.add(email);
        });
    }
    logger.info(`Client emails to filter: ${Array.from(clientEmails).join(', ')}`);
    
    // If this was a forwarded email, use the extracted recipients
    if (forwardedRecipients && (forwardedRecipients.to.length > 0 || forwardedRecipients.from)) {
        for (const fwdTo of forwardedRecipients.to) {
            potentialLeads.push({ email: fwdTo.email, name: fwdTo.name, source: 'forwarded-to' });
        }
        for (const fwdCc of forwardedRecipients.cc) {
            if (!potentialLeads.some(p => p.email === fwdCc.email)) {
                potentialLeads.push({ email: fwdCc.email, name: fwdCc.name, source: 'forwarded-cc' });
            }
        }
        // Also add the From field - handles forwarded inbound replies from leads
        if (forwardedRecipients.from) {
            const fromEmail = forwardedRecipients.from.toLowerCase().trim();
            if (!potentialLeads.some(p => p.email === fromEmail)) {
                potentialLeads.push({ email: fromEmail, name: '', source: 'forwarded-from' });
                logger.info(`Added forwarded From address as potential lead: ${fromEmail}`);
            }
        }
        logger.info(`Using ${potentialLeads.length} recipients from forwarded email (To + Cc + From)`);
    } else {
        // Normal BCC flow - add primary recipient (To) with name from header for fallback lookup
        if (leadEmail) {
            const toName = extractRecipientName(mailgunData);
            potentialLeads.push({ email: leadEmail, name: toName || '', source: 'to' });
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
    
    // Filter out client's own email addresses from potential leads
    const filteredLeads = potentialLeads.filter(p => {
        if (clientEmails.has(p.email.toLowerCase())) {
            logger.info(`Filtering out client's own email from potential leads: ${p.email}`);
            return false;
        }
        return true;
    });
    
    logger.info(`Processing ${filteredLeads.length} potential leads (after filtering client emails)`);
    
    
    if (filteredLeads.length === 0) {
        logger.info('No potential leads found after filtering - ignoring');
        return {
            success: false,
            error: 'no_recipients',
            message: 'No recipients found to process (all were client emails or tracking addresses)',
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
    
    for (const potential of filteredLeads) {
        let lead = await findLeadByEmail(client, potential.email);
        
        // Name-based fallback: when email lookup fails, try matching by name
        // Parse from top (headers) to bottom (body) - use header name first, then body
        if (!lead) {
            let nameToTry = potential.name && potential.name.trim().length >= 2
                ? potential.name.trim()
                : extractNameFromBodyForRecipient(bodyPlain, potential.email);
            if (nameToTry) {
                const nameSearch = await findLeadByName(client, nameToTry, null);
                if (nameSearch.matchType === 'unique' && nameSearch.lead) {
                    lead = nameSearch.lead;
                    logger.info(`Email lookup failed for ${potential.email}; matched by name "${nameToTry}" (unique match)`);
                }
            }
        }
        
        if (!lead) {
            logger.info(`${potential.source.toUpperCase()} recipient ${potential.email} is not a lead - skipping`);
            results.leadsNotFound.push({
                email: potential.email,
                name: potential.name || '',
                source: potential.source
            });
            continue;
        }
        
        // Update this lead with email content (serialized per lead to prevent race overwrites)
        try {
            const result = await withLeadLock(lead.id, () => updateLeadWithEmail(client, lead, {
                subject,
                bodyPlain,
                bodyHtml,
                timestamp,
                senderName
            }));
            
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
    results.totalProcessed = filteredLeads.length;
    results.totalUpdated = results.leadsUpdated.length;
    
    if (results.leadsUpdated.length === 0 && results.leadsNotFound.length === filteredLeads.length) {
        logger.info('No recipients were leads in the system - notifying client');
        results.ignored = true;
        await sendLeadNotFoundEmail(client.clientEmailAddress, results.leadsNotFound, client.clientFirstName || client.clientName);
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
    findLeadByName,
    updateLeadWithEmail,
    updateLeadWithMeetingNotes,
    sendErrorNotification,
    validateMailgunSignature,
    extractRecipientEmail,
    extractCcRecipients,
    isForwardedEmail,
    extractForwardedRecipients,
    // Meeting note-taker functions
    detectMeetingNotetaker,
    parseMeetingNotetakerEmail,
    processMeetingNotetakerEmail
};
