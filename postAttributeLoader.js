// File: postAttributeLoader.js

/**
 * Fetches and structures the post scoring configuration from Airtable.
 * This includes general prompt components (from Table 2) and
 * specific scoring attributes (from Table 1).
 *
 * @param {object} base - The initialized Airtable base instance.
 * @param {object} config - The postAnalysisConfig object from index.js, containing table names.
 * @returns {Promise<object>} A promise that resolves to an object containing structured data.
 * e.g., { promptComponents: [...], attributesById: {...} }
 * @throws {Error} If fetching from Airtable fails or data is missing.
 */
async function loadPostScoringAirtableConfig(base, config) {
    if (!base) throw new Error("Airtable base instance is required.");
    if (!config || !config.attributesTableName || !config.promptComponentsTableName) {
        throw new Error("Airtable table names for attributes and prompt components are required in config.");
    }

    const tableNames = {
        attributes: config.attributesTableName,
        promptComponents: config.promptComponentsTableName
    };

    console.log(`PostAttributeLoader: Loading data from Airtable tables: Attributes ('${tableNames.attributes}'), PromptComponents ('${tableNames.promptComponents}')`);

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
                    exampleLow: record.get('Example - Low Score / Does Not Apply'),
                    active: record.get('Active') === true || record.get('Active') === null || record.get('Active') === undefined // Default to true if empty/null
                };
            }
        }

        if (Object.keys(attributesById).length === 0) {
            console.warn(`PostAttributeLoader: No scoring attributes found in table '${tableNames.attributes}'.`);
        }

        // --- 3. All configuration loaded ---
        // Note: Removed global keyword filtering to support true multi-tenancy
        // Each client's scoring attributes handle content relevance through their own keywords
        
        console.log(`PostAttributeLoader: Loaded ${promptComponents.length} prompt components and ${Object.keys(attributesById).length} scoring attributes.`);

        // Return all loaded configuration in one structured object
        return {
            promptComponents,
            attributesById
        };

    } catch (error) {
        console.error(`PostAttributeLoader: Error loading configuration from Airtable. Error: ${error.message}`, error.stack);
        throw new Error(`Failed to load post scoring configuration from Airtable: ${error.message}`);
    }
}

module.exports = {
    loadPostScoringAirtableConfig
};