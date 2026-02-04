import axios from 'axios';
import { getCurrentClientId, getCurrentPortalToken, getCurrentDevKey } from '../utils/clientUtils.js';

// API configuration
// In Next.js, env vars must be prefixed with NEXT_PUBLIC_ to be exposed to the browser.
// We normalize to a full absolute URL ending with /api/linkedin and prefer localhost in dev.
function resolveApiBase() {
  try {
    let raw = process.env.NEXT_PUBLIC_API_BASE_URL;

    // Prefer localhost automatically when developing on localhost
    if (!raw && typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) {
      raw = 'http://localhost:3001';
    }

    // Detect staging environment (same logic as getBackendBase)
    if (!raw && typeof window !== 'undefined') {
      const host = window.location.hostname || '';
      // Check if URL contains "staging"
      if (/vercel\.app$/i.test(host) && /staging/i.test(host)) {
        raw = 'https://pb-webhook-server-staging.onrender.com';
      }
    }
    
    // Check VERCEL_ENV environment variable
    if (!raw) {
      const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV;
      if (vercelEnv === 'preview') {
        raw = 'https://pb-webhook-server-staging.onrender.com';
      }
    }

    // Final fallback to production Render URL
    if (!raw) raw = 'https://pb-webhook-server.onrender.com/api/linkedin';

    // Ensure it's a string
    raw = String(raw).trim();

    // If no protocol provided, assume http for localhost
    if (/^localhost(:\d+)?(\/|$)/i.test(raw)) {
      raw = `http://${raw}`;
    }

    // If it already ends with /api/linkedin (with or without trailing slash), keep as is (no trailing slash)
    if (/\/api\/linkedin\/?$/i.test(raw)) {
      return raw.replace(/\/$/, '');
    }

    // Otherwise, append the path (no trailing slash)
    return `${raw.replace(/\/$/, '')}/api/linkedin`;
  } catch (e) {
    return 'https://pb-webhook-server.onrender.com/api/linkedin';
  }
}

const API_BASE_URL = resolveApiBase();

// Optional: log resolved base in dev for diagnostics
if (typeof window !== 'undefined') {
  try { console.debug('[API] Resolved base URL:', API_BASE_URL); } catch {}
}

const RAW_TIMEOUT = process.env.NEXT_PUBLIC_API_TIMEOUT;
const API_TIMEOUT = RAW_TIMEOUT && !isNaN(Number(RAW_TIMEOUT)) ? Number(RAW_TIMEOUT) : 30000;
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Return the backend base URL without the "/api/linkedin" suffix
// Heuristics:
// - If NEXT_PUBLIC_API_BASE_URL is set, strip the suffix
// - Else derive from resolved API_BASE_URL
// - Else: localhost in dev, staging in Vercel preview, production otherwise
export function getBackendBase() {
  try {
    let raw = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (raw) {
      raw = String(raw).trim().replace(/\/$/, '');
      return raw.replace(/\/api\/linkedin\/?$/i, '');
    }
    if (API_BASE_URL) {
      const derived = String(API_BASE_URL).replace(/\/$/, '').replace(/\/api\/linkedin\/?$/i, '');
      if (derived) return derived;
    }
    if (typeof window !== 'undefined') {
      const host = window.location.hostname || '';
      if (/^(localhost|127\.0\.0\.1)$/i.test(host)) {
        return 'http://localhost:3001';
      }
      // Detect staging by hostname pattern (e.g., pb-webhook-server-staging.vercel.app)
      if (/vercel\.app$/i.test(host) && /staging/i.test(host)) {
        return 'https://pb-webhook-server-staging.onrender.com';
      }
    }
    const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV;
    if (vercelEnv === 'preview') return 'https://pb-webhook-server-staging.onrender.com';
    if (vercelEnv === 'production') return 'https://pb-webhook-server.onrender.com';
    return 'https://pb-webhook-server.onrender.com';
  } catch (e) {
    return 'https://pb-webhook-server.onrender.com';
  }
}

// Helper function to get authenticated headers for API calls
const getAuthenticatedHeaders = () => {
  const clientId = getCurrentClientId();
  const token = getCurrentPortalToken();
  const devKey = getCurrentDevKey();
  
  if (!clientId) {
    throw new Error('Client ID not available - user not authenticated');
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-client-id': clientId
  };

  // Include token or devKey for authentication
  if (token) {
    headers['x-portal-token'] = token;
  }
  if (devKey) {
    headers['x-dev-key'] = devKey;
  }

  return headers;
};

// Get authentication headers
const getAuthHeaders = () => {
  // Only access browser APIs on client side
  if (typeof window !== 'undefined') {
    const wpUser = localStorage.getItem('wpUsername');
    const wpAppPassword = localStorage.getItem('wpAppPassword');
    
    if (wpUser && wpAppPassword) {
      return {
        'Authorization': `Basic ${btoa(`${wpUser}:${wpAppPassword}`)}`,
        'Content-Type': 'application/json'
      };
    }
    
    // Fallback to nonce if available
    const wpNonce = document.querySelector('meta[name="wp-nonce"]')?.content;
    if (wpNonce) {
      return {
        'X-WP-Nonce': wpNonce,
        'Content-Type': 'application/json'
      };
    }
  }
  
  return {
    'Content-Type': 'application/json'
  };
};

// Request interceptor for authentication
api.interceptors.request.use(
  (config) => {
    // Add WordPress authentication headers
    const headers = getAuthHeaders();
    for (const [key, value] of Object.entries(headers)) {
      config.headers[key] = value;
    }
    
    // Add client parameter to all requests if not already present
    if (!config.params) {
      config.params = {};
    }
    if (!config.params.client) {
      const clientId = getCurrentClientId();
      if (clientId) {
        config.params.client = clientId;
      } else {
        console.error('API: No client ID available. Authentication required.');
        // Reject requests without proper client authentication
        return Promise.reject(new Error('Client authentication required. Please log in through Australian Side Hustles.'));
      }
    }
    
    // Add portal token and dev key headers for authentication
    const clientId = getCurrentClientId();
    const token = getCurrentPortalToken();
    const devKey = getCurrentDevKey();
    
    if (clientId) {
      config.headers['x-client-id'] = clientId;
    }
    if (token) {
      config.headers['x-portal-token'] = token;
    }
    if (devKey) {
      config.headers['x-dev-key'] = devKey;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Lead search and management functions
export const searchLeads = async (query, priority = 'all', searchTerms = '', limit = 25, offset = 0, sortField = null, sortDirection = null) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const params = { 
      q: query,
      clientId: clientId, // Updated from testClient to clientId
      limit: limit,
      offset: offset
    };
    
    // Add sort parameters if provided
    if (sortField) {
      params.sortField = sortField;
    }
    if (sortDirection) {
      params.sortDirection = sortDirection;
    }
    
    // Only add priority parameter if it's not 'all'
    if (priority && priority !== 'all') {
      params.priority = priority;
    }

    // Add search terms parameter if provided
    if (searchTerms && searchTerms.trim() !== '') {
      params.searchTerms = searchTerms.trim();
    }
    
    const response = await api.get('/leads/search', { params });
    
    // Handle both old (array) and new (object with leads/total) response formats
    let leadsArray = [];
    let total = null;
    
    if (!response.data) {
      return { leads: [], total: null };
    }
    
    // New format: { leads: [...], total: number|null }
    if (response.data.leads && Array.isArray(response.data.leads)) {
      leadsArray = response.data.leads;
      total = response.data.total;
    }
    // Old format: just an array
    else if (Array.isArray(response.data)) {
      leadsArray = response.data;
      total = null;
    }
    // Unknown format
    else {
      console.error('Unexpected response format from /leads/search:', response.data);
      return { leads: [], total: null };
    }
    
    // Map backend field names to frontend field names
    const mappedLeads = leadsArray.map(lead => ({
      'Profile Key': lead.id || '',
      'First Name': lead.firstName || '',
      'Last Name': lead.lastName || '',
      'LinkedIn Profile URL': lead.linkedinProfileUrl || '',
      'AI Score': lead.aiScore,
      'Status': lead.status || '',
      'Priority': lead.priority || '',
      'Last Message Date': lead.lastMessageDate || '',
      // Include search terms for display
      'Search Terms': lead.searchTerms || '',
      'Search Tokens (canonical)': lead.searchTokensCanonical || '',
      // Include contact info for export functionality
      'Email': lead.email || '',
      'Phone': lead.phone || '',
  'Company': lead.company || '',
      'Job Title': lead.jobTitle || '',
      // Include all raw data for compatibility
      ...lead
    }));
    
    return { leads: mappedLeads, total };
  } catch (error) {
    console.error('Search error:', error);
    throw new Error('Failed to search leads');
  }
};

// Incrementally update search terms for a lead
export const updateLeadSearchTerms = async (leadId, { add = [], remove = [] }) => {
  if (!leadId) throw new Error('leadId required');
  try {
    const clientId = getCurrentClientId();
    if (!clientId) throw new Error('Client ID not available');
    const body = { add, remove };
    const res = await api.patch(`/leads/${leadId}/search-terms`, body, { params: { testClient: clientId } });
    return res.data; // { id, searchTerms, tokens }
  } catch (e) {
    console.error('updateLeadSearchTerms error', e.response?.data || e.message);
    throw new Error('Failed to update search terms');
  }
};

// Get popular search terms (server aggregated) with optional limit
export const getPopularSearchTerms = async ({ limit = 30 } = {}) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) throw new Error('Client ID not available');
    // reuse existing suggestions endpoint for now
    const res = await api.get('/leads/search-token-suggestions', { params: { testClient: clientId, limit } });
    return (res.data?.suggestions || []).map(s => s.term);
  } catch (e) {
    console.error('getPopularSearchTerms error', e.response?.data || e.message);
    return [];
  }
};

export const getLeadById = async (leadId) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.get(`/leads/${leadId}`, {
      params: {
        testClient: clientId
      }
    });
    
    // Map backend response to frontend format
    const lead = response.data;
    const mapped = {
      id: lead.id,
      'Profile Key': lead.profileKey,
      'First Name': lead.firstName,
      'Last Name': lead.lastName,
      'LinkedIn Profile URL': lead.linkedinProfileUrl,
      'View In Sales Navigator': lead.viewInSalesNavigator,
      'Email': lead.email,
  // Provide camelCase variant expected by components like LeadDetailForm
  email: lead.email,
      'Phone': lead.phone,
      'Location': lead.location || lead['Location'],
      'Raw Profile Data': lead.rawProfileData || lead['Raw Profile Data'],
      'AI Score': lead.aiScore,
      'Posts Relevance Score': lead.postsRelevanceScore,
      'Posts Relevance Percentage': lead.postsRelevancePercentage,
      'Source': lead.source,
      'Status': lead.status,
      'Priority': lead.priority,
      'LinkedIn Connection Status': lead.linkedinConnectionStatus,
      'Follow-Up Date': lead.followUpDate,
      'Follow Up Notes': lead.followUpNotes,
      'Notes': lead.notes,
      'LinkedIn Messages': lead.linkedinMessages,
      'Last Message Date': lead.lastMessageDate,
      'Extension Last Sync': lead.extensionLastSync,
      'Headline': lead.headline,
      'Job Title': lead.jobTitle,
      'Company Name': lead.companyName,
  'About': lead.about,
      'AI Profile Assessment': lead.aiProfileAssessment,
      'AI Attribute Breakdown': lead.aiAttributeBreakdown,
  'Search Terms': lead['Search Terms'] || lead.searchTerms || '',
  'Search Tokens (canonical)': lead['Search Tokens (canonical)'] || lead.searchTokensCanonical || '',
      // Also include camelCase for compatibility
      
      phone: lead.phone,
      location: lead.location || lead['Location'],
      rawProfileData: lead.rawProfileData || lead['Raw Profile Data'],
  followUpDate: lead.followUpDate,
  source: lead.source,
  status: lead.status,
  priority: lead.priority,
  linkedinConnectionStatus: lead.linkedinConnectionStatus,
  notes: lead.notes,
  aiScore: lead.aiScore,
  postsRelevancePercentage: lead.postsRelevancePercentage,
  searchTerms: lead.searchTerms || lead['Search Terms'],
  searchTokensCanonical: lead.searchTokensCanonical || lead['Search Tokens (canonical)'],
  lastMessageDate: lead.lastMessageDate
    };
    if (typeof window !== 'undefined') {
      try { window.__lastLead = mapped; } catch {}
      try { console.debug('[getLeadById] mapped lead source variants', { source: mapped.source, Source: mapped['Source'] }); } catch {}
    }
    return mapped;
  } catch (error) {
    throw new Error('Failed to load lead details');
  }
};

export const createLead = async (leadData) => {
  try {
    // Map frontend field names to Airtable field names (same mapping as updateLead)
    const backendData = {};
    const fieldMapping = {
      'firstName': 'First Name',
      'lastName': 'Last Name', 
      'linkedinProfileUrl': 'LinkedIn Profile URL',
      'viewInSalesNavigator': 'View In Sales Navigator',
      'email': 'Email',
      'phone': 'Phone',
      'location': 'Location',
      'notes': 'Notes',
      'followUpDate': 'Follow-Up Date',
      'followUpNotes': 'Follow Up Notes',
      'source': 'Source',
      'status': 'Status',
      'priority': 'Priority',
  'linkedinConnectionStatus': 'LinkedIn Connection Status',
  'postsActioned': 'Posts Actioned',
  'searchTerms': 'Search Terms',
  'searchTokensCanonical': 'Search Tokens (canonical)'
    };
    
    // List of dropdown fields that need empty string handling
    const dropdownFields = ['source', 'status', 'priority', 'linkedinConnectionStatus'];
    
    // List of date fields that need empty string handling
  const dateFields = ['followUpDate'];
    
    Object.keys(leadData).forEach(frontendField => {
      const backendField = fieldMapping[frontendField];
      if (backendField) {
        let value = leadData[frontendField];
        
        // Convert empty strings to null for dropdown fields to avoid Airtable permissions error
        if (dropdownFields.includes(frontendField) && value === '') {
          value = null;
        }
        
        // Convert empty strings to null for date fields to avoid Airtable parsing error
        if (dateFields.includes(frontendField) && value === '') {
          value = null;
        }
        
  backendData[backendField] = value;
      }
    });
    
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.post('/leads', backendData, {
      params: {
        testClient: clientId
      }
    });
    
    // Map backend response to frontend format (same as getLeadById)
    const lead = response.data;
    return {
      id: lead.id,
      'Profile Key': lead.profileKey,
      'First Name': lead.firstName,
      'Last Name': lead.lastName,
      'LinkedIn Profile URL': lead.linkedinProfileUrl,
      'View In Sales Navigator': lead.viewInSalesNavigator,
      'Email': lead.email,
      'Phone': lead.phone,
      'AI Score': lead.aiScore,
      'Posts Relevance Score': lead.postsRelevanceScore,
      'Posts Relevance Percentage': lead.postsRelevancePercentage,
      'Source': lead.source,
      'Status': lead.status,
      'Priority': lead.priority,
      'LinkedIn Connection Status': lead.linkedinConnectionStatus,
      'Follow-Up Date': lead.followUpDate,
      'Follow Up Notes': lead.followUpNotes,
      'Notes': lead.notes,
      'LinkedIn Messages': lead.linkedinMessages,
      'Last Message Date': lead.lastMessageDate,
      'Extension Last Sync': lead.extensionLastSync,
      'Headline': lead.headline,
      'Job Title': lead.jobTitle,
      'Company Name': lead.companyName,
  'About': lead.about,
  'Search Terms': lead['Search Terms'] || lead.searchTerms || '',
  'Search Tokens (canonical)': lead['Search Tokens (canonical)'] || lead.searchTokensCanonical || '',
      // Also include camelCase for compatibility
      
      phone: lead.phone,
      followUpDate: lead.followUpDate
    };
  } catch (error) {
    console.error('Create lead error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Failed to create lead');
  }
};

export const updateLead = async (leadId, updateData) => {
  try {
  try { console.debug('[api.updateLead] called', { leadId, updateData }); } catch {}
    // Map frontend field names to Airtable field names
    const backendData = {};
    const fieldMapping = {
      'firstName': 'First Name',
      'lastName': 'Last Name', 
      'linkedinProfileUrl': 'LinkedIn Profile URL',
      'viewInSalesNavigator': 'View In Sales Navigator',
      'email': 'Email',
      'phone': 'Phone',
      'location': 'Location',
      'notes': 'Notes',
      'followUpDate': 'Follow-Up Date',
      'followUpNotes': 'Follow Up Notes',
      'source': 'Source',
      'status': 'Status',
      'priority': 'Priority',
  'linkedinConnectionStatus': 'LinkedIn Connection Status',
  'postsActioned': 'Posts Actioned',
  'searchTerms': 'Search Terms',
  'searchTokensCanonical': 'Search Tokens (canonical)'
    };
    
    // List of fields that need empty string converted to null
    const emptyStringToNullFields = ['source', 'status', 'priority', 'linkedinConnectionStatus', 'followUpDate'];
    
  Object.keys(updateData).forEach(frontendField => {
      const backendField = fieldMapping[frontendField];
      if (backendField) {
        let value = updateData[frontendField];
        
        // Convert empty strings to null for fields that can't handle empty strings
        if (emptyStringToNullFields.includes(frontendField) && value === '') {
          value = null;
        }
        
  backendData[backendField] = value;
      }
    });
    
    const clientId = getCurrentClientId();
    let effectiveClientId = clientId;
    if (!effectiveClientId && typeof window !== 'undefined') {
      // Fallback: extract testClient from URL if present
      const u = new URL(window.location.href);
      const tc = u.searchParams.get('testClient');
      if (tc) {
        effectiveClientId = tc;
        console.debug('[api.updateLead] using fallback testClient from URL', tc);
      }
    }
    if (!effectiveClientId) {
      console.error('[api.updateLead] missing clientId – aborting request');
      throw new Error('Client authentication missing (no clientId).');
    }
    
  try { console.debug('[api.updateLead] sending', { backendData }); } catch {}
  const response = await api.put(`/leads/${leadId}`, backendData, {
      params: {
        testClient: effectiveClientId
      }
    });
    
    // Map backend response to frontend format (same as getLeadById)
    const lead = response.data;
  try { console.debug('[api.updateLead] response', { lead }); } catch {}
    
    return {
      id: lead.id,
      'Profile Key': lead.id,  // Always use lead.id for consistency with follow-ups loading
      'First Name': lead.firstName,
      'Last Name': lead.lastName,
      'LinkedIn Profile URL': lead.linkedinProfileUrl,
      'View In Sales Navigator': lead.viewInSalesNavigator,
      'Email': lead.email,
      'Phone': lead.phone,
      'AI Score': lead.aiScore,
      'Posts Relevance Score': lead.postsRelevanceScore,
      'Posts Relevance Percentage': lead.postsRelevancePercentage,
      'Source': lead.source,
      'Status': lead.status,
      'Priority': lead.priority,
      'LinkedIn Connection Status': lead.linkedinConnectionStatus,
      'Follow-Up Date': lead.followUpDate || lead['Follow-Up Date'] || lead.fields?.['Follow-Up Date'] || '',
      'Follow Up Notes': lead.followUpNotes,
      'Notes': lead.notes,
      'LinkedIn Messages': lead.linkedinMessages,
      'Last Message Date': lead.lastMessageDate,
      'Extension Last Sync': lead.extensionLastSync,
      'Headline': lead.headline,
      'Job Title': lead.jobTitle,
      'Company Name': lead.companyName,
  'About': lead.about,
  'Search Terms': lead['Search Terms'] || lead.searchTerms || '',
  'Search Tokens (canonical)': lead['Search Tokens (canonical)'] || lead.searchTokensCanonical || '',
      // Also include camelCase for compatibility
      
      phone: lead.phone,
      followUpDate: lead.followUpDate
    };
  } catch (error) {
    console.error('Update lead error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Failed to update lead');
  }
};

export const deleteLead = async (leadId) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.delete(`/leads/${leadId}`, {
      params: {
        testClient: clientId
      }
    });
    
    // Return the response data which includes success confirmation and deleted lead info
    return response.data;
  } catch (error) {
    console.error('Delete lead error:', error.response?.data || error.message);
    
    // Handle specific error cases
    if (error.response?.status === 404) {
      throw new Error('Lead not found. It may have already been deleted.');
    }
    
    throw new Error(error.response?.data?.message || 'Failed to delete lead');
  }
};

export const getFollowUps = async () => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.get('/leads/follow-ups', {
      params: {
        testClient: clientId
      },
      timeout: 30000 // 30 seconds for follow-ups to handle larger datasets
    });
    
    // Backend already returns data in the correct format for the Follow-Up Manager
    // Map backend response to frontend format (same as searchLeads)
    return response.data.map(lead => ({
      'Profile Key': lead.id || '',
      'First Name': lead.firstName || '',
      'Last Name': lead.lastName || '',
      'LinkedIn Profile URL': lead.linkedinProfileUrl || '',
      'Follow-Up Date': lead.followUpDate || '',
      'AI Score': lead.aiScore,
      'Status': lead.status || '',
      'Last Message Date': lead.lastMessageDate || '',
      'Notes': lead.notes || '',
      // Additional fields for Follow-Up Manager
      daysUntilFollowUp: lead.daysUntilFollowUp,
      // Include raw backend data for compatibility
      ...lead
    }));
  } catch (error) {
    console.error('Get follow-ups error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Failed to load follow-ups');
  }
};

export const getTopScoringPosts = async (opts = {}) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    const params = { testClient: clientId };
    if (opts && Number.isFinite(Number(opts.minPerc))) params.minPerc = Number(opts.minPerc);
    if (opts && Number.isFinite(Number(opts.minScore))) params.minScore = Number(opts.minScore);

    const response = await api.get('/leads/top-scoring-posts', {
      params,
      timeout: 30000 // 30 seconds to handle larger datasets
    });
    
    // Handle new response format with total count
    const responseData = response.data;
    const leadsArray = responseData.leads || responseData; // Support both old and new format
    const totalCount = responseData.total;
    
    // Backend returns data in correct format, just map to frontend field names
    const mappedLeads = (Array.isArray(leadsArray) ? leadsArray : []).map(lead => ({
      'Profile Key': lead.id || '',
      'First Name': lead.firstName || '',
      'Last Name': lead.lastName || '',
      'LinkedIn Profile URL': lead.linkedinProfileUrl || '',
      'View In Sales Navigator': lead.viewInSalesNavigator || '',
      'LinkedIn Connection Status': lead.linkedinConnectionStatus || '',
      'Notes': lead.notes || '',
      'AI Profile Assessment': lead.aiProfileAssessment || '',
      'AI Score': lead.aiScore,
  // Prefer computed percentage from server; fallback to legacy field if present
  'Posts Relevance Percentage': lead.computedPostsRelevancePercentage ?? lead.postsRelevancePercentage,
      'Top Scoring Post': lead.topScoringPost || '',
      'Posts Actioned': lead.postsActioned,
      'Posts Relevance Score': lead.postsRelevanceScore,
      'Posts Relevance Status': lead.postsRelevanceStatus || '',
      // Additional fields for compatibility
      id: lead.id,
  postsMaxPossibleScore: lead.postsMaxPossibleScore,
  computedPostsRelevancePercentage: lead.computedPostsRelevancePercentage,
      // Include raw backend data for compatibility
      ...lead
    }));
    
    // Return leads with total count metadata
    return {
      leads: mappedLeads,
      total: totalCount || mappedLeads.length
    };
  } catch (error) {
    console.error('Get top scoring posts error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Failed to load top scoring posts');
  }
};

// Search Terms: fetch client-scoped token suggestions
export const getSearchTokenSuggestions = async (opts = {}) => {
  const clientId = getCurrentClientId();
  if (!clientId) throw new Error('Client ID not available. Please ensure user is authenticated.');

  const params = {
    testClient: clientId,
    limit: opts.limit ?? 30,
    minCount: opts.minCount ?? 1
  };

  const response = await api.get('/leads/search-token-suggestions', { params });
  const data = response.data;
  // Support either { ok, suggestions } or direct array fallback
  const list = Array.isArray(data) ? data : data?.suggestions;
  if (!Array.isArray(list)) return [];
  return list;
};

export const getLeadByLinkedInUrl = async (linkedinUrl) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.get('/leads/by-linkedin-url', {
      params: { 
        url: linkedinUrl,
        testClient: clientId
      }
    });
    
    // Map backend response to frontend format (same structure as getLeadById)
    const lead = response.data;
    return {
      id: lead.id,
      'Profile Key': lead.profileKey || lead.id,
      'First Name': lead.firstName,
      'Last Name': lead.lastName,
      'LinkedIn Profile URL': lead.linkedinProfileUrl,
      'Email': lead.email,
      email: lead.email,
      'Phone': lead.phone,
      phone: lead.phone,
      'AI Score': lead.aiScore,
      aiScore: lead.aiScore,
      'Status': lead.status,
      status: lead.status,
      'Priority': lead.priority,
      priority: lead.priority,
      'Notes': lead.notes,
      notes: lead.notes
    };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      throw new Error('Lead not found with that LinkedIn URL');
    }
    throw new Error('Failed to find lead by LinkedIn URL');
  }
};

// Message history functions
export const updateMessageHistory = async (leadId, messageData) => {
  try {
    const response = await api.post(`/leads/${leadId}/messages`, messageData);
    return response.data;
  } catch (error) {
    throw new Error('Failed to update message history');
  }
};

export const getMessageHistory = async (leadId) => {
  try {
    const response = await api.get(`/leads/${leadId}/messages`);
    return response.data;
  } catch (error) {
    throw new Error('Failed to load message history');
  }
};

// Chrome extension specific functions
export const syncLeadData = async (syncData) => {
  try {
    const response = await api.post('/extension/sync', syncData);
    return response.data;
  } catch (error) {
    throw new Error('Failed to sync lead data from extension');
  }
};

// Attribute management functions (Profile Scoring)
export const getAttributes = async () => {
  try {
    // Call your deployed backend directly - use full base URL without /api/linkedin
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const response = await fetch(`${baseUrl}/api/attributes`, {
      method: 'GET',
      headers: getAuthenticatedHeaders()
    });
    
    if (!response.ok) {
      throw new Error(`Failed to load attributes: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error in getAttributes:', error);
    throw new Error('Failed to load attributes');
  }
};

// Post Scoring Attributes management functions
export const getPostAttributes = async () => {
  try {
    // Import getCurrentClientId to get the client authentication
    const { getCurrentClientId } = await import('../utils/clientUtils.js');
    const clientId = getCurrentClientId();
    
    if (!clientId) {
      throw new Error('Client ID not available - user not authenticated');
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const url = `${baseUrl}/api/post-attributes`;
    console.log('🌐 Making API call to:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthenticatedHeaders()
    });
    
    console.log('📡 Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API error response:', errorText);
      throw new Error(`Failed to load post attributes: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('📄 API response data:', data);
    return data;
  } catch (error) {
    console.error('Error in getPostAttributes:', error);
    throw new Error('Failed to load post attributes');
  }
};

export const getAttributeForEditing = async (attributeId) => {
  try {
    // Import getCurrentClientId to get the client authentication
    const { getCurrentClientId } = await import('../utils/clientUtils.js');
    const clientId = getCurrentClientId();
    
    if (!clientId) {
      throw new Error('Client ID not available - user not authenticated');
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const response = await fetch(`${baseUrl}/api/attributes/${attributeId}/edit`, {
      method: 'GET',
      headers: getAuthenticatedHeaders()
    });
    
    if (!response.ok) {
      throw new Error(`Failed to load attribute: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error in getAttributeForEditing:', error);
    throw new Error('Failed to load attribute for editing');
  }
};

export const getPostAttributeForEditing = async (attributeId) => {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const response = await fetch(`${baseUrl}/api/post-attributes/${attributeId}/edit`, {
      method: 'GET',
      headers: getAuthenticatedHeaders()
    });
    
    if (!response.ok) {
      throw new Error(`Failed to load post attribute: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error in getPostAttributeForEditing:', error);
    throw new Error('Failed to load post attribute for editing');
  }
};

export const getAISuggestions = async (attributeId, userRequest, currentAttribute) => {
  try {
    // Import getCurrentClientId to get the client authentication
    const { getCurrentClientId } = await import('../utils/clientUtils.js');
    const clientId = getCurrentClientId();
    
    if (!clientId) {
      throw new Error('Client ID not available - user not authenticated');
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const response = await fetch(`${baseUrl}/api/attributes/${attributeId}/ai-edit`, {
      method: 'POST',
      headers: getAuthenticatedHeaders(),
      body: JSON.stringify({
        userRequest
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get AI suggestions: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error in getAISuggestions:', error);
    throw new Error('Failed to get AI suggestions');
  }
};

export const getPostAISuggestions = async (attributeId, userRequest, currentAttribute) => {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const response = await fetch(`${baseUrl}/api/post-attributes/${attributeId}/ai-edit`, {
      method: 'POST',
      headers: getAuthenticatedHeaders(),
      body: JSON.stringify({
        userRequest
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get post AI suggestions: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error in getPostAISuggestions:', error);
    throw new Error('Failed to get post AI suggestions');
  }
};

export const saveAttributeChanges = async (attributeId, improvedRubric) => {
  try {
    // Import getCurrentClientId to get the client authentication
    const { getCurrentClientId } = await import('../utils/clientUtils.js');
    const clientId = getCurrentClientId();
    
    if (!clientId) {
      throw new Error('Client ID not available - user not authenticated');
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const response = await fetch(`${baseUrl}/api/attributes/${attributeId}/save`, {
      method: 'POST',
      headers: getAuthenticatedHeaders(),
      body: JSON.stringify({
        improvedRubric
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to save changes: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error in saveAttributeChanges:', error);
    throw new Error('Failed to save attribute changes');
  }
};

export const savePostAttributeChanges = async (attributeId, updatedData) => {
  try {
    console.log('savePostAttributeChanges - sending data:', {
      attributeId,
      updatedData,
      activeField: updatedData.active,
      activeType: typeof updatedData.active
    });

    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const response = await fetch(`${baseUrl}/api/post-attributes/${attributeId}/save`, {
      method: 'POST',
      headers: getAuthenticatedHeaders(),
      body: JSON.stringify(updatedData)
    });
    
    console.log('savePostAttributeChanges - response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('savePostAttributeChanges - error response:', errorText);
      throw new Error(`Failed to save post changes: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('savePostAttributeChanges - success response:', result);
    return result;
  } catch (error) {
    console.error('Error in savePostAttributeChanges:', error);
    throw new Error('Failed to save post attribute changes');
  }
};

export const toggleAttributeActive = async (attributeId, isActive) => {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const response = await fetch(`${baseUrl}/api/attributes/${attributeId}/save`, {
      method: 'POST',
      headers: getAuthenticatedHeaders(),
      body: JSON.stringify({
        active: isActive
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to toggle active status: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error in toggleAttributeActive:', error);
    throw new Error('Failed to toggle active status');
  }
};

export const togglePostAttributeActive = async (attributeId, isActive) => {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const response = await fetch(`${baseUrl}/api/post-attributes/${attributeId}/save`, {
      method: 'POST',
      headers: getAuthenticatedHeaders(),
      body: JSON.stringify({
        active: isActive
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to toggle post active status: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error in togglePostAttributeActive:', error);
    throw new Error('Failed to toggle post active status');
  }
};

// Get current token usage
export const getTokenUsage = async () => {
  try {
    const baseUrl = getBackendBase();
    
    // Get client ID from clientUtils (works with token-based auth)
    const clientId = getCurrentClientId();
    
    if (!clientId) {
      console.warn('getTokenUsage: Client ID not available yet');
      throw new Error('Client ID not available');
    }
    
    const response = await fetch(`${baseUrl}/api/token-usage`, {
      method: 'GET',
      headers: getAuthenticatedHeaders()
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get token usage: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error in getTokenUsage:', error);
    throw new Error('Failed to get token usage');
  }
};

// Get current post token usage
export const getPostTokenUsage = async () => {
  try {
    const baseUrl = getBackendBase();
    
    // Get client ID from clientUtils (works with token-based auth)
    const clientId = getCurrentClientId();
    
    if (!clientId) {
      console.warn('getPostTokenUsage: Client ID not available yet');
      throw new Error('Client ID not available');
    }
    
    const response = await fetch(`${baseUrl}/api/post-token-usage`, {
      method: 'GET',
      headers: getAuthenticatedHeaders()
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get post token usage: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error in getPostTokenUsage:', error);
    throw new Error('Failed to get post token usage');
  }
};

// Alias for backwards compatibility
export const saveAttribute = saveAttributeChanges;

// START HERE HELP: fetch hierarchical onboarding categories (Phase 1)
export const getStartHereHelp = async (opts = {}) => {
  try {
  // Always resolve via helper to pick correct backend per env (dev, preview, prod)
  const baseUrl = getBackendBase();
  const params = new URLSearchParams();
  params.set('include', 'body');
  // Ensure Start Here list uses the same client/base as topic/context calls
  try {
    const cid = getCurrentClientId?.();
    if (cid) params.set('testClient', cid);
    else if (typeof window !== 'undefined') {
      const u = new URL(window.location.href);
      const tc = u.searchParams.get('testClient');
      if (tc) params.set('testClient', tc);
    }
  } catch {}
  if (opts.refresh) params.set('refresh', '1');
  if (opts.table) params.set('table', opts.table); // e.g. 'copy' to inspect legacy table
  if (opts.section) params.set('section', opts.section); // Section filtering: Setup, Regular Tasks, Getting Better Results
    // Add a cache-buster to avoid CDN/browser caching stale responses in preview envs
    params.set('_', String(Date.now()));
  const startHereUrl = `${baseUrl}/api/help/start-here?${params.toString()}`;
  try { if (typeof window !== 'undefined') console.debug('[help] GET', startHereUrl); } catch {}
  const resp = await fetch(startHereUrl, { method: 'GET' });
    if (!resp.ok) throw new Error(`Failed to load Start Here help: ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.error('getStartHereHelp error', e);
    throw e;
  }
};
  // HELP by context area (e.g., 'linkedin_messaging', 'lead_scoring', etc.)
  export const getContextHelp = async (area, opts = {}) => {
    if (!area) throw new Error('area is required');
    try {
  const baseUrl = getBackendBase();
      const params = new URLSearchParams();
      params.set('area', String(area));
      params.set('include', opts.includeBody ? 'body' : '');
      // Prefer explicit client base when available to avoid default production base
      try {
        const cid = getCurrentClientId?.();
        if (cid) params.set('testClient', cid);
        else if (typeof window !== 'undefined') {
          const u = new URL(window.location.href);
          const tc = u.searchParams.get('testClient');
          if (tc) params.set('testClient', tc);
        }
      } catch {}
      if (opts.refresh) params.set('refresh', '1');
      if (opts.table) params.set('table', opts.table);
  params.set('_', String(Date.now()));
  const url = `${baseUrl}/api/help/context?${params.toString()}`;
  try { if (typeof window !== 'undefined') console.debug('[help] GET', url); } catch {}
  const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) throw new Error(`Failed to load help for ${area}: ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.error('getContextHelp error', e);
      throw e;
    }
  };


// Fetch a single help topic with parsed blocks
export const getHelpTopic = async (id, opts = {}) => {
  const includeInstructions = opts.includeInstructions ? '1' : '0';
  try {
  // Always resolve via helper for consistent behavior across environments
  const baseUrl = getBackendBase();

    // Add a timeout wrapper so UI can surface an error instead of endless "Loading" if server unreachable
    const controller = new AbortController();
    const t = setTimeout(()=>controller.abort(), 12000); // 12s network timeout
    let resp;
    try {
      // Build topic URL with include_instructions and testClient when available
      const params = new URLSearchParams();
      params.set('include_instructions', includeInstructions);
      try {
        const cid = getCurrentClientId?.();
        if (cid) params.set('testClient', cid);
        else if (typeof window !== 'undefined') {
          const u = new URL(window.location.href);
          const tc = u.searchParams.get('testClient');
          if (tc) params.set('testClient', tc);
        }
      } catch {}
  params.set('_', String(Date.now()));
  const topicUrl = `${baseUrl}/api/help/topic/${id}?${params.toString()}`;
  try { if (typeof window !== 'undefined') console.debug('[help] GET', topicUrl); } catch {}
  resp = await fetch(topicUrl, { method: 'GET', signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
    if (!resp.ok) {
      // Read body for diagnostics, then throw
      let bodyText = '';
      try { bodyText = await resp.text(); } catch {}
      console.error('getHelpTopic non-OK', { status: resp.status, bodyText: (bodyText||'').slice(0,200) });
      throw new Error(`Failed to load topic ${id}: ${resp.status}`);
    }
    const payload = await resp.json();
    // Normalize to always return blocks for the UI renderer
    let blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
    if (blocks.length === 0) {
      const html = payload.bodyHtml || payload.body_html || '';
      const md = payload.markdown || payload.body || '';
      const content = html || md;
      if (content) {
        blocks = [{ type: 'text', markdown: String(content) }];
      }
    }
    return { ...payload, blocks };
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error('getHelpTopic timeout', id);
      throw new Error('Topic fetch timed out');
    }
    console.error('getHelpTopic error', e);
    throw e;
  }
};

// =========================================================================
// QUICK UPDATE API FUNCTIONS
// For rapid notes and contact info updates
// =========================================================================

/**
 * Lookup lead by LinkedIn URL, email, or name
 * @param {string} query - URL, email, or name to search
 * @returns {Promise<{lookupMethod: string, count: number, leads: Array}>}
 */
export const lookupLead = async (query) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.get('/leads/lookup', {
      params: { query, testClient: clientId }
    });
    
    return response.data;
  } catch (error) {
    console.error('Lead lookup error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error || 'Failed to lookup lead');
  }
};

/**
 * Get notes section summary for a lead
 * @param {string} leadId - Airtable record ID
 * @returns {Promise<{leadId: string, summary: Object, totalLength: number}>}
 */
export const getLeadNotesSummary = async (leadId) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.get(`/leads/${leadId}/notes-summary`, {
      params: { testClient: clientId }
    });
    
    return response.data;
  } catch (error) {
    console.error('Notes summary error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error || 'Failed to get notes summary');
  }
};

/**
 * Quick update lead - notes section and/or contact info
 * @param {string} leadId - Airtable record ID
 * @param {Object} updates - Update data
 * @param {string} updates.section - 'linkedin' | 'salesnav' | 'manual'
 * @param {string} updates.content - Note content (raw or formatted)
 * @param {string} updates.followUpDate - ISO date string
 * @param {string} updates.email - Email address
 * @param {string} updates.phone - Phone number
 * @param {boolean} updates.parseRaw - Auto-parse raw content (default true)
 * @returns {Promise<Object>}
 */
export const quickUpdateLead = async (leadId, updates) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.patch(`/leads/${leadId}/quick-update`, updates, {
      params: { testClient: clientId }
    });
    
    return response.data;
  } catch (error) {
    console.error('Quick update error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error || 'Failed to update lead');
  }
};

/**
 * Preview how content will be parsed
 * @param {string} content - Raw content to parse
 * @param {string} section - Target section
 * @returns {Promise<{detectedFormat: string, messageCount: number, formatted: string}>}
 */
export const previewParse = async (content, section) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.post('/leads/parse-preview', { content, section }, {
      params: { testClient: clientId }
    });
    
    return response.data;
  } catch (error) {
    console.error('Parse preview error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error || 'Failed to preview parse');
  }
};

/**
 * Update client timezone (self-service configuration)
 * @param {string} timezone - IANA timezone identifier
 * @returns {Promise<{success: boolean, timezone: string}>}
 */
export const updateClientTimezone = async (timezone) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.patch('/client/timezone', { timezone }, {
      params: { testClient: clientId }
    });
    
    return response.data;
  } catch (error) {
    console.error('Update timezone error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error || 'Failed to update timezone');
  }
};

/**
 * Get service account email for calendar sharing instructions
 * @returns {Promise<{success: boolean, serviceAccountEmail: string}>}
 */
export const getServiceAccountEmail = async () => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.get('/client/service-account-email', {
      params: { testClient: clientId }
    });
    
    return response.data;
  } catch (error) {
    console.error('Get service account email error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error || 'Failed to get service account email');
  }
};

/**
 * Update client calendar email (self-service configuration)
 * @param {string} calendarEmail - Google Calendar email address
 * @returns {Promise<{success: boolean, calendarEmail: string}>}
 */
export const updateClientCalendarEmail = async (calendarEmail) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.patch('/client/calendar', { calendarEmail }, {
      params: { testClient: clientId }
    });
    
    return response.data;
  } catch (error) {
    console.error('Update calendar email error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error || 'Failed to update calendar email');
  }
};

/**
 * Verify calendar connection - tests if calendar is properly shared
 * @param {string} calendarEmail - Google Calendar email to verify
 * @returns {Promise<{success: boolean, connected: boolean, message: string}>}
 */
export const verifyCalendarConnection = async (calendarEmail) => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.post('/client/verify-calendar', { calendarEmail }, {
      params: { testClient: clientId }
    });
    
    return response.data;
  } catch (error) {
    console.error('Verify calendar error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error || 'Failed to verify calendar connection');
  }
};

/**
 * Get clients coached by the current user
 * @returns {Promise<{success: boolean, clients: Array, count: number}>}
 */
export const getCoachedClients = async () => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    // Use the backend base URL (not /api/linkedin) for this endpoint
    const backendBase = getBackendBase();
    const response = await axios.get(`${backendBase}/api/coached-clients/${clientId}`, {
      timeout: 30000,
      headers: getAuthenticatedHeaders()
    });
    
    return response.data;
  } catch (error) {
    console.error('Get coached clients error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error || 'Failed to get coached clients');
  }
};

/**
 * Get system settings (Coaching Resources URL, etc.)
 * @returns {Promise<{success: boolean, settings: Object}>}
 */
export const getSystemSettings = async () => {
  try {
    const backendBase = getBackendBase();
    const response = await axios.get(`${backendBase}/api/system-settings`, {
      timeout: 10000,
      headers: getAuthenticatedHeaders()
    });
    
    return response.data;
  } catch (error) {
    console.error('Get system settings error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error || 'Failed to get system settings');
  }
};

/**
 * Generate a follow-up message for a lead using AI
 * Uses Next.js API proxy (same pattern as calendar-chat) for reliable backend communication
 * @param {string} leadId - The lead's Airtable record ID
 * @param {Object} options - Generation options
 * @param {string} options.refinement - Optional refinement instruction
 * @param {boolean} options.analyzeOnly - If true, return analysis instead of message
 * @param {Object} options.context - Lead context for generation
 * @returns {Promise<{message?: string, analysis?: string}>}
 */
export const generateFollowupMessage = async (leadId, options = {}) => {
  try {
    const clientId = getCurrentClientId();
    const token = getCurrentPortalToken();
    const devKey = getCurrentDevKey();
    
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    // Use Next.js API proxy (same pattern as calendar-chat which works)
    const headers = {
      'Content-Type': 'application/json',
      'x-client-id': clientId,
    };
    if (token) headers['x-portal-token'] = token;
    if (devKey) headers['x-dev-key'] = devKey;
    
    const response = await fetch('/api/smart-followups/generate-message', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        leadId,
        ...options
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Generate follow-up message error:', data);
      throw new Error(data.message || data.error || 'Failed to generate message');
    }
    
    return data;
  } catch (error) {
    console.error('Generate follow-up message error:', error.message);
    throw error;
  }
};

/**
 * Detect tags for a lead using AI analysis
 * @param {Object} params - Parameters for tag detection
 * @param {string} params.notes - Lead's manual notes
 * @param {string} params.linkedinMessages - LinkedIn conversation content
 * @param {string} params.emailContent - Email correspondence content
 * @param {string} params.leadName - Name of the lead
 * @returns {Promise<{suggestedTags: string[], reasoning: string, promiseDate: string|null}>}
 */
export const detectLeadTags = async ({ notes, linkedinMessages, emailContent, leadName }) => {
  try {
    const clientId = getCurrentClientId();
    const token = getCurrentPortalToken();
    const devKey = getCurrentDevKey();
    
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const headers = {
      'Content-Type': 'application/json',
      'x-client-id': clientId,
    };
    if (token) headers['x-portal-token'] = token;
    if (devKey) headers['x-dev-key'] = devKey;
    
    const response = await fetch('/api/smart-followups/detect-tags', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        notes,
        linkedinMessages,
        emailContent,
        leadName
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Detect tags error:', data);
      throw new Error(data.message || data.error || 'Failed to detect tags');
    }
    
    return data;
  } catch (error) {
    console.error('Detect tags error:', error.message);
    throw error;
  }
};

export default api;

// Export helper functions for use in components
export { getAuthenticatedHeaders };
