/**
 * AI-Powered Email Parser Service
 * 
 * Uses Google Gemini to parse raw email content into structured messages.
 * Replaces fragile regex-based parsing with intelligent AI extraction.
 * 
 * Features:
 * - Handles Gmail, Outlook, and various email client formats
 * - Extracts sender, recipient, date/time, and message body
 * - Removes signatures and footer content automatically
 * - Returns same format as parseEmailRaw for drop-in compatibility
 */

require('dotenv').config();
const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');

// Use the existing Gemini client from config
const { vertexAIClient } = require('../config/geminiClient');

// Use Gemini Flash for speed (email parsing doesn't need Pro)
const EMAIL_PARSER_MODEL = 'gemini-2.0-flash';
const PARSER_TIMEOUT_MS = 30000; // 30 second timeout

/**
 * Format date as DD-MM-YY
 */
function formatDateDDMMYY(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
}

/**
 * Format time as HH:MM AM/PM
 */
function formatTime12Hour(date) {
    const d = new Date(date);
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // Handle midnight
    return `${hours}:${minutes} ${ampm}`;
}

/**
 * Build the system prompt for email parsing
 */
function buildEmailParserPrompt() {
    return `You are an expert email parser. Your task is to extract individual messages from a pasted email thread or single email.

CRITICAL RULES:
1. Extract ONLY the actual message content - AGGRESSIVELY remove signatures, disclaimers, and footers
2. Identify the sender name for each message (use first name + last name if available)
3. Extract the date and time for each message if present
4. For reply threads, separate each message in the conversation
5. Remove email headers, "On [date], [person] wrote:" lines, and forwarded message markers

SIGNATURE REMOVAL (VERY IMPORTANT):
The message should END at the LAST sentence of actual content. Remove EVERYTHING after that:
- Remove closing phrases WITH the name: "Cheers", "Best regards", "Thanks", "Kind regards", "Best", "Regards", "Warmly" etc.
- These closing phrases are NOT part of the message - they are signatures
- Remove names that appear after closing phrases (this is the sender signing off)
- Remove "Sent from my iPhone/Android"
- Remove confidentiality notices
- Remove phone numbers at the end
- Remove job titles and company names
- Remove social media links
- Remove any text in parentheses after names like "(I know a) Guy" or "(mobile)"

EXAMPLE - What to extract:
Input: "Hi Michelle, Great speaking with you. Look forward to meeting Monday. Cheers (I know a) Guy"
Output message: "Hi Michelle, Great speaking with you. Look forward to meeting Monday."
(Note: "Cheers (I know a) Guy" is the signature - REMOVE IT)

OUTPUT FORMAT:
Return a JSON array of message objects. Each message should have:
- "sender": The name of the person who sent the message (string)
- "timestamp": ISO 8601 date-time string (e.g., "2025-01-15T14:30:00Z") - use reference date if not found in email
- "message": The actual message content, with signature COMPLETELY REMOVED (string)

Order messages chronologically (oldest first).

If you cannot determine a sender name, look for it in the signature (before you remove it).
The sender is usually the name after "Cheers", "Thanks", "Best regards" etc.

Example output:
[
  {
    "sender": "Guy Wilson",
    "timestamp": "2025-01-14T09:15:00Z",
    "message": "Hi Michelle, Great speaking with you. Look forward to meeting Monday."
  }
]`;
}

/**
 * Parse email content using Gemini AI
 * 
 * @param {string} rawEmailText - The raw email text to parse
 * @param {string} clientFirstName - The client's first name (to identify "You" in messages)
 * @param {Date} referenceDate - Reference date for parsing relative dates
 * @returns {Promise<{messages: Array<{date: string, time: string, sender: string, message: string}>, error: string|null}>}
 */
async function parseEmailWithAI(rawEmailText, clientFirstName = 'Me', referenceDate = new Date()) {
    if (!rawEmailText || typeof rawEmailText !== 'string' || rawEmailText.trim().length === 0) {
        return { messages: [], error: null };
    }

    // Check if Gemini client is available
    if (!vertexAIClient) {
        return { messages: null, error: 'AI service not configured' };
    }

    try {
        const model = vertexAIClient.getGenerativeModel({
            model: EMAIL_PARSER_MODEL,
            systemInstruction: { parts: [{ text: buildEmailParserPrompt() }] },
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
            generationConfig: {
                temperature: 0, // Deterministic parsing
                responseMimeType: 'application/json',
                maxOutputTokens: 4096
            }
        });

        const userPrompt = `Parse the following email content. The current reference date is ${referenceDate.toISOString()}.

EMAIL CONTENT:
${rawEmailText}`;

        const requestPayload = {
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
        };

        // Race between API call and timeout
        const callPromise = model.generateContent(requestPayload);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('AI email parsing timed out')), PARSER_TIMEOUT_MS);
        });

        const result = await Promise.race([callPromise, timeoutPromise]);

        if (!result || !result.response) {
            throw new Error('Gemini API returned no response');
        }

        const candidate = result.response.candidates?.[0];
        if (!candidate?.content?.parts?.[0]?.text) {
            return { messages: null, error: 'AI returned no content' };
        }

        const responseText = candidate.content.parts[0].text;
        
        // Parse the JSON response
        let parsedMessages;
        try {
            parsedMessages = JSON.parse(responseText);
        } catch (parseError) {
            // Try to extract JSON from response (in case of markdown wrapping)
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                parsedMessages = JSON.parse(jsonMatch[0]);
            } else {
                return { messages: null, error: `Failed to parse AI response: ${parseError.message}` };
            }
        }

        if (!Array.isArray(parsedMessages)) {
            return { messages: null, error: 'AI response format invalid' };
        }

        // Convert AI format to internal format
        const messages = parsedMessages.map(msg => {
            // Parse the timestamp
            let messageDate = referenceDate;
            if (msg.timestamp) {
                try {
                    messageDate = new Date(msg.timestamp);
                    if (isNaN(messageDate.getTime())) {
                        messageDate = referenceDate;
                    }
                } catch {
                    messageDate = referenceDate;
                }
            }

            // Replace sender name with clientFirstName if it's a "You" equivalent
            let sender = msg.sender || 'Unknown';
            const youPatterns = ['me', 'you', 'myself', clientFirstName.toLowerCase()];
            if (youPatterns.includes(sender.toLowerCase())) {
                sender = clientFirstName;
            }

            return {
                date: formatDateDDMMYY(messageDate),
                time: formatTime12Hour(messageDate),
                sender: sender,
                message: (msg.message || '').trim()
            };
        }).filter(msg => msg.message.length > 0);

        return { messages, error: null };

    } catch (error) {
        // Log error and return it - caller can fall back to regex
        console.error('[AI Email Parser] Error:', error.message);
        return { messages: null, error: error.message };
    }
}

/**
 * Check if AI parsing is available (Gemini client initialized)
 */
function isAIParsingAvailable() {
    return !!vertexAIClient;
}

module.exports = {
    parseEmailWithAI,
    isAIParsingAvailable,
    formatDateDDMMYY,
    formatTime12Hour
};
