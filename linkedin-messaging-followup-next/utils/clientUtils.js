// utils/clientUtils.js
// Dynamic client management for frontend authentication

let currentClientId = null;
let clientProfile = null;

/**
 * Simple function to fix malformed JSON with double commas
 * @param {string} jsonText - Raw JSON text that might have double commas
 * @returns {Object} - Parsed JSON object
 */
function parseJSONWithFix(jsonText) {
  try {
    // Fix the specific corruption we're seeing: ,, → ,
    const fixedText = jsonText.replace(/,,/g, ',');
    return JSON.parse(fixedText);
  } catch (error) {
    console.error('ClientUtils: JSON parse error even after fix:', error);
    console.error('ClientUtils: Original text:', jsonText);
    console.error('ClientUtils: Fixed text:', jsonText.replace(/,,/g, ','));
    throw error;
  }
}

/**
 * Fetch current user's client profile from the backend
 * This replaces hardcoded client references
 */
export async function getCurrentClientProfile() {
  try {
    // Check for test client parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    console.log('ClientUtils: Current URL:', window.location.href);
    console.log('ClientUtils: URL search params:', window.location.search);
    console.log('ClientUtils: All URL params:', Object.fromEntries(urlParams));
    
    const testClient = urlParams.get('testClient');
    // Handle case-insensitive wpUserId parameter variations
    const wpUserId = urlParams.get('wpUserId') || urlParams.get('wpuserid') || urlParams.get('wpuserId');
    
    console.log('ClientUtils: Extracted testClient:', testClient);
    console.log('ClientUtils: Extracted wpUserId:', wpUserId);
    
    let apiUrl = '/api/auth/test';
    
    // If test client specified, use test mode
    if (testClient) {
      console.log(`ClientUtils: Using test client from URL: ${testClient}`);
      apiUrl += `?testClient=${encodeURIComponent(testClient)}`;
    } 
    // If WordPress User ID provided, use that for authentication
    else if (wpUserId) {
      console.log(`ClientUtils: Using WordPress User ID from URL: ${wpUserId}`);
      apiUrl += `?wpUserId=${encodeURIComponent(wpUserId)}`;
    }

    // Use absolute URL to backend for authentication
    const fullUrl = `https://pb-webhook-server-hotfix.onrender.com${apiUrl}`;
    
    console.log(`ClientUtils: Fetching client profile from: ${fullUrl}`);
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': testClient,
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ClientUtils: API Error ${response.status}:`, errorText);
      throw new Error(`Failed to get user profile: ${response.status} ${response.statusText}`);
    }

    // Parse JSON response with corruption fix
    const responseText = await response.text();
    console.log('ClientUtils: Raw response text:', responseText);
    
    const data = parseJSONWithFix(responseText);
    console.log('ClientUtils: Successfully parsed JSON response with fix');
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
    
    // Check for test client parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    const testClient = urlParams.get('testClient');
    
    // Only allow fallback if testClient parameter is explicitly provided
    if (testClient) {
      console.warn(`ClientUtils: Using development fallback for testClient: ${testClient}`);
      currentClientId = testClient;
      clientProfile = {
        client: {
          clientId: testClient,
          clientName: `${testClient} (Development Mode)`,
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
    } else {
      // No testClient parameter - authentication failed, provide specific error messages
      console.error('ClientUtils: Authentication failed and no testClient parameter provided');
      
      // Try to parse error response for better error messages
      if (error.message.includes('401')) {
        throw new Error('Please log in to Australian Side Hustles before accessing this portal.');
      } else if (error.message.includes('403')) {
        throw new Error('Your account does not have access to this portal. Please contact your coach.');
      } else {
        throw new Error('Authentication required. Please log in to access this portal.');
      }
    }
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
    // Re-throw the error so Layout.js can handle authentication failures properly
    throw error;
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
