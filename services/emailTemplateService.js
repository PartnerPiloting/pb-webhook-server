// services/emailTemplateService.js
// Email template management service for client notifications
// Handles reading email templates from the Master Clients Email Templates table

require('dotenv').config();
const Airtable = require('airtable');

// Cache for email templates to avoid repeated API calls
let templatesCache = null;
let templatesCacheTimestamp = null;
const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// Master Clients base connection
let masterClientsBase = null;

/**
 * Initialize connection to the Master Clients base
 */
function initializeMasterClientsBase() {
    if (!masterClientsBase) {
        if (!process.env.MASTER_CLIENTS_BASE_ID) {
            throw new Error("MASTER_CLIENTS_BASE_ID environment variable is not set");
        }
        
        if (!process.env.AIRTABLE_API_KEY) {
            throw new Error("AIRTABLE_API_KEY environment variable is not set");
        }

        console.log("Initializing Master Clients base connection for email templates...");
        
        // Configure Airtable if not already done
        Airtable.configure({
            apiKey: process.env.AIRTABLE_API_KEY
        });

        masterClientsBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
        console.log(`Connected to Master Clients base: ${process.env.MASTER_CLIENTS_BASE_ID}`);
    }
    
    return masterClientsBase;
}

/**
 * Check if cache is still valid
 */
function isCacheValid() {
    return templatesCache && 
           templatesCacheTimestamp && 
           (Date.now() - templatesCacheTimestamp) < CACHE_DURATION_MS;
}

/**
 * Get all active email templates from the Email Templates table
 * @returns {Promise<Array>} Array of active email template records
 */
async function getAllActiveTemplates() {
    try {
        // Return cached data if valid
        if (isCacheValid()) {
            console.log("Returning cached email template data");
            return templatesCache;
        }

        const base = initializeMasterClientsBase();
        const templates = [];

        console.log("Fetching active email templates from Email Templates table...");

        await base('Email Templates').select({
            filterByFormula: '{Active} = TRUE()'
        }).eachPage((records, fetchNextPage) => {
            records.forEach(record => {
                const templateId = record.get('Template ID');
                const templateName = record.get('Template Name');
                const subject = record.get('Subject');
                const bodyHTML = record.get('Body HTML');
                const active = record.get('Active');
                const createdTime = record.get('Created Time');
                const lastModified = record.get('Last Modified');
                
                templates.push({
                    id: record.id,
                    templateId: templateId,
                    templateName: templateName,
                    subject: subject,
                    bodyHTML: bodyHTML,
                    active: active,
                    createdTime: createdTime,
                    lastModified: lastModified
                });
            });
            fetchNextPage();
        });

        // Update cache
        templatesCache = templates;
        templatesCacheTimestamp = Date.now();

        console.log(`Retrieved ${templates.length} active email templates`);
        return templates;

    } catch (error) {
        console.error("Error fetching email templates:", error);
        throw error;
    }
}

/**
 * Get a specific email template by Template ID
 * @param {string} templateId - The Template ID to search for
 * @returns {Promise<Object|null>} Email template record or null if not found
 */
async function getTemplateById(templateId) {
    try {
        const allTemplates = await getAllActiveTemplates();
        const template = allTemplates.find(t => t.templateId === templateId);
        
        if (template) {
            console.log(`Found email template: ${template.templateName} (${templateId})`);
        } else {
            console.log(`Email template not found: ${templateId}`);
        }

        return template || null;

    } catch (error) {
        console.error(`Error fetching email template ${templateId}:`, error);
        throw error;
    }
}

/**
 * Clear the templates cache (useful for testing or forced refresh)
 */
function clearCache() {
    templatesCache = null;
    templatesCacheTimestamp = null;
    console.log("Email templates cache cleared");
}

/**
 * Replace template variables in email content
 * @param {string} content - The content with template variables
 * @param {Object} variables - Object containing variable values
 * @returns {string} Content with variables replaced
 */
function replaceTemplateVariables(content, variables) {
    if (!content) return content;
    
    let processedContent = content;
    
    // Replace variables in format {{variableName}}
    Object.keys(variables).forEach(key => {
        const placeholder = `{{${key}}}`;
        const value = variables[key] || '';
        processedContent = processedContent.replace(new RegExp(placeholder, 'g'), value);
    });
    
    return processedContent;
}

/**
 * Process email template with client-specific variables
 * @param {string} templateId - The Template ID to process
 * @param {Object} clientData - Client data for variable replacement
 * @returns {Promise<Object>} Processed email content with subject and body
 */
async function processTemplate(templateId, clientData = {}) {
    try {
        const template = await getTemplateById(templateId);
        
        if (!template) {
            throw new Error(`Email template not found: ${templateId}`);
        }

        // Prepare template variables
        const variables = {
            clientFirstName: clientData.clientFirstName || clientData.clientName || 'Valued Client',
            clientName: clientData.clientName || 'Valued Client',
            clientId: clientData.clientId || '',
            // Add current date
            currentDate: new Date().toLocaleDateString('en-AU', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            }),
            // Add current time
            currentTime: new Date().toLocaleTimeString('en-AU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            }),
            ...clientData // Allow override with any additional client data
        };

        // Process subject and body with variables
        const processedSubject = replaceTemplateVariables(template.subject, variables);
        const processedBodyHTML = replaceTemplateVariables(template.bodyHTML, variables);

        console.log(`Processed email template ${templateId} for client ${clientData.clientId || 'unknown'}`);

        return {
            templateId: template.templateId,
            templateName: template.templateName,
            subject: processedSubject,
            bodyHTML: processedBodyHTML,
            variables: variables
        };

    } catch (error) {
        console.error(`Error processing email template ${templateId}:`, error);
        throw error;
    }
}

module.exports = {
    getAllActiveTemplates,
    getTemplateById,
    processTemplate,
    replaceTemplateVariables,
    clearCache
};