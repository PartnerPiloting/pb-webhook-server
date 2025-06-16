// File: postAttributeLoader.js

/**
 * Fetches and structures the post scoring configuration from Airtable.
 * This includes general prompt components (from Table 2) and
 * specific scoring attributes (from Table 1).
 *
 * @param {object} base - The initialized Airtable base instance.
 * @param {object} config - The postAnalysisConfig object from index.js, containing table names.
 * @returns {Promise<object>} A promise that resolves to an object containing structured data.
 * e.g., { promptComponents: [...], attributesById: {...}, aiKeywords: "..." }
 * @throws {Error} If fetching from Airtable fails or data is missing.
 */
async function loadPostScoringAirtableConfig(base, config) {
    if (!base) throw new Error("Airtable base instance is required.");
    if (!config || !config.attributesTableName || !config.promptComponentsTableName) {
        throw new Error("Airtable table names for attributes and prompt components are required in config.");
    }

    const tableNames = {
        attributes: config.attributesTableName,
        promptComponents: config.promptComponentsTableName,
        // You might have a dedicated 'credentials' or 'settings' table
        // For this example, let's assume the keywords are in a table named 'Global Settings'
        settings: config.settingsTableName || "Global Settings" // Using a configurable name with a default
    };

    console.log(`PostAttributeLoader: Loading data from Airtable tables: Attributes ('${tableNames.attributes}'), PromptComponents ('${tableNames.promptComponents}'), Settings ('${tableNames.settings}')`);

    try {
        // --- 1. Fetch General Prompt Components (from Table 2) ---
        const promptComponentRecords = await base(tableNames.promptComponents)
            .select({
                fields: ['Component ID', 'Instruction Text', 'Sort Order', 'Component Name'],
                sort: [{ field: 'Sort Order', direction: 'asc' }],
            })
            .all();

        const promptComponents = promptComponentRecords.map(record => ({
            componentId: record.get('Component ID'),
            componentName: record.get('Component Name'),
            instructionText: record.get('Instruction Text'),
            sortOrder: record.get('Sort Order')
        }));

        if (promptComponents.length === 0) {
            console.warn(`PostAttributeLoader: No prompt components found in table '${tableNames.promptComponents}'.`);
        }

        // --- 2. Fetch Scoring Attributes (from Table 1) ---
        const attributeRecords = await base(tableNames.attributes)
            .select()
            .all();

        const attributesById = {};
        for (const record of attributeRecords) {
            const attributeId = record.get('Attribute ID');
            if (attributeId) {
                attributesById[attributeId] = {
                    id: attributeId,
                    criterionName: record.get('Criterion Name'),
                    Category: record.get('Category'), // FIX: use exact field name and value
                    scoringType: record.get('Scoring Type'), // FIX: use exact field name and value
                    maxScorePointValue: record.get('Max Score / Point Value'),
                    detailedInstructions: record.get('Detailed Instructions for AI (Scoring Rubric)'),
                    positiveKeywords: record.get('Keywords/Positive Indicators'),
                    negativeKeywords: record.get('Keywords/Negative Indicators'),
                    exampleHigh: record.get('Example - High Score / Applies'),
                    exampleLow: record.get('Example - Low Score / Does Not Apply')
                };
            }
        }

        if (Object.keys(attributesById).length === 0) {
            console.warn(`PostAttributeLoader: No scoring attributes found in table '${tableNames.attributes}'.`);
        }

        // --- 3. Fetch AI Keywords (from your 'Global Settings' or 'Credentials' table) ---
        let aiKeywordsString = "";
        try {
            // This assumes there's only ONE record in your "Global Settings" table that holds all such settings.
            const settingsRecords = await base(tableNames.settings).select({ maxRecords: 1 }).firstPage();
            if (settingsRecords && settingsRecords.length > 0) {
                // Fetches the value from the 'Post Scoring AI Keywords' field you created.
                aiKeywordsString = settingsRecords[0].get('Post Scoring AI Keywords') || "";
            } else {
                 console.warn(`PostAttributeLoader: No record found in settings table '${tableNames.settings}' to load AI Keywords from.`);
            }
        } catch (settingsError) {
             console.error(`PostAttributeLoader: Could not fetch AI keywords from settings table '${tableNames.settings}'. Error: ${settingsError.message}. Will use fallback if available.`);
        }
        
        const aiKeywords = aiKeywordsString.split(',').map(k => k.trim()).filter(Boolean); // Parse the string into an array

        console.log(`PostAttributeLoader: Loaded ${promptComponents.length} prompt components, ${Object.keys(attributesById).length} scoring attributes, and ${aiKeywords.length} AI keywords.`);

        // Return all loaded configuration in one structured object
        return {
            promptComponents,
            attributesById,
            aiKeywords
        };

    } catch (error) {
        console.error(`PostAttributeLoader: Error loading configuration from Airtable. Error: ${error.message}`, error.stack);
        throw new Error(`Failed to load post scoring configuration from Airtable: ${error.message}`);
    }
}

module.exports = {
    loadPostScoringAirtableConfig
};