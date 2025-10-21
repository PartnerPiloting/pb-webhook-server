/**
 * Clear Production Issues Table
 * Deletes all records from Production Issues table for clean slate testing
 */

require('dotenv').config();
const Airtable = require('airtable');

const MASTER_CLIENTS_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID;
const PRODUCTION_ISSUES_TABLE = 'Production Issues';

async function clearProductionIssues() {
    try {
        console.log('🧹 Starting Production Issues table cleanup...\n');

        const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(MASTER_CLIENTS_BASE_ID);
        
        // Fetch all records
        console.log('📊 Fetching all Production Issues records...');
        const records = await base(PRODUCTION_ISSUES_TABLE)
            .select({
                fields: ['Error Message', 'Severity', 'Run ID', 'Status', 'Created Time']
            })
            .all();

        console.log(`\n📋 Found ${records.length} records to delete\n`);

        if (records.length === 0) {
            console.log('✅ Production Issues table is already empty!');
            return;
        }

        // Show breakdown before deletion
        const bySeverity = {};
        const byStatus = {};
        records.forEach(record => {
            const severity = record.get('Severity') || 'UNKNOWN';
            const status = record.get('Status') || 'UNKNOWN';
            bySeverity[severity] = (bySeverity[severity] || 0) + 1;
            byStatus[status] = (byStatus[status] || 0) + 1;
        });

        console.log('📊 Breakdown before deletion:');
        console.log('  By Severity:', JSON.stringify(bySeverity, null, 2));
        console.log('  By Status:', JSON.stringify(byStatus, null, 2));
        console.log('');

        // Delete in batches of 10 (Airtable limit)
        const batchSize = 10;
        let deleted = 0;

        for (let i = 0; i < records.length; i += batchSize) {
            const batch = records.slice(i, i + batchSize);
            const recordIds = batch.map(r => r.id);
            
            console.log(`🗑️  Deleting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(records.length / batchSize)} (${recordIds.length} records)...`);
            
            await base(PRODUCTION_ISSUES_TABLE).destroy(recordIds);
            deleted += recordIds.length;
            
            // Small delay between batches to avoid rate limits
            if (i + batchSize < records.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        console.log(`\n✅ Successfully deleted ${deleted} records from Production Issues table!`);
        console.log('🎯 Table is now clean and ready for next run\n');

    } catch (error) {
        console.error('❌ Error clearing Production Issues table:', error.message);
        if (error.statusCode) {
            console.error(`   Status: ${error.statusCode}`);
        }
        if (error.error) {
            console.error(`   Details:`, error.error);
        }
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    clearProductionIssues()
        .then(() => process.exit(0))
        .catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { clearProductionIssues };
