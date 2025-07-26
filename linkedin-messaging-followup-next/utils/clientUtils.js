// utils/clientUtils.js
// Dynamic client management for frontend authentication

let currentClientId = null;
let clientProfile = null;

/**
 * Fetch current user's client profile from the backend
 * This replaces hardcoded client references
 */
export async function getCurrentClientProfile() {
  try {
    // Check for test client parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    const testClient = urlParams.get('testClient');
    
    let apiUrl = '/api/auth/test';
    
    // If test client specified, add it as parameter
    if (testClient) {
      console.log(`ClientUtils: Using test client from URL: ${testClient}`);
      apiUrl += `?testClient=${encodeURIComponent(testClient)}`;
    }

    // Use absolute URL to backend for authentication
    const fullUrl = `https://pb-webhook-server.onrender.com${apiUrl}`;
    
    console.log(`ClientUtils: Fetching client profile from: ${fullUrl}`);
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ClientUtils: API Error ${response.status}:`, errorText);
      throw new Error(`Failed to get user profile: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('ClientUtils: Received client profile:', data);
    
    // Cache the client info
    currentClientId = data.client?.clientId;
    clientProfile = {
      client: data.client,
      authentication: data.authentication,
      features: data.features
    };
    
    console.log('ClientUtils: Retrieved client profile:', {
      clientId: currentClientId,
      clientName: data.client?.clientName,
      serviceLevel: data.client?.serviceLevel
    });
    
    return data;
    
  } catch (error) {
    console.error('ClientUtils: Error fetching client profile:', error);
    
    // Fallback to Guy-Wilson for development/testing
    console.warn('ClientUtils: Falling back to Guy-Wilson for development');
    currentClientId = 'Guy-Wilson';
    clientProfile = {
      client: {
        clientId: 'Guy-Wilson',
        clientName: 'Guy Wilson (Fallback)',
        status: 'Active',
        serviceLevel: 2
      },
      authentication: {
        testMode: true
      },
      features: {
        leadSearch: true,
        leadManagement: true,
        postScoring: true,
        topScoringPosts: true
      }
    };
    
    return clientProfile;
  }
}

/**
 * Get the current client ID (cached)
 * @returns {string|null} Current client ID or null if not loaded
 */
export function getCurrentClientId() {
  return currentClientId;
}

/**
 * Get the full client profile (cached)
 * @returns {Object|null} Full client profile or null if not loaded
 */
export function getClientProfile() {
  return clientProfile;
}

/**
 * Initialize client profile on app startup
 * Should be called once when the app loads
 */
export async function initializeClient() {
  console.log('ClientUtils: Initializing client profile...');
  
  try {
    await getCurrentClientProfile();
    return true;
  } catch (error) {
    console.error('ClientUtils: Failed to initialize client:', error);
    return false;
  }
}

/**
 * Clear cached client data (for logout scenarios)
 */
export function clearClientData() {
  currentClientId = null;
  clientProfile = null;
  console.log('ClientUtils: Client data cleared');
}

export default {
  getCurrentClientProfile,
  getCurrentClientId,
  getClientProfile,
  initializeClient,
  clearClientData
};
