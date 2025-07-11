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
            ? buildSearchFormula(searchQuery.toLowerCase())
            : ''; // Empty filter returns all records
            
        await base('Leads').select({
            filterByFormula: filterFormula,
            maxRecords: 200, // Increased from 50 to handle more leads
            sort: [
                { field: 'First Name', direction: 'asc' },
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
                    lastMessageDate: record.get('Last Message Date') || null,
                    // Include all field formats for compatibility
                    'Profile Key': record.id,
                    'First Name': record.get('First Name') || '',
                    'Last Name': record.get('Last Name') || '',
                    'LinkedIn Profile URL': record.get('LinkedIn Profile URL') || '',
                    'AI Score': record.get('AI Score') || null,
                    'Status': record.get('Status') || '',
                    'Last Message Date': record.get('Last Message Date') || null,
                    'ASH Workshop Email': Boolean(record.get('ASH Workshop Email')),
                    'Follow-Up Date': record.get('Follow-Up Date') || ''
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
        
        // Debug what's actually in Airtable
        console.log('🔍 DEBUG: Raw Airtable data for Follow-Up Date:', record.get('Follow-Up Date'));
        console.log('🔍 DEBUG: Raw Airtable data for ASH Workshop Email:', record.get('ASH Workshop Email'));
        console.log('🔍 DEBUG: Raw Airtable data for ASH Wshop Email:', record.get('ASH Wshop Email'));
        console.log('🔍 DEBUG: All available fields:', Object.keys(record.fields));
        console.log('🔍 DEBUG: All field values:', record.fields);
        console.log('🔍 DEBUG: Lead being sent to frontend - ASH Workshop Email field:', record.get('ASH Workshop Email'));
        
        const leadData = {
            id: record.id,
            // Basic information
            firstName: record.get('First Name') || '',
            lastName: record.get('Last Name') || '',
            linkedinProfileUrl: record.get('LinkedIn Profile URL') || '',
            viewInSalesNavigator: record.get('View In Sales Navigator') || '',
            email: record.get('Email') || '',
            phone: record.get('Phone') || '',
            ashWorkshopEmail: Boolean(record.get('ASH Workshop Email')),
            
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
            notes: record.get('Notes') || '',
            
            // Message history
            linkedinMessages: record.get('LinkedIn Messages') || '',
            lastMessageDate: record.get('Last Message Date') || null,
            extensionLastSync: record.get('Extension Last Sync') || null,
            
            // Additional profile data (read-only)
            headline: record.get('Headline') || '',
            jobTitle: record.get('Job Title') || '',
            companyName: record.get('Company Name') || '',
            about: record.get('About') || '',
            
            // Also include Airtable field names for compatibility
            'First Name': record.get('First Name') || '',
            'Last Name': record.get('Last Name') || '',
            'LinkedIn Profile URL': record.get('LinkedIn Profile URL') || '',
            'View In Sales Navigator': record.get('View In Sales Navigator') || '',
            'Email': record.get('Email') || '',
            'Phone': record.get('Phone') || '',
            'ASH Workshop Email': Boolean(record.get('ASH Workshop Email')),
            'Notes': record.get('Notes') || '',
            'Follow-Up Date': record.get('Follow-Up Date') || '',
            'Source': record.get('Source') || '',
            'Status': record.get('Status') || '',
            'Priority': record.get('Priority') || '',
            'LinkedIn Connection Status': record.get('LinkedIn Connection Status') || '',
            'Profile Key': record.get('Profile Key') || '',
            'AI Score': record.get('AI Score') || null,
            'Posts Relevance Percentage': calculatePostsRelevancePercentage(record.get('Post Relevance Score')),
            'Last Message Date': record.get('Last Message Date') || null
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
 * Create new lead
 * POST /api/linkedin/leads
 * Body: { firstName, lastName, linkedinProfileUrl?, source, status, ... }
 */
router.post('/leads', async (req, res) => {
    try {
        const { client: clientId } = req.query; // For testing: get client from URL parameter
        const leadData = req.body;
        
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

        // Required fields validation
        const requiredFields = ['firstName', 'lastName', 'source', 'status'];
        for (const field of requiredFields) {
            if (!leadData[field] || leadData[field].trim() === '') {
                return res.status(400).json({
                    error: 'Required field missing',
                    message: `Field '${field}' is required`
                });
            }
        }

        // Generate LinkedIn URL if not provided
        let linkedinProfileUrl = leadData.linkedinProfileUrl;
        if (!linkedinProfileUrl || linkedinProfileUrl.trim() === '') {
            const timestamp = Date.now();
            const cleanFirst = leadData.firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanLast = leadData.lastName.toLowerCase().replace(/[^a-z0-9]/g, '');
            linkedinProfileUrl = `unknown-${cleanFirst}-${cleanLast}-${timestamp}`;
        }

        // Validate LinkedIn URL format if it's a real URL (not generated placeholder)
        if (!linkedinProfileUrl.startsWith('unknown-') && !isValidLinkedInUrl(linkedinProfileUrl)) {
            return res.status(400).json({
                error: 'Invalid LinkedIn URL format',
                message: 'Please provide a valid LinkedIn profile URL'
            });
        }

        // Check for duplicate LinkedIn URL
        const existingLeads = [];
        await base('Leads').select({
            filterByFormula: `{LinkedIn Profile URL} = "${linkedinProfileUrl}"`,
            maxRecords: 1
        }).eachPage((records, fetchNextPage) => {
            records.forEach(record => {
                existingLeads.push(record);
            });
            fetchNextPage();
        });

        if (existingLeads.length > 0) {
            return res.status(409).json({
                error: 'Duplicate LinkedIn URL',
                message: 'A lead with this LinkedIn URL already exists'
            });
        }

        // Map React field names to Airtable field names
        const fieldMapping = {
            firstName: 'First Name',
            lastName: 'Last Name',
            linkedinProfileUrl: 'LinkedIn Profile URL',
            viewInSalesNavigator: 'View In Sales Navigator',
            email: 'Email',
            phone: 'Phone',
            ashWorkshopEmail: 'ASH Workshop Email',
            notes: 'Notes',
            followUpDate: 'Follow-Up Date',
            source: 'Source',
            status: 'Status',
            priority: 'Priority',
            linkedinConnectionStatus: 'LinkedIn Connection Status'
        };

        // Build create object
        const createFields = {
            'LinkedIn Profile URL': linkedinProfileUrl, // Always include this as primary key
        };

        Object.keys(leadData).forEach(reactFieldName => {
            const airtableFieldName = fieldMapping[reactFieldName];
            if (airtableFieldName && reactFieldName !== 'linkedinProfileUrl') { // Skip linkedinProfileUrl since we handled it above
                const value = leadData[reactFieldName];
                
                // Basic validation
                if (reactFieldName === 'email' && value && !isValidEmail(value)) {
                    throw new Error('Invalid email format');
                }
                
                // Handle specific field types
                if (reactFieldName === 'followUpDate') {
                    createFields[airtableFieldName] = value || null;
                } else if (reactFieldName === 'ashWorkshopEmail') {
                    createFields[airtableFieldName] = Boolean(value);
                } else if (isSelectField(airtableFieldName)) {
                    // Handle select fields - only set if value is not empty
                    if (value && value.trim() !== '') {
                        createFields[airtableFieldName] = value;
                    }
                } else {
                    createFields[airtableFieldName] = value || '';
                }
            }
        });

        // Create record in Airtable
        const createdRecord = await base('Leads').create([{
            fields: createFields
        }]);

        // Return created data in both formats (following same pattern as other routes)
        const record = createdRecord[0];
        const newLead = {
            id: record.id,
            // Return data in the format frontend expects (Airtable field names)
            'First Name': record.get('First Name') || '',
            'Last Name': record.get('Last Name') || '',
            'LinkedIn Profile URL': record.get('LinkedIn Profile URL') || '',
            'View In Sales Navigator': record.get('View In Sales Navigator') || '',
            'Email': record.get('Email') || '',
            'Phone': record.get('Phone') || '',
            'ASH Workshop Email': Boolean(record.get('ASH Workshop Email')),
            'Notes': record.get('Notes') || '',
            'Follow-Up Date': record.get('Follow-Up Date') || '',
            'Source': record.get('Source') || '',
            'Status': record.get('Status') || '',
            'Priority': record.get('Priority') || '',
            'LinkedIn Connection Status': record.get('LinkedIn Connection Status') || '',
            
            // Read-only fields
            'Profile Key': record.get('Profile Key') || '',
            'AI Score': record.get('AI Score') || null,
            postsRelevancePercentage: calculatePostsRelevancePercentage(record.get('Post Relevance Score')),
            'Last Message Date': record.get('Last Message Date') || null,
            
            // Also include camelCase versions for compatibility
            firstName: record.get('First Name') || '',
            lastName: record.get('Last Name') || '',
            linkedinProfileUrl: record.get('LinkedIn Profile URL') || '',
            viewInSalesNavigator: record.get('View In Sales Navigator') || '',
            email: record.get('Email') || '',
            phone: record.get('Phone') || '',
            ashWorkshopEmail: Boolean(record.get('ASH Workshop Email')),
            notes: record.get('Notes') || '',
            followUpDate: record.get('Follow-Up Date') || '',
            source: record.get('Source') || '',
            status: record.get('Status') || '',
            priority: record.get('Priority') || '',
            linkedinConnectionStatus: record.get('LinkedIn Connection Status') || '',
            profileKey: record.get('Profile Key') || '',
            aiScore: record.get('AI Score') || null,
            lastMessageDate: record.get('Last Message Date') || null
        };

        console.log(`Created new lead for client ${clientId}:`, record.id);
        res.status(201).json(newLead);

    } catch (error) {
        console.error('Create lead error:', error);
        res.status(500).json({
            error: 'Create failed',
            message: error.message || 'Unable to create lead'
        });
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

        // Add debugging to see what data is being sent
        console.log('🔍 DEBUG: Incoming update data:', JSON.stringify(updates, null, 2));

        // Prepare update fields (only allow editable fields)
        const updateFields = {};
        const editableFields = [
            'First Name', 'Last Name', 'LinkedIn Profile URL', 'View In Sales Navigator',
            'Email', 'Phone', 'ASH Workshop Email', 'Notes', 'Follow-Up Date', 'Source',
            'Status', 'Priority', 'LinkedIn Connection Status'
        ];

        // Map React field names to Airtable field names
        const fieldMapping = {
            firstName: 'First Name',
            lastName: 'Last Name',
            linkedinProfileUrl: 'LinkedIn Profile URL',
            viewInSalesNavigator: 'View In Sales Navigator',
            email: 'Email',
            phone: 'Phone',
            ashWorkshopEmail: 'ASH Workshop Email',
            notes: 'Notes',
            followUpDate: 'Follow-Up Date',
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
                    console.log('🔍 DEBUG: Follow-up date update - incoming value:', value, 'type:', typeof value);
                    updateFields[airtableFieldName] = value || null;
                    console.log('🔍 DEBUG: Follow-up date update - sending to Airtable:', updateFields[airtableFieldName]);
                } else if (reactFieldName === 'ashWorkshopEmail') {
                    // Handle checkbox field - convert to boolean
                    updateFields[airtableFieldName] = Boolean(value);
                } else if (isSelectField(airtableFieldName)) {
                    // Handle select fields - only update if value is not empty
                    if (value && value.trim() !== '') {
                        updateFields[airtableFieldName] = value;
                    }
                    // Skip empty select fields entirely - don't try to update them
                    console.log(`🔍 DEBUG: Skipping empty select field: ${airtableFieldName} = "${value}"`);
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

        // Add debugging to see what fields are being sent to Airtable
        console.log('🔍 DEBUG: Fields being sent to Airtable:', JSON.stringify(updateFields, null, 2));

        // Update record
        const updatedRecord = await base('Leads').update([{
            id: leadId,
            fields: updateFields
        }]);

        // Return updated data
        const record = updatedRecord[0];
        const updatedLead = {
            id: record.id,
            // Return data in the format frontend expects (Airtable field names)
            'First Name': record.get('First Name') || '',
            'Last Name': record.get('Last Name') || '',
            'LinkedIn Profile URL': record.get('LinkedIn Profile URL') || '',
            'View In Sales Navigator': record.get('View In Sales Navigator') || '',
            'Email': record.get('Email') || '',
            'Phone': record.get('Phone') || '',
            'ASH Workshop Email': Boolean(record.get('ASH Workshop Email')),
            'Notes': record.get('Notes') || '',
            'Follow-Up Date': record.get('Follow-Up Date') || '',
            'Source': record.get('Source') || '',
            'Status': record.get('Status') || '',
            'Priority': record.get('Priority') || '',
            'LinkedIn Connection Status': record.get('LinkedIn Connection Status') || '',
            
            // Read-only fields
            'Profile Key': record.get('Profile Key') || '',
            'AI Score': record.get('AI Score') || null,
            postsRelevancePercentage: calculatePostsRelevancePercentage(record.get('Post Relevance Score')),
            'Last Message Date': record.get('Last Message Date') || null,
            
            // Also include camelCase versions for compatibility
            firstName: record.get('First Name') || '',
            lastName: record.get('Last Name') || '',
            linkedinProfileUrl: record.get('LinkedIn Profile URL') || '',
            viewInSalesNavigator: record.get('View In Sales Navigator') || '',
            email: record.get('Email') || '',
            phone: record.get('Phone') || '',
            ashWorkshopEmail: Boolean(record.get('ASH Workshop Email')),
            notes: record.get('Notes') || '',
            followUpDate: record.get('Follow-Up Date') || '',
            source: record.get('Source') || '',
            status: record.get('Status') || '',
            priority: record.get('Priority') || '',
            linkedinConnectionStatus: record.get('LinkedIn Connection Status') || '',
            profileKey: record.get('Profile Key') || '',
            aiScore: record.get('AI Score') || null,
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
 * Delete lead by ID
 * DELETE /api/linkedin/leads/:leadId
 */
router.delete('/leads/:leadId', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { client: clientId } = req.query; // For testing: get client from URL parameter
        
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

        console.log(`Deleting lead ${leadId} for client: ${client.clientName} (${clientId}) → Base: ${client.airtableBaseId}`);

        // Get client's Airtable base
        const base = await getClientBase(clientId);

        // First, verify the lead exists and get its basic info for logging
        let leadInfo = null;
        try {
            const record = await base('Leads').find(leadId);
            leadInfo = {
                firstName: record.get('First Name') || '',
                lastName: record.get('Last Name') || '',
                linkedinUrl: record.get('LinkedIn Profile URL') || ''
            };
        } catch (error) {
            if (error.statusCode === 404) {
                return res.status(404).json({
                    error: 'Lead not found',
                    message: 'The requested lead does not exist'
                });
            }
            throw error; // Re-throw if it's a different error
        }

        // Delete the record
        await base('Leads').destroy([leadId]);

        console.log(`Successfully deleted lead ${leadId} for client ${clientId}: ${leadInfo.firstName} ${leadInfo.lastName}`);
        
        res.json({
            success: true,
            message: 'Lead deleted successfully',
            deletedLead: {
                id: leadId,
                firstName: leadInfo.firstName,
                lastName: leadInfo.lastName,
                linkedinUrl: leadInfo.linkedinUrl
            }
        });

    } catch (error) {
        console.error('Delete lead error:', error);
        if (error.statusCode === 404) {
            res.status(404).json({
                error: 'Lead not found',
                message: 'The requested lead does not exist'
            });
        } else {
            res.status(500).json({
                error: 'Delete failed',
                message: error.message || 'Unable to delete lead'
            });
        }
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
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Helper function to identify select fields
function isSelectField(fieldName) {
    const selectFields = [
        'Source',
        'Status', 
        'Priority',
        'LinkedIn Connection Status',
        'Scoring Status'
    ];
    return selectFields.includes(fieldName);
}

/**
 * Build search formula for Airtable to handle single words and multi-word searches
 * Examples:
 * - "justin" → searches first name and last name for "justin"
 * - "justin c" → searches for first name containing "justin" AND last name starting with "c"
 */
function buildSearchFormula(searchQuery) {
    const query = searchQuery.trim().toLowerCase();
    
    // Handle multi-word searches (e.g., "justin c")
    if (query.includes(' ')) {
        const parts = query.split(/\s+/);
        const [firstPart, ...restParts] = parts;
        const lastPart = restParts.join(' ');
        
        // Search for first name containing first part AND last name starting with last part
        // Using FIND which is case-insensitive in Airtable
        return `AND(
            FIND("${firstPart}", LOWER({First Name})) > 0,
            FIND("${lastPart}", LOWER({Last Name})) = 1
        )`;
    }
    
    // Single word search - check both first and last name
    return `OR(
        FIND("${query}", LOWER({First Name})) > 0,
        FIND("${query}", LOWER({Last Name})) > 0
    )`;
}

module.exports = router;
