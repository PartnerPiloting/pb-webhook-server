// utils/airtableUtils.js
const base = require('../config/airtableClient');

/**
 * Fetches a single record from an Airtable table by its record ID.
 * @param {string} tableName - The name of the table.
 * @param {string} recordId - The ID of the record to fetch.
 * @returns {Promise<object|null>} The Airtable record object or null if not found.
 */
async function getAirtableRecord(tableName, recordId) {
    if (!base) {
        console.error("airtableUtils.js: Airtable base is not initialized.");
        throw new Error("Airtable connection not available.");
    }
    if (!tableName || !recordId) {
        console.error("airtableUtils.js: Table name and record ID are required.");
        return null;
    }

    try {
        const record = await base(tableName).find(recordId);
        return record.fields;
    } catch (error) {
        console.error(`airtableUtils.js: Error fetching record ${recordId} from table ${tableName}:`, error);
        return null;
    }
}

module.exports = {
    getAirtableRecord,
};
