const express = require('express');
const { createLogger } = require('../../../utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'api' });

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

    logger.info(`LinkedIn Routes: Found ${records.length} top scoring posts leads`);

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

    res.json(transformedLeads);

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
      ],
      maxRecords: 50 // Memory limit protection
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
    const { query, priority, q, searchTerms, limit, offset } = req.query;
    
    // Support both 'query' and 'q' parameter names for backward compatibility
    const searchTerm = query || q;
    
    // Parse pagination parameters with defaults
    const pageLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 25)); // Default 25, max 100
    const pageOffset = Math.max(0, parseInt(offset, 10) || 0); // Default 0
    
    logger.info('LinkedIn Routes: Search query:', searchTerm, 'Priority:', priority, 'Search Terms:', searchTerms, 'Limit:', pageLimit, 'Offset:', pageOffset);
    
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
        logger.info('LinkedIn Routes: Search terms filter applied for:', terms);
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

    // Stream Airtable pages and return only the requested slice (offset, limit)
    // This avoids the previous ~500 record cap while keeping memory reasonable.
    const selectOptions = {
      sort: [{ field: 'First Name' }, { field: 'Last Name' }],
      pageSize: Math.min(100, pageLimit || 100)
    };

    if (filterFormula) {
      selectOptions.filterByFormula = filterFormula;
    }

    let collected = [];
    let skipped = 0;
    let done = false;

    logger.info(`LinkedIn Routes: Streaming pages for offset=${pageOffset}, limit=${pageLimit}…`);

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
        company: f['Company'] || '',
        jobTitle: f['Job Title'] || '',
        // Include all original fields for compatibility
        ...f
      };
    });

    res.json(transformedLeads);

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
    if (!['linkedin', 'emails', 'phones'].includes(exportType)) {
      return res.status(400).json({ error: 'Invalid type. Use linkedin|emails|phones' });
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

              let raw = '';
              if (exportType === 'linkedin') raw = linkedinUrl;
              if (exportType === 'emails') raw = email;
              if (exportType === 'phones') raw = phone;
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
    if (exportFormat === 'csv') {
      let header = '';
      if (exportType === 'linkedin') header = ['linkedin_url','first_name','last_name','company','job_title','profile_key'].map(csvEscape).join(',');
      if (exportType === 'emails') header = ['email','first_name','last_name','linkedin_url','company','job_title'].map(csvEscape).join(',');
      if (exportType === 'phones') header = ['phone','first_name','last_name','linkedin_url','company','job_title'].map(csvEscape).join(',');
      const body = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
      const content = '\uFEFF' + header + '\r\n' + body + (body ? '\r\n' : '');
      const buf = Buffer.from(content, 'utf8');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}-${today}.csv"`);
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
      aiScore: f['AI Score'],
      postsRelevanceScore: f['Posts Relevance Score'],
      postsRelevancePercentage: f['Posts Relevance Percentage'],
  source: normalizedSource,
      status: f['Status'],
      priority: f['Priority'],
      linkedinConnectionStatus: f['LinkedIn Connection Status'],
      followUpDate: f['Follow-Up Date'],
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
    const updates = req.body || {};
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'Body must be an object of fields to update' });
    }
    // Defensive log: track any attempt to toggle Posts Actioned via API
    if (Object.prototype.hasOwnProperty.call(updates, 'Posts Actioned')) {
      logger.warn(`[LinkedIn Routes] PATCH: Posts Actioned set to`, updates['Posts Actioned'], 'for lead', leadId, 'by client', req.client?.clientId || 'unknown');
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
 */
router.put('/leads/:id', async (req, res) => {
  logger.info('LinkedIn Routes: PUT /leads/:id called');
  logger.info(`LinkedIn Routes: Authenticated client: ${req.client.clientName} (${req.client.clientId})`);
  
  try {
    const airtableBase = await getAirtableBase(req);
    const leadId = req.params.id;
    const updates = req.body;
    
    logger.info('LinkedIn Routes: Updating lead:', leadId, 'with data:', updates);

    // Defensive log: track any attempt to toggle Posts Actioned via API
    if (updates && Object.prototype.hasOwnProperty.call(updates, 'Posts Actioned')) {
      logger.warn(`[LinkedIn Routes] PUT: Posts Actioned set to`, updates['Posts Actioned'], 'for lead', leadId, 'by client', req.client?.clientId || 'unknown');
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
 * GET /api/linkedin/leads/by-linkedin-url?url=linkedinUrl
 * Find a lead by their LinkedIn profile URL
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
      logger.info('LinkedIn Routes: No lead found with LinkedIn URL:', normalizedUrl);
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

  } catch (error) {
    logger.error('LinkedIn Routes: Error searching for lead by LinkedIn URL:', error);
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

module.exports = router;
