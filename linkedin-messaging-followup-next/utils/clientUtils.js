// utils/clientUtils.js
// Dynamic client management for frontend authentication

// Derive API host from the same env var used by axios client
// Falls back to production only if env is missing
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://pb-webhook-server.onrender.com/api/linkedin';
let AUTH_BASE_ORIGIN = 'https://pb-webhook-server.onrender.com';
try {
  const u = new URL(API_BASE_URL);
  AUTH_BASE_ORIGIN = `${u.origin}`; // e.g. https://pb-webhook-server-hotfix.onrender.com
} catch (_) {
  // keep fallback
}

let currentClientId = null;
let clientProfile = null;
let currentPortalToken = null; // Cache the token for API calls
let currentDevKey = null; // Cache the devKey for admin access

/**
 * Determine a human-friendly environment label for UI badges/titles
 * Prefers explicit NEXT_PUBLIC_ENV_LABEL / NEXT_PUBLIC_ENV values,
 * otherwise infers from hostname conventions used in this project.
 */
export function getEnvLabel() {
  // Prefer explicit public env variables when available (compile-time for Next.js)
  if (process.env.NEXT_PUBLIC_ENV_LABEL) return process.env.NEXT_PUBLIC_ENV_LABEL;
  if (process.env.NEXT_PUBLIC_ENV) {
    const v = String(process.env.NEXT_PUBLIC_ENV).toLowerCase();
    if (v.startsWith('stag')) return 'Staging';
    if (v.startsWith('hot')) return 'Hotfix';
    if (v.startsWith('prod')) return 'Production';
    return 'Development';
  }

  // Fallback: infer from hostname when running in the browser
  try {
    if (typeof window !== 'undefined') {
      const host = window.location.host || '';
      if (host.includes('staging')) return 'Staging';
      if (host.includes('hotfix')) return 'Hotfix';
      if (host.includes('dev')) return 'Development';
      if (host.includes('vercel.app')) return ''; // Production - no badge
    }
  } catch (_) {}

  return ''; // Production default - no badge
}

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
    // Check for client parameter in URL (prefer token for secure access)
    const urlParams = new URLSearchParams(window.location.search);
    console.log('ClientUtils: Current URL:', window.location.href);
    console.log('ClientUtils: URL search params:', window.location.search);
    console.log('ClientUtils: All URL params:', Object.fromEntries(urlParams));
    
    // Priority: token from URL > token from sessionStorage > clientId (legacy) > localStorage
    // sessionStorage persists tokens across page refreshes (but not new tabs/windows - that's intentional for security)
    let portalToken = urlParams.get('token');
    if (!portalToken && typeof sessionStorage !== 'undefined') {
      portalToken = sessionStorage.getItem('portalToken');
      if (portalToken) {
        console.log('ClientUtils: Retrieved token from sessionStorage');
      }
    }
    const clientId = urlParams.get('client') || urlParams.get('clientId') || urlParams.get('testClient') || localStorage.getItem('clientCode');
    const devKey = urlParams.get('devKey');
    // Handle case-insensitive wpUserId parameter variations
    const wpUserId = urlParams.get('wpUserId') || urlParams.get('wpuserid') || urlParams.get('wpuserId');
    
    console.log('ClientUtils: Extracted portalToken:', portalToken ? `${portalToken.substring(0, 4)}...` : null);
    console.log('ClientUtils: Extracted clientId:', clientId);
    console.log('ClientUtils: (from localStorage):', localStorage.getItem('clientCode'));
    console.log('ClientUtils: Extracted wpUserId:', wpUserId);
    
    let apiUrl = '/api/auth/test';
    
    // If portal token specified, use secure token auth
    if (portalToken) {
      console.log(`ClientUtils: Using portal token for authentication`);
      apiUrl += `?token=${encodeURIComponent(portalToken)}`;
      currentPortalToken = portalToken; // Cache token for API calls
      // Also persist to sessionStorage for page refresh resilience
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('portalToken', portalToken);
      }
    }
    // If client ID with dev key specified, use dev mode
    else if (clientId && devKey) {
      console.log(`ClientUtils: Using client ID with dev key: ${clientId}`);
      apiUrl += `?clientId=${encodeURIComponent(clientId)}&devKey=${encodeURIComponent(devKey)}`;
      currentDevKey = devKey; // Cache devKey for API calls
    }
    // If client ID specified without dev key (legacy - will fail gracefully)
    else if (clientId) {
      console.log(`ClientUtils: Using client ID from URL (legacy mode): ${clientId}`);
      apiUrl += `?clientId=${encodeURIComponent(clientId)}`;
    } 
    // If WordPress User ID provided, use that for authentication
    else if (wpUserId) {
      console.log(`ClientUtils: Using WordPress User ID from URL: ${wpUserId}`);
      apiUrl += `?wpUserId=${encodeURIComponent(wpUserId)}`;
    }

  // Use absolute URL to backend for authentication based on env-derived origin
  const fullUrl = `${AUTH_BASE_ORIGIN}${apiUrl}`;
    
    console.log(`ClientUtils: Fetching client profile from: ${fullUrl}`);
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
  'Content-Type': 'application/json',
  'x-client-id': clientId || '',
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ClientUtils: API Error ${response.status}:`, errorText);
      
      // Try to parse error response for specific messages
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.code === 'LINK_UPDATED') {
          throw new Error(errorData.message || 'Your portal link has been updated. Please contact your coach for your new secure link.');
        }
        if (errorData.code === 'INVALID_TOKEN') {
          throw new Error(errorData.message || 'Invalid access link. Please contact your coach for a valid link.');
        }
        if (errorData.code === 'CLIENT_INACTIVE') {
          throw new Error(errorData.message || 'Your account is not currently active. Please contact your coach.');
        }
      } catch (parseErr) {
        // If JSON parsing fails, continue with generic error
      }
      
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
    
    // Expose clientId for Chrome extension (Network Accelerator LinkedIn Quick Update)
    if (typeof window !== 'undefined' && currentClientId) {
      window.__NA_CLIENT_ID__ = currentClientId;
    }
    
    console.log('ClientUtils: Retrieved client profile:', {
      clientId: currentClientId,
      clientName: data.client?.clientName,
      serviceLevel: data.client?.serviceLevel
    });
    
    // SECURITY: Clean token from URL after successful authentication
    // This prevents token exposure in screenshots during demos/screen shares
    // The token is already cached in memory for API calls
    if (typeof window !== 'undefined' && currentPortalToken) {
      const url = new URL(window.location.href);
      if (url.searchParams.has('token')) {
        url.searchParams.delete('token');
        // Use replaceState to update URL without adding to history
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        console.log('ClientUtils: Token removed from URL for security');
      }
    }
    
    return data;
    
  } catch (error) {
    console.error('ClientUtils: Error fetching client profile:', error);
    
    // No fallback profiles - always respect backend authentication
    // The error message from the backend will be shown to the user
    console.error('ClientUtils: Authentication failed');
    
    // Re-throw the error with the backend's message
    throw error;
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
  currentPortalToken = null;
  currentDevKey = null;
  // Also clear sessionStorage token
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('portalToken');
  }
  console.log('ClientUtils: Client data cleared');
}

/**
 * Get the current portal token (for API calls)
 * @returns {string|null} Current portal token or null if not using token auth
 */
export function getCurrentPortalToken() {
  return currentPortalToken;
}

/**
 * Get the current dev key (for admin API calls)
 * @returns {string|null} Current dev key or null if not using dev mode
 */
export function getCurrentDevKey() {
  return currentDevKey;
}

/**
 * Manually set the current client ID (for pages that don't use WordPress auth)
 * Used by calendar-booking page which gets clientId from URL params
 * @param {string} clientId - The client ID to set
 */
export function setCurrentClientId(clientId) {
  currentClientId = clientId;
  console.log('ClientUtils: Client ID manually set to:', clientId);
}

/**
 * Build a URL with preserved authentication parameters
 * Prioritizes token (secure) over legacy client params
 * @param {string} path - The path to navigate to (e.g., '/quick-update')
 * @returns {string} URL with auth params appended
 */
export function buildAuthUrl(path) {
  const params = new URLSearchParams();
  
  // Prefer token (secure) over legacy client param
  if (currentPortalToken) {
    params.set('token', currentPortalToken);
  } else if (currentDevKey && currentClientId) {
    params.set('clientId', currentClientId);
    params.set('devKey', currentDevKey);
  } else if (currentClientId) {
    // Legacy fallback - will be blocked by backend
    params.set('client', currentClientId);
  }
  
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export default {
  getCurrentClientProfile,
  getCurrentClientId,
  getClientProfile,
  initializeClient,
  clearClientData,
  setCurrentClientId,
  getCurrentPortalToken,
  getCurrentDevKey,
  buildAuthUrl
};
