// Background service worker for Network Accelerator extension

// API endpoints
const API_ENDPOINTS = {
  production: 'https://pb-webhook-server.onrender.com/api/linkedin',
  staging: 'https://pb-webhook-server-staging.onrender.com/api/linkedin'
};

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // Portal broadcasts auth credentials
  if (message.type === 'AUTH_BROADCAST') {
    const { clientId, portalToken, devKey, environment } = message;
    chrome.storage.local.set({
      clientId,
      portalToken,
      devKey,
      environment: environment || 'production',
      lastAuthTime: Date.now()
    }, () => {
      console.log('[NA Extension] Auth credentials saved from portal');
      // Notify any open LinkedIn tabs that auth is ready
      chrome.tabs.query({ url: 'https://www.linkedin.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'AUTH_READY' }).catch(() => {});
        });
      });
      sendResponse({ success: true });
    });
    return true; // Keep channel open for async response
  }
  
  // Check if authenticated
  if (message.type === 'CHECK_AUTH') {
    chrome.storage.local.get(['clientId', 'portalToken', 'environment'], (data) => {
      sendResponse({
        authenticated: !!(data.clientId && data.portalToken),
        clientId: data.clientId,
        environment: data.environment || 'production'
      });
    });
    return true;
  }
  
  // Get auth credentials for API calls
  if (message.type === 'GET_AUTH') {
    chrome.storage.local.get(['clientId', 'portalToken', 'devKey', 'environment'], (data) => {
      sendResponse(data);
    });
    return true;
  }
  
  // Lookup lead by LinkedIn URL
  if (message.type === 'LOOKUP_LEAD') {
    handleLookupLead(message.linkedinUrl)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  // Quick update lead with conversation
  if (message.type === 'QUICK_UPDATE') {
    handleQuickUpdate(message.leadId, message.content, message.section)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  // Check for open portal tab
  if (message.type === 'CHECK_PORTAL_TAB') {
    chrome.tabs.query({
      url: ['https://pb-webhook-server.vercel.app/*', 'https://pb-webhook-server-staging.vercel.app/*']
    }, (tabs) => {
      sendResponse({ hasPortalTab: tabs.length > 0, tabCount: tabs.length });
    });
    return true;
  }
  
  // Clear stored auth
  if (message.type === 'CLEAR_AUTH') {
    chrome.storage.local.remove(['clientId', 'portalToken', 'devKey', 'environment', 'lastAuthTime'], () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Helper: Get API base URL
async function getApiBase() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['environment'], (data) => {
      const env = data.environment || 'production';
      resolve(API_ENDPOINTS[env] || API_ENDPOINTS.production);
    });
  });
}

// Helper: Get auth headers
async function getAuthHeaders() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['clientId', 'portalToken', 'devKey'], (data) => {
      if (!data.clientId || !data.portalToken) {
        reject(new Error('Not authenticated. Please open your Network Accelerator portal.'));
        return;
      }
      
      const headers = {
        'Content-Type': 'application/json',
        'x-client-id': data.clientId,
        'x-portal-token': data.portalToken
      };
      
      if (data.devKey) {
        headers['x-dev-key'] = data.devKey;
      }
      
      resolve(headers);
    });
  });
}

// Lookup lead by LinkedIn URL
async function handleLookupLead(linkedinUrl) {
  const apiBase = await getApiBase();
  const headers = await getAuthHeaders();
  
  const url = new URL(`${apiBase}/leads/lookup`);
  url.searchParams.set('query', linkedinUrl);
  
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Lookup failed: ${response.status}`);
  }
  
  return response.json();
}

// Quick update lead with conversation
async function handleQuickUpdate(leadId, content, section = 'linkedin') {
  const apiBase = await getApiBase();
  const headers = await getAuthHeaders();
  
  const response = await fetch(`${apiBase}/leads/${leadId}/quick-update`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      section,
      content,
      parseRaw: true
    })
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Update failed: ${response.status}`);
  }
  
  return response.json();
}

// Set extension badge based on auth state
chrome.storage.local.get(['clientId', 'portalToken'], (data) => {
  updateBadge(!!(data.clientId && data.portalToken));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.clientId || changes.portalToken)) {
    const clientId = changes.clientId?.newValue;
    const portalToken = changes.portalToken?.newValue;
    chrome.storage.local.get(['clientId', 'portalToken'], (data) => {
      updateBadge(!!(data.clientId && data.portalToken));
    });
  }
});

function updateBadge(isAuthenticated) {
  if (isAuthenticated) {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  } else {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  }
}
