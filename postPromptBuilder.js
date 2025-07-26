// File: postPromptBuilder.js

// We import the function to load all necessary data from Airtable
const { loadPostScoringAirtableConfig } = require('./postAttributeLoader');

/**
 * Builds the complete system prompt string for Gemini to score LinkedIn posts.
 * It fetches prompt components and scoring attributes from Airtable via the loader.
 *
 * @param {object} base - The initialized Airtable base instance.
 * @param {object} config - The postAnalysisConfig object from index.js, containing table names.
 * @returns {Promise<string>} A promise that resolves to the fully constructed system prompt string.
 */
async function buildPostScoringPrompt(base, config) {
    // 1. Load the structured data (prompt components and attributes) from Airtable
    const { promptComponents, attributesById } = await loadPostScoringAirtableConfig(base, config);

    if (!promptComponents || promptComponents.length === 0) {
        throw new Error("PostPromptBuilder: Cannot build prompt. No prompt components were loaded from Airtable.");
    }
    if (!attributesById || Object.keys(attributesById).length === 0) {
        throw new Error("PostPromptBuilder: Cannot build prompt. No scoring attributes were loaded from Airtable.");
    }

    // 2. Assemble the prompt by iterating through the ordered components from Table 2
    let finalPrompt = "";
    promptComponents.forEach(component => {
        // Find the 'SCORING_HEADER' component. When we find it, we will insert
        // its text, followed by the entire detailed attribute breakdown.
        if (component.componentId === 'SCORING_HEADER') {
            finalPrompt += component.instructionText + "\n";
            finalPrompt += buildScoringRubricSection(attributesById); // Add the detailed rubric here
        }
        // The OUTPUT_JSON_STRUCTURE is just another component, so its text gets added in its sorted order.
        else {
            finalPrompt += component.instructionText + "\n\n";
        }
    });

    return finalPrompt.trim();
}

/**
 * (Internal helper function) Takes the loaded attributes and formats them into a
 * readable rubric string for the AI prompt.
 * @param {object} attributesById - The structured attributes object from the loader.
 * @returns {string} A formatted string containing all scoring attribute details.
 */
function buildScoringRubricSection(attributesById) {
    let rubricParts = [];
    rubricParts.push("================= SCORING ATTRIBUTES (Criteria & Details) =================");

    const positiveAttrs = [];
    const negativeAttrs = [];

    // Separate attributes into positive and negative categories for clarity
    // Only include ACTIVE attributes in the scoring rubric
    for (const attrId in attributesById) {
        const attr = attributesById[attrId];
        
        // Skip inactive attributes - they should not be included in AI scoring
        if (attr.active === false) {
            console.log(`PostPromptBuilder: Skipping inactive attribute '${attr.id}' from scoring rubric`);
            continue;
        }
        
        if (attr.Category === 'Positive Scoring Factor') {
            positiveAttrs.push(attr);
        } else if (attr.Category === 'Negative Scoring Factor') {
            negativeAttrs.push(attr);
        } else {
            // Add any other attributes to a default list if needed
            console.warn(`PostPromptBuilder: Attribute '${attr.id}' has an unhandled category: '${attr.Category}'.`);
            positiveAttrs.push(attr); // Defaulting to list under positives
        }
    }

    // Format the positive attributes section
    if (positiveAttrs.length > 0) {
        rubricParts.push("\n--- Positive Scoring Attributes ---");
        positiveAttrs.forEach(attr => {
            rubricParts.push(formatAttributeForPrompt(attr));
        });
    }

    // Format the negative attributes section
    if (negativeAttrs.length > 0) {
        rubricParts.push("\n--- Negative Scoring Attributes (Penalties) ---");
        negativeAttrs.forEach(attr => {
            rubricParts.push(formatAttributeForPrompt(attr));
        });
    }

    return rubricParts.join("\n");
}

/**
 * (Internal helper function) Formats a single attribute object into a detailed string.
 * @param {object} attr - A single attribute object.
 * @returns {string} A formatted string for one attribute.
 */
function formatAttributeForPrompt(attr) {
    // Using a template literal for clean, multi-line string formatting
    let attributeDetail = `
### Attribute ID: ${attr.id}
- **Criterion Name:** ${attr.criterionName || 'N/A'}
- **Scoring Type:** ${attr.scoringType || 'N/A'}
- **Max Score / Point Value:** ${attr.maxScorePointValue !== undefined ? attr.maxScorePointValue : 'N/A'}
- **Detailed Instructions:** ${attr.detailedInstructions || 'No specific instructions provided.'}`;

    // Conditionally add optional fields only if they have content
    if (attr.positiveKeywords) {
        attributeDetail += `\n- **Keywords/Positive Indicators:** ${attr.positiveKeywords}`;
    }
    if (attr.negativeKeywords) {
        attributeDetail += `\n- **Keywords/Negative Indicators:** ${attr.negativeKeywords}`;
    }
    if (attr.exampleHigh) {
        attributeDetail += `\n- **Example - High Score / Applies:** ${attr.exampleHigh}`;
    }
    if (attr.exampleLow) {
        attributeDetail += `\n- **Example - Low Score / Does Not Apply:** ${attr.exampleLow}`;
    }
    
    return attributeDetail;
}


module.exports = {
    buildPostScoringPrompt
};