// services/coachingService.js
// Coaching management service - handles task templates, client tasks, and system settings

require('dotenv').config();
const Airtable = require('airtable');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ 
    runId: 'SYSTEM', 
    clientId: 'SYSTEM', 
    operation: 'coaching-service' 
});

// Table names in Master Clients base
const TABLES = {
    SYSTEM_SETTINGS: 'System Settings',
    TASK_TEMPLATES: 'Task Templates',
    CLIENT_TASKS: 'Client Tasks',
    CLIENTS: 'Clients'
};

// Cache for system settings (refresh every 5 minutes)
let systemSettingsCache = null;
let systemSettingsCacheTimestamp = null;
const SETTINGS_CACHE_DURATION_MS = 5 * 60 * 1000;

/**
 * Get the Master Clients base connection
 */
function getMasterBase() {
    if (!process.env.MASTER_CLIENTS_BASE_ID) {
        throw new Error("MASTER_CLIENTS_BASE_ID environment variable is not set");
    }
    Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
    return Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
}

/**
 * Get system settings (cached)
 * @returns {Promise<Object>} System settings object
 */
async function getSystemSettings() {
    try {
        // Return cached if valid
        if (systemSettingsCache && systemSettingsCacheTimestamp && 
            (Date.now() - systemSettingsCacheTimestamp) < SETTINGS_CACHE_DURATION_MS) {
            return systemSettingsCache;
        }

        const base = getMasterBase();
        const records = await base(TABLES.SYSTEM_SETTINGS).select({
            maxRecords: 1
        }).firstPage();

        if (records.length === 0) {
            logger.warn('No system settings record found');
            return {};
        }

        const record = records[0];
        systemSettingsCache = {
            name: record.get('Name') || 'Production',
            coachingResourcesUrl: record.get('Coaching Resources URL') || null
        };
        systemSettingsCacheTimestamp = Date.now();

        logger.info('System settings loaded:', systemSettingsCache.name);
        return systemSettingsCache;

    } catch (error) {
        logger.error('Error fetching system settings:', error.message);
        throw error;
    }
}

/**
 * Get all active task templates
 * @returns {Promise<Array>} Array of task template objects
 */
async function getTaskTemplates() {
    try {
        const base = getMasterBase();
        const templates = [];

        await base(TABLES.TASK_TEMPLATES).select({
            filterByFormula: `{Is Active} = "Yes"`,
            sort: [{ field: 'Order', direction: 'asc' }]
        }).eachPage((records, fetchNextPage) => {
            records.forEach(record => {
                templates.push({
                    id: record.id,
                    taskName: record.get('Task Name') || '',
                    phase: record.get('Phase') || '',
                    order: record.get('Order') || 0,
                    instructionsUrl: record.get('Instructions URL') || null
                });
            });
            fetchNextPage();
        });

        logger.info(`Loaded ${templates.length} active task templates`);
        return templates;

    } catch (error) {
        logger.error('Error fetching task templates:', error.message);
        throw error;
    }
}

/**
 * Create client tasks from templates for a new client
 * @param {string} clientRecordId - Airtable record ID of the client
 * @param {string} clientName - Client name for logging
 * @returns {Promise<{success: boolean, tasksCreated: number}>}
 */
async function createClientTasksFromTemplates(clientRecordId, clientName) {
    try {
        const base = getMasterBase();
        
        // Check if client already has tasks
        const existingTasks = await base(TABLES.CLIENT_TASKS).select({
            filterByFormula: `RECORD_ID({Client}) = "${clientRecordId}"`,
            maxRecords: 1
        }).firstPage();

        if (existingTasks.length > 0) {
            logger.info(`Client ${clientName} already has tasks, skipping creation`);
            return { success: true, tasksCreated: 0, skipped: true };
        }

        // Get all active templates
        const templates = await getTaskTemplates();
        
        if (templates.length === 0) {
            logger.warn('No active task templates found');
            return { success: true, tasksCreated: 0 };
        }

        // Create tasks in batches of 10 (Airtable limit)
        const tasksToCreate = templates.map(template => ({
            fields: {
                'Task': template.taskName,
                'Client': [clientRecordId],
                'Phase': template.phase,
                'Order': template.order,
                'Instructions URL': template.instructionsUrl,
                'Status': 'Not Started'
            }
        }));

        let tasksCreated = 0;
        const batchSize = 10;

        for (let i = 0; i < tasksToCreate.length; i += batchSize) {
            const batch = tasksToCreate.slice(i, i + batchSize);
            await base(TABLES.CLIENT_TASKS).create(batch);
            tasksCreated += batch.length;
        }

        logger.info(`Created ${tasksCreated} tasks for client ${clientName}`);
        return { success: true, tasksCreated };

    } catch (error) {
        logger.error(`Error creating tasks for client ${clientName}:`, error.message);
        throw error;
    }
}

/**
 * Get client tasks for a specific client
 * @param {string} clientRecordId - Airtable record ID of the client
 * @returns {Promise<Array>} Array of client task objects
 */
async function getClientTasks(clientRecordId) {
    try {
        const base = getMasterBase();
        const tasks = [];

        await base(TABLES.CLIENT_TASKS).select({
            filterByFormula: `RECORD_ID({Client}) = "${clientRecordId}"`,
            sort: [{ field: 'Order', direction: 'asc' }]
        }).eachPage((records, fetchNextPage) => {
            records.forEach(record => {
                tasks.push({
                    id: record.id,
                    task: record.get('Task') || '',
                    phase: record.get('Phase') || '',
                    status: record.get('Status') || 'Not Started',
                    order: record.get('Order') || 0,
                    instructionsUrl: record.get('Instructions URL') || null,
                    notes: record.get('Notes') || ''
                });
            });
            fetchNextPage();
        });

        return tasks;

    } catch (error) {
        logger.error('Error fetching client tasks:', error.message);
        throw error;
    }
}

/**
 * Get task progress summary for a client
 * @param {string} clientRecordId - Airtable record ID of the client
 * @returns {Promise<{total: number, completed: number, percentage: number}>}
 */
async function getClientTaskProgress(clientRecordId) {
    try {
        const tasks = await getClientTasks(clientRecordId);
        const total = tasks.length;
        const completed = tasks.filter(t => t.status === 'Done').length;
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

        return { total, completed, percentage };

    } catch (error) {
        logger.error('Error calculating task progress:', error.message);
        return { total: 0, completed: 0, percentage: 0 };
    }
}

/**
 * Clear system settings cache (for testing)
 */
function clearSettingsCache() {
    systemSettingsCache = null;
    systemSettingsCacheTimestamp = null;
}

module.exports = {
    getSystemSettings,
    getTaskTemplates,
    createClientTasksFromTemplates,
    getClientTasks,
    getClientTaskProgress,
    clearSettingsCache,
    TABLES
};
