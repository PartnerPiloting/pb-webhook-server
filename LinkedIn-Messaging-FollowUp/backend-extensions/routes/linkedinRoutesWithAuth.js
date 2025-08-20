const express = require('express');
const router = express.Router();

// Import authentication middleware
const { authenticateUserWithTestMode } = require('../../../middleware/authMiddleware');

// Import Airtable base function that can switch between client bases
const { getClientBase } = require('../../../services/clientService');

/**
 * Apply authentication to all routes
 */
router.use(authenticateUserWithTestMode);

/**
 * Helper function to get the correct Airtable base for the authenticated client
 */
async function getAirtableBase(req) {
  if (!req.client) {
    throw new Error('No authenticated client found');
  }
  
  return getClientBase(req.client.airtableBaseId);
}

/**
 * GET /api/linkedin/leads/top-scoring-posts
 * Returns leads with empty Posts Actioned and Posts Relevance Status = "Relevant"
 * Sorted by First Name, Last Name
 */
router.get('/leads/top-scoring-posts', async (req, res) => {
  console.log('LinkedIn Routes: GET /leads/top-scoring-posts called');
  console.log(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);

    console.log('LinkedIn Routes: Fetching leads from Airtable...');

    // Define field names (matching frontend)
    const FIELD_NAMES = {
      FIRST_NAME: 'First Name',
      LAST_NAME: 'Last Name',
      LINKEDIN_PROFILE_URL: 'LinkedIn Profile URL',
      AI_SCORE: 'AI Score',
      POSTS_RELEVANCE_STATUS: 'Posts Relevance Status',
      POSTS_ACTIONED: 'Posts Actioned',
      PRIORITY: 'Priority',
      STATUS: 'Status'
    };

    // Build filter to find leads with empty Posts Actioned and Posts Relevance Status = "Relevant"
    const filterFormula = `AND(
      {${FIELD_NAMES.POSTS_RELEVANCE_STATUS}} = "Relevant",
      OR(
        {${FIELD_NAMES.POSTS_ACTIONED}} = "",
        {${FIELD_NAMES.POSTS_ACTIONED}} = BLANK()
      )
    )`;

    console.log('LinkedIn Routes: Using filter:', filterFormula);

    const records = await airtableBase('Leads').select({
      filterByFormula: filterFormula,
      sort: [
        { field: FIELD_NAMES.FIRST_NAME },
        { field: FIELD_NAMES.LAST_NAME }
      ],
      maxRecords: 50  // Limit to 50 records for Load More pattern
    }).all();

    console.log(`LinkedIn Routes: Found ${records.length} top scoring posts leads`);

    // Transform records to expected format
    const transformedLeads = records.map(record => ({
      id: record.id,
      recordId: record.id,
      profileKey: record.id, // Use Airtable record ID as profile key
      firstName: record.fields[FIELD_NAMES.FIRST_NAME],
      lastName: record.fields[FIELD_NAMES.LAST_NAME],
      linkedinProfileUrl: record.fields[FIELD_NAMES.LINKEDIN_PROFILE_URL],
      aiScore: record.fields[FIELD_NAMES.AI_SCORE],
      status: record.fields[FIELD_NAMES.STATUS],
      priority: record.fields[FIELD_NAMES.PRIORITY],
      topScoringPost: record.fields['Top Scoring Post'],
      postsRelevanceStatus: record.fields[FIELD_NAMES.POSTS_RELEVANCE_STATUS],
      postsActioned: record.fields[FIELD_NAMES.POSTS_ACTIONED],
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
 * GET /api/linkedin/leads/follow-ups
 * Get leads that need follow-ups (with follow-up dates today or earlier)
 */
router.get('/leads/follow-ups', async (req, res) => {
  console.log('LinkedIn Routes: GET /leads/follow-ups called');
  console.log(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);

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
      ],
      maxRecords: 50 // Memory limit protection
    }).all();

    console.log(`LinkedIn Routes: Found ${leads.length} follow-ups for client ${req.client.clientId}`);

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
 * GET /api/linkedin/leads/search?query=searchTerm&priority=priorityLevel&searchTerms=tag1,tag2&limit=25&offset=0
 * Search for leads with optional query, priority, search terms filters and pagination
 */
router.get('/leads/search', async (req, res) => {
  console.log('LinkedIn Routes: GET /leads/search called');
  console.log(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const { query, priority, q, searchTerms, limit, offset } = req.query;
    
    // Support both 'query' and 'q' parameter names for backward compatibility
    const searchTerm = query || q;
    
    // Parse pagination parameters with defaults
    const pageLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 25)); // Default 25, max 100
    const pageOffset = Math.max(0, parseInt(offset, 10) || 0); // Default 0
    
    console.log('LinkedIn Routes: Search query:', searchTerm, 'Priority:', priority, 'Search Terms:', searchTerms, 'Limit:', pageLimit, 'Offset:', pageOffset);
    
    // Build filter formula based on query, priority, and search terms
    let filterParts = [];
    
    // Add name and LinkedIn URL search filter (only if search term provided)
    if (searchTerm && searchTerm.trim() !== '') {
      // Split search term into words for better name matching
      const searchWords = searchTerm.toLowerCase().trim().split(/\s+/);
      
      // Create search conditions for each word
      const wordSearches = searchWords.map(word => 
        `OR(
          SEARCH(LOWER("${word}"), LOWER({First Name})) > 0,
          SEARCH(LOWER("${word}"), LOWER({Last Name})) > 0,
          SEARCH(LOWER("${word}"), LOWER({LinkedIn Profile URL})) > 0
        )`
      );
      
      // Join with AND so "sally kuter" finds records that match "sally" AND "kuter"
      filterParts.push(`AND(${wordSearches.join(', ')})`);
    }

    // Add search terms filter (search in canonical tokens)
    if (searchTerms && searchTerms.trim() !== '') {
      // Parse comma-separated search terms and normalize
      const terms = searchTerms.toLowerCase().trim().split(',')
        .map(term => term.trim())
        .filter(Boolean);
      
      if (terms.length > 0) {
        // Create search conditions for each term in both canonical and regular search terms fields
        const termSearches = terms.map(term => 
          `OR(
            SEARCH("${term}", LOWER({Search Tokens (canonical)})) > 0,
            SEARCH("${term}", LOWER({Search Terms})) > 0
          )`
        );
        
        // Join with AND so all terms must be found (leads tagged with ALL specified terms)
        filterParts.push(`AND(${termSearches.join(', ')})`);
        console.log('LinkedIn Routes: Search terms filter applied for:', terms);
      }
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
    
    // Combine all filter parts - if no search/priority, just show all client leads
    const filterFormula = filterParts.length > 1 ? `AND(${filterParts.join(', ')})` : filterParts[0];

    console.log('LinkedIn Routes: Using filter:', filterFormula);

    // For pagination, we fetch more records than requested and apply pagination client-side
    // to avoid Airtable timeout issues while still providing proper pagination
    const batchSize = Math.min(500, pageLimit + pageOffset + 50); // Fetch a reasonable batch

    const selectOptions = {
      sort: [{ field: 'First Name' }, { field: 'Last Name' }],
      maxRecords: batchSize  // Fetch reasonable batch size to avoid timeouts
    };
    
    if (filterFormula) {
      selectOptions.filterByFormula = filterFormula;
    }

    const allRecords = await airtableBase('Leads').select(selectOptions).all();

    console.log(`LinkedIn Routes: Found ${allRecords.length} leads total`);
    
    // Apply pagination on the results
    const paginatedRecords = allRecords.slice(pageOffset, pageOffset + pageLimit);
    
    console.log(`LinkedIn Routes: Returning ${paginatedRecords.length} leads (offset: ${pageOffset}, limit: ${pageLimit})`);

    // Transform to expected format
    const transformedLeads = paginatedRecords.map(record => ({
      id: record.id,
      recordId: record.id,
      profileKey: record.id, // Use Airtable record ID as profile key
      firstName: record.fields['First Name'],
      lastName: record.fields['Last Name'],
      linkedinProfileUrl: record.fields['LinkedIn Profile URL'],
      aiScore: record.fields['AI Score'],
      status: record.fields['Status'],
      priority: record.fields['Priority'],
      lastMessageDate: record.fields['Last Message Date'],
      // Include search terms fields for display
      searchTerms: record.fields['Search Terms'] || '',
      searchTokensCanonical: record.fields['Search Tokens (canonical)'] || '',
      // Include contact fields for export functionality
      email: record.fields['Email'] || '',
      phone: record.fields['Phone'] || '',
      company: record.fields['Company'] || '',
      jobTitle: record.fields['Job Title'] || '',
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
 * GET /api/linkedin/leads/search-token-suggestions
 * Get search token suggestions from existing leads
 */
router.get('/leads/search-token-suggestions', async (req, res) => {
  console.log('LinkedIn Routes: GET /leads/search-token-suggestions called');
  console.log(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const { limit = 30, minCount = 1 } = req.query;
    
    console.log('LinkedIn Routes: Fetching suggestions with limit=' + limit + ', minCount=' + minCount);

    // Query leads with search terms using a view that filters for non-empty Search Terms
    const records = await airtableBase('Leads').select({
      view: 'Leads with Search Terms', // Use a filtered view if it exists
      fields: ['Search Tokens (canonical)', 'Search Terms'],
      maxRecords: 500 // Get enough records to analyze
    }).all();

    console.log(`LinkedIn Routes: Found ${records.length} lead records`);

    // Extract and count all search tokens
    const tokenCounts = new Map();
    let leadsWithSearchTerms = 0;

    records.forEach(record => {
      const canonicalTokens = record.fields['Search Tokens (canonical)'] || '';
      const regularTokens = record.fields['Search Terms'] || '';
      
      // Parse tokens more carefully - split by commas but preserve phrases
      const parseTokens = (tokensString) => {
        if (!tokensString) return [];
        
        // Split by commas first, then clean up each token
        return tokensString
          .split(',')
          .map(token => token.trim().toLowerCase())
          .filter(token => token.length > 0);
      };
      
      const canonicalList = parseTokens(canonicalTokens);
      const regularList = parseTokens(regularTokens);
      
      // Combine both lists, removing duplicates
      const allTokens = [...new Set([...canonicalList, ...regularList])];

      if (allTokens.length > 0) {
        leadsWithSearchTerms++;
        
        allTokens.forEach(token => {
          tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
        });
      }
    });

    console.log(`LinkedIn Routes: Scanned ${records.length} leads, found ${leadsWithSearchTerms} with search terms, ${tokenCounts.size} unique tokens`);

    // Convert to suggestions format and filter by minimum count
    const suggestions = Array.from(tokenCounts.entries())
      .filter(([token, count]) => count >= parseInt(minCount))
      .map(([token, count]) => ({
        term: token,
        count: count
      }))
      .sort((a, b) => b.count - a.count) // Sort by count descending
      .slice(0, parseInt(limit)); // Limit results

    res.json({ suggestions });

  } catch (error) {
    console.error('LinkedIn Routes: Error in /leads/search-token-suggestions:', error);
    res.status(500).json({ 
      error: 'Failed to fetch search token suggestions',
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
  console.log(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const leadId = req.params.id;
    
    console.log('LinkedIn Routes: Getting lead:', leadId);

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
      aiProfileAssessment: record.fields['AI Profile Assessment'],
      aiAttributeBreakdown: record.fields['AI Attribute Breakdown'],
      // Include all original fields for compatibility
      ...record.fields
    };

    console.log('LinkedIn Routes: Lead found');
    res.json(transformedLead);

  } catch (error) {
    console.error('LinkedIn Routes: Error getting lead:', error);
    if (error.statusCode === 404) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    res.status(500).json({ 
      error: 'Failed to get lead',
      details: error.message 
    });
  }
});

/**
 * PATCH /api/linkedin/leads/:id
 * Update a specific lead
 */
router.patch('/leads/:id', async (req, res) => {
  console.log('LinkedIn Routes: PATCH /leads/:id called');
  console.log(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const leadId = req.params.id;
    const updates = req.body;
    
    console.log('LinkedIn Routes: Updating lead:', leadId, 'with data:', updates);

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

    // Return the updated lead in the expected format
    const updatedLead = {
      id: updatedRecords[0].id,
      recordId: updatedRecords[0].id,
      profileKey: updatedRecords[0].id,
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
    if (error.statusCode === 404) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    res.status(500).json({ 
      error: 'Failed to update lead',
      details: error.message 
    });
  }
});

/**
 * PUT /api/linkedin/leads/:id
 * Update a specific lead (same as PATCH for compatibility)
 */
router.put('/leads/:id', async (req, res) => {
  console.log('LinkedIn Routes: PUT /leads/:id called');
  console.log(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const leadId = req.params.id;
    const updates = req.body;
    
    console.log('LinkedIn Routes: Updating lead:', leadId, 'with data:', updates);

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

    // Return the updated lead in the expected format
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
    if (error.statusCode === 404) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    res.status(500).json({ 
      error: 'Failed to update lead',
      details: error.message 
    });
  }
});

/**
 * GET /api/linkedin/leads/by-linkedin-url?url=linkedinUrl
 * Find a lead by their LinkedIn profile URL
 */
router.get('/leads/by-linkedin-url', async (req, res) => {
  console.log('LinkedIn Routes: GET /leads/by-linkedin-url called');
  console.log(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'LinkedIn URL parameter is required' });
    }
    
    console.log('LinkedIn Routes: Searching for lead with LinkedIn URL:', url);

    // Normalize the URL (remove trailing slash if present)
    let normalizedUrl = url;
    if (typeof normalizedUrl === 'string' && normalizedUrl.endsWith('/')) {
      normalizedUrl = normalizedUrl.slice(0, -1);
    }

    // Search for the lead by LinkedIn Profile URL
    const records = await airtableBase('Leads').select({
      maxRecords: 1,
      filterByFormula: `{LinkedIn Profile URL} = "${normalizedUrl}"`
    }).firstPage();

    if (!records || records.length === 0) {
      console.log('LinkedIn Routes: No lead found with LinkedIn URL:', normalizedUrl);
      return res.status(404).json({ error: 'Lead not found with that LinkedIn URL' });
    }

    const record = records[0];
    const leadData = {
      id: record.id,
      firstName: record.get('First Name') || '',
      lastName: record.get('Last Name') || '', 
      linkedinProfileUrl: record.get('LinkedIn Profile URL') || '',
      company: record.get('Company') || '',
      jobTitle: record.get('Job Title') || '',
      industry: record.get('Industry') || '',
      location: record.get('Location') || '',
      priority: record.get('Priority') || '',
      notes: record.get('Notes') || '',
      tags: record.get('Tags') || '',
      status: record.get('Status') || '',
      score: record.get('Score') || null,
      leadScoringStatus: record.get('Scoring Status') || '',
      dateScored: record.get('Date Scored') || null,
      dateAdded: record.get('Date Added') || null,
      lastContactDate: record.get('Last Contact Date') || null
    };

    console.log('LinkedIn Routes: Found lead:', leadData.firstName, leadData.lastName);
    res.json(leadData);

  } catch (error) {
    console.error('LinkedIn Routes: Error searching for lead by LinkedIn URL:', error);
    res.status(500).json({ 
      error: 'Failed to search for lead',
      details: error.message 
    });
  }
});

/**
 * POST /api/linkedin/leads
 * Creates a new lead in Airtable
 */
router.post('/leads', async (req, res) => {
  console.log('LinkedIn Routes: POST /leads called');
  console.log(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const leadData = req.body;
    const airtableBase = await getAirtableBase(req);
    
    console.log('LinkedIn Routes: Creating lead with data:', leadData);

    // DEBUG: Log exactly what we're sending to Airtable
    const recordToCreate = {
      fields: {
        ...leadData,
        'Status': 'On The Radar'
      }
    };

    console.log('LinkedIn Routes: Record to create:', recordToCreate);

    // Create the lead in Airtable
    const createdRecords = await airtableBase('Leads').create([recordToCreate]);
    
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

    console.log('LinkedIn Routes: Lead created successfully:', newLead.firstName, newLead.lastName);
    res.status(201).json(newLead);

  } catch (error) {
    console.error('LinkedIn Routes: Error creating lead:', error);
    res.status(500).json({ 
      error: 'Failed to create lead',
      details: error.message 
    });
  }
});

module.exports = router;
