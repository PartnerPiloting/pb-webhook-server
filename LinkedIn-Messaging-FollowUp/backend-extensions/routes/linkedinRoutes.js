// LinkedIn-Messaging-FollowUp/backend-extensions/routes/linkedinRoutes.js

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
        OR({${FIELD_NAMES.POSTS_ACTIONED}} = '', {${FIELD_NAMES.POSTS_ACTIONED}} = BLANK()),
        {${FIELD_NAMES.POSTS_RELEVANCE_STATUS}} = 'Relevant'
      )`,
      sort: [
        { field: FIELD_NAMES.FIRST_NAME, direction: 'asc' },
        { field: FIELD_NAMES.LAST_NAME, direction: 'asc' }
      ]
    }).all();

    console.log(`LinkedIn Routes: Found ${leads.length} leads with Posts Relevance Status = "Relevant"`);

    // Transform records to include id and fields
    const transformedLeads = leads.map(record => ({
      id: record.id,
      recordId: record.id,
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
 * PUT /api/linkedin/leads/:id
 * Update a lead's fields
 */
router.put('/leads/:id', async (req, res) => {
  console.log('LinkedIn Routes: PUT /leads/:id called');
  
  try {
    const leadId = req.params.id;
    const updates = req.body;
    
    console.log('LinkedIn Routes: Updating lead:', leadId, 'with:', updates);

    // Update the lead in Airtable using the main base
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

module.exports = router;
