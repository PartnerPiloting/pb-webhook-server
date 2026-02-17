const express = require('express');
const { createLogger } = require('../../../utils/contextLogger');
const { stripCredentialSuffixes } = require('../../../utils/nameNormalizer');
const geminiConfig = require('../../../config/geminiClient');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'api' });

// Gemini AI for message generation
const vertexAIClient = geminiConfig ? geminiConfig.vertexAIClient : null;
const geminiModelId = geminiConfig ? geminiConfig.geminiModelId : null;

console.log('✅ linkedinRoutesWithAuth.js loaded - logger initialized:', typeof logger);

const router = express.Router();

// Import authentication middleware
const { authenticateUserWithTestMode } = require('../../../middleware/authMiddleware');

// Import Airtable base function that can switch between client bases
const { getClientBase } = require('../../../services/clientService');
// Load scoring attributes to compute dynamic max score
const { loadPostScoringAirtableConfig } = require('../../../postAttributeLoader');

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
  logger.info('LinkedIn Routes: GET /leads/top-scoring-posts called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);

    logger.info('LinkedIn Routes: Fetching leads from Airtable...');

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

    // Optional threshold filters
    const { minPerc, minScore, threshold } = req.query || {};
    let minPercNum = Number.parseFloat(minPerc ?? threshold);
    let minScoreNum = Number.parseFloat(minScore);

    // Compute dynamic maxPossibleScore from active Post Scoring Attributes
    // and derive minScore from percentage when provided or defaulted from Credentials
    let maxPossibleScore = 0;
    try {
      const config = { attributesTableName: 'Post Scoring Attributes', promptComponentsTableName: 'Post Scoring Instructions' };
      const loaded = await loadPostScoringAirtableConfig(airtableBase, config);
      const attrs = loaded?.attributesById || {};
      for (const a of Object.values(attrs)) {
        const active = a?.active !== false; // default to true if undefined
        const val = Number(a?.maxScorePointValue);
        if (active && Number.isFinite(val)) maxPossibleScore += val;
      }
    } catch (e) {
      logger.warn('LinkedIn Routes: Failed to load Post Scoring Attributes for max score:', e?.message || e);
    }
    if (!Number.isFinite(maxPossibleScore) || maxPossibleScore <= 0) {
      // Fallback to a safe default to avoid hiding all results
      maxPossibleScore = 100;
    }

    // If no explicit minScore provided, compute it from minPerc or Credentials default
    if (!Number.isFinite(minScoreNum)) {
      // Determine effective percent
      if (!Number.isFinite(minPercNum)) {
        try {
          const creds = await airtableBase('Credentials').select({ maxRecords: 1 }).firstPage();
          const row = creds && creds[0];
          const raw = row ? row.get('Posts Threshold Percentage') : undefined;
          minPercNum = Number.parseFloat(raw);
        } catch (e) {
          logger.warn('LinkedIn Routes: Could not read Posts Threshold Percentage from Credentials:', e?.message || e);
        }
      }
      if (!Number.isFinite(minPercNum)) minPercNum = 0;
      minScoreNum = Math.ceil((minPercNum / 100) * maxPossibleScore);
    }

    // Build filter to find leads with empty Posts Actioned and enforce minimum Posts Relevance Score
    const filterParts = [
      `OR({${FIELD_NAMES.POSTS_ACTIONED}} = "", {${FIELD_NAMES.POSTS_ACTIONED}} = BLANK())`,
      `{Posts Relevance Score} >= ${Number.isFinite(minScoreNum) ? minScoreNum : 0}`
    ];
    // Optionally ensure a Top Scoring Post exists
    filterParts.push(`NOT({Top Scoring Post} = BLANK())`);
    const filterFormula = `AND(${filterParts.join(', ')})`;

    logger.info('LinkedIn Routes: Using filter:', filterFormula);

    const records = await airtableBase('Leads').select({
      filterByFormula: filterFormula,
      sort: [
        { field: FIELD_NAMES.FIRST_NAME },
        { field: FIELD_NAMES.LAST_NAME }
      ],
      maxRecords: 50  // Limit to 50 records for Load More pattern
    }).all();

    logger.info(`LinkedIn Routes: Found ${records.length} top scoring posts leads (limited to 50)`);

    // Get total count without limit for display purposes
    let totalCount = records.length;
    try {
      const countRecords = await airtableBase('Leads').select({
        filterByFormula: filterFormula,
        fields: [FIELD_NAMES.FIRST_NAME] // Minimal field to speed up count query
      }).all();
      totalCount = countRecords.length;
      logger.info(`LinkedIn Routes: Total matching records: ${totalCount}`);
    } catch (countError) {
      logger.warn('LinkedIn Routes: Could not get total count:', countError.message);
      // Fall back to returned count if total count fails
    }

    // Transform records to expected format and include computed helpers
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
      postsRelevanceScore: record.fields['Posts Relevance Score'],
      // Back-compat: retain fields if they exist in Airtable
      postsRelevanceStatus: record.fields[FIELD_NAMES.POSTS_RELEVANCE_STATUS],
      postsActioned: record.fields[FIELD_NAMES.POSTS_ACTIONED],
      // New helper fields
      postsMaxPossibleScore: maxPossibleScore,
      computedPostsRelevancePercentage: (() => {
        const s = Number(record.fields['Posts Relevance Score']);
        return Number.isFinite(s) && maxPossibleScore > 0 ? Math.round((s / maxPossibleScore) * 100) : null;
      })(),
      // Include all original fields for compatibility
      ...record.fields
    }));

    res.json({
      leads: transformedLeads,
      total: totalCount,
      displayed: transformedLeads.length
    });

  } catch (error) {
    logger.error('LinkedIn Routes: Error in /leads/top-scoring-posts:', error);
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
  logger.info('LinkedIn Routes: GET /leads/follow-ups called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
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
      ]
      // No maxRecords limit - return all leads needing follow-up
    }).all();

    logger.info(`LinkedIn Routes: Found ${leads.length} follow-ups for client ${req.client.clientId}`);

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
    logger.error('LinkedIn Routes: Error in /leads/follow-ups:', error);
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
  logger.info('LinkedIn Routes: GET /leads/search called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const { query, priority, q, searchTerms, limit, offset, sortField, sortDirection } = req.query;
    
    // Support both 'query' and 'q' parameter names for backward compatibility
    const searchTerm = query || q;
    
    // Parse pagination parameters with defaults
    const pageLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 25)); // Default 25, max 100
    const pageOffset = Math.max(0, parseInt(offset, 10) || 0); // Default 0
    
    logger.info('LinkedIn Routes: Search query:', searchTerm, 'Priority:', priority, 'Search Terms:', searchTerms, 'Limit:', pageLimit, 'Offset:', pageOffset);
    
    // Build filter formula based on query, priority, and search terms
    let filterParts = [];
    
    // Track if any filters are applied (for total count optimization)
    const hasFilters = (searchTerm && searchTerm.trim() !== '') || (priority && priority !== 'all') || (searchTerms && searchTerms.trim() !== '');
    
    // Add name, email, and LinkedIn URL search filter (only if search term provided)
    if (searchTerm && searchTerm.trim() !== '') {
      const trimmedSearch = searchTerm.trim();
      
      // Check if search term is an email address (same pattern as /api/calendar/lookup-lead)
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedSearch);
      
      if (isEmail) {
        // Email lookup - exact match on Email field
        filterParts.push(`LOWER({Email}) = LOWER('${trimmedSearch}')`);
        logger.info('LinkedIn Routes: Email search detected, using exact match');
      } else {
        // Split search term into words for better name matching
        const searchWords = trimmedSearch.toLowerCase().split(/\s+/);
        
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
    }

    // Add search terms filter with boolean logic support
    if (searchTerms && searchTerms.trim() !== '') {
      const { parseBooleanSearch } = require('../../../utils/booleanSearchParser');
      
      try {
        // Parse boolean search query (supports AND, OR, NOT, parentheses, quotes)
        const booleanFormula = parseBooleanSearch(
          searchTerms,
          ['{Search Tokens (canonical)}', '{Search Terms}']
        );
        
        if (booleanFormula) {
          filterParts.push(booleanFormula);
          logger.info('LinkedIn Routes: Boolean search filter applied for:', searchTerms);
        }
      } catch (error) {
        logger.warn('LinkedIn Routes: Boolean search parsing failed, falling back to simple search:', error.message);
        // Fallback to old comma-separated behavior
        const terms = searchTerms.toLowerCase().trim().split(',')
          .map(term => term.trim())
          .filter(Boolean);
        
        if (terms.length > 0) {
          const termSearches = terms.map(term => 
            `OR(
              SEARCH("${term}", LOWER({Search Tokens (canonical)})) > 0,
              SEARCH("${term}", LOWER({Search Terms})) > 0
            )`
          );
          filterParts.push(`AND(${termSearches.join(', ')})`);
          logger.info('LinkedIn Routes: Search terms filter applied for:', terms);
        }
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

    logger.info('LinkedIn Routes: Using filter:', filterFormula);

    // Map frontend sort keys to Airtable field names
    const sortFieldMap = {
      'fullName': 'First Name',
      'AI Score': 'AI Score',
      'Company': 'Company',
      'location': 'Location',
      'Priority': 'Priority',
      'Status': 'Status',
      'First Name': 'First Name',
      'Last Name': 'Last Name',
      'Location': 'Location'
    };
    
    // Determine sort configuration
    const effectiveSortField = sortFieldMap[sortField] || 'First Name';
    const effectiveSortDir = sortDirection === 'asc' ? 'asc' : 'desc';
    
    // Build sort array - for fullName, sort by First Name then Last Name
    let sortConfig;
    if (sortField === 'fullName' || !sortField) {
      // Default or name sort: First Name + Last Name
      sortConfig = [
        { field: 'First Name', direction: effectiveSortDir },
        { field: 'Last Name', direction: effectiveSortDir }
      ];
    } else {
      // Single field sort
      sortConfig = [{ field: effectiveSortField, direction: effectiveSortDir }];
    }
    
    logger.info('LinkedIn Routes: Sort config:', JSON.stringify(sortConfig));

    // Stream Airtable pages and return only the requested slice (offset, limit)
    // This avoids the previous ~500 record cap while keeping memory reasonable.
    const selectOptions = {
      sort: sortConfig,
      pageSize: Math.min(100, pageLimit || 100)
    };

    if (filterFormula) {
      selectOptions.filterByFormula = filterFormula;
    }

    let collected = [];
    let skipped = 0;
    let done = false;
    let totalCount = null; // Only count when filters applied

    logger.info(`LinkedIn Routes: Streaming pages for offset=${pageOffset}, limit=${pageLimit}…`);

    // If filters are applied, count total matching records (expensive but useful)
    if (hasFilters) {
      logger.info('LinkedIn Routes: Filters detected, counting total matching records...');
      let countTotal = 0;
      await new Promise((resolve, reject) => {
        airtableBase('Leads')
          .select({ filterByFormula: filterFormula, fields: ['First Name'] }) // Minimal field to speed up count
          .eachPage(
            (records, fetchNextPage) => {
              countTotal += records.length;
              fetchNextPage();
            },
            (err) => {
              if (err) return reject(err);
              resolve();
            }
          );
      });
      totalCount = countTotal;
      logger.info(`LinkedIn Routes: Total matching records: ${totalCount}`);
    }

    await new Promise((resolve, reject) => {
      airtableBase('Leads')
        .select(selectOptions)
        .eachPage(
          (records, fetchNextPage) => {
            if (done) return; // Safety guard
            // Skip until we reach the requested offset
            for (const rec of records) {
              if (skipped < pageOffset) {
                skipped += 1;
                continue;
              }
              if (collected.length < pageLimit) {
                collected.push(rec);
              }
              if (collected.length >= pageLimit) {
                done = true;
                break;
              }
            }
            if (done) return resolve();
            fetchNextPage();
          },
          (err) => {
            if (err) return reject(err);
            resolve();
          }
        );
    });

    logger.info(`LinkedIn Routes: Returning ${collected.length} leads (offset: ${pageOffset}, limit: ${pageLimit}, skipped: ${skipped})`);

    // Transform to expected format
    const transformedLeads = collected.map(record => {
      const f = record.fields || {};
      // Unified contact normalization (same logic as /leads/:id)
      const email = f['Email'] || f['Email Address'] || f['email'] || '';
      const phone = f['Phone'] || f['Phone Number'] || f['phone'] || '';
      // Location with fallback to Raw Profile Data (same as /leads/:id)
      let location = f['Location'] || '';
      if (!location && f['Raw Profile Data']) {
        try {
          const rawData = JSON.parse(f['Raw Profile Data']);
          location = rawData.location_name || rawData.location || '';
        } catch (e) { /* ignore */ }
      }
      return {
        id: record.id,
        recordId: record.id,
        profileKey: record.id, // Use Airtable record ID as profile key
        firstName: f['First Name'],
        lastName: f['Last Name'],
        linkedinProfileUrl: f['LinkedIn Profile URL'],
        aiScore: f['AI Score'],
        status: f['Status'],
        priority: f['Priority'],
        lastMessageDate: f['Last Message Date'],
        // Include search terms fields for display
        searchTerms: f['Search Terms'] || '',
        searchTokensCanonical: f['Search Tokens (canonical)'] || '',
        // Normalized contact fields
        email,
        phone,
        location,
        company: f['Company'] || '',
        jobTitle: f['Job Title'] || '',
        // Include all original fields for compatibility
        ...f
      };
    });

    res.json({
      leads: transformedLeads,
      total: totalCount, // null when no filters, number when filtered
      offset: pageOffset,
      limit: pageLimit
    });

  } catch (error) {
    logger.error('LinkedIn Routes: Error in /leads/search:', error);
    res.status(500).json({ 
      error: 'Failed to search leads',
      details: error.message 
    });
  }
});

/**
 * GET /api/linkedin/leads/export?type=linkedin|emails|phones&format=txt|csv&query=...&q=...&priority=...&searchTerms=...
 * Bulk export all matching leads as a downloadable file (fast, no client paging)
 */
router.get('/leads/export', async (req, res) => {
  logger.info('LinkedIn Routes: GET /leads/export called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);

  try {
    const airtableBase = await getAirtableBase(req);
  const { type = 'linkedin', format = 'txt', query, q, priority, searchTerms, limit } = req.query;

    const exportType = String(type).toLowerCase();
    const exportFormat = String(format).toLowerCase();
    if (!['linkedin', 'emails', 'phones', 'csv'].includes(exportType)) {
      return res.status(400).json({ error: 'Invalid type. Use linkedin|emails|phones|csv' });
    }
    if (!['txt', 'csv'].includes(exportFormat)) {
      return res.status(400).json({ error: 'Invalid format. Use txt|csv' });
    }

    // Build filter formula same as /leads/search
    const searchTerm = query || q;
    let filterParts = [];
    if (searchTerm && String(searchTerm).trim() !== '') {
      const searchWords = String(searchTerm).toLowerCase().trim().split(/\s+/);
      const wordSearches = searchWords.map(word =>
        `OR(
          SEARCH(LOWER("${word}"), LOWER({First Name})) > 0,
          SEARCH(LOWER("${word}"), LOWER({Last Name})) > 0,
          SEARCH(LOWER("${word}"), LOWER({LinkedIn Profile URL})) > 0
        )`
      );
      filterParts.push(`AND(${wordSearches.join(', ')})`);
    }
    if (searchTerms && String(searchTerms).trim() !== '') {
      const { parseBooleanSearch } = require('../../../utils/booleanSearchParser');
      
      try {
        // Parse boolean search query (supports AND, OR, NOT, parentheses, quotes)
        const booleanFormula = parseBooleanSearch(
          String(searchTerms),
          ['{Search Tokens (canonical)}', '{Search Terms}']
        );
        
        if (booleanFormula) {
          filterParts.push(booleanFormula);
          logger.info('LinkedIn Routes: Export boolean search filter applied for:', searchTerms);
        }
      } catch (error) {
        logger.warn('LinkedIn Routes: Export boolean search parsing failed, falling back to simple search:', error.message);
        // Fallback to old comma-separated behavior
        const terms = String(searchTerms).toLowerCase().trim().split(',')
          .map(t => t.trim()).filter(Boolean);
        if (terms.length > 0) {
          const termSearches = terms.map(term =>
            `OR(
              SEARCH("${term}", LOWER({Search Tokens (canonical)})) > 0,
              SEARCH("${term}", LOWER({Search Terms})) > 0
            )`
          );
          filterParts.push(`AND(${termSearches.join(', ')})`);
          logger.info('LinkedIn Routes: Export terms filter applied for:', terms);
        }
      }
    }
    if (priority && priority !== 'all') {
      filterParts.push(`{Priority} = "${priority}"`);
    }
    filterParts.push(`NOT(OR(
      SEARCH("multi", LOWER({First Name})) > 0,
      SEARCH("multi", LOWER({Last Name})) > 0,
      SEARCH("tenant", LOWER({First Name})) > 0,
      SEARCH("tenant", LOWER({Last Name})) > 0
    ))`);
    const filterFormula = filterParts.length > 1 ? `AND(${filterParts.join(', ')})` : filterParts[0];

    const selectOptions = {
      sort: [{ field: 'First Name' }, { field: 'Last Name' }],
    };
    if (filterFormula) selectOptions.filterByFormula = filterFormula;

    // Helpers
    const normalize = (val) => (val == null ? '' : String(val));
    const trim = (s) => String(s || '').trim();
    const normLinkedIn = (url) => {
      let u = trim(url);
      if (!u) return '';
      if (u.endsWith('/')) u = u.slice(0, -1);
      return u;
    };
    const canonKey = (t, v) => {
      const s = trim(v);
      if (!s) return '';
      if (t === 'emails') return s.toLowerCase();
      if (t === 'phones') return s.replace(/[^0-9+]/g, '');
      if (t === 'linkedin') return normLinkedIn(s).toLowerCase();
      return s;
    };
    const csvEscape = (v) => '"' + String(v || '').replace(/"/g, '""') + '"';

    const seen = new Set();
    const rows = [];
    let totalScanned = 0;
    // Optional early limit (e.g. 1000 for fast copy); safeguard upper bound
    let hardLimit = 0;
    if (limit) {
      const parsed = parseInt(String(limit), 10);
      if (!isNaN(parsed) && parsed > 0) {
        // Cap very large requests to avoid pulling the entire base unintentionally
        hardLimit = Math.min(parsed, 50000); // adjustable upper bound
      }
    }
    let reachedLimit = false;

    await new Promise((resolve, reject) => {
      airtableBase('Leads')
        .select(selectOptions)
        .eachPage(
          (records, fetchNextPage) => {
            if (reachedLimit) return; // defensive
            for (const record of records) {
              totalScanned++;
              const firstName = normalize(record.fields['First Name']);
              const lastName = normalize(record.fields['Last Name']);
              const company = normalize(record.fields['Company'] || record.fields['Company Name']);
              const jobTitle = normalize(record.fields['Job Title'] || record.fields['Headline']);
              const linkedinUrl = normalize(record.fields['LinkedIn Profile URL']);
              const email = normalize(record.fields['Email']);
              const phone = normalize(record.fields['Phone'] || record.fields['Phone Number']);
              const notes = normalize(record.fields['Notes']);

              let raw = '';
              if (exportType === 'linkedin') raw = linkedinUrl;
              if (exportType === 'emails') raw = email;
              if (exportType === 'phones') raw = phone;
              
              // For CSV type, we export all fields without deduplication
              if (exportType === 'csv') {
                rows.push([firstName, lastName, email, normLinkedIn(linkedinUrl), notes]);
                if (hardLimit && rows.length >= hardLimit) {
                  reachedLimit = true;
                  break;
                }
                continue;
              }
              
              const key = canonKey(exportType, raw);
              if (!key) continue;
              if (seen.has(key)) continue;
              seen.add(key);

              if (exportFormat === 'csv') {
                if (exportType === 'linkedin') {
                  rows.push([
                    normLinkedIn(raw), firstName, lastName, company, jobTitle, key
                  ]);
                } else if (exportType === 'emails') {
                  rows.push([raw, firstName, lastName, normLinkedIn(linkedinUrl), company, jobTitle]);
                } else {
                  rows.push([key, firstName, lastName, normLinkedIn(linkedinUrl), company, jobTitle]);
                }
              } else {
                if (exportType === 'linkedin') rows.push(normLinkedIn(raw));
                else if (exportType === 'emails') rows.push(String(raw).trim());
                else rows.push(key);
              }

              if (hardLimit && rows.length >= hardLimit) {
                reachedLimit = true;
                break;
              }
            }
            if (reachedLimit) {
              // Do not fetch more pages; allow completion callback to fire
              return fetchNextPage(); // minimal call to progress Airtable iterator
            }
            fetchNextPage();
          },
          (err) => {
            if (err) return reject(err);
            resolve();
          }
        );
    });

    const today = new Date().toISOString().slice(0, 10);
    const baseName = exportType === 'linkedin' ? 'linkedin-urls' : (exportType === 'emails' ? 'emails' : 'phones');

  // Build full content to compute accurate Content-Length for progress
    if (exportFormat === 'csv' || exportType === 'csv') {
      let header = '';
      if (exportType === 'linkedin') header = ['linkedin_url','first_name','last_name','company','job_title','profile_key'].map(csvEscape).join(',');
      if (exportType === 'emails') header = ['email','first_name','last_name','linkedin_url','company','job_title'].map(csvEscape).join(',');
      if (exportType === 'phones') header = ['phone','first_name','last_name','linkedin_url','company','job_title'].map(csvEscape).join(',');
      if (exportType === 'csv') header = ['first_name','last_name','email','linkedin_url','notes'].map(csvEscape).join(',');
      const body = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
      const content = '\uFEFF' + header + '\r\n' + body + (body ? '\r\n' : '');
      const buf = Buffer.from(content, 'utf8');
      const csvBaseName = exportType === 'csv' ? 'leads-export' : baseName;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${csvBaseName}-${today}.csv"`);
      res.setHeader('X-Total-Rows', String(rows.length));
      res.setHeader('Content-Length', String(buf.length));
      if (reachedLimit && hardLimit) res.setHeader('X-Truncated', '1');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, X-Total-Rows, X-Truncated');
      res.end(buf);
    } else {
      const content = rows.join('\r\n') + (rows.length ? '\r\n' : '');
      const buf = Buffer.from(content, 'utf8');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}-${today}.txt"`);
      res.setHeader('X-Total-Rows', String(rows.length));
      res.setHeader('Content-Length', String(buf.length));
      if (reachedLimit && hardLimit) res.setHeader('X-Truncated', '1');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, X-Total-Rows, X-Truncated');
      res.end(buf);
    }
    logger.info(`LinkedIn Routes: Exported ${rows.length} ${exportType} (scanned ${totalScanned})${reachedLimit && hardLimit ? ' [TRUNCATED]' : ''}`);
  } catch (error) {
    logger.error('LinkedIn Routes: Error in /leads/export:', error);
    res.status(500).json({ error: 'Failed to export leads', details: error.message });
  }
});

/**
 * GET /api/linkedin/leads/search-token-suggestions
 * Get search token suggestions from existing leads
 */
router.get('/leads/search-token-suggestions', async (req, res) => {
  logger.info('LinkedIn Routes: GET /leads/search-token-suggestions called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const { limit = 30, minCount = 1 } = req.query;
    
    logger.info('LinkedIn Routes: Fetching suggestions with limit=' + limit + ', minCount=' + minCount);

    // Query leads with search terms using a view that filters for non-empty Search Terms
    const records = await airtableBase('Leads').select({
      view: 'Leads with Search Terms', // Use a filtered view if it exists
      fields: ['Search Tokens (canonical)', 'Search Terms'],
      maxRecords: 500 // Get enough records to analyze
    }).all();

    logger.info(`LinkedIn Routes: Found ${records.length} lead records`);

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

    logger.info(`LinkedIn Routes: Scanned ${records.length} leads, found ${leadsWithSearchTerms} with search terms, ${tokenCounts.size} unique tokens`);

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
    logger.error('LinkedIn Routes: Error in /leads/search-token-suggestions:', error);
    res.status(500).json({ 
      error: 'Failed to fetch search token suggestions',
      details: error.message 
    });
  }
});

/**
 * GET /api/linkedin/leads/by-linkedin-url?url=linkedinUrl
 * Find a lead by their LinkedIn profile URL
 * IMPORTANT: This route MUST come BEFORE /leads/:id to avoid being matched as an ID
 */
router.get('/leads/by-linkedin-url', async (req, res) => {
  logger.info('LinkedIn Routes: GET /leads/by-linkedin-url called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'LinkedIn URL parameter is required' });
    }
    
    logger.info('LinkedIn Routes: Searching for lead with LinkedIn URL:', url);

    // Normalize the URL (remove trailing slash, protocol, www)
    // This matches the same normalization used in NewLeadForm.js duplicate checking
    let normalizedUrl = url;
    if (typeof normalizedUrl === 'string') {
      // Remove trailing slash
      normalizedUrl = normalizedUrl.replace(/\/$/, '');
      // Remove protocol and www for comparison (match NewLeadForm normalization)
      const urlPattern = normalizedUrl.replace(/^https?:\/\/(www\.)?/, '');
      
      logger.info('LinkedIn Routes: URL after normalization:', normalizedUrl);
      logger.info('LinkedIn Routes: URL pattern (no protocol/www):', urlPattern);
      
      // Use SEARCH() function like /leads/search endpoint does
      // This does substring/partial matching which is more flexible than exact equality
      // Match the same approach used in duplicate checking
      const filterFormula = `SEARCH(LOWER("${urlPattern.replace(/"/g, '\\"')}"), LOWER({LinkedIn Profile URL})) > 0`;
      
      logger.info('LinkedIn Routes: Filter formula:', filterFormula);
      
      // Search for the lead by LinkedIn Profile URL using SEARCH (substring match)
      const records = await airtableBase('Leads').select({
        maxRecords: 1,
        filterByFormula: filterFormula
      }).firstPage();
      
      logger.info('LinkedIn Routes: Airtable query completed');
      logger.info('LinkedIn Routes: Records found:', records ? records.length : 0);

      if (!records || records.length === 0) {
        logger.info('LinkedIn Routes: No lead found with LinkedIn URL:', normalizedUrl);
        logger.info('LinkedIn Routes: Client base ID:', req.client?.airtableBaseId);
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

      logger.info('LinkedIn Routes: Found lead:', leadData.firstName, leadData.lastName);
      res.json(leadData);
    }
  } catch (error) {
    logger.error('LinkedIn Routes: Error searching for lead by LinkedIn URL:', error);
    res.status(500).json({ 
      error: 'Failed to search for lead',
      details: error.message 
    });
  }
});

// =========================================================================
// QUICK UPDATE ENDPOINTS
// For rapid notes and contact info updates with section-based notes management
// IMPORTANT: These routes with static paths MUST come BEFORE /leads/:id 
// to avoid being matched as an ID parameter
// =========================================================================

const { parseConversation } = require('../../../utils/messageParser');
const { updateSection, getSectionsSummary, addManualNote, setTags, getTags, parseNotesIntoSections, rebuildNotesFromSections } = require('../../../utils/notesSectionManager');

/**
 * GET /api/linkedin/leads/lookup
 * Lookup lead by LinkedIn URL, email, or name
 * Priority: LinkedIn URL > Email > Name search
 * IMPORTANT: Must be defined BEFORE /leads/:id route
 */
router.get('/leads/lookup', async (req, res) => {
  logger.info('LinkedIn Routes: GET /leads/lookup called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const { query } = req.query;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query parameter is required' });
    }
    
    const trimmedQuery = query.trim();
    let leads = [];
    let lookupMethod = 'name';
    
    // Detect query type
    const isLinkedInUrl = /linkedin\.com\/in\//i.test(trimmedQuery);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedQuery);
    
    if (isLinkedInUrl) {
      // Extract profile slug for matching
      const slugMatch = trimmedQuery.match(/linkedin\.com\/in\/([^\/\?]+)/i);
      const slug = slugMatch ? slugMatch[1].toLowerCase() : null;
      
      if (slug) {
        lookupMethod = 'linkedin_url';
        const records = await airtableBase('Leads').select({
          filterByFormula: `SEARCH("${slug}", LOWER({LinkedIn Profile URL}))`,
          maxRecords: 5
        }).firstPage();
        
        leads = records.map(r => ({
          id: r.id,
          firstName: r.fields['First Name'] || '',
          lastName: r.fields['Last Name'] || '',
          linkedinProfileUrl: r.fields['LinkedIn Profile URL'] || '',
          email: r.fields['Email'] || '',
          phone: r.fields['Phone'] || '',
          company: r.fields['Company Name'] || r.fields['Company'] || '',
          title: r.fields['Job Title'] || r.fields['Headline'] || '',
          aiScore: r.fields['AI Score'],
          status: r.fields['Status'] || '',
          followUpDate: r.fields['Follow-Up Date'] || '',
          ceaseFup: r.fields['Cease FUP'] || '',
          notes: r.fields['Notes'] || ''
        }));
      }
    } else if (isEmail) {
      lookupMethod = 'email';
      const records = await airtableBase('Leads').select({
        filterByFormula: `LOWER({Email}) = "${trimmedQuery.toLowerCase()}"`,
        maxRecords: 5
      }).firstPage();
      
      leads = records.map(r => ({
        id: r.id,
        firstName: r.fields['First Name'] || '',
        lastName: r.fields['Last Name'] || '',
        linkedinProfileUrl: r.fields['LinkedIn Profile URL'] || '',
        email: r.fields['Email'] || '',
        phone: r.fields['Phone'] || '',
        company: r.fields['Company Name'] || r.fields['Company'] || '',
        title: r.fields['Job Title'] || r.fields['Headline'] || '',
        aiScore: r.fields['AI Score'],
        status: r.fields['Status'] || '',
        followUpDate: r.fields['Follow-Up Date'] || '',
        ceaseFup: r.fields['Cease FUP'] || '',
        notes: r.fields['Notes'] || ''
      }));
    }
    
    // If no matches by URL or email, or if it's a name search
    if (leads.length === 0 && !isLinkedInUrl && !isEmail) {
      lookupMethod = 'name';
      // Strip professional credential suffixes before matching (e.g., "Carinne Bird, GAICD" -> "Carinne Bird")
      const cleanedQuery = stripCredentialSuffixes(trimmedQuery);
      // Split into first/last name parts
      const nameParts = cleanedQuery.split(/\s+/);
      
      let filterFormula;
      if (nameParts.length >= 3) {
        // 3+ parts (e.g., "Srujan Kumar Chennupati") - try multiple strategies
        // Strategy 1: First word + Last word (treats middle as middle name)
        // Strategy 2: First word + all remaining (original behavior)
        const firstName = nameParts[0];
        const lastWord = nameParts[nameParts.length - 1];
        const remainingWords = nameParts.slice(1).join(' ');
        
        filterFormula = `OR(
          AND(
            SEARCH("${firstName.toLowerCase()}", LOWER({First Name})),
            SEARCH("${lastWord.toLowerCase()}", LOWER({Last Name}))
          ),
          AND(
            SEARCH("${firstName.toLowerCase()}", LOWER({First Name})),
            SEARCH("${remainingWords.toLowerCase()}", LOWER({Last Name}))
          )
        )`;
      } else if (nameParts.length === 2) {
        // Two parts - standard first/last name search
        const firstName = nameParts[0];
        const lastName = nameParts[1];
        filterFormula = `AND(
          SEARCH("${firstName.toLowerCase()}", LOWER({First Name})),
          SEARCH("${lastName.toLowerCase()}", LOWER({Last Name}))
        )`;
      } else {
        // Single word - search in both fields
        filterFormula = `OR(
          SEARCH("${nameParts[0].toLowerCase()}", LOWER({First Name})),
          SEARCH("${nameParts[0].toLowerCase()}", LOWER({Last Name}))
        )`;
      }
      
      const records = await airtableBase('Leads').select({
        filterByFormula: filterFormula,
        maxRecords: 10
      }).firstPage();
      
      leads = records.map(r => ({
        id: r.id,
        firstName: r.fields['First Name'] || '',
        lastName: r.fields['Last Name'] || '',
        linkedinProfileUrl: r.fields['LinkedIn Profile URL'] || '',
        email: r.fields['Email'] || '',
        phone: r.fields['Phone'] || '',
        company: r.fields['Company Name'] || r.fields['Company'] || '',
        title: r.fields['Job Title'] || r.fields['Headline'] || '',
        aiScore: r.fields['AI Score'],
        status: r.fields['Status'] || '',
        followUpDate: r.fields['Follow-Up Date'] || '',
        ceaseFup: r.fields['Cease FUP'] || '',
        notes: r.fields['Notes'] || ''
      }));
    }
    
    logger.info(`LinkedIn Routes: Lookup found ${leads.length} leads via ${lookupMethod}`);
    
    res.json({
      lookupMethod,
      query: trimmedQuery,
      count: leads.length,
      leads
    });
    
  } catch (error) {
    logger.error('LinkedIn Routes: Error in /leads/lookup:', error);
    res.status(500).json({ error: 'Lead lookup failed', details: error.message });
  }
});

/**
 * POST /api/linkedin/leads/parse-preview
 * Preview how content will be parsed without saving
 * Useful for showing user what will be saved
 * IMPORTANT: Must be defined BEFORE /leads/:id route
 */
router.post('/leads/parse-preview', async (req, res) => {
  logger.info('LinkedIn Routes: POST /leads/parse-preview called');
  
  try {
    const { content, section } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    // Get client's first name for "You" replacement
    const clientFirstName = req.client?.clientName?.split(' ')[0] || 'Me';
    
    // Use client's timezone to determine correct reference date
    // This fixes relative dates like "Friday", "Today", "Saturday" when server is in UTC
    let referenceDate = new Date();
    const clientTimezone = req.client?.timezone;
    if (clientTimezone) {
      try {
        // Get current date/time in client's timezone
        const clientDateStr = new Date().toLocaleString('en-US', { timeZone: clientTimezone });
        referenceDate = new Date(clientDateStr);
      } catch (e) {
        logger.warn(`Invalid client timezone: ${clientTimezone}, using server time`);
      }
    }
    
    // If user selected a specific source (email, linkedin, etc.), force that format
    // Otherwise auto-detect from content
    const result = await parseConversation(content, {
      clientFirstName,
      newestFirst: true,
      referenceDate,
      forceFormat: section  // e.g., 'email', 'linkedin', 'salesnav'
    });
    
    // Map format names back to friendly section names for UI
    const formatToSection = {
      'email_raw': 'email',
      'email_ai': 'email',
      'linkedin_raw': 'linkedin',
      'salesnav_raw': 'salesnav',
      'aiblaze': 'linkedin',
      'manual': 'manual'
    };
    
    const autoDetectedSection = formatToSection[result.autoDetectedFormat] || 'manual';
    const selectedSection = section || 'linkedin';
    
    // Check for mismatch between user's selection and auto-detected format
    let formatMismatch = null;
    if (selectedSection !== 'manual' && autoDetectedSection !== 'manual' && selectedSection !== autoDetectedSection) {
      formatMismatch = {
        selected: selectedSection,
        detected: autoDetectedSection,
        message: `This looks like ${autoDetectedSection} content. Consider switching to "${autoDetectedSection.charAt(0).toUpperCase() + autoDetectedSection.slice(1)}".`
      };
    }
    
    res.json({
      detectedFormat: result.format,
      messageCount: result.messageCount || 0,
      formatted: result.formatted,
      messages: result.messages || [],
      usedAI: result.usedAI || false,
      aiError: result.aiError || null,
      forcedFormat: section || null,
      autoDetectedFormat: autoDetectedSection,
      formatMismatch  // Warning if user selected wrong format
    });
    
  } catch (error) {
    logger.error('LinkedIn Routes: Error in /leads/parse-preview:', error);
    res.status(500).json({ error: 'Parse preview failed', details: error.message });
  }
});

/**
 * POST /api/linkedin/leads/generate-followup-message
 * Generate a personalized follow-up message using AI
 * Used by Smart Follow-ups feature (Owner-only)
 */
router.post('/leads/generate-followup-message', async (req, res) => {
  logger.info('LinkedIn Routes: POST /leads/generate-followup-message called');
  
  try {
    const { leadId, refinement, analyzeOnly, context } = req.body;
    
    if (!context) {
      return res.status(400).json({ error: 'context is required' });
    }
    
    // Import geminiConfig INSIDE the handler (exactly like calendar-chat does at line 6931)
    const geminiConfigLocal = require('../../../config/geminiClient.js');
    if (!geminiConfigLocal || !geminiConfigLocal.geminiModel) {
      logger.error('LinkedIn Routes: Gemini model not available for message generation');
      return res.status(503).json({ 
        error: 'AI service unavailable',
        message: 'Gemini AI is not configured'
      });
    }

    // Use the pre-initialized model (matches working calendar-chat pattern)
    const model = geminiConfigLocal.geminiModel;
    
    // Build the prompt
    let prompt;
    
    if (analyzeOnly) {
      // Analysis prompt
      prompt = `You are a sales coach analyzing a lead for follow-up strategy.

Lead Information:
- Name: ${context.name}
- AI Score: ${context.score || 'N/A'} (higher is better fit)
- Status: ${context.status}
- Follow-up Date: ${context.followUpDate || 'Not set'}
- Last Contact: ${context.lastMessageDate || 'Unknown'}
- Tags: ${context.tags?.join(', ') || 'None'}

Notes:
${context.notes || 'No notes available'}

Recent LinkedIn Conversation:
${context.linkedinMessages ? context.linkedinMessages.slice(-2000) : 'No conversation history'}

Provide a brief analysis (3-4 paragraphs) covering:
1. 📊 Overview - Summarize what you know about this lead
2. 🎯 My read - Your assessment of their interest level and any patterns you notice
3. 💡 Recommendation - What action should be taken and why

Be concise and actionable. If you notice patterns (e.g., multiple cancellations, going cold), mention them.`;
      
    } else {
      // Message generation prompt
      const basePrompt = `You are writing a LinkedIn follow-up message for a professional.

Lead Information:
- Name: ${context.name}
- AI Score: ${context.score || 'N/A'}
- Status: ${context.status}
- Tags: ${context.tags?.join(', ') || 'None'}

Notes:
${context.notes ? context.notes.slice(-1500) : 'No notes available'}

Recent LinkedIn Conversation:
${context.linkedinMessages ? context.linkedinMessages.slice(-1500) : 'No conversation history'}

Write a personalized LinkedIn follow-up message that:
1. Is warm but professional
2. References something specific from their notes or conversation if available
3. Has a clear, low-friction call to action
4. Is concise (2-4 sentences max)
5. Feels personal, not templated
6. Does NOT use cliché phrases like "I hope this finds you well"

${context.tags?.includes('#no-show') ? 'Note: This person was a no-show for a meeting. Be gracious and offer to reschedule without guilt-tripping.' : ''}
${context.tags?.includes('#cancelled') ? 'Note: This person cancelled a meeting. Acknowledge it lightly and offer to reconnect.' : ''}

Write only the message, no subject line or signature needed. Start with "Hi ${context.name?.split(' ')[0] || 'there'},".`;

      if (refinement) {
        prompt = `${basePrompt}

User wants this change: "${refinement}"

Write an improved version incorporating this feedback.`;
      } else {
        prompt = basePrompt;
      }
    }

    // Generate content
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    if (analyzeOnly) {
      res.json({ analysis: text });
    } else {
      res.json({ message: text });
    }

  } catch (error) {
    logger.error('LinkedIn Routes: Error generating follow-up message:', error);
    res.status(500).json({ 
      error: 'Failed to generate message',
      details: error.message 
    });
  }
});

/**
 * GET /api/linkedin/leads/:id
 * Get a specific lead by ID
 */
router.get('/leads/:id', async (req, res) => {
  logger.info('LinkedIn Routes: GET /leads/:id called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const leadId = req.params.id;
    
    logger.info('LinkedIn Routes: Getting lead:', leadId);

    // Get the lead from Airtable
    const record = await airtableBase('Leads').find(leadId);

    const f = record.fields || {};
    // Normalized contact fields (keep logic in sync with /leads/search)
    const email = f['Email'] || f['Email Address'] || f['email'] || '';
    const phone = f['Phone'] || f['Phone Number'] || f['phone'] || '';

    // Location with fallback to Raw Profile Data (same pattern as calendar/lookup-lead)
    let location = f['Location'] || '';
    if (!location && f['Raw Profile Data']) {
      try {
        const rawData = JSON.parse(f['Raw Profile Data']);
        location = rawData.location_name || rawData.location || '';
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

  // Normalize and fallback source variants
  const rawSource = f['Source'] || f['Lead Source'] || f['source'] || f['leadSource'] || '';
  const normalizedSource = typeof rawSource === 'string' ? rawSource.trim().replace(/\s+/g, ' ') : rawSource;

  const transformedLead = {
      id: record.id,
      recordId: record.id,
      profileKey: record.id, // Use Airtable record ID as profile key
      firstName: f['First Name'],
      lastName: f['Last Name'],
      linkedinProfileUrl: f['LinkedIn Profile URL'],
      viewInSalesNavigator: f['View In Sales Navigator'],
      email,
      phone,
      location,
      aiScore: f['AI Score'],
      postsRelevanceScore: f['Posts Relevance Score'],
      postsRelevancePercentage: f['Posts Relevance Percentage'],
  source: normalizedSource,
      status: f['Status'],
      priority: f['Priority'],
      linkedinConnectionStatus: f['LinkedIn Connection Status'],
      followUpDate: f['Follow-Up Date'],
      ceaseFup: f['Cease FUP'],
      followUpNotes: f['Follow Up Notes'],
      notes: f['Notes'],
      linkedinMessages: f['LinkedIn Messages'],
      lastMessageDate: f['Last Message Date'],
      extensionLastSync: f['Extension Last Sync'],
      headline: f['Headline'],
      jobTitle: f['Job Title'],
      companyName: f['Company Name'],
      about: f['About'],
      ashWorkshopEmail: f['ASH Workshop Email'],
      aiProfileAssessment: f['AI Profile Assessment'],
      aiAttributeBreakdown: f['AI Attribute Breakdown'],
      // Include all original fields for compatibility
      ...f
    };

  logger.info('[DEBUG /leads/:id] Source variants:', {
    field_Source: f['Source'],
    field_LeadSource: f['Lead Source'],
    field_source_lower: f['source'],
    chosen: transformedLead.source,
    leadId: record.id
  });

    logger.info('LinkedIn Routes: Lead found');
    res.json(transformedLead);

  } catch (error) {
    logger.error('LinkedIn Routes: Error getting lead:', error);
    if (error.statusCode === 404) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    res.status(500).json({ 
      error: 'Failed to get lead',
      details: error.message 
    });
  }
});

// Max search terms allowed
const MAX_SEARCH_TERMS = 15;

/**
 * PATCH /api/linkedin/leads/:id/search-terms
 * Incrementally add/remove search terms for a lead.
 * Body: { add: string[], remove: string[] }
 * Returns: { id, searchTerms (display), tokens (canonical lower), count, max }
 */
router.patch('/leads/:id/search-terms', async (req, res) => {
  logger.info('LinkedIn Routes: PATCH /leads/:id/search-terms called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  try {
    const airtableBase = await getAirtableBase(req);
    const leadId = req.params.id;
    const { add = [], remove = [] } = req.body || {};

    const norm = (s) => (s == null ? '' : String(s).trim()).replace(/\s+/g, ' ');
    const normLower = (s) => norm(s).toLowerCase();

    // Fetch current record
    const record = await airtableBase('Leads').find(leadId);
    if (!record) return res.status(404).json({ error: 'Lead not found' });

    // Canonical tokens preference
    const canonicalRaw = record.fields['Search Tokens (canonical)'] || record.fields['Search Tokens'] || '';
    let canonicalTokens = Array.isArray(canonicalRaw)
      ? canonicalRaw.map(normLower).filter(Boolean)
      : String(canonicalRaw || '').split(',').map(normLower).filter(Boolean);

    // Fallback to display if empty
    if (!canonicalTokens.length) {
      const displayRaw = record.fields['Search Terms'] || record.fields['Search Term'] || '';
      canonicalTokens = Array.isArray(displayRaw)
        ? displayRaw.map(normLower).filter(Boolean)
        : String(displayRaw || '').split(',').map(normLower).filter(Boolean);
    }

    // Preserve original display casing
    const originalDisplayRaw = record.fields['Search Terms'] || record.fields['Search Term'] || '';
    const originalDisplayTokens = (Array.isArray(originalDisplayRaw)
      ? originalDisplayRaw
      : String(originalDisplayRaw || '').split(',')).map(norm).filter(Boolean);

    // Deduplicate order-preserving
    const seen = new Set();
    canonicalTokens = canonicalTokens.filter(t => { if (seen.has(t)) return false; seen.add(t); return true; });

    const addLower = Array.isArray(add) ? add.map(normLower).filter(Boolean) : [];
    const removeLower = Array.isArray(remove) ? remove.map(normLower).filter(Boolean) : [];

    if (removeLower.length) {
      const rem = new Set(removeLower);
      canonicalTokens = canonicalTokens.filter(t => !rem.has(t));
    }

    for (const t of addLower) {
      if (canonicalTokens.length >= MAX_SEARCH_TERMS) break;
      if (!canonicalTokens.includes(t)) canonicalTokens.push(t);
    }

    canonicalTokens = canonicalTokens.slice(0, MAX_SEARCH_TERMS);

    const displayTokens = canonicalTokens.map(lower => {
      const existing = originalDisplayTokens.find(o => o.toLowerCase() === lower);
      if (existing) return existing;
      const addedOriginal = (add || []).find(a => normLower(a) === lower);
      return addedOriginal ? norm(addedOriginal) : lower;
    });

    const displayStr = displayTokens.join(', ');
    const canonicalStr = canonicalTokens.join(', ');

    const prevCanonicalSet = new Set((record.fields['Search Tokens (canonical)'] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    const unchanged = canonicalTokens.length === prevCanonicalSet.size && canonicalTokens.every(t => prevCanonicalSet.has(t));
    if (unchanged) {
      return res.json({ id: leadId, searchTerms: displayStr, tokens: canonicalTokens, count: canonicalTokens.length, max: MAX_SEARCH_TERMS, unchanged: true });
    }

    const attempts = [
      { 'Search Terms': displayStr, 'Search Tokens (canonical)': canonicalStr },
      { 'Search Terms': displayStr },
      { 'Search Term': displayStr, 'Search Tokens (canonical)': canonicalStr },
      { 'Search Term': displayStr },
      { 'Search Tokens (canonical)': canonicalStr },
      { 'Search Tokens': canonicalStr }
    ];
    let updated, attemptErrors = [];
    for (const fields of attempts) {
      try {
        logger.info('LinkedIn Routes: Attempting update with fields', fields);
        updated = await airtableBase('Leads').update([{ id: leadId, fields }]);
        if (updated && updated.length) { logger.info('LinkedIn Routes: Update succeeded with', Object.keys(fields)); break; }
      } catch (e) { attemptErrors.push(`${Object.keys(fields).join('+')}: ${e.message}`); }
    }
    if (!updated || !updated.length) {
      return res.status(500).json({ error: 'Failed to update search terms', details: attemptErrors.join(' | ') });
    }
    logger.info(`LinkedIn Routes: Updated search terms for lead ${leadId}: display="${displayStr}" canonical="${canonicalStr}"`);
    return res.json({ id: leadId, searchTerms: displayStr, tokens: canonicalTokens, count: canonicalTokens.length, max: MAX_SEARCH_TERMS });
  } catch (error) {
    logger.error('LinkedIn Routes: Error updating search terms:', error);
    return res.status(500).json({ error: 'Failed to update search terms', details: error.message });
  }
});

/**
 * PATCH /api/linkedin/leads/:id
 * Generic partial update (non search-term fields)
 */
router.patch('/leads/:id', async (req, res) => {
  logger.info('LinkedIn Routes: PATCH /leads/:id (generic) called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  try {
    const airtableBase = await getAirtableBase(req);
    const leadId = req.params.id;
    const updates = { ...(req.body || {}) };
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'Body must be an object of fields to update' });
    }
    // Defensive log: track any attempt to toggle Posts Actioned via API
    if (Object.prototype.hasOwnProperty.call(updates, 'Posts Actioned')) {
      logger.warn(`[LinkedIn Routes] PATCH: Posts Actioned set to`, updates['Posts Actioned'], 'for lead', leadId, 'by client', req.client?.clientId || 'unknown');
    }
    
    // When Notes is included, ALWAYS preserve server email/meeting sections
    // These are managed by inbound email and Fathom - Portal's cache may be stale
    if (updates.Notes !== undefined) {
      try {
        const currentRecord = await airtableBase('Leads').find(leadId);
        const serverNotes = currentRecord.get('Notes') || currentRecord.fields?.['Notes'] || '';
        if (serverNotes && serverNotes.trim()) {
          const serverSections = parseNotesIntoSections(serverNotes);
          const clientSections = parseNotesIntoSections(updates.Notes);
          
          let preserved = false;
          if (serverSections.email && serverSections.email.trim()) {
            clientSections.email = serverSections.email;
            preserved = true;
          }
          if (serverSections.meeting && serverSections.meeting.trim()) {
            clientSections.meeting = serverSections.meeting;
            preserved = true;
          }
          updates.Notes = rebuildNotesFromSections(clientSections);
          if (preserved) {
            logger.info('LinkedIn Routes: PATCH - preserved server email/meeting sections');
          }
        }
      } catch (mergeErr) {
        logger.warn('LinkedIn Routes: PATCH could not merge Notes:', mergeErr.message);
      }
    }
    
    logger.info('LinkedIn Routes: Generic PATCH applying fields:', updates);
    const updatedRecords = await airtableBase('Leads').update([{ id: leadId, fields: updates }]);
    if (!updatedRecords || !updatedRecords.length) return res.status(404).json({ error: 'Lead not found' });
    return res.json({ id: updatedRecords[0].id, fields: updatedRecords[0].fields });
  } catch (error) {
    logger.error('LinkedIn Routes: Error in generic PATCH:', error);
    return res.status(500).json({ error: 'Failed to update lead', details: error.message });
  }
});

/**
 * PUT /api/linkedin/leads/:id
 * Update a specific lead (same as PATCH for compatibility)
 * When Notes is included: preserves server-managed sections (email, meeting) to avoid
 * Portal overwriting content added by inbound email or meeting note-takers.
 */
router.put('/leads/:id', async (req, res) => {
  logger.info('LinkedIn Routes: PUT /leads/:id called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const leadId = req.params.id;
    const updates = { ...req.body };
    
    logger.info('LinkedIn Routes: Updating lead:', leadId, 'with data:', updates);

    // Defensive log: track any attempt to toggle Posts Actioned via API
    if (updates && Object.prototype.hasOwnProperty.call(updates, 'Posts Actioned')) {
      logger.warn(`[LinkedIn Routes] PUT: Posts Actioned set to`, updates['Posts Actioned'], 'for lead', leadId, 'by client', req.client?.clientId || 'unknown');
    }

    // When Portal sends Notes, ALWAYS preserve server-managed sections (email, meeting).
    // These sections are populated by inbound email and Fathom - Portal doesn't edit them.
    // The Portal's cached notes may be stale (loaded before email arrived), so we must
    // merge server sections into whatever the Portal sends.
    if (updates.Notes !== undefined) {
      try {
        const currentRecord = await airtableBase('Leads').find(leadId);
        const serverNotes = currentRecord.get('Notes') || currentRecord.fields?.['Notes'] || '';
        if (serverNotes && serverNotes.trim()) {
          const serverSections = parseNotesIntoSections(serverNotes);
          const clientSections = parseNotesIntoSections(updates.Notes);
          
          // ALWAYS preserve server email/meeting sections - Portal never edits these
          // This prevents stale Portal cache from wiping out newly-arrived emails
          let preserved = false;
          if (serverSections.email && serverSections.email.trim()) {
            clientSections.email = serverSections.email;
            preserved = true;
          }
          if (serverSections.meeting && serverSections.meeting.trim()) {
            clientSections.meeting = serverSections.meeting;
            preserved = true;
          }
          updates.Notes = rebuildNotesFromSections(clientSections);
          if (preserved) {
            logger.info('LinkedIn Routes: Merged Notes - preserved server email/meeting sections');
          }
        }
      } catch (mergeErr) {
        logger.warn('LinkedIn Routes: Could not merge Notes (using client version):', mergeErr.message);
      }
    }

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
      ceaseFup: updatedRecords[0].fields['Cease FUP'],
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

    logger.info('LinkedIn Routes: Lead updated successfully');
    res.json(updatedLead);

  } catch (error) {
    logger.error('LinkedIn Routes: Error updating lead:', error);
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
 * POST /api/linkedin/leads
 * Creates a new lead in Airtable
 */
router.post('/leads', async (req, res) => {
  logger.info('LinkedIn Routes: POST /leads called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const leadData = req.body;
    const airtableBase = await getAirtableBase(req);
    
    logger.info('LinkedIn Routes: Creating lead with data:', leadData);

    // DEBUG: Log exactly what we're sending to Airtable
    const recordToCreate = {
      fields: {
        ...leadData,
        'Status': 'On The Radar'
      }
    };

    logger.info('LinkedIn Routes: Record to create:', recordToCreate);

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

    logger.info('LinkedIn Routes: Lead created successfully:', newLead.firstName, newLead.lastName);
    res.status(201).json(newLead);

  } catch (error) {
    logger.error('LinkedIn Routes: Error creating lead:', error);
    res.status(500).json({ 
      error: 'Failed to create lead',
      details: error.message 
    });
  }
});

/**
 * GET /api/linkedin/leads/:id/notes-summary
 * Get summary of notes sections for a lead
 */
router.get('/leads/:id/notes-summary', async (req, res) => {
  logger.info('LinkedIn Routes: GET /leads/:id/notes-summary called');
  
  try {
    const airtableBase = await getAirtableBase(req);
    const leadId = req.params.id;
    
    const records = await airtableBase('Leads').select({
      filterByFormula: `RECORD_ID() = "${leadId}"`,
      maxRecords: 1
    }).firstPage();
    
    if (!records || records.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    const notes = records[0].fields['Notes'] || '';
    const summary = getSectionsSummary(notes);
    
    res.json({
      leadId,
      summary,
      totalLength: notes.length
    });
    
  } catch (error) {
    logger.error('LinkedIn Routes: Error in /leads/:id/notes-summary:', error);
    res.status(500).json({ error: 'Failed to get notes summary', details: error.message });
  }
});

/**
 * PATCH /api/linkedin/leads/:id/quick-update
 * Quick update endpoint for notes sections and contact info
 * 
 * Body: {
 *   section: 'linkedin' | 'salesnav' | 'manual',
 *   content: string (raw or pre-formatted),
 *   replaceNotes?: string (complete replacement of Notes field),
 *   followUpDate?: string (ISO date),
 *   email?: string,
 *   phone?: string,
 *   parseRaw?: boolean (default true - auto-parse raw LinkedIn/SalesNav)
 * }
 */
router.patch('/leads/:id/quick-update', async (req, res) => {
  logger.info('LinkedIn Routes: PATCH /leads/:id/quick-update called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const leadId = req.params.id;
    const { section, content, replaceNotes, followUpDate, email, phone, parseRaw = true, tags, ceaseFup } = req.body;
    
    // If replaceNotes is provided, skip section validation (full replacement mode)
    if (replaceNotes !== undefined) {
      logger.info('LinkedIn Routes: Full notes replacement mode');
    } else if (content && (!section || !['linkedin', 'salesnav', 'email', 'manual'].includes(section))) {
      return res.status(400).json({ 
        error: 'Invalid section', 
        validSections: ['linkedin', 'salesnav', 'email', 'manual']
      });
    }
    
    // Fetch current lead
    const records = await airtableBase('Leads').select({
      filterByFormula: `RECORD_ID() = "${leadId}"`,
      maxRecords: 1
    }).firstPage();
    
    if (!records || records.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    const currentLead = records[0];
    const currentNotes = currentLead.fields['Notes'] || '';
    
    // Build update object
    const updates = {};
    let parsedResult = null;
    let noteUpdateResult = null;
    
    // Process notes content if provided
    // Full replacement mode - replaceNotes takes precedence
    if (replaceNotes !== undefined) {
      updates['Notes'] = replaceNotes;
      logger.info('LinkedIn Routes: Replacing entire notes field');
    } else if (content && section) {
      let processedContent = content;
      
      // Parse raw content if needed (and not manual notes)
      if (parseRaw && section !== 'manual') {
        // Get client's first name for "You" replacement
        const clientFirstName = req.client?.clientName?.split(' ')[0] || 'Me';
        
        // Use client's timezone to determine correct reference date
        let referenceDate = new Date();
        const clientTimezone = req.client?.timezone;
        if (clientTimezone) {
          try {
            const clientDateStr = new Date().toLocaleString('en-US', { timeZone: clientTimezone });
            referenceDate = new Date(clientDateStr);
          } catch (e) {
            logger.warn(`Invalid client timezone: ${clientTimezone}, using server time`);
          }
        }
        
        parsedResult = await parseConversation(content, {
          clientFirstName,
          newestFirst: true,
          referenceDate,
          forceFormat: section  // Force parsing to match user's selected source (email, linkedin, salesnav)
        });
        
        // Use formatted output if parsing was successful
        if (parsedResult.format !== 'manual' && parsedResult.formatted) {
          processedContent = parsedResult.formatted;
        }
      }
      
      // For manual notes, auto-add date prefix
      if (section === 'manual') {
        noteUpdateResult = addManualNote(currentNotes, processedContent);
        updates['Notes'] = noteUpdateResult.notes;
      } else if (section === 'email') {
        // For Email, APPEND to existing content (prepend new messages, keeping chronological order)
        noteUpdateResult = updateSection(currentNotes, section, processedContent, { append: true, replace: false });
        updates['Notes'] = noteUpdateResult.notes;
      } else {
        // For LinkedIn/SalesNav, replace section
        noteUpdateResult = updateSection(currentNotes, section, processedContent, { replace: true });
        updates['Notes'] = noteUpdateResult.notes;
      }
    }
    
    // Update contact fields if provided
    if (followUpDate !== undefined) {
      updates['Follow-Up Date'] = followUpDate || null;
    }
    if (email !== undefined) {
      updates['Email'] = email || '';
    }
    if (phone !== undefined) {
      updates['Phone'] = phone || '';
    }
    if (ceaseFup !== undefined) {
      updates['Cease FUP'] = ceaseFup || null;
    }
    
    // Handle tags if provided
    if (tags && Array.isArray(tags)) {
      // Get the current notes (either updated or original)
      const notesToUpdate = updates['Notes'] || currentNotes;
      // Apply tags to the notes
      updates['Notes'] = setTags(notesToUpdate, tags);
      logger.info(`LinkedIn Routes: Setting tags: ${tags.join(', ')}`);
    }
    
    // Only update if there are changes
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }
    
    // Apply updates
    const updatedRecords = await airtableBase('Leads').update([
      { id: leadId, fields: updates }
    ]);
    
    if (!updatedRecords || updatedRecords.length === 0) {
      return res.status(500).json({ error: 'Failed to update lead' });
    }
    
    const updatedLead = updatedRecords[0];
    
    logger.info(`LinkedIn Routes: Quick update successful for lead ${leadId}`);
    
    res.json({
      success: true,
      leadId,
      updatedFields: Object.keys(updates),
      parsing: parsedResult ? {
        detectedFormat: parsedResult.format,
        messageCount: parsedResult.messageCount || 0
      } : null,
      noteUpdate: noteUpdateResult ? {
        section,
        previousLineCount: noteUpdateResult.lineCount?.old || 0,
        newLineCount: noteUpdateResult.lineCount?.new || 0
      } : null,
      lead: {
        id: updatedLead.id,
        firstName: updatedLead.fields['First Name'] || '',
        lastName: updatedLead.fields['Last Name'] || '',
        email: updatedLead.fields['Email'] || '',
        phone: updatedLead.fields['Phone'] || '',
        followUpDate: updatedLead.fields['Follow-Up Date'] || '',
        ceaseFup: updatedLead.fields['Cease FUP'] || '',
        notes: updatedLead.fields['Notes'] || '',
        notesSummary: getSectionsSummary(updatedLead.fields['Notes'] || ''),
        tags: getTags(updatedLead.fields['Notes'] || '')
      }
    });
    
  } catch (error) {
    logger.error('LinkedIn Routes: Error in /leads/:id/quick-update:', error);
    res.status(500).json({ error: 'Quick update failed', details: error.message });
  }
});

// ============================================================
// CLIENT CONFIGURATION ENDPOINTS
// ============================================================

/**
 * PATCH /client/timezone
 * Self-service timezone configuration for clients
 * Allows users to set their own timezone without coach intervention
 */
router.patch('/client/timezone', async (req, res) => {
  try {
    const clientId = req.client?.clientId;
    if (!clientId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { timezone } = req.body;
    if (!timezone) {
      return res.status(400).json({ error: 'Timezone is required' });
    }
    
    // Validate timezone using JavaScript's Intl API
    // This accepts any valid IANA timezone identifier
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch (e) {
      return res.status(400).json({ 
        error: 'Invalid timezone identifier',
        message: `"${timezone}" is not a valid IANA timezone. Examples: Europe/Paris, America/Denver, Asia/Dubai`,
        hint: 'See https://en.wikipedia.org/wiki/List_of_tz_database_time_zones for valid options'
      });
    }
    
    logger.info(`LinkedIn Routes: Updating timezone for client ${clientId} to ${timezone}`);
    
    // Update timezone in Master Clients base
    const Airtable = require('airtable');
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    // Find the client record
    const records = await masterBase('Clients').select({
      filterByFormula: `LOWER({Client ID}) = LOWER('${clientId}')`,
      maxRecords: 1
    }).firstPage();
    
    if (!records || records.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const clientRecord = records[0];
    
    // Update the timezone field
    await masterBase('Clients').update(clientRecord.id, {
      'Timezone': timezone
    });
    
    logger.info(`LinkedIn Routes: Successfully updated timezone for ${clientId} to ${timezone}`);
    
    res.json({
      success: true,
      clientId,
      timezone,
      message: `Timezone updated to ${timezone}`
    });
    
  } catch (error) {
    logger.error('LinkedIn Routes: Error updating client timezone:', error);
    res.status(500).json({ error: 'Failed to update timezone', details: error.message });
  }
});

/**
 * GET /client/service-account-email
 * Returns the service account email that clients need to share their calendar with
 */
router.get('/client/service-account-email', async (req, res) => {
  try {
    const { serviceAccountEmail } = require('../../../config/calendarServiceAccount');
    
    if (!serviceAccountEmail) {
      return res.status(503).json({ 
        error: 'Calendar service not configured',
        message: 'Service account email not available. Please contact support.'
      });
    }
    
    res.json({
      success: true,
      serviceAccountEmail
    });
    
  } catch (error) {
    logger.error('LinkedIn Routes: Error getting service account email:', error);
    res.status(500).json({ error: 'Failed to get service account email', details: error.message });
  }
});

/**
 * PATCH /client/calendar
 * Self-service calendar email configuration for clients
 * Allows users to set their Google Calendar email
 */
router.patch('/client/calendar', async (req, res) => {
  try {
    const clientId = req.client?.clientId;
    if (!clientId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { calendarEmail } = req.body;
    if (!calendarEmail) {
      return res.status(400).json({ error: 'Calendar email is required' });
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(calendarEmail)) {
      return res.status(400).json({ 
        error: 'Invalid email format',
        message: 'Please enter a valid email address'
      });
    }
    
    logger.info(`LinkedIn Routes: Updating calendar email for client ${clientId} to ${calendarEmail}`);
    
    // Update calendar email in Master Clients base
    const Airtable = require('airtable');
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    // Find the client record
    const records = await masterBase('Clients').select({
      filterByFormula: `LOWER({Client ID}) = LOWER('${clientId}')`,
      maxRecords: 1
    }).firstPage();
    
    if (!records || records.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const clientRecord = records[0];
    
    // Update the Google Calendar Email field
    await masterBase('Clients').update(clientRecord.id, {
      'Google Calendar Email': calendarEmail
    });
    
    logger.info(`LinkedIn Routes: Successfully updated calendar email for ${clientId} to ${calendarEmail}`);
    
    res.json({
      success: true,
      clientId,
      calendarEmail,
      message: `Calendar email updated to ${calendarEmail}`
    });
    
  } catch (error) {
    logger.error('LinkedIn Routes: Error updating client calendar email:', error);
    res.status(500).json({ error: 'Failed to update calendar email', details: error.message });
  }
});

/**
 * POST /client/verify-calendar
 * Test if the client's calendar is properly shared with the service account
 * Attempts a free/busy query to verify access
 */
router.post('/client/verify-calendar', async (req, res) => {
  try {
    const clientId = req.client?.clientId;
    if (!clientId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { calendarEmail } = req.body;
    if (!calendarEmail) {
      return res.status(400).json({ error: 'Calendar email is required' });
    }
    
    logger.info(`LinkedIn Routes: Verifying calendar access for ${clientId} - calendar: ${calendarEmail}`);
    
    const { getFreeBusy, serviceAccountEmail } = require('../../../config/calendarServiceAccount');
    
    if (!serviceAccountEmail) {
      return res.status(503).json({ 
        error: 'Calendar service not configured',
        message: 'Service account not available. Please contact support.'
      });
    }
    
    // Try to query free/busy for the next hour (minimal query to test access)
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    
    const { busy, error } = await getFreeBusy(calendarEmail, now, oneHourLater);
    
    if (error) {
      // Check if it's a sharing error
      if (error.includes('not shared') || error.includes('notFound')) {
        return res.json({
          success: false,
          connected: false,
          error: 'Calendar not shared',
          message: `Your calendar is not shared with our service. Please share your Google Calendar with: ${serviceAccountEmail}`,
          serviceAccountEmail
        });
      }
      
      // Other error
      return res.json({
        success: false,
        connected: false,
        error: 'Calendar access error',
        message: error,
        serviceAccountEmail
      });
    }
    
    // Success! We can access the calendar
    logger.info(`LinkedIn Routes: Calendar verified successfully for ${clientId} - ${calendarEmail}`);
    
    res.json({
      success: true,
      connected: true,
      message: 'Calendar connected successfully! We can now check your availability.',
      calendarEmail
    });
    
  } catch (error) {
    logger.error('LinkedIn Routes: Error verifying calendar:', error);
    res.status(500).json({ error: 'Failed to verify calendar', details: error.message });
  }
});

module.exports = router;
