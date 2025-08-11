import axios from 'axios';
import { getCurrentClientId } from '../utils/clientUtils.js';

// API configuration
// In Next.js, environment variables must be prefixed with NEXT_PUBLIC_ to be available in the browser
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://pb-webhook-server.onrender.com/api/linkedin';

// Configurable timeout (default 30s). Override with NEXT_PUBLIC_API_TIMEOUT (milliseconds)
const RAW_TIMEOUT = process.env.NEXT_PUBLIC_API_TIMEOUT;
const API_TIMEOUT = RAW_TIMEOUT && !isNaN(Number(RAW_TIMEOUT)) ? Number(RAW_TIMEOUT) : 30000;
console.log('[DEBUG] API timeout (ms):', API_TIMEOUT, RAW_TIMEOUT ? '(from NEXT_PUBLIC_API_TIMEOUT)' : '(default 30000)');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Helper function to get authenticated headers for API calls
const getAuthenticatedHeaders = () => {
  const clientId = getCurrentClientId();
  
  if (!clientId) {
    throw new Error('Client ID not available - user not authenticated');
  }

  return {
    'Content-Type': 'application/json',
    'x-client-id': clientId
  };
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
export const searchLeads = async (query, priority = 'all') => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const params = { 
      q: query,
      testClient: clientId
    };
    
    // Only add priority parameter if it's not 'all'
    if (priority && priority !== 'all') {
      params.priority = priority;
    }
    
    const response = await api.get('/leads/search', { params });
    
    // Ensure we always return an array
    if (!response.data) {
      return [];
    }
    
    if (!Array.isArray(response.data)) {
      return [];
    }
    
    // Map backend field names to frontend field names
    return response.data.map(lead => ({
      'Profile Key': lead.id || '',
      'First Name': lead.firstName || '',
      'Last Name': lead.lastName || '',
      'LinkedIn Profile URL': lead.linkedinProfileUrl || '',
      'AI Score': lead.aiScore,
      'Status': lead.status || '',
      'Priority': lead.priority || '',
      'Last Message Date': lead.lastMessageDate || ''
    }));
  } catch (error) {
    console.error('Search error:', error);
    throw new Error('Failed to search leads');
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
      'ASH Workshop Email': lead.ashWorkshopEmail,
      'AI Profile Assessment': lead.aiProfileAssessment,
      'AI Attribute Breakdown': lead.aiAttributeBreakdown,
      // Also include camelCase for compatibility
      ashWorkshopEmail: lead.ashWorkshopEmail,
      phone: lead.phone,
      followUpDate: lead.followUpDate
    };
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
      'notes': 'Notes',
      'followUpDate': 'Follow-Up Date',
      'followUpNotes': 'Follow Up Notes',
      'source': 'Source',
      'status': 'Status',
      'priority': 'Priority',
      'linkedinConnectionStatus': 'LinkedIn Connection Status',
      'ashWorkshopEmail': 'ASH Workshop Email',
      'postsActioned': 'Posts Actioned'
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
      'ASH Workshop Email': lead.ashWorkshopEmail,
      // Also include camelCase for compatibility
      ashWorkshopEmail: lead.ashWorkshopEmail,
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
    // Map frontend field names to Airtable field names
    const backendData = {};
    const fieldMapping = {
      'firstName': 'First Name',
      'lastName': 'Last Name', 
      'linkedinProfileUrl': 'LinkedIn Profile URL',
      'viewInSalesNavigator': 'View In Sales Navigator',
      'email': 'Email',
      'phone': 'Phone',
      'notes': 'Notes',
      'followUpDate': 'Follow-Up Date',
      'followUpNotes': 'Follow Up Notes',
      'source': 'Source',
      'status': 'Status',
      'priority': 'Priority',
      'linkedinConnectionStatus': 'LinkedIn Connection Status',
      'ashWorkshopEmail': 'ASH Workshop Email',
      'postsActioned': 'Posts Actioned'
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
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.put(`/leads/${leadId}`, backendData, {
      params: {
        testClient: clientId
      }
    });
    
    // Map backend response to frontend format (same as getLeadById)
    const lead = response.data;
    
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
      'ASH Workshop Email': lead.ashWorkshopEmail,
      // Also include camelCase for compatibility
      ashWorkshopEmail: lead.ashWorkshopEmail,
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

export const getTopScoringPosts = async () => {
  try {
    const clientId = getCurrentClientId();
    if (!clientId) {
      throw new Error('Client ID not available. Please ensure user is authenticated.');
    }
    
    const response = await api.get('/leads/top-scoring-posts', {
      params: {
        testClient: clientId
      },
      timeout: 30000 // 30 seconds to handle larger datasets
    });
    
    // Backend returns data in correct format, just map to frontend field names
    return response.data.map(lead => ({
      'Profile Key': lead.id || '',
      'First Name': lead.firstName || '',
      'Last Name': lead.lastName || '',
      'LinkedIn Profile URL': lead.linkedinProfileUrl || '',
      'View In Sales Navigator': lead.viewInSalesNavigator || '',
      'LinkedIn Connection Status': lead.linkedinConnectionStatus || '',
      'Notes': lead.notes || '',
      'AI Profile Assessment': lead.aiProfileAssessment || '',
      'AI Score': lead.aiScore,
      'Posts Relevance Percentage': lead.postsRelevancePercentage,
      'Top Scoring Post': lead.topScoringPost || '',
      'Posts Actioned': lead.postsActioned,
      'Posts Relevance Score': lead.postsRelevanceScore,
      'Posts Relevance Status': lead.postsRelevanceStatus || '',
      // Additional fields for compatibility
      id: lead.id,
      // Include raw backend data for compatibility
      ...lead
    }));
  } catch (error) {
    console.error('Get top scoring posts error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Failed to load top scoring posts');
  }
};

export const getLeadByLinkedInUrl = async (linkedinUrl) => {
  try {
    const response = await api.get('/leads/by-linkedin-url', {
      params: { url: linkedinUrl }
    });
    return response.data;
  } catch (error) {
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
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId
      }
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
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId
      }
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
      headers: {
        'Content-Type': 'application/json'
      }
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
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId
      },
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
      headers: {
        'Content-Type': 'application/json'
      },
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
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId
      },
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
      headers: {
        'Content-Type': 'application/json'
      },
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
      headers: {
        'Content-Type': 'application/json'
      },
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
      headers: {
        'Content-Type': 'application/json'
      },
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
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    
    // Get client parameter from URL for authentication
    const urlParams = new URLSearchParams(window.location.search);
    const testClient = urlParams.get('testClient');
    const client = urlParams.get('client');
    const clientId = testClient || client;
    
    if (!clientId) {
      throw new Error('Client ID not found in URL parameters');
    }
    
    const response = await fetch(`${baseUrl}/api/token-usage?client=${encodeURIComponent(clientId)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
      }
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
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    
    // Get client parameter from URL for authentication
    const urlParams = new URLSearchParams(window.location.search);
    const testClient = urlParams.get('testClient');
    const client = urlParams.get('client');
    const clientId = testClient || client;
    
    if (!clientId) {
      throw new Error('Client ID not found in URL parameters');
    }
    
    const response = await fetch(`${baseUrl}/api/post-token-usage?client=${encodeURIComponent(clientId)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
      }
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

export default api;
