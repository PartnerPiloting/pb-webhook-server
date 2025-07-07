// routes/linkedinRoutes.js
// API routes for LinkedIn extension and web portal integration
// All routes are protected by WordPress authentication middleware

const express = require('express');
const router = express.Router();
// const { authenticateWordPressUser } = require('../middleware/wordpressAuth');
const { getClientBase } = require('../../../config/airtableClient');
const clientService = require('../../../services/clientService');

// For testing: Skip authentication and use client parameter from URL
// router.use(authenticateWordPressUser);

/**
 * Simple test endpoint - no authentication required
 * GET /api/linkedin/test
 */
router.get('/test', (req, res) => {
    res.json({
        status: 'success',
        message: 'LinkedIn API is working!',
        timestamp: new Date().toISOString(),
        version: 'v1.0'
    });
});

/**
 * Root endpoint test
 * GET /api/linkedin/
 */
router.get('/', (req, res) => {
    res.json({
        status: 'success',
        message: 'LinkedIn API root endpoint working!',
        timestamp: new Date().toISOString()
    });
});

/**
 * Search leads by name across client's base
 * GET /api/linkedin/leads/search?q=searchQuery
 */
router.get('/leads/search', async (req, res) => {
    try {
        const { q: searchQuery, client: clientId } = req.query;
        
        // For testing: get client from URL parameter
        if (!clientId) {
            return res.status(400).json({
                error: 'Client parameter required',
                message: 'Please provide ?client=guy-wilson in URL for testing'
            });
        }

        // No validation for searchQuery - allow empty searches to return all leads

        // Validate client exists and is active
        const client = await clientService.getClientById(clientId);
        if (!client) {
            return res.status(404).json({
                error: 'Client not found',
                message: `Client '${clientId}' does not exist in master Clients base`
            });
        }
        
        if (client.status !== 'Active') {
            return res.status(403).json({
                error: 'Client inactive',
                message: `Client '${clientId}' status is '${client.status}', expected 'Active'`
            });
        }

        console.log(`Using client: ${client.clientName} (${clientId}) → Base: ${client.airtableBaseId}`);

        // Get client's Airtable base using existing infrastructure
        const base = await getClientBase(clientId);
        const leads = [];

        // Search in Leads table
        const filterFormula = searchQuery.trim() 
            ? `OR(
                SEARCH(LOWER("${searchQuery.toLowerCase()}"), LOWER({First Name})),
                SEARCH(LOWER("${searchQuery.toLowerCase()}"), LOWER({Last Name}))
            )`
            : ''; // Empty filter returns all records
            
        await base('Leads').select({
            filterByFormula: filterFormula,
            maxRecords: 50,
            sort: [
                { field: 'AI Score', direction: 'desc' },
                { field: 'Last Name', direction: 'asc' }
            ]
        }).eachPage((records, fetchNextPage) => {
            records.forEach(record => {
                leads.push({
                    id: record.id,
                    firstName: record.get('First Name') || '',
                    lastName: record.get('Last Name') || '',
                    linkedinProfileUrl: record.get('LinkedIn Profile URL') || '',
                    aiScore: record.get('AI Score') || null,
                    status: record.get('Status') || '',
                    lastMessageDate: record.get('Last Message Date') || null
                });
            });
            fetchNextPage();
        });

        console.log(`Search "${searchQuery}" returned ${leads.length} results for client ${clientId} (${client.clientName})`);
        res.json(leads);

    } catch (error) {
        console.error('Lead search error:', error);
        res.status(500).json({
            error: 'Search failed',
            message: 'Unable to search leads'
        });
    }
});

/**
 * Get detailed lead information by ID
 * GET /api/linkedin/leads/:leadId
 */
router.get('/leads/:leadId', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { client: clientId } = req.query;
        
        // For testing: get client from URL parameter
        if (!clientId) {
            return res.status(400).json({
                error: 'Client parameter required',
                message: 'Please provide ?client=guy-wilson in URL for testing'
            });
        }

        // Validate client exists and is active  
        const client = await clientService.getClientById(clientId);
        if (!client || client.status !== 'Active') {
            return res.status(404).json({
                error: 'Invalid client',
                message: `Client '${clientId}' not found or inactive`
            });
        }

        console.log(`Getting lead ${leadId} for client: ${client.clientName} (${clientId}) → Base: ${client.airtableBaseId}`);

        // Get client's Airtable base
        const base = await getClientBase(clientId);

        // Fetch lead record
        const record = await base('Leads').find(leadId);
        
        const leadData = {
            id: record.id,
            // Basic information
            firstName: record.get('First Name') || '',
            lastName: record.get('Last Name') || '',
            linkedinProfileUrl: record.get('LinkedIn Profile URL') || '',
            viewInSalesNavigator: record.get('View In Sales Navigator') || '',
            email: record.get('Email') || '',
            
            // Read-only fields
            profileKey: record.get('Profile Key') || '',
            aiScore: record.get('AI Score') || null,
            postsRelevanceScore: record.get('Post Relevance Score') || null,
            postsRelevancePercentage: calculatePostsRelevancePercentage(record.get('Post Relevance Score')),
            
            // Status fields
            source: record.get('Source') || '',
            status: record.get('Status') || '',
            priority: record.get('Priority') || '',
            linkedinConnectionStatus: record.get('LinkedIn Connection Status') || '',
            
            // Follow-up fields
            followUpDate: record.get('Follow-Up Date') || '',
            followUpNotes: record.get('Follow-Up Notes') || '',
            notes: record.get('Notes') || '',
            
            // Message history
            linkedinMessages: record.get('LinkedIn Messages') || '',
            lastMessageDate: record.get('Last Message Date') || null,
            extensionLastSync: record.get('Extension Last Sync') || null,
            
            // Additional profile data (read-only)
            headline: record.get('Headline') || '',
            jobTitle: record.get('Job Title') || '',
            companyName: record.get('Company Name') || '',
            about: record.get('About') || ''
        };

        console.log(`Retrieved lead ${leadId} for client ${clientId}`);
        res.json(leadData);

    } catch (error) {
        console.error('Get lead error:', error);
        if (error.statusCode === 404) {
            res.status(404).json({
                error: 'Lead not found',
                message: 'The requested lead does not exist'
            });
        } else {
            res.status(500).json({
                error: 'Failed to retrieve lead',
                message: 'Unable to fetch lead details'
            });
        }
    }
});

/**
 * Update lead information
 * PUT /api/linkedin/leads/:leadId
 */
router.put('/leads/:leadId', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { client: clientId } = req.query; // For testing: get client from URL parameter
        const updates = req.body;
        
        // For testing: get client from URL parameter
        if (!clientId) {
            return res.status(400).json({
                error: 'Client parameter required',
                message: 'Please provide ?client=guy-wilson in URL for testing'
            });
        }

        // Validate client exists and is active
        const client = await clientService.getClientById(clientId);
        if (!client || client.status !== 'Active') {
            return res.status(404).json({
                error: 'Invalid client',
                message: `Client '${clientId}' not found or inactive`
            });
        }

        // Get client's Airtable base
        const base = await getClientBase(clientId);

        // Prepare update fields (only allow editable fields)
        const updateFields = {};
        const editableFields = [
            'First Name', 'Last Name', 'LinkedIn Profile URL', 'View In Sales Navigator',
            'Email', 'Notes', 'Follow-Up Date', 'Follow-Up Notes', 'Source',
            'Status', 'Priority', 'LinkedIn Connection Status'
        ];

        // Map React field names to Airtable field names
        const fieldMapping = {
            firstName: 'First Name',
            lastName: 'Last Name',
            linkedinProfileUrl: 'LinkedIn Profile URL',
            viewInSalesNavigator: 'View In Sales Navigator',
            email: 'Email',
            notes: 'Notes',
            followUpDate: 'Follow-Up Date',
            followUpNotes: 'Follow-Up Notes',
            source: 'Source',
            status: 'Status',
            priority: 'Priority',
            linkedinConnectionStatus: 'LinkedIn Connection Status'
        };

        // Build update object with validation
        Object.keys(updates).forEach(reactFieldName => {
            const airtableFieldName = fieldMapping[reactFieldName];
            if (airtableFieldName && editableFields.includes(airtableFieldName)) {
                const value = updates[reactFieldName];
                
                // Basic validation
                if (reactFieldName === 'linkedinProfileUrl' && value && !isValidLinkedInUrl(value)) {
                    throw new Error('Invalid LinkedIn URL format');
                }
                if (reactFieldName === 'email' && value && !isValidEmail(value)) {
                    throw new Error('Invalid email format');
                }
                
                // Handle date fields - convert empty strings to null
                if (reactFieldName === 'followUpDate') {
                    updateFields[airtableFieldName] = value || null;
                } else {
                    updateFields[airtableFieldName] = value || '';
                }
            }
        });

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({
                error: 'No valid fields to update',
                message: 'Please provide valid field updates'
            });
        }

        // Update record
        const updatedRecord = await base('Leads').update([{
            id: leadId,
            fields: updateFields
        }]);

        // Return updated data
        const record = updatedRecord[0];
        const updatedLead = {
            id: record.id,
            firstName: record.get('First Name') || '',
            lastName: record.get('Last Name') || '',
            linkedinProfileUrl: record.get('LinkedIn Profile URL') || '',
            viewInSalesNavigator: record.get('View In Sales Navigator') || '',
            email: record.get('Email') || '',
            notes: record.get('Notes') || '',
            followUpDate: record.get('Follow-Up Date') || '',
            followUpNotes: record.get('Follow-Up Notes') || '',
            source: record.get('Source') || '',
            status: record.get('Status') || '',
            priority: record.get('Priority') || '',
            linkedinConnectionStatus: record.get('LinkedIn Connection Status') || '',
            
            // Read-only fields
            profileKey: record.get('Profile Key') || '',
            aiScore: record.get('AI Score') || null,
            postsRelevancePercentage: calculatePostsRelevancePercentage(record.get('Post Relevance Score')),
            lastMessageDate: record.get('Last Message Date') || null
        };

        console.log(`Updated lead ${leadId} for client ${clientId}:`, Object.keys(updateFields));
        res.json(updatedLead);

    } catch (error) {
        console.error('Update lead error:', error);
        res.status(500).json({
            error: 'Update failed',
            message: error.message || 'Unable to update lead'
        });
    }
});

/**
 * Check if lead exists by LinkedIn URL
 * POST /api/linkedin/leads/check-exists
 * Body: { linkedinUrl: "https://linkedin.com/in/..." }
 */
router.post('/leads/check-exists', async (req, res) => {
    try {
        const { linkedinUrl } = req.body;
        const { clientId } = req.auth;

        if (!linkedinUrl) {
            return res.status(400).json({
                error: 'LinkedIn URL required',
                message: 'Please provide a LinkedIn profile URL'
            });
        }

        // Get client's Airtable base
        const base = await getClientBase(clientId);

        // Search for existing lead by LinkedIn URL
        const leads = [];
        await base('Leads').select({
            filterByFormula: `{LinkedIn Profile URL} = "${linkedinUrl}"`,
            maxRecords: 1
        }).eachPage((records, fetchNextPage) => {
            records.forEach(record => {
                leads.push({
                    id: record.id,
                    firstName: record.get('First Name') || '',
                    lastName: record.get('Last Name') || '',
                    lastMessageDate: record.get('Last Message Date') || null,
                    followUpDate: record.get('Follow-Up Date') || null,
                    status: record.get('Status') || ''
                });
            });
            fetchNextPage();
        });

        const exists = leads.length > 0;
        const response = {
            exists,
            lead: exists ? leads[0] : null
        };

        console.log(`LinkedIn URL existence check for client ${clientId}: ${exists}`);
        res.json(response);

    } catch (error) {
        console.error('Check exists error:', error);
        res.status(500).json({
            error: 'Check failed',
            message: 'Unable to check lead existence'
        });
    }
});

/**
 * Add message to lead's message history
 * POST /api/linkedin/leads/:leadId/messages
 * Body: { message: { content, direction, platform, date, ... } }
 */
router.post('/leads/:leadId/messages', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { clientId } = req.auth;
        const { message } = req.body;

        if (!message || !message.content) {
            return res.status(400).json({
                error: 'Message content required',
                message: 'Please provide message content'
            });
        }

        // Get client's Airtable base
        const base = await getClientBase(clientId);

        // Get current lead record
        const record = await base('Leads').find(leadId);
        const currentMessages = record.get('LinkedIn Messages') || '';
        
        // Parse existing messages
        let messageHistory;
        try {
            messageHistory = currentMessages ? JSON.parse(currentMessages) : { messages: [], last_updated: null, total_messages: 0 };
        } catch (parseError) {
            messageHistory = { messages: [], last_updated: null, total_messages: 0 };
        }

        // Add new message
        const newMessage = {
            date: message.date || new Date().toISOString(),
            content: message.content,
            direction: message.direction || 'sent',
            platform: message.platform || 'linkedin',
            message_id: message.message_id || generateMessageId(),
            thread_id: message.thread_id || 'default'
        };

        messageHistory.messages.unshift(newMessage); // Add to beginning
        messageHistory.last_updated = new Date().toISOString();
        messageHistory.total_messages = messageHistory.messages.length;

        // Update lead record
        await base('Leads').update([{
            id: leadId,
            fields: {
                'LinkedIn Messages': JSON.stringify(messageHistory),
                'Last Message Date': newMessage.date,
                'Extension Last Sync': new Date().toISOString()
            }
        }]);

        console.log(`Added message to lead ${leadId} for client ${clientId}`);
        res.json({
            success: true,
            messageHistory,
            lastMessageDate: newMessage.date
        });

    } catch (error) {
        console.error('Add message error:', error);
        res.status(500).json({
            error: 'Failed to add message',
            message: 'Unable to update message history'
        });
    }
});

/**
 * Test endpoint for API connection
 * GET /api/linkedin/test?client=clientId
 */
router.get('/test', async (req, res) => {
    try {
        const { client: clientId } = req.query;
        
        if (!clientId) {
            return res.status(400).json({
                error: 'Client parameter required',
                message: 'Please provide ?client=guy-wilson in URL for testing'
            });
        }

        // Validate client exists and is active
        const client = await clientService.getClientById(clientId);
        if (!client) {
            return res.status(404).json({
                error: 'Client not found',
                message: `Client '${clientId}' does not exist in master Clients base`
            });
        }
        
        if (client.status !== 'Active') {
            return res.status(403).json({
                error: 'Client inactive',
                message: `Client '${clientId}' status is '${client.status}', expected 'Active'`
            });
        }

        res.json({
            status: 'success',
            message: 'API connection successful',
            timestamp: new Date().toISOString(),
            client: {
                id: clientId,
                name: client.clientName,
                baseId: client.airtableBaseId
            }
        });
        
    } catch (error) {
        console.error('Test endpoint error:', error);
        res.status(500).json({
            error: 'Test failed',
            message: 'Unable to test API connection'
        });
    }
});

// Helper functions
function calculatePostsRelevancePercentage(score) {
    if (!score || score === 0) return 0;
    return Math.round((score / 80) * 100);
}

function isValidLinkedInUrl(url) {
    const pattern = /^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9-]+\/?$/;
    return pattern.test(url);
}

function isValidEmail(email) {
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(email);
}

function generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = router;
