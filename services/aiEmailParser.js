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
const { VertexAI, HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');

// Use Gemini Flash for speed (email parsing doesn't need Pro)
const EMAIL_PARSER_MODEL = 'gemini-2.0-flash';
const PARSER_TIMEOUT_MS = 30000; // 30 second timeout

// Lazy-load Vertex AI client (only created when needed)
let vertexClient = null;

/**
 * Get or create the Vertex AI client
 */
function getVertexClient() {
    if (vertexClient) return vertexClient;
    
    const projectId = process.env.GCP_PROJECT_ID;
    const location = process.env.GCP_LOCATION || 'us-central1';
    
    if (!projectId) {
        throw new Error('GCP_PROJECT_ID environment variable not set');
    }
    
    vertexClient = new VertexAI({
        project: projectId,
        location: location
    });
    
    return vertexClient;
}

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
1. Extract ONLY the actual message content - remove signatures, disclaimers, and footers
2. Identify the sender name for each message (use first name + last name if available)
3. Extract the date and time for each message
4. For reply threads, separate each message in the conversation
5. Remove email headers, "On [date], [person] wrote:" lines, and forwarded message markers
6. Remove common signature indicators like:
   - Lines starting with "Sent from my iPhone/Android"
   - Confidentiality notices
   - Phone numbers at the end of messages
   - Job titles and company names in signature blocks
   - Social media links
   - "Best regards", "Cheers", "Thanks," followed by a name (keep the closing phrase, remove the signature block)

OUTPUT FORMAT:
Return a JSON array of message objects. Each message should have:
- "sender": The name of the person who sent the message (string)
- "timestamp": ISO 8601 date-time string (e.g., "2025-01-15T14:30:00Z")
- "message": The actual message content, cleaned of signatures (string)

Order messages chronologically (oldest first).

If you cannot determine a timestamp, use the reference date provided.
If you cannot determine a sender name, use "Unknown".

Example output:
[
  {
    "sender": "John Smith",
    "timestamp": "2025-01-14T09:15:00Z",
    "message": "Hi, just following up on our conversation about the project timeline."
  },
  {
    "sender": "Jane Doe",
    "timestamp": "2025-01-14T10:30:00Z",
    "message": "Thanks for reaching out! I'll have the proposal ready by Friday."
  }
]`;
}

/**
 * Parse email content using Gemini AI
 * 
 * @param {string} rawEmailText - The raw email text to parse
 * @param {string} clientFirstName - The client's first name (to identify "You" in messages)
 * @param {Date} referenceDate - Reference date for parsing relative dates
 * @returns {Promise<Array<{date: string, time: string, sender: string, message: string}>>}
 */
async function parseEmailWithAI(rawEmailText, clientFirstName = 'Me', referenceDate = new Date()) {
    if (!rawEmailText || typeof rawEmailText !== 'string' || rawEmailText.trim().length === 0) {
        return [];
    }

    try {
        const client = getVertexClient();
        const model = client.getGenerativeModel({
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
            throw new Error('Gemini API returned no content');
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
                throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
            }
        }

        if (!Array.isArray(parsedMessages)) {
            throw new Error('AI response is not an array');
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

        return messages;

    } catch (error) {
        // Log error but don't throw - caller can fall back to regex
        console.error('[AI Email Parser] Error:', error.message);
        return null; // Return null to signal failure (caller should fall back)
    }
}

/**
 * Check if AI parsing is available (credentials configured)
 */
function isAIParsingAvailable() {
    return !!(process.env.GCP_PROJECT_ID && process.env.GCP_LOCATION);
}

module.exports = {
    parseEmailWithAI,
    isAIParsingAvailable,
    formatDateDDMMYY,
    formatTime12Hour
};
