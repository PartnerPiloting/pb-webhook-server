import axios from 'axios';
import { getCurrentClientId } from '../utils/clientUtils.js';

// API configuration
// In Next.js, environment variables must be prefixed with NEXT_PUBLIC_ to be available in the browser
console.log('[DEBUG] Environment variable NEXT_PUBLIC_API_BASE_URL:', process.env.NEXT_PUBLIC_API_BASE_URL);
console.log('[DEBUG] Fallback URL would be:', 'https://pb-webhook-server-hotfix.onrender.com/api/linkedin');
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://pb-webhook-server-hotfix.onrender.com/api/linkedin';
console.log('[DEBUG] Final API_BASE_URL being used:', API_BASE_URL);

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Add request interceptor to add client authentication headers
api.interceptors.request.use((config) => {
  const clientId = getCurrentClientId();
  if (clientId) {
    config.headers['x-client-id'] = clientId;
  }
  return config;
});

export default api;
