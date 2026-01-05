/**
 * Message Parser Utility
 * 
 * Parses raw LinkedIn and Sales Navigator conversation text into a standardized format.
 * Supports:
 * - AIBlaze pre-formatted output (already clean)
 * - Raw LinkedIn messaging copy-paste
 * - Raw Sales Navigator copy-paste
 * - Email threads (AI-powered with regex fallback)
 * 
 * Output format: DD-MM-YY HH:MM AM/PM - Sender Name - Message content
 */

// AI-powered email parsing (uses Gemini Flash for speed)
const { parseEmailWithAI, isAIParsingAvailable } = require('../services/aiEmailParser');

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
        // Uses \S to match any non-whitespace for apostrophe (covers all Unicode variants)
        .replace(/View \w+\Ss profile[A-Za-z ]+/gi, '')
        // Remove "Remove reaction" 
        .replace(/\s*Remove\s+reaction/gi, '')
        // Remove pronouns like (She/Her), (He/Him), (They/Them)
        .replace(/\s*\((?:She\/Her|He\/Him|They\/Them)\)/gi, '')
        // Remove "1st degree connection" markers
        .replace(/\s*·?\s*1st(?:\s+degree)?\s*(?:connection)?/gi, '')
        // Remove UI labels that might get copied
        .replace(/^Current Notes\s*$/gim, '')
        // Remove LinkedIn message compose UI elements that get copied
        .replace(/Maximize compose field/gi, '')
        .replace(/Attach an? (?:image|file) to your conversation with .+?(?=\s*(?:Attach|Open|$))/gi, '')
        .replace(/Open (?:GIF|Emoji) Keyboard/gi, '')
        .replace(/Open send options/gi, '')
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
    
    // Email format: Various patterns
    // Pattern 1: "Name <email>" header format
    // Pattern 2: "to me" (Gmail indicator)
    // Pattern 3: Reply header "On Date, Name wrote:"
    // Pattern 4: "From: Name" / "To: Name" / "Date:" headers (Gmail paste)
    const emailHeaderPattern = /^[A-Za-z\s]+<[^>]+@[^>]+>/m;
    const gmailToMePattern = /^to\s+(me|[A-Za-z\s,]+)$/m;
    const replyHeaderPattern = /^On\s+.+wrote:$/m;
    const fromToPattern = /^From:\s*.+$/m;
    const hasDateHeader = /^Date:\s*.+$/m;
    if (emailHeaderPattern.test(trimmed) || 
        (gmailToMePattern.test(trimmed) && trimmed.includes('@')) ||
        replyHeaderPattern.test(trimmed) ||
        (fromToPattern.test(trimmed) && hasDateHeader.test(trimmed))) {
        return 'email_raw';
    }
    
    return 'manual';
}

/**
 * Parse date from various formats
 * @param {string} dateStr - Date string like "Dec 4, 2025", "Monday", "Nov 29", "2 Jan"
 * @param {Date} referenceDate - Reference date for relative dates
 * @returns {Date} Parsed date
 */
function parseFlexibleDate(dateStr, referenceDate = new Date()) {
    if (!dateStr) return referenceDate;
    
    const trimmed = dateStr.trim();
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    
    // Full date (month first): "Dec 4, 2025" or "Nov 29"
    const monthDayYear = /^([A-Z][a-z]{2})\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i;
    const match = trimmed.match(monthDayYear);
    if (match) {
        const month = months[match[1].toLowerCase()];
        const day = parseInt(match[2], 10);
        const year = match[3] ? parseInt(match[3], 10) : referenceDate.getFullYear();
        return new Date(year, month, day);
    }
    
    // Full date (day first - Gmail format): "2 Jan" or "2 Jan 2026"
    const dayMonthYear = /^(\d{1,2})\s+([A-Z][a-z]{2})(?:,?\s*(\d{4}))?$/i;
    const match2 = trimmed.match(dayMonthYear);
    if (match2) {
        const day = parseInt(match2[1], 10);
        const month = months[match2[2].toLowerCase()];
        const year = match2[3] ? parseInt(match2[3], 10) : referenceDate.getFullYear();
        return new Date(year, month, day);
    }
    
    // Relative days: "Monday", "Tuesday", etc.
    // LinkedIn shows day names for the current week, so "Friday" when today is Saturday means yesterday
    // And "Saturday" when today is Saturday means today (not last week)
    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayIndex = daysOfWeek.indexOf(trimmed.toLowerCase());
    if (dayIndex !== -1) {
        const today = new Date(referenceDate);
        const todayDay = today.getDay();
        let diff = todayDay - dayIndex;
        // Only go back if it's a past day this week (diff > 0)
        // If diff <= 0, it would be in the future, so go back to last week
        // BUT if diff == 0, it means today - keep it as today
        if (diff < 0) diff += 7; // Go back to last occurrence (e.g., "Monday" when today is Sunday)
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
        // IMPORTANT: Save pending message BEFORE updating date, otherwise the message
        // gets assigned to the wrong date when date changes mid-conversation
        if (datePattern.test(line)) {
            // Save any pending message with the CURRENT date before changing it
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
                currentMessage = [];
            }
            currentDate = parseFlexibleDate(line, referenceDate);
            continue;
        }
        
        // Check for sender + time line like "Guy Wilson   1:41 PM"
        const senderMatch = line.match(senderTimePattern);
        if (senderMatch) {
            const potentialSender = senderMatch[1].trim();
            
            // Skip false positives: lines starting with bullet points, hyphens, or numbers
            // These are likely list items in message content, not sender names
            // e.g., "- Monday, Jan 12 at 10:30 AM" or "• Wednesday at 2:00 PM"
            if (/^[-•*\d]/.test(potentialSender)) {
                // This is message content, not a sender line
                if (currentSender) {
                    currentMessage.push(line);
                }
                continue;
            }
            
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
            
            currentSender = potentialSender;
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
 * Parse raw email text (from Gmail copy-paste)
 * Handles formats like:
 *   "Name <email@domain.com>
 *    3 Jan 2026, 00:00 (1 day ago)
 *    to me
 *    
 *    Message body..."
 * 
 * Also handles today's emails:
 *   "Name <email@domain.com>
 *    06:25 (3 minutes ago)
 *    to Ben
 *    
 *    Message body..."
 * 
 * Also handles day-of-week format:
 *   "Name <email@domain.com>
 *    Fri 2 Jan, 14:26 (3 days ago)
 *    to me
 *    ..."
 * 
 * @param {string} text - Raw email copy-paste
 * @param {string} clientFirstName - Client's first name for "Me" replacement
 * @param {Date} referenceDate - Reference date for relative dates
 * @returns {Array<{date: string, time: string, sender: string, message: string}>}
 */
function parseEmailRaw(text, clientFirstName = 'Me', referenceDate = new Date()) {
    const messages = [];
    const lines = text.split('\n');
    
    // Email header pattern: "Name <email@domain.com>"
    const emailHeaderPattern = /^([A-Za-z\s]+)\s*<([^>]+@[^>]+)>/;
    // Gmail From header: "From: Name" or "From: Name <email>"
    const fromHeaderPattern = /^From:\s*([^<\n]+?)(?:\s*<[^>]+>)?\s*$/i;
    // Gmail To header: "To: Name" or "To: Name <email>"
    const toHeaderPattern = /^To:\s*.+$/i;
    // Gmail Date header: "Date: HH:MM (X hours ago)" or "Date: 02 December 2025 16:21"
    const dateHeaderPattern = /^Date:\s*(.+)$/i;
    // Full date pattern: "3 Jan 2026, 00:00" or "3 Jan 2026, 00:00 (1 day ago)"
    const fullDatePattern = /^(\d{1,2}\s+[A-Za-z]+\s+\d{4}),?\s*(\d{1,2}:\d{2})/;
    // Day-of-week date pattern: "Fri 2 Jan, 14:26" or "Fri 2 Jan, 14:26 (3 days ago)" (no year)
    const dayOfWeekDatePattern = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2}\s+[A-Za-z]+),?\s*(\d{1,2}:\d{2})/i;
    // Time-only pattern for today's emails: "06:25" or "06:25 (3 minutes ago)" or "09:42 (11 hours ago)"
    const timeOnlyPattern = /^(\d{1,2}:\d{2})(?:\s*\(.+\))?$/;
    // "to me" or "to Name Name, ..."
    const toPattern = /^to\s+/i;
    // Reply header: "On Mon, Jan 3, 2026 at 12:00 PM Name <email> wrote:"
    const replyHeaderPattern = /^On\s+.+wrote:\s*$/i;
    // Subject line
    const subjectPattern = /^Subject:\s*.+$/i;
    // Sent header (for forwarded/replied emails): "From: Name" or "Sent: Date"
    const sentHeaderPattern = /^Sent:\s*(.+)$/i;
    
    let currentSender = null;
    let currentDate = null;
    let currentTime = '12:00 PM';
    let currentMessage = [];
    let inBody = false;
    let skipUntilNextEmail = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines unless we're in message body
        if (!line && !inBody) continue;
        
        // Check for "---" separator (email signature or thread separator)
        if (line === '---') {
            // Save current message before the separator
            if (currentSender && currentMessage.length > 0) {
                const msgText = currentMessage.join(' ').trim();
                if (msgText) {
                    messages.push({
                        date: currentDate || formatDateDDMMYY(referenceDate),
                        time: currentTime,
                        sender: currentSender,
                        message: msgText
                    });
                }
                currentMessage = [];
            }
            skipUntilNextEmail = true;
            inBody = false;
            continue;
        }
        
        // Check for "From: Name" header (Gmail format)
        const fromMatch = line.match(fromHeaderPattern);
        if (fromMatch) {
            // Save previous message if exists
            if (currentSender && currentMessage.length > 0) {
                const msgText = currentMessage.join(' ').trim();
                if (msgText) {
                    messages.push({
                        date: currentDate || formatDateDDMMYY(referenceDate),
                        time: currentTime,
                        sender: currentSender,
                        message: msgText
                    });
                }
            }
            
            currentSender = fromMatch[1].trim();
            currentDate = null;
            currentTime = '12:00 PM';
            currentMessage = [];
            inBody = false;
            skipUntilNextEmail = false;
            continue;
        }
        
        // Check for email header "Name <email>"
        const headerMatch = line.match(emailHeaderPattern);
        if (headerMatch) {
            // Save previous message if exists
            if (currentSender && currentMessage.length > 0) {
                const msgText = currentMessage.join(' ').trim();
                if (msgText) {
                    messages.push({
                        date: currentDate || formatDateDDMMYY(referenceDate),
                        time: currentTime,
                        sender: currentSender,
                        message: msgText
                    });
                }
            }
            
            currentSender = headerMatch[1].trim();
            currentDate = null;
            currentTime = '12:00 PM';
            currentMessage = [];
            inBody = false;
            skipUntilNextEmail = false;
            continue;
        }
        
        // Skip if we're past a separator waiting for next email
        if (skipUntilNextEmail) continue;
        
        // Check for Date header: "Date: 09:42 (11 hours ago)" or "Date: 02 December 2025 16:21"
        const dateHeaderMatch = line.match(dateHeaderPattern);
        if (dateHeaderMatch && currentSender && !currentDate) {
            const dateValue = dateHeaderMatch[1].trim();
            
            // Check for time-only format: "09:42 (11 hours ago)"
            const timeMatch = dateValue.match(/^(\d{1,2}):(\d{2})/);
            if (timeMatch) {
                currentDate = formatDateDDMMYY(referenceDate);
                const hours = parseInt(timeMatch[1], 10);
                const minutes = timeMatch[2];
                const ampm = hours >= 12 ? 'PM' : 'AM';
                const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
                currentTime = `${hours12}:${minutes} ${ampm}`;
            } else {
                // Try to parse full date: "02 December 2025 16:21"
                const fullMatch = dateValue.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:,?\s*(\d{1,2}):(\d{2}))?/);
                if (fullMatch) {
                    const months = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, 
                                     may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, 
                                     sep: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
                    const month = months[fullMatch[2].toLowerCase()];
                    if (month !== undefined) {
                        const parsedDate = new Date(parseInt(fullMatch[3]), month, parseInt(fullMatch[1]));
                        currentDate = formatDateDDMMYY(parsedDate);
                        if (fullMatch[4] && fullMatch[5]) {
                            const hours = parseInt(fullMatch[4], 10);
                            const minutes = fullMatch[5];
                            const ampm = hours >= 12 ? 'PM' : 'AM';
                            const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
                            currentTime = `${hours12}:${minutes} ${ampm}`;
                        }
                    }
                }
            }
            continue;
        }
        
        // Handle Sent header for date extraction: "Sent: 02 December 2025 16:21"
        const sentMatch = line.match(sentHeaderPattern);
        if (sentMatch && currentSender && !currentDate) {
            const sentValue = sentMatch[1].trim();
            // Parse "02 December 2025 16:21" format
            const fullMatch = sentValue.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
            if (fullMatch) {
                const months = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, 
                                 may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, 
                                 sep: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
                const month = months[fullMatch[2].toLowerCase()];
                if (month !== undefined) {
                    const parsedDate = new Date(parseInt(fullMatch[3]), month, parseInt(fullMatch[1]));
                    currentDate = formatDateDDMMYY(parsedDate);
                    if (fullMatch[4] && fullMatch[5]) {
                        const hours = parseInt(fullMatch[4], 10);
                        const minutes = fullMatch[5];
                        const ampm = hours >= 12 ? 'PM' : 'AM';
                        const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
                        currentTime = `${hours12}:${minutes} ${ampm}`;
                    }
                }
            }
            continue;
        }
        
        // Skip To and Subject headers, but mark body start
        if (toHeaderPattern.test(line) || subjectPattern.test(line)) {
            // After To: or Subject:, the body usually starts (next non-empty line)
            inBody = true;
            continue;
        }
        
        // Check for full date line: "3 Jan 2026, 00:00"
        const fullDateMatch = line.match(fullDatePattern);
        if (fullDateMatch && currentSender && !currentDate) {
            const parsedDate = parseFlexibleDate(fullDateMatch[1], referenceDate);
            currentDate = formatDateDDMMYY(parsedDate);
            // Extract time and format to AM/PM
            const timeParts = fullDateMatch[2].split(':');
            const hours = parseInt(timeParts[0], 10);
            const minutes = timeParts[1];
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
            currentTime = `${hours12}:${minutes} ${ampm}`;
            continue;
        }
        
        // Check for day-of-week date line: "Fri 2 Jan, 14:26 (3 days ago)"
        const dayOfWeekMatch = line.match(dayOfWeekDatePattern);
        if (dayOfWeekMatch && currentSender && !currentDate) {
            // Parse date without year (assumes current year)
            const parsedDate = parseFlexibleDate(dayOfWeekMatch[1], referenceDate);
            currentDate = formatDateDDMMYY(parsedDate);
            // Extract time and format to AM/PM
            const timeParts = dayOfWeekMatch[2].split(':');
            const hours = parseInt(timeParts[0], 10);
            const minutes = timeParts[1];
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
            currentTime = `${hours12}:${minutes} ${ampm}`;
            continue;
        }
        
        // Check for time-only line (today's emails): "06:25" or "06:25 (3 minutes ago)"
        const timeOnlyMatch = line.match(timeOnlyPattern);
        if (timeOnlyMatch && currentSender && !currentDate) {
            // Time-only means today
            currentDate = formatDateDDMMYY(referenceDate);
            // Extract time and format to AM/PM
            const timeParts = timeOnlyMatch[1].split(':');
            const hours = parseInt(timeParts[0], 10);
            const minutes = timeParts[1];
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
            currentTime = `${hours12}:${minutes} ${ampm}`;
            continue;
        }
        
        // Check for "to me" line - marks start of body on next line
        if (toPattern.test(line) && currentSender && !inBody) {
            inBody = true;
            continue;
        }
        
        // Check for reply header "On Date, Name wrote:"
        if (replyHeaderPattern.test(line)) {
            // This indicates quoted reply - save current message and look for quoted content
            if (currentSender && currentMessage.length > 0) {
                const msgText = currentMessage.join(' ').trim();
                if (msgText) {
                    messages.push({
                        date: currentDate || formatDateDDMMYY(referenceDate),
                        time: currentTime,
                        sender: currentSender,
                        message: msgText
                    });
                }
            }
            
            // Parse the reply header to extract sender of quoted message
            const replyMatch = line.match(/On\s+(.+?),\s+([A-Za-z\s]+)\s*<([^>]+)>\s*wrote:/i);
            if (replyMatch) {
                currentSender = replyMatch[2].trim();
                const parsedDate = parseFlexibleDate(replyMatch[1], referenceDate);
                currentDate = formatDateDDMMYY(parsedDate);
                currentTime = '12:00 PM';
            }
            currentMessage = [];
            inBody = true;
            continue;
        }
        
        // Skip quoted lines (starting with >)
        if (line.startsWith('>')) {
            continue;
        }
        
        // If we're in the body, collect message content
        if (inBody && currentSender) {
            // Stop at signature closings
            const closingPattern = /^(regards|best regards|cheers|thanks|thank you|kind regards|best|sincerely|talk soon),?\s*$/i;
            if (closingPattern.test(line)) {
                // Include the closing line but stop after
                currentMessage.push(line);
                // Save the message now
                const msgText = currentMessage.join(' ').trim();
                if (msgText) {
                    messages.push({
                        date: currentDate || formatDateDDMMYY(referenceDate),
                        time: currentTime,
                        sender: currentSender,
                        message: msgText
                    });
                }
                currentMessage = [];
                currentSender = null;
                currentDate = null;
                inBody = false;
                continue;
            }
            
            // Skip email signature markers and disclaimers
            if (line === '--' || 
                line.toLowerCase().startsWith('this email and any attachments') ||
                line.toLowerCase().startsWith('although precautions')) {
                continue;
            }
            
            // Skip signature-like lines (phone numbers, URLs, single-word titles)
            const signaturePattern = /^(\+?\d[\d\s\-]{8,}|www\..+|https?:\/\/.+|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|founder|cto|ceo|director|manager|president|vp)$/i;
            if (signaturePattern.test(line)) {
                continue;
            }
            
            // Skip lines that are just a name (likely part of signature)
            if (currentMessage.length > 0 && /^[A-Z][a-z]+(\s+[A-Z][a-z]+)?$/.test(line)) {
                // Could be signature name, check if next lines look like signature
                continue;
            }
            
            currentMessage.push(line);
        }
    }
    
    // Don't forget the last message
    if (currentSender && currentMessage.length > 0) {
        const msgText = currentMessage.join(' ').trim();
        if (msgText) {
            messages.push({
                date: currentDate || formatDateDDMMYY(referenceDate),
                time: currentTime,
                sender: currentSender,
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
 * Now async to support AI-powered email parsing
 * @param {string} text - Raw or pre-formatted text
 * @param {Object} options - Parser options
 * @param {string} options.clientFirstName - Client's first name for "You" replacement
 * @param {Date} options.referenceDate - Reference date for relative dates
 * @param {boolean} options.newestFirst - Output with newest messages first
 * @param {boolean} options.useAI - Use AI for email parsing (default true if available)
 * @returns {Promise<{ format: string, messages: Array, formatted: string, usedAI: boolean, aiError: string|null }>}
 */
async function parseConversation(text, options = {}) {
    const {
        clientFirstName = 'Me',
        referenceDate = new Date(),
        newestFirst = true,
        useAI = true
    } = options;
    
    const format = detectFormat(text);
    let messages = [];
    let usedAI = false;
    let aiError = null;
    
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
        case 'email_raw':
            // Try AI parsing first if available and enabled
            if (useAI && isAIParsingAvailable()) {
                const aiResult = await parseEmailWithAI(text, clientFirstName, referenceDate);
                if (aiResult.messages && aiResult.messages.length > 0) {
                    messages = aiResult.messages;
                    usedAI = true;
                } else {
                    // AI returned empty/null, fall back to regex
                    aiError = aiResult.error || 'AI returned no messages';
                    console.log('[MessageParser] AI parsing failed, falling back to regex:', aiError);
                    messages = parseEmailRaw(text, clientFirstName, referenceDate);
                }
            } else {
                // AI not available, use regex
                if (!isAIParsingAvailable()) {
                    aiError = 'AI service not available';
                }
                messages = parseEmailRaw(text, clientFirstName, referenceDate);
            }
            break;
        case 'manual':
        default:
            // For manual notes, just return as-is with timestamp
            return {
                format: 'manual',
                messages: [],
                formatted: text.trim(),
                usedAI: false,
                aiError: null
            };
    }
    
    // Apply final cleanup to catch any noise that slipped through parsing
    const formatted = cleanLinkedInNoise(formatMessages(messages, newestFirst));
    
    return {
        format: usedAI ? 'email_ai' : format,
        messages,
        formatted,
        messageCount: messages.length,
        usedAI,
        aiError
    };
}

module.exports = {
    detectFormat,
    parseConversation,
    parseLinkedInRaw,
    parseSalesNavRaw,
    parseEmailRaw,
    parseAIBlaze,
    formatMessages,
    parseFlexibleDate,
    formatDateDDMMYY,
    cleanLinkedInNoise
};
