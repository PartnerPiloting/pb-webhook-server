// utils/parsePlainTextPosts.js
// Utility to parse the Posts Plain Text field into structured post objects

/**
 * Parses a plain text field containing multiple posts into an array of post objects.
 * Each post is separated by a line with '---'.
 * Each post contains lines starting with 'Date:', 'URL:', and 'Content:'.
 * @param {string} plainText - The full plain text field from Airtable
 * @returns {Array<{postDate: string, postUrl: string, postContent: string}>}
 */
function parsePlainTextPosts(plainText) {
    if (!plainText || typeof plainText !== 'string') return [];
    return plainText
        .split(/\n---+\n/)
        .map(block => {
            const dateMatch = block.match(/^Date:\s*(.*)$/m);
            const urlMatch = block.match(/^URL:\s*(.*)$/m);
            const contentMatch = block.match(/^Content:\s*([\s\S]*)$/m);
            return {
                postDate: dateMatch ? dateMatch[1].trim() : '',
                postUrl: urlMatch ? urlMatch[1].trim() : '',
                postContent: contentMatch ? contentMatch[1].trim() : ''
            };
        })
        .filter(post => post.postContent || post.postUrl || post.postDate);
}

module.exports = { parsePlainTextPosts };
