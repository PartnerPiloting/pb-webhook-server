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

// Self-heal open LinkedIn tabs after an install/update. When the extension reloads, Chrome tears down
// the old content script's context in already-open tabs (its /wg listener goes dead) but does NOT
// inject the new one - so the tab silently stops responding until a manual refresh. Re-injecting here
// removes that refresh step. The content script guards against double-injection (window.__wingguyLoaded).
function reinjectLinkedInTabs() {
  chrome.tabs.query({ url: 'https://www.linkedin.com/*' }, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] }).catch(() => {});
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-wingguy.js'] }).catch(() => {});
    }
  });
}
chrome.runtime.onInstalled.addListener(reinjectLinkedInTabs);
chrome.runtime.onStartup.addListener(reinjectLinkedInTabs);

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
  // Wingguy: patch a just-created lead's LinkedIn Contact Info (email/phone) — second half of the
  // create→enrich handshake. The content script scrapes the contact info (only the logged-in tab can),
  // then sends it here to write onto the record the chat agent created.
  if (message.type === 'WG_LEAD_CONTACT') {
    wingguyLeadContact(message.payload)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  // Wingguy: read a lead's LinkedIn Contact Info (email + phone) by rendering their contact-info card in a
  // background tab and reading the DOM. The durable path — see scrapeContactViaTab.
  if (message.type === 'WG_SCRAPE_CONTACT') {
    scrapeContactViaTab(message.profileUrl)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

const sleepBg = (ms) => new Promise((r) => setTimeout(r, ms));

// Read a lead's Contact Info by loading LinkedIn's contact-info overlay in a tab and reading the rendered
// modal DOM. The durable path (2026-07-08): LinkedIn no longer serves contact info via a fetchable API or
// in the page HTML — the classic Voyager endpoint is 410 Gone, and the data only appears once the SPA
// renders the card — so we render the card for real and read what a human would see.
//
// The tab is opened ACTIVE (flash-to-front) — tried inactive first (with the visibility spoof), still empty:
// Chrome doesn't run the paint/rAF cycle for background tabs AT ALL, whatever the page believes about its
// visibility, and LinkedIn's SPA renders off that cycle. So the tab must be frontmost for the card to build.
// We remember the user's tab, flash the overlay for the couple of seconds the read takes, then restore focus
// and ALWAYS close the tab. Returns { email, phone } (either may be '').
async function scrapeContactViaTab(profileUrl) {
  const out = { email: '', phone: '' };
  const slug = (String(profileUrl || '').match(/\/in\/([^/?#]+)/) || [])[1];
  if (!slug) { console.log('[Wingguy][bg] scrapeContactViaTab: no /in/ slug in', profileUrl); return out; }
  // Load the PROFILE page, not the overlay URL: a cold navigation to /overlay/contact-info/ gets
  // silently stripped back to the plain profile (verified live 2026-07-08 — the flashed tab showed the
  // profile, no card). A human gets the card by CLICKING "Contact info" on the loaded profile, so the
  // injected reader does exactly that, then we read the card it opens.
  const url = `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
  let tabId = null;
  let prevTabId = null;
  try {
    // Remember where the user is so we can put them straight back.
    const [prev] = await chrome.tabs.query({ active: true, currentWindow: true });
    prevTabId = prev && prev.id;
    const tab = await chrome.tabs.create({ url, active: true });
    tabId = tab.id;
    await waitForTabComplete(tabId, 15000);
    // Poll: each pass reads the card if it's up, otherwise clicks the profile's "Contact info" link to
    // open it (SPA route — same as a human). The SPA needs a few beats after 'complete' for the top
    // card to exist, hence the retry loop.
    let res = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const inj = await chrome.scripting.executeScript({ target: { tabId }, func: readContactModalDom });
        res = inj && inj[0] && inj[0].result;
      } catch (_) { res = null; }   // page still mid-load; retry
      if (res && (res.email || res.phone)) break;
      if (res && res.rendered) break;   // card rendered but genuinely no email/phone → stop waiting
      await sleepBg(600);
    }
    if (res) { out.email = res.email || ''; out.phone = res.phone || ''; }
    console.log('[Wingguy][bg] contact-info (tab read) →', out.email || '(no email)', '|', out.phone || '(no phone)',
      res ? (res.rendered ? '' : `(card not detected; link ${res.clickedLink ? 'clicked' : 'NOT found'} — paste this line to Guy)`) : '(page never became readable — paste this line to Guy)');
  } catch (e) {
    console.log('[Wingguy][bg] scrapeContactViaTab error:', e.message);
  } finally {
    // Put the user back FIRST (so closing the overlay tab can't focus some unrelated tab), then close.
    if (prevTabId != null) { try { await chrome.tabs.update(prevTabId, { active: true }); } catch (_) { /* tab gone */ } }
    if (tabId != null) { try { await chrome.tabs.remove(tabId); } catch (_) { /* already gone */ } }
  }
  return out;
}

// Resolve once the background tab has finished loading (or after a timeout, so a stuck load never hangs us).
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timer); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (t) => { if (chrome.runtime.lastError) return; if (t && t.status === 'complete') finish(); });
  });
}

// Injected into the profile tab (must be self-contained — no outer references). If the "Contact info"
// card isn't open yet, CLICKS the profile's Contact info link (the SPA route a human uses — a cold load
// of the overlay URL gets stripped back to the plain profile, so navigation can't open it). Once the card
// is up, reads it: email via a mailto: link (most stable), phone via a tel: link or the number under a
// "Phone" header. `rendered` tells the poller the card is actually up, so it can stop waiting even when
// there's genuinely no email/phone; `clickedLink` is diagnostic. Returns { rendered, clickedLink, email, phone }.
function readContactModalDom() {
  const out = { rendered: false, clickedLink: false, email: '', phone: '' };

  // Card not up yet? Click the profile's "Contact info" link (top card, under the name) and let the
  // poller's next pass read the opened card. Anchor on the overlay href — language-proof.
  if (!document.querySelector('a[href^="mailto:"], a[href^="tel:"]') &&
      !Array.from(document.querySelectorAll('h1, h2, h3')).some((el) => /contact info/i.test(el.textContent || ''))) {
    const link = document.querySelector('a[href*="overlay/contact-info"]');
    if (link) { link.click(); out.clickedLink = true; }
    return out;
  }
  const headerMatch = (re) => Array.from(document.querySelectorAll('h3, .pv-contact-info__header, span, dt'))
    .find((el) => re.test((el.textContent || '').trim()));

  // Email — a mailto: link is the sturdiest hook; fall back to an "Email"-headed section.
  const mailto = document.querySelector('a[href^="mailto:"]');
  if (mailto) {
    out.email = (mailto.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
  } else {
    const h = headerMatch(/^email$/i);
    const c = h && (h.closest('section, li, div') || h.parentElement);
    const m = c && (c.innerText || '').match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    if (m) out.email = m[0].trim().toLowerCase();
  }

  // Phone — a tel: link if present, else the number inside the "Phone"-headed section.
  const tel = document.querySelector('a[href^="tel:"]');
  if (tel) {
    out.phone = (tel.getAttribute('href') || '').replace(/^tel:/i, '').trim();
  } else {
    const h = headerMatch(/^phone$/i);
    const c = h && (h.closest('section, li, div') || h.parentElement);
    const m = c && (c.innerText || '').match(/\+?\d[\d()\-.\s]{5,}\d/);
    if (m) out.phone = m[0].replace(/\s+/g, ' ').trim();
  }

  // The card is "up" if we see its heading or any contact link — used only to stop the poll early.
  const heading = Array.from(document.querySelectorAll('h1, h2, h3'))
    .some((el) => /contact info/i.test(el.textContent || ''));
  out.rendered = !!(mailto || tel || heading);
  return out;
}

// Wingguy: POST /api/wingguy/lead-contact
async function wingguyLeadContact(payload) {
  const apiBase = await getWingguyApiBase();
  const headers = await getAuthHeaders();
  const response = await fetch(`${apiBase}/lead-contact`, { method: 'POST', headers, body: JSON.stringify(payload || {}) });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Lead-contact failed: ${response.status}`);
  }
  return response.json();
}

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
