// repairSingleBadJsonRecord.js
const { createLogger } = require('./utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'api' });

// Repairs a single Airtable record's Posts Content field using dirty-json, with full step-by-step logging

const base = require('./config/airtableClient');
const dirtyJSON = require('dirty-json');

const LEADS_TABLE = 'Leads';
const POSTS_CONTENT_FIELD = 'Posts Content';

/**
 * Repairs a single record's Posts Content field by recordId.
 * @param {string} recordId - The Airtable record ID to repair.
 */
async function repairSingleBadJsonRecord(recordId) {
    logger.info(`\n=== Starting repair for record: ${recordId} ===`);
    // 1. Fetch the record
    let record;
    try {
        const records = await base(LEADS_TABLE).select({
            filterByFormula: `RECORD_ID() = '${recordId}'`,
            maxRecords: 1,
            fields: [POSTS_CONTENT_FIELD]
        }).firstPage();
        if (!records.length) {
            logger.info('Record not found.');
            return;
        }
        record = records[0];
        logger.info('Fetched record.');
    } catch (e) {
        logger.info('Error fetching record:', e.message);
        return;
    }

    const raw = record.get(POSTS_CONTENT_FIELD);
    logger.info('Original field value:', raw);
    if (!raw) {
        logger.info('Field is empty. Nothing to repair.');
        return;
    }

    // 2. Try normal JSON.parse
    let parsed = null;
    let fixed = false;
    try {
        parsed = JSON.parse(raw);
        logger.info('Field is already valid JSON. No repair needed.');
        return;
    } catch (e) {
        logger.info('Standard JSON.parse failed:', e.message);
    }

    // 3. Try dirty-json
    try {
        parsed = dirtyJSON.parse(raw);
        fixed = true;
        logger.info('dirty-json successfully parsed the field.');
    } catch (e) {
        logger.info('dirty-json failed to parse the field:', e.message);
        return;
    }

    // 4. Write back the cleaned JSON
    const cleaned = JSON.stringify(parsed);
    try {
        await base(LEADS_TABLE).update([{
            id: recordId,
            fields: { [POSTS_CONTENT_FIELD]: cleaned }
        }]);
        logger.info('Wrote cleaned JSON back to Airtable.');
    } catch (e) {
        logger.info('Error writing cleaned JSON to Airtable:', e.message);
        return;
    }

    // 5. Fetch again and verify
    try {
        const verifyRecords = await base(LEADS_TABLE).select({
            filterByFormula: `RECORD_ID() = '${recordId}'`,
            maxRecords: 1,
            fields: [POSTS_CONTENT_FIELD]
        }).firstPage();
        if (!verifyRecords.length) {
            logger.info('Record not found after update.');
            return;
        }
        const newRaw = verifyRecords[0].get(POSTS_CONTENT_FIELD);
        logger.info('Fetched updated field value:', newRaw);
        try {
            JSON.parse(newRaw);
            logger.info('Verification: Field is now valid JSON. Repair successful!');
        } catch (e) {
            logger.info('Verification: Field is still invalid JSON after repair:', e.message);
        }
    } catch (e) {
        logger.info('Error fetching record for verification:', e.message);
    }
    logger.info(`=== Repair process complete for record: ${recordId} ===\n`);
}

// To use this utility, call repairSingleBadJsonRecord('recXXXXXXXXXXXXXX');
// Or export it for use in other scripts/APIs
module.exports = repairSingleBadJsonRecord;
