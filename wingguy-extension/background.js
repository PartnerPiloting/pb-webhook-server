// Background service worker for Wingguy extension (forked from Network Accelerator).
// Reuses the proven auth plumbing (AUTH_BROADCAST from the portal -> chrome.storage ->
// x-client-id / x-portal-token headers). Adds the Wingguy /api/wingguy draft endpoints.

// API endpoints
const API_ENDPOINTS = {
  production: 'https://pb-webhook-server.onrender.com/api/linkedin',
  staging: 'https://pb-webhook-server-staging.onrender.com/api/linkedin'
};

// Wingguy drafting endpoints (Slice 1) — separate base from the legacy /api/linkedin lookup.
const WINGGUY_ENDPOINTS = {
  production: 'https://pb-webhook-server.onrender.com/api/wingguy',
  staging: 'https://pb-webhook-server-staging.onrender.com/api/wingguy'
};

// Calendar/booking endpoints (Slice 2 — reused as-is; they auth on x-client-id which we already send).
const CALENDAR_ENDPOINTS = {
  production: 'https://pb-webhook-server.onrender.com/api/calendar',
  staging: 'https://pb-webhook-server-staging.onrender.com/api/calendar'
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
  
  // Store clipboard data for portal to pick up
  if (message.type === 'STORE_CLIPBOARD_DATA') {
    chrome.storage.local.set({
      clipboardData: message.data
    }, () => {
      console.log('[NA Extension] Clipboard data stored for portal');
      sendResponse({ success: true });
    });
    return true;
  }
  
  // Portal requests clipboard data
  if (message.type === 'GET_CLIPBOARD_DATA') {
    chrome.storage.local.get(['clipboardData'], (data) => {
      sendResponse(data.clipboardData || null);
      // Clear after reading (one-time use)
      chrome.storage.local.remove(['clipboardData']);
    });
    return true;
  }
  
  // Resolve LinkedIn internal ID to real profile URL
  if (message.type === 'RESOLVE_LINKEDIN_URL') {
    resolveLinkedInUrl(message.internalUrl)
      .then(realUrl => sendResponse({ success: true, realUrl }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Wingguy: fetch the campaign quick-pick template set
  if (message.type === 'WINGGUY_GET_TEMPLATES') {
    wingguyGetTemplates()
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Wingguy: draft a personalised thanks-for-connecting message
  if (message.type === 'WINGGUY_DRAFT_THANKS') {
    wingguyDraftThanks(message.templateId, message.profile, message.conversation)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Wingguy: draft the next message in an ongoing conversation
  if (message.type === 'WINGGUY_DRAFT_REPLY') {
    wingguyDraftReply(message.profile, message.conversation)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Wingguy Slice 2: per-tenant booking preferences (the seam — Guy's defaults for now).
  if (message.type === 'WG_BOOKING_PREFS') {
    wingguyGetBookingPrefs()
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Wingguy Slice 2 (booking spike): real calendar availability + the times message.
  if (message.type === 'WG_CAL_AVAILABILITY') {
    wgCal('GET', `/availability?leadLocation=${encodeURIComponent(message.leadLocation || '')}`)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (message.type === 'WG_CAL_QUICKPICK') {
    wgCal('POST', '/quick-pick-message', { selectedSlots: message.selectedSlots, context: message.context })
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  // Look up the lead (for the invite's guest email) by profile URL / name.
  if (message.type === 'WG_CAL_LOOKUP') {
    wgCal('GET', `/lookup-lead?query=${encodeURIComponent(message.query || '')}`)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  // Create the calendar invite (Nylas write) once the human has confirmed the time + guest.
  if (message.type === 'WG_BOOK') {
    wingguyBook(message.payload)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  // Wingguy Slice 2 (chat agent): one turn of the tool-using booking chat. Returns
  // { reply, draft, booked, messages } — the panel resends `messages` each turn.
  if (message.type === 'WG_CHAT') {
    wingguyChat(message.payload)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Wingguy: POST /api/wingguy/book
async function wingguyBook(payload) {
  const apiBase = await getWingguyApiBase();
  const headers = await getAuthHeaders();
  const response = await fetch(`${apiBase}/book`, { method: 'POST', headers, body: JSON.stringify(payload || {}) });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Book failed: ${response.status}`);
  }
  return response.json();
}

// Wingguy: POST /api/wingguy/chat (the tool-using chat agent)
async function wingguyChat(payload) {
  const apiBase = await getWingguyApiBase();
  const headers = await getAuthHeaders();
  const response = await fetch(`${apiBase}/chat`, { method: 'POST', headers, body: JSON.stringify(payload || {}) });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Chat failed: ${response.status}`);
  }
  return response.json();
}

// Helper: Wingguy calendar API call (x-client-id auth via getAuthHeaders).
async function getCalendarApiBase() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['environment'], (data) => {
      const env = data.environment || 'production';
      resolve(CALENDAR_ENDPOINTS[env] || CALENDAR_ENDPOINTS.production);
    });
  });
}
async function wgCal(method, path, body) {
  const base = await getCalendarApiBase();
  const headers = await getAuthHeaders();
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const response = await fetch(`${base}${path}`, opts);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Calendar ${path} failed: ${response.status}`);
  }
  return response.json();
}

// Helper: Get Wingguy API base URL
async function getWingguyApiBase() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['environment'], (data) => {
      const env = data.environment || 'production';
      resolve(WINGGUY_ENDPOINTS[env] || WINGGUY_ENDPOINTS.production);
    });
  });
}

// Wingguy: GET /api/wingguy/templates
async function wingguyGetTemplates() {
  const apiBase = await getWingguyApiBase();
  const headers = await getAuthHeaders();

  const response = await fetch(`${apiBase}/templates`, { method: 'GET', headers });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Templates fetch failed: ${response.status}`);
  }
  return response.json();
}

// Wingguy: GET /api/wingguy/booking-prefs
async function wingguyGetBookingPrefs() {
  const apiBase = await getWingguyApiBase();
  const headers = await getAuthHeaders();
  const response = await fetch(`${apiBase}/booking-prefs`, { method: 'GET', headers });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Booking prefs fetch failed: ${response.status}`);
  }
  return response.json();
}

// Wingguy: POST /api/wingguy/draft-thanks
async function wingguyDraftThanks(templateId, profile, conversation) {
  const apiBase = await getWingguyApiBase();
  const headers = await getAuthHeaders();

  const response = await fetch(`${apiBase}/draft-thanks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ templateId, profile, conversation })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Draft failed: ${response.status}`);
  }
  return response.json();
}

// Wingguy: POST /api/wingguy/draft-reply
async function wingguyDraftReply(profile, conversation) {
  const apiBase = await getWingguyApiBase();
  const headers = await getAuthHeaders();

  const response = await fetch(`${apiBase}/draft-reply`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ profile, conversation })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Reply draft failed: ${response.status}`);
  }
  return response.json();
}

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
  
  const url = `${apiBase}/leads/${leadId}/quick-update`;
  
  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      section,
      content,
      parseRaw: true
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorMsg = `Update failed: ${response.status}`;
    try {
      const errorData = JSON.parse(errorText);
      errorMsg = errorData.error || errorData.message || errorMsg;
    } catch (e) {
      if (errorText) errorMsg = errorText.substring(0, 200);
    }
    throw new Error(errorMsg);
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

// Resolve LinkedIn's internal member-id URL (/in/ACoA…) to the real vanity /in/<slug>.
// NOTE: LinkedIn does NOT redirect the ACoA URL — a HEAD/GET returns 200 on the ACoA URL itself,
// so the old "follow the redirect" approach was a no-op. Instead GET the page and read the owner's
// "vanityName" out of the embedded JSON. The primary resolve now runs IN-PAGE in the content script
// (same-origin → the logged-in session is carried); this background copy is kept correct as a fallback,
// but a service-worker fetch may not carry the LinkedIn session, in which case it returns '' safely.
async function resolveLinkedInUrl(internalUrl) {
  console.log('[NA Extension] Resolving LinkedIn URL:', internalUrl);

  try {
    const response = await fetch(internalUrl, { method: 'GET', credentials: 'include' });
    if (!response.ok) return '';
    const html = await response.text();
    const m = html.match(/vanityName\\?":\\?"([a-zA-Z0-9\-]{2,100})/);
    const resolved = m ? `https://www.linkedin.com/in/${m[1]}` : '';
    console.log('[NA Extension] Resolved to:', resolved || '(no vanityName found)');
    return resolved;
  } catch (error) {
    console.error('[NA Extension] Failed to resolve URL:', error);
    return '';
  }
}
