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

    // Lowercase prepositions/particles that are allowed inside a proper name
    const nameParticles = new Set(['de', 'van', 'le', 'la', 'von', 'der', 'den', 'da', 'di', 'du', 'el', 'al', 'bin', 'binte']);

    function looksLikeName(str) {
        const words = str.trim().split(/\s+/);
        // Must be 2–4 words (a real person name)
        if (words.length < 2 || words.length > 4) return false;
        // Every word must either start with uppercase OR be a known name particle
        return words.every(w => /^[A-Z]/.test(w) || nameParticles.has(w.toLowerCase()));
    }

    for (const item of items) {
        if (emailRegex.test(item)) {
            result.push({ email: item.toLowerCase().trim() });
        } else if (looksLikeName(item)) {
            result.push({ name: item });
        }
        // Otherwise skip — likely body text that accidentally matched the "add" pattern
    }

    return result;
}

module.exports = { parseAddToRecipients };
