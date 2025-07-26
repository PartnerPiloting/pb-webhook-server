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
    // Use relative path to leverage existing authentication headers
    const response = await fetch('/api/linkedin/user/profile', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Authentication headers will be added by axios interceptor
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get user profile: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Cache the client info
    currentClientId = data.client?.clientId;
    clientProfile = data;
    
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
