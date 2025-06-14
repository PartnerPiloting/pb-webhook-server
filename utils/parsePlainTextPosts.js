// utils/parsePlainTextPosts.js
// Utility to parse the Posts Plain Text field into structured post objects

/**
 * Parses a plain text field containing multiple posts into an array of post objects.
 * Each post is separated by a line with '---'.
 * Each post contains lines starting with 'Date:', 'URL:', 'AuthorURL:', and 'Content:'.
 * Handles multiline content and blank lines.
 * @param {string} plainText - The full plain text field from Airtable
 * @returns {Array<{postDate: string, postUrl: string, authorUrl: string, postContent: string}>}
 */
function parsePlainTextPosts(plainText) {
    if (!plainText || typeof plainText !== 'string') return [];
    return plainText
        .split(/\n---+\n/)
        .map(block => {
            const dateMatch = block.match(/^Date:\s*(.*)$/m);
            const urlMatch = block.match(/^URL:\s*(.*)$/m);
            const authorUrlMatch = block.match(/^AuthorURL:\s*(.*)$/m);
            // Content is everything after the first 'Content:' line
            const contentMatch = block.match(/^Content:\s*([\s\S]*)$/m);
            let postContent = '';
            if (contentMatch) {
                // Get everything after 'Content:'
                const idx = block.indexOf(contentMatch[0]);
                postContent = block.substring(idx + contentMatch[0].length).trim();
                // If contentMatch[1] already has the content, use it
                if (!postContent && contentMatch[1]) postContent = contentMatch[1].trim();
            }
            return {
                postDate: dateMatch ? dateMatch[1].trim() : '',
                postUrl: urlMatch ? urlMatch[1].trim() : '',
                authorUrl: authorUrlMatch ? authorUrlMatch[1].trim() : '',
                postContent
            };
        })
        .filter(post => post.postContent || post.postUrl || post.postDate);
}

module.exports = { parsePlainTextPosts };
