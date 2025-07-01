// Enhanced JSON repair utility for PhantomBuster data issues
// Specifically handles unescaped quotes and other common corruption patterns

/**
 * Attempts to repair common JSON corruption patterns from PhantomBuster
 * @param {string} rawJson - The potentially corrupted JSON string
 * @returns {Object} - { success: boolean, data: any, method: string, error: string }
 */
function repairAndParseJson(rawJson) {
    const result = {
        success: false,
        data: null,
        method: '',
        error: ''
    };

    if (!rawJson || typeof rawJson !== 'string') {
        result.error = 'Invalid input: not a string';
        return result;
    }

    // Step 1: Try standard JSON.parse first
    try {
        result.data = JSON.parse(rawJson);
        result.success = true;
        result.method = 'CLEAN';
        return result;
    } catch (error) {
        result.error = error.message;
    }

    // Step 2: Basic cleaning
    let cleaned = rawJson
        .trim()
        .replace(/\u0000/g, '') // Remove null characters
        .replace(/\r\n/g, '\n') // Normalize line endings
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // Remove control characters

    try {
        result.data = JSON.parse(cleaned);
        result.success = true;
        result.method = 'CLEAN_PREPROCESSING';
        return result;
    } catch (error) {
        result.error = error.message;
    }

    // Step 3: Fix common quote escaping issues
    // This is the tricky part - we need to escape quotes inside string values
    // without breaking the JSON structure
    let quoteFixed = attemptQuoteRepair(cleaned);
    if (quoteFixed !== cleaned) {
        try {
            result.data = JSON.parse(quoteFixed);
            result.success = true;
            result.method = 'QUOTE_REPAIR';
            return result;
        } catch (error) {
            // Continue to dirty-json
        }
    }

    // Step 4: Try dirty-json
    try {
        const dirtyJSON = require('dirty-json');
        result.data = dirtyJSON.parse(cleaned);
        result.success = true;
        result.method = 'DIRTY_JSON';
        return result;
    } catch (error) {
        result.error = error.message;
    }

    // Step 5: Try dirty-json on quote-repaired version
    if (quoteFixed !== cleaned) {
        try {
            const dirtyJSON = require('dirty-json');
            result.data = dirtyJSON.parse(quoteFixed);
            result.success = true;
            result.method = 'DIRTY_JSON_QUOTE_REPAIR';
            return result;
        } catch (error) {
            result.error = error.message;
        }
    }

    // If we get here, the JSON is truly corrupted
    result.success = false;
    result.method = 'CORRUPTED';
    return result;
}

/**
 * Attempts to fix unescaped quotes in JSON string values
 * This is very tricky because we need to distinguish between:
 * - Structural quotes (part of JSON syntax)
 * - Content quotes (inside string values that should be escaped)
 */
function attemptQuoteRepair(jsonString) {
    // This is a simplified approach - in practice, this is very complex
    // We'll focus on the most common pattern: quotes inside postContent
    
    // Look for the pattern: "postContent": "content with "unescaped quotes" here"
    const postContentRegex = /"postContent"\s*:\s*"(.*?)"/gs;
    
    return jsonString.replace(postContentRegex, (match, content) => {
        // Escape any unescaped quotes in the content
        // But don't double-escape already escaped quotes
        const escapedContent = content.replace(/(?<!\\)"/g, '\\"');
        return `"postContent": "${escapedContent}"`;
    });
}

/**
 * Analyzes JSON string for specific corruption patterns
 * @param {string} jsonString - The JSON string to analyze
 * @returns {Object} - Analysis results
 */
function analyzeJsonCorruption(jsonString) {
    const analysis = {
        length: jsonString.length,
        issues: [],
        severity: 'CLEAN'
    };

    // Check for structural issues
    if (!jsonString.trim().startsWith('[') && !jsonString.trim().startsWith('{')) {
        analysis.issues.push('Missing opening bracket/brace');
        analysis.severity = 'CORRUPTED';
    }

    if (!jsonString.trim().endsWith(']') && !jsonString.trim().endsWith('}')) {
        analysis.issues.push('Missing closing bracket/brace');
        analysis.severity = 'CORRUPTED';
    }

    // Check bracket/brace balance
    const openBrackets = (jsonString.match(/\[/g) || []).length;
    const closeBrackets = (jsonString.match(/\]/g) || []).length;
    const openBraces = (jsonString.match(/\{/g) || []).length;
    const closeBraces = (jsonString.match(/\}/g) || []).length;

    if (openBrackets !== closeBrackets) {
        analysis.issues.push(`Unbalanced brackets: ${openBrackets} open, ${closeBrackets} close`);
        analysis.severity = 'CORRUPTED';
    }

    if (openBraces !== closeBraces) {
        analysis.issues.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
        analysis.severity = 'CORRUPTED';
    }

    // Check for unescaped quotes (simplified detection)
    const quotesTotal = (jsonString.match(/"/g) || []).length;
    if (quotesTotal % 2 !== 0) {
        analysis.issues.push('Odd number of quotes (likely unescaped)');
        if (analysis.severity === 'CLEAN') analysis.severity = 'DIRTY';
    }

    // Check for control characters
    if (/[\u0000-\u001F\u007F-\u009F]/.test(jsonString)) {
        analysis.issues.push('Contains control characters');
        if (analysis.severity === 'CLEAN') analysis.severity = 'DIRTY';
    }

    // Check for null characters
    if (/\u0000/.test(jsonString)) {
        analysis.issues.push('Contains null characters');
        if (analysis.severity === 'CLEAN') analysis.severity = 'DIRTY';
    }

    // Check for common unescaped quote patterns
    if (/"[^"]*"[^",}\]]*"[^"]*"/g.test(jsonString)) {
        analysis.issues.push('Likely unescaped quotes in string values');
        if (analysis.severity === 'CLEAN') analysis.severity = 'DIRTY';
    }

    return analysis;
}

module.exports = {
    repairAndParseJson,
    analyzeJsonCorruption,
    attemptQuoteRepair
};
