// scanBadJsonRecords.js
const { createLogger } = require('./utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'api' });

// Scans Airtable for records with malformed JSON in the 'Posts Content' field and logs the first 5

const base = require('./config/airtableClient');
const POSTS_CONTENT_FIELD = 'Posts Content';
const LEADS_TABLE = 'Leads';

async function scanBadJsonRecords() {
    logger.info('DEBUG: scanBadJsonRecords function started.');
    const maxToLog = 5;
    let badRecords = [];
    let checked = 0;
    let page = 0;
    logger.info('Scanning Airtable for records with malformed JSON in Posts Content...');
    await base(LEADS_TABLE).select({fields: [POSTS_CONTENT_FIELD]}).eachPage((records, fetchNextPage) => {
        page++;
        logger.info(`DEBUG: Fetched page ${page} with ${records.length} records.`);
        for (const record of records) {
            checked++;
            if (checked % 100 === 0) {
                logger.info(`Checked ${checked} records so far...`);
            }
            const raw = record.get(POSTS_CONTENT_FIELD);
            if (!raw) continue;
            try {
                JSON.parse(raw);
            } catch (e) {
                logger.info(`DEBUG: Found bad record at #${checked} (Record ID: ${record.id})`);
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
    logger.info(`DEBUG: scanBadJsonRecords finished. Total checked: ${checked}, bad records: ${badRecords.length}`);
    if (badRecords.length === 0) {
        logger.info('No malformed JSON records found.');
    } else {
        logger.info(`Found ${badRecords.length} records with malformed JSON:`);
        badRecords.forEach((rec, i) => {
            logger.info(`\n#${i+1} Record ID: ${rec.id}`);
            logger.info(`Error: ${rec.error}`);
            logger.info(`Snippet: ${rec.snippet}`);
        });
    }
}

module.exports = scanBadJsonRecords;
