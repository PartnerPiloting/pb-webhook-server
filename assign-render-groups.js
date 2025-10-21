// assign-render-groups.js
// Assigns each environment variable to its appropriate Render Environment Group

require('dotenv').config();
const { getMasterClientsBase } = require('./config/airtableClient');

/**
 * Mapping of environment variables to their Render Environment Groups
 * Based on logical grouping and purpose
 */
const RENDER_GROUP_MAPPING = {
    // AI Service Configuration
    'GCP_LOCATION': 'AI Service Configuration',
    'GCP_PROJECT_ID': 'AI Service Configuration',
    'GEMINI_MODEL_ID': 'AI Service Configuration',
    'GOOGLE_APPLICATION_CREDENTIALS': 'AI Service Configuration',
    'GPT_CHAT_URL': 'AI Service Configuration',
    'OPENAI_API_KEY': 'AI Service Configuration',

    // Performance & Optimization
    'BATCH_CHUNK_SIZE': 'Performance & Optimization',

    // Third-Party Integrations
    'APIFY_ACTOR_ID': 'Third-Party Integrations',
    'APIFY_API_TOKEN': 'Third-Party Integrations',
    'APIFY_MAX_POSTS': 'Third-Party Integrations',
    'APIFY_POSTED_LIMIT': 'Third-Party Integrations',
    'APIFY_WEBHOOK_TOKEN': 'Third-Party Integrations',

    // Email & Notifications
    'ALERT_EMAIL': 'Email & Notifications',
    'FROM_EMAIL': 'Email & Notifications',
    'MAILGUN_API_KEY': 'Email & Notifications',
    'MAILGUN_DOMAIN': 'Email & Notifications',

    // Fire and Forget Config
    'FIRE_AND_FORGET': 'Fire and Forget Config',
    'MAX_CLIENT_PROCESSING_MINUTES': 'Fire and Forget Config',
    'MAX_JOB_PROCESSING_HOURS': 'Fire and Forget Config',
    'SMART_RESUME_LOCK_TIMEOUT_HOURS': 'Fire and Forget Config',

    // Service Configuration
    'ENABLE_TOP_SCORING_LEADS': 'Service Configuration',
    'NODE_ENV': 'Service Configuration',
    'NEXT_PUBLIC_API_BASE_URL': 'Service Configuration',
    'RENDER_EXTERNAL_URL': 'Service Configuration',

    // Authentication & API Keys
    'AIRTABLE_API_KEY': 'Authentication & API Keys',
    'AIRTABLE_BASE_ID': 'Authentication & API Keys',
    'AIRTABLE_HELP_BASE_ID': 'Authentication & API Keys',
    'MASTER_CLIENTS_BASE_ID': 'Authentication & API Keys',
    'PB_WEBHOOK_SECRET': 'Authentication & API Keys',

    // Testing (Limits etc)
    'IGNORE_POST_HARVESTING_LIMITS': 'Testing (Limits etc)',
    'LEAD_SCORING_LIMIT': 'Testing (Limits etc)',
    'POST_SCORING_LIMIT': 'Testing (Limits etc)',
    'VERBOSE_POST_SCORING': 'Testing (Limits etc)',

    // Logging Controls
    'DEBUG_LEAD_SCORING': 'Logging Controls',
    'DEBUG_POST_HARVESTING': 'Logging Controls',
    'DEBUG_POST_SCORING': 'Logging Controls',
    'DEBUG_RAW_GEMINI': 'Logging Controls',
    'FIRE_AND_FORGET_BATCH_PROCESS_TESTING': 'Logging Controls',

    // Render-Logging-Variables
    'RENDER_API_KEY': 'Render-Logging-Variables',
    'RENDER_OWNER_ID': 'Render-Logging-Variables',
    'RENDER_SERVICE_ID': 'Render-Logging-Variables',
    'RENDER_GIT_BRANCH': 'Render-Logging-Variables',
    'RENDER_GIT_COMMIT': 'Render-Logging-Variables',

    // Service Configuration (port)
    'PORT': 'Service Configuration'
};

/**
 * Update Airtable Environment Variables table with Render Group assignments
 */
async function assignRenderGroups() {
    console.log('🎯 Starting Render Group Assignment...\n');

    try {
        const masterBase = await getMasterClientsBase();
        const envVarsTable = masterBase('Environment Variables');

        // Fetch all records
        console.log('📥 Fetching environment variables from Airtable...');
        const records = await envVarsTable.select().all();
        console.log(`   Found ${records.length} records\n`);

        let updated = 0;
        let skipped = 0;
        let notMapped = 0;

        // Update each record with its Render Group
        for (const record of records) {
            const varName = record.get('Variable Name');
            const currentGroup = record.get('Render Group');
            const newGroup = RENDER_GROUP_MAPPING[varName];

            if (!newGroup) {
                console.log(`⚠️  [${varName}] - Not in mapping (skipping)`);
                notMapped++;
                continue;
            }

            if (currentGroup === newGroup) {
                console.log(`✓  [${varName}] - Already assigned to "${newGroup}"`);
                skipped++;
                continue;
            }

            // Update the record
            await envVarsTable.update(record.id, {
                'Render Group': newGroup
            });

            console.log(`✅ [${varName}] - Assigned to "${newGroup}"`);
            updated++;

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        console.log('\n📊 Summary:');
        console.log(`   ✅ Updated: ${updated}`);
        console.log(`   ✓  Already assigned: ${skipped}`);
        console.log(`   ⚠️  Not mapped: ${notMapped}`);
        console.log(`   📝 Total: ${records.length}`);

        if (notMapped > 0) {
            console.log('\n⚠️  Variables not in mapping:');
            for (const record of records) {
                const varName = record.get('Variable Name');
                if (!RENDER_GROUP_MAPPING[varName]) {
                    console.log(`   - ${varName}`);
                }
            }
        }

        console.log('\n✅ Render Group assignment complete!');

    } catch (error) {
        console.error('❌ Error assigning Render groups:', error);
        process.exit(1);
    }
}

// Run the assignment
if (require.main === module) {
    assignRenderGroups()
        .then(() => process.exit(0))
        .catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { assignRenderGroups, RENDER_GROUP_MAPPING };
