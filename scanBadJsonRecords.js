// scanBadJsonRecords.js
// Scans Airtable for records with malformed JSON in the 'Posts Content' field and logs the first 5

const base = require('./config/airtableClient');
const POSTS_CONTENT_FIELD = 'Posts Content';
const LEADS_TABLE = 'Leads';

async function scanBadJsonRecords() {
    console.log('DEBUG: scanBadJsonRecords function started.');
    const maxToLog = 5;
    let badRecords = [];
    let checked = 0;
    let page = 0;
    console.log('Scanning Airtable for records with malformed JSON in Posts Content...');
    await base(LEADS_TABLE).select({fields: [POSTS_CONTENT_FIELD]}).eachPage((records, fetchNextPage) => {
        page++;
        console.log(`DEBUG: Fetched page ${page} with ${records.length} records.`);
        for (const record of records) {
            checked++;
            if (checked % 100 === 0) {
                console.log(`Checked ${checked} records so far...`);
            }
            const raw = record.get(POSTS_CONTENT_FIELD);
            if (!raw) continue;
            try {
                JSON.parse(raw);
            } catch (e) {
                console.log(`DEBUG: Found bad record at #${checked} (Record ID: ${record.id})`);
                badRecords.push({
                    id: record.id,
                    snippet: raw.substring(0, 300),
                    error: e.message
                });
                if (badRecords.length >= maxToLog) break;
            }
        }
        if (badRecords.length < maxToLog) fetchNextPage();
    });
    console.log(`DEBUG: scanBadJsonRecords finished. Total checked: ${checked}, bad records: ${badRecords.length}`);
    if (badRecords.length === 0) {
        console.log('No malformed JSON records found.');
    } else {
        console.log(`Found ${badRecords.length} records with malformed JSON:`);
        badRecords.forEach((rec, i) => {
            console.log(`\n#${i+1} Record ID: ${rec.id}`);
            console.log(`Error: ${rec.error}`);
            console.log(`Snippet: ${rec.snippet}`);
        });
    }
}

module.exports = scanBadJsonRecords;

scanBadJsonRecords().catch(err => {
    console.error('Error running scanBadJsonRecords:', err);
});
