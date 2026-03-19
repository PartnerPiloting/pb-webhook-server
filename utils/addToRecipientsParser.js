/**
 * Parse "Add to:" recipients from email body or subject.
 * No dependencies - safe to require in tests.
 *
 * Supports: "Add to X", "add: X", "add X", "Add to: X" (colon optional, space after add optional)
 * Searches entire body - not just before forward marker (so Add to in Ask Fathom widget works).
 *
 * @param {string} body - Email body
 * @param {string} subject - Email subject
 * @returns {Array<{email?: string, name?: string}>} Recipients to add meeting notes to
 */
function parseAddToRecipients(body, subject = '') {
    const result = [];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // Match "add:", "add to:", "add X", "Add to X", "Also add to:", "Save to:", "For:" (case insensitive)
    // Require start of line (^ or \n) to avoid "add to" in "No add to in body"
    // Use \b to avoid matching "for" in "Forwarded message"
    const addToRegex = /(?:^|\n)\s*(?:add\s*(?:to\s*)?|also\s+add\s+to|save\s+to|for\s*:)\s*:?\s*([^\n\[\]]+)/gim;

    const extractAllLists = (text) => {
        if (!text || typeof text !== 'string') return [];
        const allItems = [];
        let match;
        while ((match = addToRegex.exec(text)) !== null) {
            const listStr = match[1].trim();
            const skipPhrases = ['the meeting', 'the notes', 'this', 'meeting', 'notes', 'remaining'];
            if (skipPhrases.some(p => listStr.toLowerCase() === p || listStr.toLowerCase().startsWith(p + ' '))) {
                continue;
            }
            const items = listStr.split(/\s*[,;]\s*|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
            allItems.push(...items);
        }
        return [...new Set(allItems)];
    };

    let items = body ? extractAllLists(body) : [];

    if (items.length === 0 && subject) {
        const subjectMatch = subject.match(/\[?\s*add\s*(?:to\s*:?\s*)?([^\]]+)\]?/i);
        if (subjectMatch) {
            const listStr = subjectMatch[1].trim();
            items = listStr.split(/\s*[,;]\s*|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
        }
    }

    for (const item of items) {
        if (emailRegex.test(item)) {
            result.push({ email: item.toLowerCase().trim() });
        } else if (item.length >= 2) {
            result.push({ name: item });
        }
    }

    return result;
}

module.exports = { parseAddToRecipients };
