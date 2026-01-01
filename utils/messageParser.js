/**
 * Message Parser Utility
 * 
 * Parses raw LinkedIn and Sales Navigator conversation text into a standardized format.
 * Supports:
 * - AIBlaze pre-formatted output (already clean)
 * - Raw LinkedIn messaging copy-paste
 * - Raw Sales Navigator copy-paste
 * 
 * Output format: DD-MM-YY HH:MM AM/PM - Sender Name - Message content
 */

/**
 * Clean up LinkedIn/Sales Navigator noise from text
 * Removes common artifacts before parsing
 * @param {string} text - Raw text with potential noise
 * @returns {string} Cleaned text
 */
function cleanLinkedInNoise(text) {
    if (!text) return '';
    
    return text
        // Remove "View X's profileName LastName" patterns (name concatenated after profile)
        // Matches: "View Guy's profileGuy Wilson" or "View Jenny's profileJenny Yan"
        .replace(/View \w+[''''']s profile[A-Za-z ]+/gi, '')
        // Remove "Remove reaction" 
        .replace(/\s*Remove\s+reaction/gi, '')
        // Remove pronouns like (She/Her), (He/Him), (They/Them)
        .replace(/\s*\((?:She\/Her|He\/Him|They\/Them)\)/gi, '')
        // Remove "1st degree connection" markers
        .replace(/\s*·?\s*1st(?:\s+degree)?\s*(?:connection)?/gi, '')
        // Clean up multiple spaces (but not newlines)
        .replace(/[ \t]+/g, ' ')
        // Clean up lines that are just whitespace
        .replace(/^\s*$/gm, '')
        // Trim each line
        .split('\n').map(line => line.trim()).join('\n')
        // Remove excessive blank lines (more than 2 consecutive)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Detect the format of pasted text
 * @param {string} text - Raw pasted text
 * @returns {'aiblaze' | 'linkedin_raw' | 'salesnav_raw' | 'manual'} Format type
 */
function detectFormat(text) {
    if (!text || typeof text !== 'string') return 'manual';
    
    const trimmed = text.trim();
    
    // AIBlaze format: DD-MM-YY HH:MM AM/PM - Name - Message
    // Pattern: starts with date like "04-12-24 01:41 PM - "
    const aiblazePattern = /^\d{2}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\s*[AP]M\s*-\s*.+\s*-\s*.+/im;
    if (aiblazePattern.test(trimmed)) {
        return 'aiblaze';
    }
    
    // Raw LinkedIn: contains "sent the following message"
    if (trimmed.includes('sent the following message')) {
        return 'linkedin_raw';
    }
    
    // Raw Sales Navigator: contains patterns like "You  HH:MM" or "Name  HH:MM PM"
    // Also check for "Invited X to connect" pattern
    const salesNavPattern = /(You|[A-Z][a-z]+\s+[A-Z][a-z]+)\s+\d{1,2}:\d{2}\s*[AP]?M?/;
    if (salesNavPattern.test(trimmed) || trimmed.includes('Invited') && trimmed.includes('to connect')) {
        return 'salesnav_raw';
    }
    
    return 'manual';
}

/**
 * Parse date from various formats
 * @param {string} dateStr - Date string like "Dec 4, 2025", "Monday", "Nov 29"
 * @param {Date} referenceDate - Reference date for relative dates
 * @returns {Date} Parsed date
 */
function parseFlexibleDate(dateStr, referenceDate = new Date()) {
    if (!dateStr) return referenceDate;
    
    const trimmed = dateStr.trim();
    
    // Full date: "Dec 4, 2025" or "Nov 29"
    const monthDayYear = /^([A-Z][a-z]{2})\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i;
    const match = trimmed.match(monthDayYear);
    if (match) {
        const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
        const month = months[match[1].toLowerCase()];
        const day = parseInt(match[2], 10);
        const year = match[3] ? parseInt(match[3], 10) : referenceDate.getFullYear();
        return new Date(year, month, day);
    }
    
    // Relative days: "Monday", "Tuesday", etc.
    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayIndex = daysOfWeek.indexOf(trimmed.toLowerCase());
    if (dayIndex !== -1) {
        const today = new Date(referenceDate);
        const todayDay = today.getDay();
        let diff = todayDay - dayIndex;
        if (diff <= 0) diff += 7; // Go back to last occurrence
        const result = new Date(today);
        result.setDate(today.getDate() - diff);
        return result;
    }
    
    // "Today" or "Yesterday"
    if (trimmed.toLowerCase() === 'today') {
        return new Date(referenceDate);
    }
    if (trimmed.toLowerCase() === 'yesterday') {
        const result = new Date(referenceDate);
        result.setDate(result.getDate() - 1);
        return result;
    }
    
    return referenceDate;
}

/**
 * Format date to DD-MM-YY
 * @param {Date} date 
 * @returns {string}
 */
function formatDateDDMMYY(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
}

/**
 * Parse raw LinkedIn messaging text
 * @param {string} text - Raw LinkedIn copy-paste
 * @param {string} clientFirstName - Client's first name for "You" replacement
 * @param {Date} referenceDate - Reference date for relative dates
 * @returns {Array<{date: string, time: string, sender: string, message: string}>}
 */
function parseLinkedInRaw(text, clientFirstName = 'Me', referenceDate = new Date()) {
    // Pre-clean the text to remove LinkedIn artifacts
    const cleanedText = cleanLinkedInNoise(text);
    
    const messages = [];
    const lines = cleanedText.split('\n');
    
    let currentDate = referenceDate;
    let currentSender = null;
    let currentTime = null;
    let currentMessage = [];
    
    // Patterns
    const datePattern = /^([A-Z][a-z]{2}\s+\d{1,2}(?:,?\s*\d{4})?|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Today|Yesterday)$/i;
    const senderTimePattern = /^(.+?)\s+(\d{1,2}:\d{2}\s*[AP]M)$/i;
    const sentMessagePattern = /sent the following message/i;
    const viewProfilePattern = /^View .+'s profile/i;
    const linkPreviewPattern = /^[a-z0-9.-]+\.[a-z]{2,}$/i; // Domain names like share.synthesia.io
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Skip noise
        if (sentMessagePattern.test(line)) continue;
        if (viewProfilePattern.test(line)) continue;
        if (linkPreviewPattern.test(line) && !line.startsWith('http')) continue;
        if (line === '1st degree connection' || line.startsWith('· 1st')) continue;
        if (line.match(/^\(She\/Her\)$|^\(He\/Him\)$/i)) continue;
        
        // Check for date header
        if (datePattern.test(line)) {
            currentDate = parseFlexibleDate(line, referenceDate);
            continue;
        }
        
        // Check for sender + time line like "Guy Wilson   1:41 PM"
        const senderMatch = line.match(senderTimePattern);
        if (senderMatch) {
            // Save previous message if exists
            if (currentSender && currentMessage.length > 0) {
                const msgText = cleanLinkedInNoise(currentMessage.join(' ').trim());
                // Skip emoji-only messages
                if (msgText && !/^[\u{1F300}-\u{1F9FF}\s]+$/u.test(msgText)) {
                    messages.push({
                        date: formatDateDDMMYY(currentDate),
                        time: currentTime,
                        sender: currentSender,
                        message: msgText
                    });
                }
            }
            
            currentSender = senderMatch[1].trim();
            currentTime = senderMatch[2].trim();
            currentMessage = [];
            continue;
        }
        
        // Otherwise, it's part of the message content
        if (currentSender) {
            // Skip lines that are just profile headers or connection info
            if (line.length > 5 && !line.includes('degree connection')) {
                currentMessage.push(line);
            }
        }
    }
    
    // Don't forget the last message
    if (currentSender && currentMessage.length > 0) {
        const msgText = cleanLinkedInNoise(currentMessage.join(' ').trim());
        if (msgText && !/^[\u{1F300}-\u{1F9FF}\s]+$/u.test(msgText)) {
            messages.push({
                date: formatDateDDMMYY(currentDate),
                time: currentTime,
                sender: currentSender,
                message: msgText
            });
        }
    }
    
    return messages;
}

/**
 * Parse raw Sales Navigator messaging text
 * @param {string} text - Raw Sales Navigator copy-paste
 * @param {string} clientFirstName - Client's first name for "You" replacement
 * @param {Date} referenceDate - Reference date for relative dates
 * @returns {Array<{date: string, time: string, sender: string, message: string}>}
 */
function parseSalesNavRaw(text, clientFirstName = 'Me', referenceDate = new Date()) {
    // Pre-clean the text to remove LinkedIn artifacts
    const cleanedText = cleanLinkedInNoise(text);
    
    const messages = [];
    const lines = cleanedText.split('\n');
    
    let currentDate = referenceDate;
    let currentSender = null;
    let currentTime = null;
    let currentMessage = [];
    
    // Patterns - Sales Nav has slightly different format
    const datePattern = /^([A-Z][a-z]{2}\s+\d{1,2}(?:,?\s*\d{4})?)$/i;
    const senderTimePattern = /^(You|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(\d{1,2}:\d{2}\s*[AP]M)$/i;
    const invitePattern = /^Invited .+ to connect$/i;
    const noisePatterns = [
        /was last active/i,
        /^Minimize conversation/i,
        /^Close conversation/i,
        /^This is the very beginning/i
    ];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Skip noise
        if (noisePatterns.some(p => p.test(line))) continue;
        
        // Skip invite messages (or include them - decision: skip for cleaner output)
        if (invitePattern.test(line)) continue;
        
        // Check for date header
        if (datePattern.test(line)) {
            currentDate = parseFlexibleDate(line, referenceDate);
            continue;
        }
        
        // Check for sender + time like "You  12:54 PM" or "Jenny Yan  1:24 PM"
        const senderMatch = line.match(senderTimePattern);
        if (senderMatch) {
            // Save previous message if exists
            if (currentSender && currentMessage.length > 0) {
                const msgText = cleanLinkedInNoise(currentMessage.join(' ').trim());
                if (msgText) {
                    messages.push({
                        date: formatDateDDMMYY(currentDate),
                        time: currentTime,
                        sender: currentSender === 'You' ? clientFirstName : currentSender,
                        message: msgText
                    });
                }
            }
            
            currentSender = senderMatch[1].trim();
            currentTime = senderMatch[2].trim();
            currentMessage = [];
            continue;
        }
        
        // Otherwise, it's part of the message content
        if (currentSender) {
            currentMessage.push(line);
        }
    }
    
    // Don't forget the last message
    if (currentSender && currentMessage.length > 0) {
        const msgText = cleanLinkedInNoise(currentMessage.join(' ').trim());
        if (msgText) {
            messages.push({
                date: formatDateDDMMYY(currentDate),
                time: currentTime,
                sender: currentSender === 'You' ? clientFirstName : currentSender,
                message: msgText
            });
        }
    }
    
    return messages;
}

/**
 * Parse AIBlaze formatted text (already clean)
 * @param {string} text - AIBlaze formatted text
 * @returns {Array<{date: string, time: string, sender: string, message: string}>}
 */
function parseAIBlaze(text) {
    const messages = [];
    const lines = text.split('\n');
    
    // Pattern: DD-MM-YY HH:MM AM/PM - Name - Message
    const pattern = /^(\d{2}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(.+?)\s*-\s*(.+)$/i;
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        const match = trimmed.match(pattern);
        if (match) {
            // Clean noise from message content
            const cleanMessage = cleanLinkedInNoise(match[4].trim());
            messages.push({
                date: match[1],
                time: match[2].trim(),
                sender: match[3].trim(),
                message: cleanMessage
            });
        }
    }
    
    return messages;
}

/**
 * Format messages to standard output string
 * @param {Array<{date: string, time: string, sender: string, message: string}>} messages
 * @param {boolean} newestFirst - If true, reverse order to show newest first
 * @returns {string} Formatted conversation text
 */
function formatMessages(messages, newestFirst = true) {
    const sorted = newestFirst ? [...messages].reverse() : messages;
    
    return sorted.map(msg => {
        return `${msg.date} ${msg.time} - ${msg.sender} - ${msg.message}`;
    }).join('\n');
}

/**
 * Main parser function - auto-detects format and parses
 * @param {string} text - Raw or pre-formatted text
 * @param {Object} options - Parser options
 * @param {string} options.clientFirstName - Client's first name for "You" replacement
 * @param {Date} options.referenceDate - Reference date for relative dates
 * @param {boolean} options.newestFirst - Output with newest messages first
 * @returns {{ format: string, messages: Array, formatted: string }}
 */
function parseConversation(text, options = {}) {
    const {
        clientFirstName = 'Me',
        referenceDate = new Date(),
        newestFirst = true
    } = options;
    
    const format = detectFormat(text);
    let messages = [];
    
    switch (format) {
        case 'aiblaze':
            messages = parseAIBlaze(text);
            break;
        case 'linkedin_raw':
            messages = parseLinkedInRaw(text, clientFirstName, referenceDate);
            break;
        case 'salesnav_raw':
            messages = parseSalesNavRaw(text, clientFirstName, referenceDate);
            break;
        case 'manual':
        default:
            // For manual notes, just return as-is with timestamp
            return {
                format: 'manual',
                messages: [],
                formatted: text.trim()
            };
    }
    
    return {
        format,
        messages,
        formatted: formatMessages(messages, newestFirst),
        messageCount: messages.length
    };
}

module.exports = {
    detectFormat,
    parseConversation,
    parseLinkedInRaw,
    parseSalesNavRaw,
    parseAIBlaze,
    formatMessages,
    parseFlexibleDate,
    formatDateDDMMYY,
    cleanLinkedInNoise
};
