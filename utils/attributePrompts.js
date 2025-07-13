// utils/attributePrompts.js
// Prompt building utilities for AI attribute editing

/**
 * Build OpenAI chat completion prompt for attribute editing
 * @param {Object} currentRubric - Current live rubric
 * @param {string} userText - User's natural language edit request
 * @returns {Array} Messages array for OpenAI chat completion
 */
function buildAttributeEditPrompt(currentRubric, userText) {
    const currentRubricText = JSON.stringify(currentRubric, null, 2);
    
    return [
        {
            role: 'system',
            content: `You are an Attribute-Rubric Assistant for LinkedIn lead scoring.

RULES:
• Always return VALID JSON with exactly these keys:
  heading, maxPoints, minToQualify, penalty, instructionsMarkdown
• maxPoints: 1-100 (integer)
• minToQualify: 0 to maxPoints (integer)  
• penalty: 0 for positive attributes, negative number for negative attributes
• instructionsMarkdown: Clear, concise scoring guidance (under 200 words)
• You may change ANY field including the heading if requested
• Do NOT add extra keys or fields
• Preserve the overall scoring logic unless specifically asked to change it

CURRENT_RUBRIC:
"""${currentRubricText}"""

USER_REQUEST:
"""${userText}"""

Respond only with the JSON object.`
        },
        { 
            role: 'user', 
            content: userText 
        }
    ];
}

/**
 * Validate AI-generated rubric draft
 * @param {any} draft - Parsed JSON from AI response
 * @throws {Error} If validation fails
 */
function validateRubricDraft(draft) {
    const required = ['heading', 'maxPoints', 'minToQualify', 'penalty', 'instructionsMarkdown'];
    
    // Check all required fields exist
    for (const key of required) {
        if (!(key in draft)) {
            throw new Error(`Missing required field: ${key}`);
        }
    }
    
    // Validate heading
    if (typeof draft.heading !== 'string' || draft.heading.trim().length === 0) {
        throw new Error('heading must be a non-empty string');
    }
    
    // Validate maxPoints
    if (typeof draft.maxPoints !== 'number' || draft.maxPoints < 1 || draft.maxPoints > 100) {
        throw new Error('maxPoints must be a number between 1 and 100');
    }
    
    // Validate minToQualify
    if (typeof draft.minToQualify !== 'number' || draft.minToQualify < 0 || draft.minToQualify > draft.maxPoints) {
        throw new Error('minToQualify must be a number between 0 and maxPoints');
    }
    
    // Validate penalty
    if (typeof draft.penalty !== 'number') {
        throw new Error('penalty must be a number');
    }
    
    // Validate instructionsMarkdown
    if (typeof draft.instructionsMarkdown !== 'string' || draft.instructionsMarkdown.trim().length === 0) {
        throw new Error('instructionsMarkdown must be a non-empty string');
    }
    
    // Check for extra fields
    const extraFields = Object.keys(draft).filter(key => !required.includes(key));
    if (extraFields.length > 0) {
        throw new Error(`Unexpected fields: ${extraFields.join(', ')}`);
    }
}

/**
 * Get predefined AI suggestion prompts
 * @returns {Array} Array of suggestion objects
 */
function getAISuggestions() {
    return [
        {
            id: 'add_examples',
            label: 'Add specific examples',
            prompt: 'Add 2-3 specific examples to the instructions to make the scoring criteria clearer'
        },
        {
            id: 'increase_points',
            label: 'Increase point range',
            prompt: 'Increase the maximum points to 20 and adjust the minimum accordingly'
        },
        {
            id: 'simplify_language',
            label: 'Simplify language',
            prompt: 'Rewrite the instructions using simpler, clearer language that is easier to understand'
        },
        {
            id: 'tighten_criteria',
            label: 'Tighten scoring criteria',
            prompt: 'Make the scoring criteria more specific and precise to reduce subjective interpretation'
        },
        {
            id: 'add_penalties',
            label: 'Add negative indicators',
            prompt: 'Add penalties for negative indicators that should reduce the score'
        }
    ];
}

module.exports = {
    buildAttributeEditPrompt,
    validateRubricDraft,
    getAISuggestions
};
