const express = require('express');
const router = express.Router();

// Import Airtable base directly instead of validateClient
const airtableBase = require('../../../config/airtableClient');

/**
 * GET /api/linkedin/leads/top-scoring-posts?client=clientId
 * Returns leads with empty Posts Actioned and Posts Relevance Status = "Relevant"
 * Sorted by First Name, Last Name
 */
router.get('/leads/top-scoring-posts', async (req, res) => {
  console.log('LinkedIn Routes: GET /leads/top-scoring-posts called');
  
  try {
    const clientId = req.query.client;
    console.log('LinkedIn Routes: Client ID:', clientId);
    
    if (!clientId) {
      return res.status(400).json({ error: 'Client parameter is required' });
    }

    console.log('LinkedIn Routes: Fetching leads from Airtable...');

    // Define field names (matching frontend)
    const FIELD_NAMES = {
      FIRST_NAME: 'First Name',
      LAST_NAME: 'Last Name',
      LINKEDIN_PROFILE_URL: 'LinkedIn Profile URL',
      AI_SCORE: 'AI Score',
      POSTS_RELEVANCE_PERCENTAGE: 'Posts Relevance Percentage',
      TOP_SCORING_POST: 'Top Scoring Post',
      POSTS_ACTIONED: 'Posts Actioned',
      POSTS_RELEVANCE_SCORE: 'Posts Relevance Score',
      POSTS_RELEVANCE_STATUS: 'Posts Relevance Status'
    };

    // Query Airtable for leads with:
    // - Posts Actioned is empty/null 
    // - Posts Relevance Status = "Relevant"
    const leads = await airtableBase('Leads').select({
      filterByFormula: `AND(
        OR({Posts Actioned} = '', {Posts Actioned} = BLANK()),
        {Posts Relevance Status} = 'Relevant'
      )`,
      sort: [
        { field: 'First Name', direction: 'asc' },
        { field: 'Last Name', direction: 'asc' }
      ]
    }).all();

    console.log(`LinkedIn Routes: Found ${leads.length} leads with Posts Relevance Status = "Relevant"`);

    // Transform records to match frontend API expectations
    const transformedLeads = leads.map(record => ({
      id: record.id,
      recordId: record.id,
      profileKey: record.id, // Use Airtable record ID as profile key
      firstName: record.fields['First Name'],
      lastName: record.fields['Last Name'],
      linkedinProfileUrl: record.fields['LinkedIn Profile URL'],
      viewInSalesNavigator: record.fields['View In Sales Navigator'],
      aiScore: record.fields['AI Score'],
      postsRelevanceScore: record.fields['Posts Relevance Score'],
      postsRelevancePercentage: record.fields['Posts Relevance Percentage'],
      topScoringPost: record.fields['Top Scoring Post'],
      postsActioned: record.fields['Posts Actioned'],
      postsRelevanceStatus: record.fields['Posts Relevance Status'],
      // Include all original fields for compatibility
      ...record.fields
    }));

    res.json(transformedLeads);
  } catch (error) {
    console.error('LinkedIn Routes: Error in /leads/top-scoring-posts:', error);
    res.status(500).json({
      error: 'Failed to fetch top scoring posts',
      details: error.message
    });
  }
});

/**
 * GET /api/linkedin/leads/follow-ups?client=clientId
 * Get leads that need follow-ups
 */
router.get('/leads/follow-ups', async (req, res) => {
  console.log('LinkedIn Routes: GET /leads/follow-ups called');
  
  try {
    const clientId = req.query.client;
    console.log('LinkedIn Routes: Client ID:', clientId);

    // Get leads with Follow-Up Date set (including overdue dates)
    // This includes leads with follow-up dates today or earlier as per frontend expectations
    const leads = await airtableBase('Leads').select({
      filterByFormula: `AND(
        {Follow-Up Date} != '',
        {Follow-Up Date} <= TODAY()
      )`,
      sort: [
        { field: 'Follow-Up Date', direction: 'asc' },
        { field: 'First Name', direction: 'asc' }
      ]
    }).all();

    console.log(`LinkedIn Routes: Found ${leads.length} follow-ups`);

    // Transform to expected format with days calculation
    const transformedLeads = leads.map(record => {
      const followUpDate = record.fields['Follow-Up Date'];
      let daysUntilFollowUp = null;
      
      if (followUpDate) {
        const today = new Date();
        const followUp = new Date(followUpDate);
        daysUntilFollowUp = Math.ceil((followUp - today) / (1000 * 60 * 60 * 24));
      }

      return {
        id: record.id,
        recordId: record.id,
        profileKey: record.id, // Use Airtable record ID as profile key
        firstName: record.fields['First Name'],
        lastName: record.fields['Last Name'],
        linkedinProfileUrl: record.fields['LinkedIn Profile URL'],
        followUpDate: record.fields['Follow-Up Date'],
        aiScore: record.fields['AI Score'],
        status: record.fields['Status'],
        lastMessageDate: record.fields['Last Message Date'],
        notes: record.fields['Notes'],
        daysUntilFollowUp: daysUntilFollowUp,
        // Include all original fields for compatibility
        ...record.fields
      };
    });

    res.json(transformedLeads);

  } catch (error) {
    console.error('LinkedIn Routes: Error in /leads/follow-ups:', error);
    res.status(500).json({ 
      error: 'Failed to fetch follow-ups',
      details: error.message 
    });
  }
});

/**
 * GET /api/linkedin/leads/search?q=query&priority=priority&client=clientId
 * Search for leads by name and optionally filter by priority
 */
router.get('/leads/search', async (req, res) => {
  console.log('LinkedIn Routes: GET /leads/search called');
  
  try {
    const query = req.query.q;
    const priority = req.query.priority;
    const clientId = req.query.client;
    
    console.log('LinkedIn Routes: Search query:', query, 'Priority:', priority, 'Client:', clientId);
    
    // Build filter formula based on query and priority
    let filterParts = [];
    
    // Add name search filter
    if (query && query.trim() !== '') {
      filterParts.push(`OR(
        SEARCH(LOWER("${query}"), LOWER({First Name})) > 0,
        SEARCH(LOWER("${query}"), LOWER({Last Name})) > 0
      )`);
    }
    
    // Add priority filter
    if (priority && priority !== 'all') {
      filterParts.push(`{Priority} = "${priority}"`);
    }
    
    // Always exclude multi-tenant entries
    filterParts.push(`NOT(OR(
      SEARCH("multi", LOWER({First Name})) > 0,
      SEARCH("multi", LOWER({Last Name})) > 0,
      SEARCH("tenant", LOWER({First Name})) > 0,
      SEARCH("tenant", LOWER({Last Name})) > 0
    ))`);
    
    // Combine filters with AND
    const filterFormula = filterParts.length > 1 ? `AND(${filterParts.join(', ')})` : filterParts[0];

    // Search leads in Airtable by First Name or Last Name
    // Exclude Multi-Tenant related entries (as per frontend filtering)
    const leads = await airtableBase('Leads').select({
      filterByFormula: filterFormula,
      sort: [
        { field: 'First Name', direction: 'asc' },
        { field: 'Last Name', direction: 'asc' }
      ],
      maxRecords: 25 // Limit to 25 results as per frontend
    }).all();

    console.log(`LinkedIn Routes: Found ${leads.length} leads matching "${query}" with priority "${priority}"`);

    // Transform to expected format
    const transformedLeads = leads.map(record => ({
      id: record.id,
      recordId: record.id,
      profileKey: record.id, // Use Airtable record ID as profile key
      firstName: record.fields['First Name'],
      lastName: record.fields['Last Name'],
      linkedinProfileUrl: record.fields['LinkedIn Profile URL'],
      aiScore: record.fields['AI Score'],
      status: record.fields['Status'],
      priority: record.fields['Priority'], // Include Priority field
      lastMessageDate: record.fields['Last Message Date'],
      // Include all original fields for compatibility
      ...record.fields
    }));

    res.json(transformedLeads);

  } catch (error) {
    console.error('LinkedIn Routes: Error in /leads/search:', error);
    res.status(500).json({ 
      error: 'Failed to search leads',
      details: error.message 
    });
  }
});

/**
 * GET /api/linkedin/leads/:id
 * Get a specific lead by ID
 */
router.get('/leads/:id', async (req, res) => {
  console.log('LinkedIn Routes: GET /leads/:id called');
  
  try {
    const leadId = req.params.id;
    const clientId = req.query.client;
    
    console.log('LinkedIn Routes: Getting lead:', leadId, 'Client:', clientId);

    // Get the lead from Airtable
    const record = await airtableBase('Leads').find(leadId);

    const transformedLead = {
      id: record.id,
      recordId: record.id,
      profileKey: record.id, // Use Airtable record ID as profile key
      firstName: record.fields['First Name'],
      lastName: record.fields['Last Name'],
      linkedinProfileUrl: record.fields['LinkedIn Profile URL'],
      viewInSalesNavigator: record.fields['View In Sales Navigator'],
      email: record.fields['Email'],
      phone: record.fields['Phone'],
      aiScore: record.fields['AI Score'],
      postsRelevanceScore: record.fields['Posts Relevance Score'],
      postsRelevancePercentage: record.fields['Posts Relevance Percentage'],
      source: record.fields['Source'],
      status: record.fields['Status'],
      priority: record.fields['Priority'],
      linkedinConnectionStatus: record.fields['LinkedIn Connection Status'],
      followUpDate: record.fields['Follow-Up Date'],
      followUpNotes: record.fields['Follow Up Notes'],
      notes: record.fields['Notes'],
      linkedinMessages: record.fields['LinkedIn Messages'],
      lastMessageDate: record.fields['Last Message Date'],
      extensionLastSync: record.fields['Extension Last Sync'],
      headline: record.fields['Headline'],
      jobTitle: record.fields['Job Title'],
      companyName: record.fields['Company Name'],
      about: record.fields['About'],
      ashWorkshopEmail: record.fields['ASH Workshop Email'],
      // Include all original fields for compatibility
      ...record.fields
    };

    console.log('LinkedIn Routes: Lead found');
    res.json(transformedLead);

  } catch (error) {
    console.error('LinkedIn Routes: Error getting lead:', error);
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Lead not found' });
    } else {
      res.status(500).json({ 
        error: 'Failed to get lead',
        details: error.message 
      });
    }
  }
});

/**
 * POST /api/linkedin/leads
 * Create a new lead
 */
router.post('/leads', async (req, res) => {
  console.log('LinkedIn Routes: POST /leads called');
  
  try {
    const leadData = req.body;
    const clientId = req.query.client;
    
    console.log('LinkedIn Routes: Creating lead with data:', leadData, 'Client:', clientId);

    // Transform frontend field names to backend/Airtable field names
    const airtableFields = {
      'First Name': leadData.firstName,
      'Last Name': leadData.lastName,
      'LinkedIn Profile URL': leadData.linkedinProfileUrl,
      'View In Sales Navigator': leadData.viewInSalesNavigator,
      'Email': leadData.email,
      'Phone': leadData.phone,
      'Notes': leadData.notes,
      'Follow-Up Date': leadData.followUpDate,
      'Follow Up Notes': leadData.followUpNotes,
      'Source': leadData.source,
      'Status': leadData.status,
      'Priority': leadData.priority,
      'LinkedIn Connection Status': leadData.linkedinConnectionStatus,
      'ASH Workshop Email': leadData.ashWorkshopEmail
    };

    // Remove undefined values
    Object.keys(airtableFields).forEach(key => {
      if (airtableFields[key] === undefined) {
        delete airtableFields[key];
      }
    });

    // Create the lead in Airtable
    const createdRecords = await airtableBase('Leads').create([{ fields: airtableFields }]);

    if (createdRecords.length === 0) {
      return res.status(500).json({ error: 'Failed to create lead' });
    }

    const newLead = {
      id: createdRecords[0].id,
      recordId: createdRecords[0].id,
      profileKey: createdRecords[0].id, // Use Airtable record ID as profile key
      firstName: createdRecords[0].fields['First Name'],
      lastName: createdRecords[0].fields['Last Name'],
      linkedinProfileUrl: createdRecords[0].fields['LinkedIn Profile URL'],
      viewInSalesNavigator: createdRecords[0].fields['View In Sales Navigator'],
      email: createdRecords[0].fields['Email'],
      phone: createdRecords[0].fields['Phone'],
      notes: createdRecords[0].fields['Notes'],
      followUpDate: createdRecords[0].fields['Follow-Up Date'],
      followUpNotes: createdRecords[0].fields['Follow Up Notes'],
      source: createdRecords[0].fields['Source'],
      status: createdRecords[0].fields['Status'],
      priority: createdRecords[0].fields['Priority'],
      linkedinConnectionStatus: createdRecords[0].fields['LinkedIn Connection Status'],
      ashWorkshopEmail: createdRecords[0].fields['ASH Workshop Email'],
      // Include all original fields for compatibility
      ...createdRecords[0].fields
    };

    console.log('LinkedIn Routes: Lead created successfully');
    res.status(201).json(newLead);

  } catch (error) {
    console.error('LinkedIn Routes: Error creating lead:', error);
    res.status(500).json({ 
      error: 'Failed to create lead',
      details: error.message 
    });
  }
});

/**
 * PUT /api/linkedin/leads/:id
 * Update a lead by ID
 */
router.put('/leads/:id', async (req, res) => {
  console.log('LinkedIn Routes: PUT /leads/:id called');
  
  try {
    const leadId = req.params.id;
    const updates = req.body;
    const clientId = req.query.client;
    
    console.log('LinkedIn Routes: Updating lead:', leadId, 'Updates:', updates, 'Client:', clientId);

    // Update the lead in Airtable
    const updatedRecords = await airtableBase('Leads').update([
      {
        id: leadId,
        fields: updates
      }
    ]);

    if (updatedRecords.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updatedLead = {
      id: updatedRecords[0].id,
      recordId: updatedRecords[0].id,
      profileKey: updatedRecords[0].id, // Use Airtable record ID as profile key
      firstName: updatedRecords[0].fields['First Name'],
      lastName: updatedRecords[0].fields['Last Name'],
      linkedinProfileUrl: updatedRecords[0].fields['LinkedIn Profile URL'],
      viewInSalesNavigator: updatedRecords[0].fields['View In Sales Navigator'],
      email: updatedRecords[0].fields['Email'],
      phone: updatedRecords[0].fields['Phone'],
      notes: updatedRecords[0].fields['Notes'],
      followUpDate: updatedRecords[0].fields['Follow-Up Date'],
      followUpNotes: updatedRecords[0].fields['Follow Up Notes'],
      source: updatedRecords[0].fields['Source'],
      status: updatedRecords[0].fields['Status'],
      priority: updatedRecords[0].fields['Priority'],
      linkedinConnectionStatus: updatedRecords[0].fields['LinkedIn Connection Status'],
      ashWorkshopEmail: updatedRecords[0].fields['ASH Workshop Email'],
      aiScore: updatedRecords[0].fields['AI Score'],
      postsRelevanceScore: updatedRecords[0].fields['Posts Relevance Score'],
      postsRelevancePercentage: updatedRecords[0].fields['Posts Relevance Percentage'],
      // Include all original fields for compatibility
      ...updatedRecords[0].fields
    };

    console.log('LinkedIn Routes: Lead updated successfully');
    res.json(updatedLead);

  } catch (error) {
    console.error('LinkedIn Routes: Error updating lead:', error);
    res.status(500).json({ 
      error: 'Failed to update lead',
      details: error.message 
    });
  }
});

/**
 * DELETE /api/linkedin/leads/:id
 * Delete a lead
 */

/**
 * GET /api/linkedin/leads/follow-ups?client=clientId
 * Get leads that need follow-ups
 */

/**
 * GET /api/linkedin/leads/follow-ups?client=clientId
 * Get leads that need follow-ups
 */
router.get('/leads/follow-ups', async (req, res) => {
  console.log('LinkedIn Routes: GET /leads/follow-ups called');
  
  try {
    const clientId = req.query.client;
    console.log('LinkedIn Routes: Client ID:', clientId);

    // Get leads with Follow-Up Date set (including overdue dates)
    // This includes leads with follow-up dates today or earlier as per frontend expectations
    const leads = await airtableBase('Leads').select({
      filterByFormula: `AND(
        {Follow-Up Date} != '',
        {Follow-Up Date} <= TODAY()
      )`,
      sort: [
        { field: 'Follow-Up Date', direction: 'asc' },
        { field: 'First Name', direction: 'asc' }
      ]
    }).all();

    console.log(`LinkedIn Routes: Found ${leads.length} follow-ups`);

    // Transform to expected format with days calculation
    const transformedLeads = leads.map(record => {
      const followUpDate = record.fields['Follow-Up Date'];
      let daysUntilFollowUp = null;
      
      if (followUpDate) {
        const today = new Date();
        const followUp = new Date(followUpDate);
        daysUntilFollowUp = Math.ceil((followUp - today) / (1000 * 60 * 60 * 24));
      }

      return {
        id: record.id,
        recordId: record.id,
        profileKey: record.id, // Use Airtable record ID as profile key
        firstName: record.fields['First Name'],
        lastName: record.fields['Last Name'],
        linkedinProfileUrl: record.fields['LinkedIn Profile URL'],
        followUpDate: record.fields['Follow-Up Date'],
        aiScore: record.fields['AI Score'],
        status: record.fields['Status'],
        lastMessageDate: record.fields['Last Message Date'],
        notes: record.fields['Notes'],
        daysUntilFollowUp: daysUntilFollowUp,
        // Include all original fields for compatibility
        ...record.fields
      };
    });

    res.json(transformedLeads);

  } catch (error) {
    console.error('LinkedIn Routes: Error in /leads/follow-ups:', error);
    res.status(500).json({ 
      error: 'Failed to fetch follow-ups',
      details: error.message 
    });
  }
});

/**
 * GET /api/linkedin/leads/by-linkedin-url?url=linkedinUrl
 * Find a lead by LinkedIn URL
 */
router.get('/leads/by-linkedin-url', async (req, res) => {
  console.log('LinkedIn Routes: GET /leads/by-linkedin-url called');
  
  try {
    const linkedinUrl = req.query.url;
    
    console.log('LinkedIn Routes: Searching for LinkedIn URL:', linkedinUrl);
    
    if (!linkedinUrl) {
      return res.status(400).json({ error: 'LinkedIn URL parameter is required' });
    }

    // Search for lead by LinkedIn Profile URL
    const leads = await airtableBase('Leads').select({
      filterByFormula: `{LinkedIn Profile URL} = "${linkedinUrl}"`,
      maxRecords: 1
    }).all();

    if (leads.length === 0) {
      return res.status(404).json({ error: 'Lead not found with that LinkedIn URL' });
    }

    const lead = {
      id: leads[0].id,
      recordId: leads[0].id,
      profileKey: leads[0].id, // Use Airtable record ID as profile key
      firstName: leads[0].fields['First Name'],
      lastName: leads[0].fields['Last Name'],
      linkedinProfileUrl: leads[0].fields['LinkedIn Profile URL'],
      // Include all original fields for compatibility
      ...leads[0].fields
    };

    console.log('LinkedIn Routes: Lead found by LinkedIn URL');
    res.json(lead);

  } catch (error) {
    console.error('LinkedIn Routes: Error finding lead by LinkedIn URL:', error);
    res.status(500).json({ 
      error: 'Failed to find lead by LinkedIn URL',
      details: error.message 
    });
  }
});

/**
 * POST /api/linkedin/leads/:id/messages
 * Add message to lead's message history
 */
router.post('/leads/:id/messages', async (req, res) => {
  console.log('LinkedIn Routes: POST /leads/:id/messages called');
  
  try {
    const leadId = req.params.id;
    const messageData = req.body;
    
    console.log('LinkedIn Routes: Adding message to lead:', leadId, 'Message:', messageData);

    // Get current lead to append to existing messages
    const record = await airtableBase('Leads').find(leadId);
    const currentMessages = record.fields['LinkedIn Messages'] || '';
    
    // Format new message entry
    const timestamp = new Date().toISOString();
    const newMessageEntry = `[${timestamp}] ${messageData.message || messageData.content || ''}`;
    
    // Append to existing messages
    const updatedMessages = currentMessages 
      ? `${currentMessages}\n${newMessageEntry}`
      : newMessageEntry;

    // Update the lead with new message
    const updatedRecords = await airtableBase('Leads').update([
      {
        id: leadId,
        fields: {
          'LinkedIn Messages': updatedMessages,
          'Last Message Date': timestamp
        }
      }
    ]);

    const updatedLead = {
      id: updatedRecords[0].id,
      recordId: updatedRecords[0].id,
      profileKey: updatedRecords[0].id, // Use Airtable record ID as profile key
      firstName: updatedRecords[0].fields['First Name'],
      lastName: updatedRecords[0].fields['Last Name'],
      linkedinMessages: updatedRecords[0].fields['LinkedIn Messages'],
      lastMessageDate: updatedRecords[0].fields['Last Message Date'],
      // Include all original fields for compatibility
      ...updatedRecords[0].fields
    };

    console.log('LinkedIn Routes: Message added successfully');
    res.json(updatedLead);

  } catch (error) {
    console.error('LinkedIn Routes: Error adding message:', error);
    res.status(500).json({ 
      error: 'Failed to add message',
      details: error.message 
    });
  }
});

/**
 * GET /api/linkedin/leads/:id/messages
 * Get message history for a lead
 */
router.get('/leads/:id/messages', async (req, res) => {
  console.log('LinkedIn Routes: GET /leads/:id/messages called');
  
  try {
    const leadId = req.params.id;
    
    console.log('LinkedIn Routes: Getting messages for lead:', leadId);

    // Get the lead from Airtable
    const record = await airtableBase('Leads').find(leadId);
    const messages = record.fields['LinkedIn Messages'] || '';

    // Parse messages into array
    const messageHistory = messages 
      ? messages.split('\n').filter(msg => msg.trim())
      : [];

    console.log('LinkedIn Routes: Messages retrieved');
    res.json({ messages: messageHistory });

  } catch (error) {
    console.error('LinkedIn Routes: Error getting messages:', error);
    res.status(500).json({ 
      error: 'Failed to get message history',
      details: error.message 
    });
  }
});

/**
 * POST /api/linkedin/extension/sync
 * Sync data from Chrome extension
 */
router.post('/extension/sync', async (req, res) => {
  console.log('LinkedIn Routes: POST /extension/sync called');
  
  try {
    const syncData = req.body;
    
    console.log('LinkedIn Routes: Syncing extension data:', syncData);

    // This would handle syncing data from the Chrome extension
    // For now, just acknowledge the sync
    res.json({ 
      message: 'Extension sync received',
      timestamp: new Date().toISOString(),
      data: syncData
    });

  } catch (error) {
    console.error('LinkedIn Routes: Error in extension sync:', error);
    res.status(500).json({ 
      error: 'Failed to sync extension data',
      details: error.message 
    });
  }
});

module.exports = router;
