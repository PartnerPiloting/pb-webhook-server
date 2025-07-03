import axios from 'axios';

// API configuration
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for authentication
api.interceptors.request.use(
  (config) => {
    // Add WordPress authentication headers
    const wpUser = localStorage.getItem('wpUsername');
    const wpAppPassword = localStorage.getItem('wpAppPassword');
    
    if (wpUser && wpAppPassword) {
      const credentials = btoa(`${wpUser}:${wpAppPassword}`);
      config.headers.Authorization = `Basic ${credentials}`;
    }
    
    // Add WordPress nonce for web portal requests
    const wpNonce = document.querySelector('meta[name="wp-nonce"]')?.content;
    if (wpNonce) {
      config.headers['X-WP-Nonce'] = wpNonce;
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
      params: { q: query }
    });
    return response.data;
  } catch (error) {
    throw new Error('Failed to search leads');
  }
};

export const getLeadById = async (leadId) => {
  try {
    const response = await api.get(`/leads/${leadId}`);
    return response.data;
  } catch (error) {
    throw new Error('Failed to load lead details');
  }
};

export const updateLead = async (leadId, updateData) => {
  try {
    const response = await api.put(`/leads/${leadId}`, updateData);
    return response.data;
  } catch (error) {
    throw new Error('Failed to update lead');
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
