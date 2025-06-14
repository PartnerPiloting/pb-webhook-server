// repairAllBadJsonRecords.js
// Batch repairs all bad JSON records in the Leads table, with progress logging and verification

const base = require('./config/airtableClient');
const dirtyJSON = require('dirty-json');

const LEADS_TABLE = 'Leads';
const POSTS_CONTENT_FIELD = 'Posts Content';

async function repairAllBadJsonRecords() {
    let total = 0;
    let repaired = 0;
    let failed = 0;
    let skipped = 0;
    let pageCount = 0;
    let badRecords = [];

    console.log('Starting batch repair of bad JSON records in Airtable...');

    await base(LEADS_TABLE).select({fields: [POSTS_CONTENT_FIELD]}).eachPage(async (records, fetchNextPage) => {
        pageCount++;
        console.log(`Fetched page ${pageCount} with ${records.length} records.`);
        for (const record of records) {
            total++;
            if (total % 50 === 0) {
                console.log(`Scanned ${total} records so far...`);
            }
            const raw = record.get(POSTS_CONTENT_FIELD);
            if (!raw) {
                skipped++;
                continue;
            }
            let parsed = null;
            let needsRepair = false;
            try {
                parsed = JSON.parse(raw);
                // Already valid
                continue;
            } catch (e) {
                needsRepair = true;
            }
            // Try dirty-json
            try {
                parsed = dirtyJSON.parse(raw);
            } catch (e) {
                failed++;
                badRecords.push({id: record.id, error: e.message});
                console.log(`Failed to repair record ${record.id}: ${e.message}`);
                continue;
            }
            // Write back cleaned JSON
            const cleaned = JSON.stringify(parsed);
            try {
                await base(LEADS_TABLE).update([{id: record.id, fields: {[POSTS_CONTENT_FIELD]: cleaned}}]);
                // Verify
                const verifyRecords = await base(LEADS_TABLE).select({
                    filterByFormula: `RECORD_ID() = '${record.id}'`,
                    maxRecords: 1,
                    fields: [POSTS_CONTENT_FIELD]
                }).firstPage();
                if (!verifyRecords.length) {
                    failed++;
                    badRecords.push({id: record.id, error: 'Not found after update'});
                    console.log(`Record ${record.id} not found after update.`);
                    continue;
                }
                const newRaw = verifyRecords[0].get(POSTS_CONTENT_FIELD);
                try {
                    JSON.parse(newRaw);
                    repaired++;
                    console.log(`Record ${record.id} repaired and verified.`);
                } catch (e) {
                    failed++;
                    badRecords.push({id: record.id, error: 'Still invalid after repair'});
                    console.log(`Record ${record.id} still invalid after repair.`);
                }
            } catch (e) {
                failed++;
                badRecords.push({id: record.id, error: 'Airtable update error: ' + e.message});
                console.log(`Airtable update error for record ${record.id}: ${e.message}`);
            }
        }
        fetchNextPage();
    });
    // Wait a moment for all async updates to finish
    setTimeout(() => {
        console.log('=== Batch Repair Complete ===');
        console.log(`Total records scanned: ${total}`);
        console.log(`Records repaired: ${repaired}`);
        console.log(`Records skipped (empty): ${skipped}`);
        console.log(`Records failed to repair: ${failed}`);
        if (badRecords.length) {
            console.log('Failed records:', badRecords);
        }
    }, 5000);
}

// To use: require and call repairAllBadJsonRecords();
module.exports = repairAllBadJsonRecords;
