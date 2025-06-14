// repairSingleBadJsonRecord.js
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
    console.log(`\n=== Starting repair for record: ${recordId} ===`);
    // 1. Fetch the record
    let record;
    try {
        const records = await base(LEADS_TABLE).select({
            filterByFormula: `RECORD_ID() = '${recordId}'`,
            maxRecords: 1,
            fields: [POSTS_CONTENT_FIELD]
        }).firstPage();
        if (!records.length) {
            console.log('Record not found.');
            return;
        }
        record = records[0];
        console.log('Fetched record.');
    } catch (e) {
        console.log('Error fetching record:', e.message);
        return;
    }

    const raw = record.get(POSTS_CONTENT_FIELD);
    console.log('Original field value:', raw);
    if (!raw) {
        console.log('Field is empty. Nothing to repair.');
        return;
    }

    // 2. Try normal JSON.parse
    let parsed = null;
    let fixed = false;
    try {
        parsed = JSON.parse(raw);
        console.log('Field is already valid JSON. No repair needed.');
        return;
    } catch (e) {
        console.log('Standard JSON.parse failed:', e.message);
    }

    // 3. Try dirty-json
    try {
        parsed = dirtyJSON.parse(raw);
        fixed = true;
        console.log('dirty-json successfully parsed the field.');
    } catch (e) {
        console.log('dirty-json failed to parse the field:', e.message);
        return;
    }

    // 4. Write back the cleaned JSON
    const cleaned = JSON.stringify(parsed);
    try {
        await base(LEADS_TABLE).update([{
            id: recordId,
            fields: { [POSTS_CONTENT_FIELD]: cleaned }
        }]);
        console.log('Wrote cleaned JSON back to Airtable.');
    } catch (e) {
        console.log('Error writing cleaned JSON to Airtable:', e.message);
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
            console.log('Record not found after update.');
            return;
        }
        const newRaw = verifyRecords[0].get(POSTS_CONTENT_FIELD);
        console.log('Fetched updated field value:', newRaw);
        try {
            JSON.parse(newRaw);
            console.log('Verification: Field is now valid JSON. Repair successful!');
        } catch (e) {
            console.log('Verification: Field is still invalid JSON after repair:', e.message);
        }
    } catch (e) {
        console.log('Error fetching record for verification:', e.message);
    }
    console.log(`=== Repair process complete for record: ${recordId} ===\n`);
}

// To use this utility, call repairSingleBadJsonRecord('recXXXXXXXXXXXXXX');
// Or export it for use in other scripts/APIs
module.exports = repairSingleBadJsonRecord;
