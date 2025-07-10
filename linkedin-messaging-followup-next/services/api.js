import axios from 'axios';

// API configuration
// In Next.js, environment variables must be prefixed with NEXT_PUBLIC_ to be available in the browser
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://pb-webhook-server.onrender.com/api/linkedin';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

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
      config.params.client = 'Guy-Wilson'; // TODO: Make this dynamic
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
export const searchLeads = async (query) => {
  try {
    const response = await api.get('/leads/search', {
      params: { 
        q: query,
        client: 'Guy-Wilson' // TODO: Make this dynamic based on logged-in user
      }
    });
    
    console.log('API searchLeads response:', response.data);
    
    // Ensure we always return an array
    if (!response.data) {
      console.warn('API returned no data');
      return [];
    }
    
    if (!Array.isArray(response.data)) {
      console.warn('API returned non-array data:', response.data);
      return [];
    }
    
    // Map backend field names to frontend field names
    const leads = response.data.map(lead => ({
      'Profile Key': lead.id || '',
      'First Name': lead.firstName || '',
      'Last Name': lead.lastName || '',
      'LinkedIn Profile URL': lead.linkedinProfileUrl || '',
      'AI Score': lead.aiScore,
      'Status': lead.status || '',
      'Last Message Date': lead.lastMessageDate || ''
    }));
    
    console.log('Mapped leads:', leads);
    return leads;
  } catch (error) {
    console.error('Search error:', error);
    throw new Error('Failed to search leads');
  }
};

export const getLeadById = async (leadId) => {
  try {
    const response = await api.get(`/leads/${leadId}`, {
      params: {
        client: 'Guy-Wilson' // TODO: Make this dynamic
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
      'Follow Up Date': lead.followUpDate,
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
    throw new Error('Failed to load lead details');
  }
};

export const updateLead = async (leadId, updateData) => {
  try {
    console.log('Updating lead:', leadId, 'with data:', updateData);
    
    // Map frontend field names to backend field names
    const backendData = {};
    const fieldMapping = {
      'firstName': 'firstName',
      'lastName': 'lastName', 
      'linkedinProfileUrl': 'linkedinProfileUrl',
      'viewInSalesNavigator': 'viewInSalesNavigator',
      'email': 'email',
      'phone': 'phone',
      'notes': 'notes',
      'followUpDate': 'followUpDate',
      'followUpNotes': 'followUpNotes',
      'source': 'source',
      'status': 'status',
      'priority': 'priority',
      'linkedinConnectionStatus': 'linkedinConnectionStatus',
      'ashWorkshopEmail': 'ashWorkshopEmail'
    };
    
    Object.keys(updateData).forEach(frontendField => {
      const backendField = fieldMapping[frontendField];
      if (backendField) {
        backendData[backendField] = updateData[frontendField];
      }
    });
    
    console.log('Sending backend data:', backendData);
    
    const response = await api.put(`/leads/${leadId}`, backendData, {
      params: {
        client: 'Guy-Wilson' // Backend expects this as URL parameter for now
      }
    });
    
    console.log('Update response:', response.data);
    
    // Fetch the complete lead data after update to ensure consistency
    const completeLeadData = await getLeadById(leadId);
    return completeLeadData;
  } catch (error) {
    console.error('Update lead error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Failed to update lead');
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

// Follow-up management
export const getFollowUps = async (date) => {
  try {
    const response = await api.get('/follow-ups', {
      params: { date }
    });
    return response.data;
  } catch (error) {
    throw new Error('Failed to load follow-ups');
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

export default api;
