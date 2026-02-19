// Content script for LinkedIn messaging pages
// Injects the quick update button and handles conversation scraping

(function() {
  'use strict';
  
  let button = null;
  let isProcessing = false;
  
  // Environment URLs - extension works on both staging and production
  const BACKEND_URLS = {
    production: 'https://pb-webhook-server.onrender.com',
    staging: 'https://pb-webhook-server-staging.onrender.com'
  };
  const PORTAL_URLS = {
    production: 'https://pb-webhook-server.vercel.app',
    staging: 'https://pb-webhook-server-staging.vercel.app'
  };
  
  // Get environment from stored auth data
  async function getEnvironment() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['environment'], (data) => {
        resolve(data.environment || 'production');
      });
    });
  }
  
  // Remote config from Airtable (fetched on init)
  // Default to production, but getConfigApiUrl() can use stored environment
  let currentEnvironment = 'production';
  const CONFIG_CACHE_KEY = 'na_extension_config';
  const CONFIG_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  
  function getConfigApiUrl() {
    return `${BACKEND_URLS[currentEnvironment]}/api/extension-config`;
  }
  
  // Default config (fallback if API unavailable)
  const DEFAULT_CONFIG = {
    popup_selectors: [
      '[placeholder*="Write a message" i]',
      '[contenteditable="true"][role="textbox"]',
      'button[aria-label*="close" i]',
      '.msg-form, [class*="msg-form"]',
      '[class*="msg-overlay"]',
      'button[aria-label*="GIF" i]'
    ],
    name_selectors: [
      'h1.text-heading-xlarge',
      'main h1',
      '.pv-top-card h1',
      '.msg-overlay-bubble-header__title',
      '.msg-entity-lockup__entity-title'
    ],
    page_patterns: {
      '/messaging': true,
      '/in/': true,
      '/feed': true,
      '/': true
    }
  };
  
  // Active config (populated from remote or defaults)
  let activeConfig = { ...DEFAULT_CONFIG };
  
  // Fetch remote config
  async function fetchRemoteConfig() {
    try {
      // Check cache first
      const cached = localStorage.getItem(CONFIG_CACHE_KEY);
      if (cached) {
        const { config, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CONFIG_CACHE_TTL) {
          applyConfig(config);
          return;
        }
      }
      
      // Fetch from API (using environment-aware URL)
      const response = await fetch(getConfigApiUrl());
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.config) {
          // Cache the config
          localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({
            config: data.config,
            timestamp: Date.now()
          }));
          applyConfig(data.config);
        }
      }
    } catch (e) {
      // API unavailable, use defaults (already set)
      console.log('[NA Extension] Using default config (API unavailable)');
    }
  }
  
  // Apply fetched config - only assign valid values to avoid "cannot read properties of undefined"
  function applyConfig(config) {
    if (!config || typeof config !== 'object') return;
    const popupVal = config.popup_selectors?.value;
    if (Array.isArray(popupVal) && popupVal.length > 0) {
      activeConfig.popup_selectors = popupVal;
    }
    const nameVal = config.name_selectors?.value;
    if (Array.isArray(nameVal) && nameVal.length > 0) {
      activeConfig.name_selectors = nameVal;
    }
    const patternsVal = config.page_patterns?.value;
    if (patternsVal && typeof patternsVal === 'object' && !Array.isArray(patternsVal)) {
      activeConfig.page_patterns = patternsVal;
    }
  }
  
  // DOM selectors for LinkedIn messaging (legacy - keeping for backward compatibility)
  const SELECTORS = {
    // Conversation container
    conversationContainer: '.msg-conversations-container__convo-card-container',
    messageThread: '.msg-s-message-list-content',
    
    // Individual messages
    messageItem: '.msg-s-message-list__event',
    messageSender: '.msg-s-message-group__profile-link, .msg-s-message-group__name',
    messageContent: '.msg-s-event-listitem__body, .msg-s-event__content',
    messageTimestamp: '.msg-s-message-list__time-heading, time.msg-s-message-group__timestamp',
    
    // Profile info
    profileHeader: '.msg-entity-lockup__entity-title',
    profileLink: '.msg-thread__link-to-profile, .msg-entity-lockup__entity-title a',
    
    // Conversation thread header
    threadHeader: '.msg-thread__link-to-profile',
    
    // Alternative selectors for different LinkedIn layouts
    altMessageItem: '[data-control-name="message"]',
    altProfileLink: '.msg-conversation-card__profile-link'
  };
  
  // Track current URL for SPA navigation detection
  let currentUrl = window.location.href;
  
  // Initialize the extension
  function init() {
    // Check if extension context is valid
    if (!chrome.runtime?.id) {
      return; // Extension was reloaded
    }
    
    // Load environment from storage, then fetch remote config
    chrome.storage.local.get(['environment'], (data) => {
      currentEnvironment = data.environment || 'production';
      console.log(`[NA Extension] Environment: ${currentEnvironment}`);
      // Fetch remote config (non-blocking)
      fetchRemoteConfig();
    });
    
    // Check if we were redirected here to auto-save
    checkPendingSave();
    
    // Always set up the observer first - don't wait for auth check
    observeForConversations();
    
    // Watch for SPA navigation (URL changes without page reload)
    setupSPANavigationDetection();
    
    // Force immediate button injection check
    if (isMessagingPage() && !button) {
      injectButton();
    }
    
    // Then check auth status (just for button state, not blocking)
    try {
      chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
        if (chrome.runtime.lastError) return;
        // Auth status received
      });
    } catch (e) {
      // Extension context error, will retry on click
    }
    
    // Listen for auth ready events
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'AUTH_READY') {
        updateButtonState('ready');
      }
    });
  }
  
  // Watch for messaging page
  function observeForConversations() {
    // Check immediately if we're on a messaging page
    if (isMessagingPage() && !button) {
      injectButton();
    }
    
    // Watch for messaging popup to appear (faster than polling)
    const observer = new MutationObserver((mutations) => {
      // Check if messaging is now visible
      if (isMessagingPage() && !button) {
        injectButton();
      } else if (!isMessagingPage() && button) {
        removeButton();
      }
    });
    
    // Observe the body for added nodes (messaging popup gets added)
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  // Detect SPA navigation (LinkedIn uses client-side routing)
  function setupSPANavigationDetection() {
    // Method 1: Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', handleNavigation);
    
    // Method 2: Intercept pushState and replaceState
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      handleNavigation();
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      handleNavigation();
    };
    
    // Method 3: Poll for URL changes (catches all SPA navigation)
    let pollCount = 0;
    setInterval(() => {
      pollCount++;
      const newUrl = window.location.href;
      if (newUrl !== currentUrl) {
        currentUrl = newUrl;
        handleNavigation();
      }
      
      // Check if we should show button based on URL
      const shouldShow = isMessagingPage();
      
      if (shouldShow && !button) {
        injectButton();
      } else if (!shouldShow && button) {
        removeButton();
      }
    }, 500);
  }
  
  // Handle navigation to potentially show/hide button
  function handleNavigation() {
    currentUrl = window.location.href;
    // Don't remove button immediately - let the polling handle it
    // This prevents flicker during navigation
  }
  
  // Helper to search in shadow DOM
  function searchInShadowDOM(root, selector) {
    const results = [];
    try {
      // Search in current root
      results.push(...root.querySelectorAll(selector));
      
      // Search in all shadow roots
      const allElements = root.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) {
          results.push(...searchInShadowDOM(el.shadowRoot, selector));
        }
      }
    } catch (e) {
      // Ignore CORS/security errors
    }
    return results;
  }
  
  // Simplified: Show button on profile pages and messaging pages
  // User can click it when they have a conversation open
  function isMessagingPage() {
    const path = window.location.pathname;
    
    // Check against remote config patterns
    const pagePatterns = activeConfig?.page_patterns && typeof activeConfig.page_patterns === 'object'
      ? activeConfig.page_patterns : DEFAULT_CONFIG.page_patterns;
    for (const pattern of Object.keys(pagePatterns)) {
      if (pagePatterns[pattern]) {
        if (pattern === '/' && path === '/') return true;
        if (pattern !== '/' && path.startsWith(pattern)) return true;
      }
    }
    return false;
  }
  
  // Legacy function - now just uses the unified check
  function isConversationVisible() {
    return isMessagingPage();
  }
  
  // Inject the quick update button
  function injectButton() {
    if (button) return;
    
    // Double-check button doesn't already exist in DOM
    const existingBtn = document.getElementById('na-quick-update-btn');
    if (existingBtn) {
      button = existingBtn;
      return;
    }
    
    button = document.createElement('button');
    button.id = 'na-quick-update-btn';
    button.className = 'na-quick-update-btn';
    button.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      <span class="na-btn-text">Save to Portal</span>
    `;
    button.title = 'Save conversation to Network Accelerator';
    
    button.addEventListener('click', handleButtonClick);
    
    document.body.appendChild(button);
    
    // Update button state based on auth
    chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
      if (!response?.authenticated) {
        updateButtonState('not-auth');
      }
    });
  }
  
  // Remove the button
  function removeButton() {
    if (button) {
      button.remove();
      button = null;
    }
  }
  
  // Professional credential suffixes to strip from names (e.g., "Carinne Bird, GAICD" -> "Carinne Bird")
  const CREDENTIAL_SUFFIXES = [
    'GAICD', 'FAICD', 'MAICD', 'AAICD',
    'PhD', 'DPhil', 'EdD', 'DBA', 'MBA', 'MPA', 'MSc', 'MA', 'MS', 'MEng', 'MFA',
    'BSc', 'BA', 'BEng', 'BCom', 'BBA', 'LLB', 'LLM', 'JD', 'MD', 'DO',
    'CPA', 'CA', 'CFA', 'CFP', 'FCPA', 'FCA', 'ACA', 'ACCA', 'CIMA', 'CMA',
    'PMP', 'PRINCE2', 'CSM', 'PMI',
    'CISSP', 'CISM', 'CISA', 'CCNA', 'CCNP', 'AWS', 'GCP', 'MCSE', 'ITIL',
    'SHRM', 'PHR', 'SPHR', 'GPHR', 'CIPD',
    'RN', 'NP', 'PA', 'FACS', 'FACP', 'FRCS',
    'PE', 'CEng', 'CPEng', 'FIEAust', 'MIEAust',
    'Esq', 'OAM', 'AM', 'AO', 'AC', 'OM', 'CH', 'CBE', 'OBE', 'MBE', 'KBE', 'DBE',
    'FRSA', 'FRS', 'FIET', 'FBCS', 'FACS'
  ];
  const credentialPattern = new RegExp(`(?:,?\\s+(?:${CREDENTIAL_SUFFIXES.join('|')}))+\\s*$`, 'i');
  
  function stripCredentialSuffixes(name) {
    if (!name || typeof name !== 'string') return name || '';
    let cleaned = name.replace(credentialPattern, '').trim();
    cleaned = cleaned.replace(/,\s*$/, '').trim();
    return cleaned;
  }
  
  // Strip LinkedIn UI text that gets concatenated with contact name when copying
  // Handles: "Rhys Cassidy Profile", "Rhys CassidyStatus is online", "Rhys Cassidy ProfileStatus is online"
  function stripLinkedInUISuffixes(text) {
    if (!text || typeof text !== 'string') return text || '';
    let cleaned = text;
    // Strip in order - handle concatenated forms first (no space before suffix)
    cleaned = cleaned.replace(/ProfileStatus\s*is\s*(online|offline|busy|away)\s*$/i, '');
    cleaned = cleaned.replace(/Status\s*is\s*(online|offline|busy|away)\s*$/i, '');
    cleaned = cleaned.replace(/\s*Profile\s*$/i, '');  // "Name Profile" or "NameProfile"
    cleaned = cleaned.replace(/Profile\s*$/i, '');     // "NameProfile" (concatenated)
    cleaned = cleaned.replace(/\s*Active\s*now\s*$/i, '');
    cleaned = cleaned.replace(/\s*is\s*(online|offline|busy|away)\s*$/i, '');
    return cleaned.trim();
  }
  
  // Smart name comparison - handles variations like "duncanmurcott" vs "Duncan Murcott"
  // and URL slugs like "kjlangdon" vs "Ken Langdon"
  function namesMatch(name1, name2) {
    if (!name1 || !name2) return false;
    
    // Exact match
    if (name1 === name2) return true;
    
    // Remove all spaces and compare (handles "duncanmurcott" vs "duncan murcott")
    const noSpaces1 = name1.replace(/\s+/g, '');
    const noSpaces2 = name2.replace(/\s+/g, '');
    if (noSpaces1 === noSpaces2) return true;
    
    // Check if one contains the other
    if (name1.includes(name2) || name2.includes(name1)) return true;
    if (noSpaces1.includes(noSpaces2) || noSpaces2.includes(noSpaces1)) return true;
    
    // Check if first names match (for cases like "Duncan M" vs "Duncan Murcott")
    const first1 = name1.split(' ')[0];
    const first2 = name2.split(' ')[0];
    if (first1 === first2 && first1.length >= 3) return true;
    
    // URL slug vs display name: "kjlangdon" (from /in/kjlangdon) vs "Ken Langdon"
    // Slug often = initials + lastname. Check if slug ends with display name's last name.
    const slug = noSpaces1.includes(' ') ? null : noSpaces1;
    const displayName = name2.trim();
    const displayWords = displayName.split(/\s+/).filter(w => w.length > 0);
    if (slug && displayWords.length >= 2) {
      const lastName = displayWords[displayWords.length - 1].toLowerCase();
      if (lastName.length >= 3 && slug.toLowerCase().endsWith(lastName)) return true;
    }
    // Same check in reverse (name2 could be the slug)
    const slug2 = noSpaces2.includes(' ') ? null : noSpaces2;
    const displayWords1 = name1.trim().split(/\s+/).filter(w => w.length > 0);
    if (slug2 && displayWords1.length >= 2) {
      const lastName1 = displayWords1[displayWords1.length - 1].toLowerCase();
      if (lastName1.length >= 3 && slug2.toLowerCase().endsWith(lastName1)) return true;
    }
    
    return false;
  }

  // Handle button click - simple: read clipboard, open portal Quick Update
  async function handleButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (isProcessing) return;
    isProcessing = true;
    updateButtonState('loading');
    
    try {
      // Read clipboard
      let clipboardText = '';
      try {
        clipboardText = await navigator.clipboard.readText();
      } catch (err) {
        // Clipboard access denied - check for selection instead
        const selection = window.getSelection()?.toString()?.trim();
        if (selection && selection.length > 20) {
          clipboardText = selection;
        }
      }
      
      if (!clipboardText || clipboardText.length < 20) {
        throw new Error('Please copy the conversation first (Ctrl+A then Ctrl+C in the message area)');
      }
      
      // Get auth data first (needed for name extraction)
      const authData = await sendMessage({ type: 'GET_AUTH' });
      
      // Get contact name from visible conversation header (what user is currently viewing)
      let visibleContactName = getContactNameFromHeader();
      
      // Parse contact name from clipboard (what user actually copied)
      const clipboardContactName = extractContactNameFromClipboard(clipboardText, authData?.clientId);
      
      // Check if we're on a profile page with messaging popup open
      const path = window.location.pathname;
      const isProfilePage = path.startsWith('/in/');
      
      // Multiple ways to detect if messaging popup is open (using remote config)
      const popupSelectors = Array.isArray(activeConfig?.popup_selectors) ? activeConfig.popup_selectors : DEFAULT_CONFIG.popup_selectors;
      const popupIndicators = popupSelectors.map(selector => {
        try {
          return document.querySelector(selector);
        } catch (e) {
          return null; // Invalid selector
        }
      });
      const hasOpenPopup = isProfilePage && popupIndicators.some(el => el !== null);
      
      
      if (hasOpenPopup && clipboardContactName) {
        // On profile page with popup open - user must copy the current conversation
        // Try to get name from popup header using multiple methods
        visibleContactName = getContactNameFromHeader();
        
        // Method 2: Look for links to profiles in any header-like area
        if (!visibleContactName) {
          const profileLinks = document.querySelectorAll('a[href*="/in/"]');
          for (const link of profileLinks) {
            // Check if this link is in a messaging context (near message input or in floating container)
            const parent = link.closest('[class*="msg"], [class*="messaging"], [class*="convo"]');
            if (parent) {
              const text = link.textContent?.trim()
                .replace(/\s+/g, ' ')
                .replace(/View.*profile.*$/i, '')
                .trim();
              if (text && text.length >= 2 && text.length <= 60 && !text.includes('@') && !text.includes('/')) {
                visibleContactName = text;
                break;
              }
            }
          }
        }
        
        // Method 3: Find any name-like text near the close button or in header area
        if (!visibleContactName) {
          // Look for text content near messaging elements that looks like a name
          const msgContainers = document.querySelectorAll('[class*="msg"], [class*="messaging"]');
          for (const container of msgContainers) {
            // Look for header-like elements
            const headers = container.querySelectorAll('h1, h2, h3, h4, [class*="title"], [class*="name"], [class*="header"] span, [class*="header"] a');
            for (const header of headers) {
              const text = header.textContent?.trim()
                .replace(/\s+/g, ' ')
                .replace(/Mobile.*$/i, '')
                .replace(/\d+[mh]\s*ago.*$/i, '')
                .replace(/View.*$/i, '')
                .trim();
              
              if (text && text.length >= 3 && text.length <= 50) {
                const words = text.split(' ').filter(w => w.length > 0);
                // Name should be 1-4 words, start with capital, no special chars
                if (words.length >= 1 && words.length <= 4 && /^[A-Z]/.test(text) && !text.includes('@') && !text.includes('/')) {
                  visibleContactName = text;
                  break;
                }
              }
            }
            if (visibleContactName) break;
          }
        }
        
        // Method 4: Use the profile page name as fallback (from URL slug or page header)
        if (!visibleContactName) {
          // Try to get from the main profile page header (h1 with the person's name)
          const profileH1 = document.querySelector('h1.text-heading-xlarge, h1[class*="text-heading"], main h1, .pv-top-card h1');
          if (profileH1) {
            visibleContactName = profileH1.textContent?.trim();
          }
        }
        
        // Method 5: Extract from URL slug as last resort
        if (!visibleContactName) {
          // URL is like /in/keenan-adolf-22092241/ - extract "keenan adolf"
          const slugMatch = path.match(/\/in\/([^\/]+)/);
          if (slugMatch) {
            const slug = slugMatch[1]
              .replace(/-\d+$/, '')  // Remove trailing numbers like -22092241
              .replace(/-/g, ' ')     // Replace dashes with spaces
              .replace(/\b\w/g, c => c.toUpperCase()); // Capitalize each word
            if (slug && slug.length >= 3) {
              visibleContactName = slug;
            }
          }
        }
        
        // If we still don't have a name, show generic error
        if (!visibleContactName) {
          throw new Error(
            `A messaging conversation is open, but you haven't copied it yet. ` +
            `Please copy the current conversation first (Ctrl+A then Ctrl+C in the message area).`
          );
        }
        
        // Compare names - if they don't match, ask instead of reject
        const visibleNormalized = visibleContactName.toLowerCase().trim();
        const clipboardNormalized = clipboardContactName.toLowerCase().trim();
        
        const match = namesMatch(visibleNormalized, clipboardNormalized);
        
        if (!match) {
          const confirmed = await showConfirmDialog(
            `You're viewing ${visibleContactName}'s conversation, but your clipboard contains ${clipboardContactName}'s messages. Continue anyway?`,
            'Continue',
            'Cancel'
          );
          if (!confirmed) {
            updateButtonState('ready');
            isProcessing = false;
            return;
          }
        }
      }
      
      // For messaging pages, check if visible conversation matches clipboard
      if (path.startsWith('/messaging')) {
        visibleContactName = getContactNameFromHeader();
        if (visibleContactName && clipboardContactName) {
          const visibleNormalized = visibleContactName.toLowerCase().trim();
          const clipboardNormalized = clipboardContactName.toLowerCase().trim();
          
          // Use smart matching - handles cases like "Duncanmurcott" vs "Duncan Murcott"
          const match = namesMatch(visibleNormalized, clipboardNormalized);
          
          if (!match) {
            const confirmed = await showConfirmDialog(
              `You're viewing ${visibleContactName}'s conversation, but your clipboard contains ${clipboardContactName}'s messages. Continue anyway?`,
              'Continue',
              'Cancel'
            );
            if (!confirmed) {
              updateButtonState('ready');
              isProcessing = false;
              return;
            }
          }
        }
      }
      
      // Use clipboard name as primary - this is the person whose messages we're saving (e.g. Tanya)
      // Fallback to visible header if clipboard parsing failed
      let contactName = clipboardContactName || visibleContactName;
      
      if (!contactName) {
        throw new Error('Could not determine contact name. Please ensure you have copied the conversation.');
      }
      
      // Only use page URL when names match - otherwise the page might show a different person
      // (e.g. viewing Turnerinternational's profile but clipboard has Tanya's messages)
      const visibleNorm = (visibleContactName || '').toLowerCase().trim();
      const clipboardNorm = (clipboardContactName || '').toLowerCase().trim();
      const namesMatched = visibleContactName && clipboardContactName && namesMatch(visibleNorm, clipboardNorm);
      
      let linkedInUrl = null;
      if (namesMatched && path.startsWith('/in/')) {
        const slugMatch = path.match(/\/in\/([^\/]+)/);
        if (slugMatch) {
          const slug = slugMatch[1].replace(/\/$/, '');
          linkedInUrl = `https://www.linkedin.com/in/${slug}`;
        }
      }
      
      // Store data for portal to pick up
      const portalData = {
        contactName: contactName,
        conversationText: clipboardText,
        linkedInUrl: linkedInUrl,
        timestamp: Date.now()
      };
      
      // Send to background script to store
      await sendMessage({ 
        type: 'STORE_CLIPBOARD_DATA', 
        data: portalData 
      });
      
      // Build portal URL with auth credentials so new tab is authenticated
      // Use environment from stored auth (staging or production)
      const env = authData?.environment || 'production';
      const portalBase = PORTAL_URLS[env] || PORTAL_URLS.production;
      let portalUrl = `${portalBase}/quick-update?from=extension`;
      if (linkedInUrl) {
        portalUrl += `&linkedinUrl=${encodeURIComponent(linkedInUrl)}`;
      }
      
      if (authData?.portalToken) {
        portalUrl += `&token=${encodeURIComponent(authData.portalToken)}`;
      } else if (authData?.clientId && authData?.devKey) {
        portalUrl += `&client=${encodeURIComponent(authData.clientId)}&devKey=${encodeURIComponent(authData.devKey)}`;
      }
      
      window.open(portalUrl, '_blank');
      
      showToast('Opening Quick Update...', 'success');
      updateButtonState('ready');
      
    } catch (error) {
      console.error('[NA Extension] Error:', error);
      updateButtonState('error');
      const msg = error?.message || 'Something went wrong. Try copying the conversation again.';
      showToast(msg.includes('undefined') ? 'Please reload the extension and try again.' : msg, 'error');
      
      setTimeout(() => {
        updateButtonState('ready');
      }, 3000);
    } finally {
      isProcessing = false;
    }
  }
  
  // Find profile link in conversation header
  function findProfileLink() {
    const selectors = [
      '.msg-thread__link-to-profile',
      '.msg-entity-lockup__entity-title a[href*="/in/"]',
      'a.msg-thread__link-to-profile',
      '.msg-overlay-bubble-header__link',
      '.msg-s-message-list-container a[href*="/in/"]',
      '.msg-conversations-container a[href*="/in/"]',
      'a[href*="linkedin.com/in/"]'
    ];
    
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el?.href && el.href.includes('/in/')) {
        return el.href.split('?')[0];
      }
    }
    return null;
  }
  
  // Get contact name from LinkedIn's conversation header (MOST RELIABLE)
  // The header always shows the OTHER person's name, never yours
  function getContactNameFromHeader() {
    // Strategy 1: Look for popup/overlay header (for profile pages with messaging popup)
    // Search for header elements in overlays/asides that contain a name
    const overlays = document.querySelectorAll('aside, [role="dialog"]');
    for (const overlay of overlays) {
      // Look for header with close button (indicates messaging popup)
      const header = overlay.querySelector('header, [role="banner"], h1, h2, h3');
      const hasCloseBtn = overlay.querySelector('button[aria-label*="close" i]');
      
      if (header && hasCloseBtn) {
        // Get text from header
        const text = header.textContent?.trim()
          .replace(/\s+/g, ' ')
          .replace(/View .+'s profile/i, '')
          .replace(/\(.*\)$/, '')  // Remove pronouns like (She/Her)
          .replace(/\d{1,2}:\d{2}\s*[AP]M.*$/, '') // Remove timestamps like "9:32 AM"
          .replace(/Mobile\s*[•·]\s*\d+[dhms]\s*ago.*$/i, '') // Remove "Mobile • 3d ago"
          .replace(/\d+[dhms]\s*ago.*$/i, '') // Remove standalone "3d ago"
          .replace(/[•·].*$/, '') // Remove anything after bullet point
          .trim();
        
        // Validate it looks like a name
        if (text && text.length >= 2 && text.length <= 60 && !text.includes('@')) {
          const words = text.split(' ').filter(w => w.length > 0);
          if (words.length >= 1 && words.length <= 4) {
            return stripCredentialSuffixes(text);
          }
        }
      }
    }
    
    // Strategy 2: Try old msg- selectors (legacy LinkedIn)
    const msgSelectors = [
      '.msg-overlay-bubble-header__title',
      '.msg-overlay-bubble-header a',
      '.msg-entity-lockup__entity-title',
      '.msg-thread__link-to-profile span',
      '.msg-s-message-list-container h2',
      '.artdeco-entity-lockup__title'
    ];
    
    for (const selector of msgSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim()
          .replace(/\s+/g, ' ')
          .replace(/View .+'s profile/i, '')
          .replace(/\(.*\)$/, '')
          .replace(/\d{1,2}:\d{2}\s*[AP]M.*$/, '') // Remove timestamps
          .replace(/Mobile\s*[•·]\s*\d+[dhms]\s*ago.*$/i, '') // Remove "Mobile • 3d ago"
          .replace(/\d+[dhms]\s*ago.*$/i, '') // Remove standalone "3d ago"
          .replace(/[•·].*$/, '') // Remove anything after bullet point
          .trim();
        
        if (text && text.length >= 2 && text.length <= 60 && !text.includes('@')) {
          const words = text.split(' ').filter(w => w.length > 0);
          if (words.length >= 1 && words.length <= 4) {
            return stripCredentialSuffixes(text);
          }
        }
      }
    }
    
    return null;
  }
  
  // Fallback: Extract contact name from clipboard by finding senders and excluding client
  function extractContactNameFromClipboard(clipboardText, clientId) {
    if (!clipboardText) return '';
    
    // Derive client name from clientId (format: "Guy-Wilson" -> "Guy Wilson")
    const clientName = (typeof clientId === 'string' && clientId) ? clientId.replace(/-/g, ' ') : '';
    const clientFirstName = (clientName.split(' ') || [])[0];
    const clientFirst = typeof clientFirstName === 'string' ? clientFirstName.toLowerCase() : '';
    
    // Find all senders using LinkedIn's format patterns
    const allSenders = new Set();
    
    // Pattern 1: "Name sent the following message(s) at HH:MM AM/PM"
    // Handle both singular "message" and plural "messages"
    const sentPattern = /^(.+?)\s+sent the following messages? at/gm;
    let match;
    while ((match = sentPattern.exec(clipboardText)) !== null) {
      const name = match[1].trim();
      if (name && name.length > 1 && name.length < 50 && !name.startsWith('View ')) {
        allSenders.add(name);
      }
    }
    
    // Pattern 2: "Name   HH:MM AM/PM" (name followed by spaces and time)
    // Use a more permissive pattern that allows any characters in names
    const timePattern = /^(.+?)\s{2,}(\d{1,2}:\d{2}\s*[AP]M)$/gm;
    while ((match = timePattern.exec(clipboardText)) !== null) {
      const name = match[1].trim();
      if (name && name.length > 1 && name.length < 50 && !name.startsWith('View ')) {
        // Skip if it looks like a date/day (e.g., "Monday", "Jan 5")
        if (!/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Today|Yesterday)$/i.test(name) &&
            !/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i.test(name)) {
          allSenders.add(name);
        }
      }
    }
    
    // Filter out client's name
    const otherPeople = Array.from(allSenders).filter(name => {
      if (!clientFirst) return true;  // No client info, keep all
      const senderFirstName = (name.split(' ') || [])[0];
      const senderFirst = typeof senderFirstName === 'string' ? senderFirstName.toLowerCase() : '';
      return senderFirst !== clientFirst && name.toLowerCase() !== clientName.toLowerCase();
    });
    
    // Return first other person found (with credentials stripped)
    // If no other people found (only client's messages in clipboard), return empty
    // so that the visible header name will be used instead
    if (otherPeople.length > 0) {
      return stripCredentialSuffixes(otherPeople[0]);
    }
    
    // Pattern 3: First line of clipboard is often the contact name header
    // LinkedIn messaging copy format: "Name" or "Name Profile" or "NameStatus is online" etc.
    const lines = clipboardText.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length > 0) {
      let firstLine = lines[0];
      
      // Strip ALL known LinkedIn UI suffixes (order matters for concatenated forms)
      firstLine = stripLinkedInUISuffixes(firstLine);
      
      // Check if first line looks like a name (1-4 words, starts with capital, no special chars)
      const words = firstLine.split(/\s+/).filter(w => w.length > 0);
      if (words.length >= 1 && words.length <= 4 && 
          firstLine.length >= 3 && firstLine.length <= 60 &&
          /^[A-Z]/.test(firstLine) && 
          !firstLine.includes('@') && !firstLine.includes('/') &&
          !firstLine.includes(':') && !firstLine.match(/^\d/) &&
          // Skip if it's a degree indicator line
          !firstLine.match(/^\d+(st|nd|rd|th)\s+degree/i) &&
          // Skip if it's the client's own name
          (!clientName || firstLine.toLowerCase() !== clientName.toLowerCase())) {
        console.log('[NA Extension] Using first line as contact name:', firstLine);
        return stripCredentialSuffixes(firstLine);
      }
    }
    
    // No other person found - this means clipboard only contains client's own messages
    // Return empty string so the caller uses the header name instead
    console.log('[NA Extension] Clipboard only contains client messages, will use header name');
    return '';
  }
  
  // Actually save the conversation
  async function saveConversation(profileUrl) {
    try {
      // Check if we have pre-scraped messages (from redirect flow)
      let conversation;
      const storedMessages = sessionStorage.getItem('na_scraped_messages');
      
      if (storedMessages) {
        conversation = JSON.parse(storedMessages);
        sessionStorage.removeItem('na_scraped_messages');
      } else {
        // Scrape from current page (profile page with overlay or direct)
        conversation = await scrapeConversation();
      }
      
      if (!conversation || conversation.length === 0) {
        throw new Error('No messages found. Please select the conversation text (Ctrl+A in the message area) or copy it first, then click Save.');
      }
      
      const rawContent = formatConversationForApi(conversation);
      
      // Lookup lead
      const lookupResult = await sendMessage({
        type: 'LOOKUP_LEAD',
        linkedinUrl: profileUrl
      });
      
      if (!lookupResult.success) {
        throw new Error(lookupResult.error || 'Failed to find lead');
      }
      
      const leads = lookupResult.data?.leads || [];
      if (leads.length === 0) {
        throw new Error('No matching lead found in your portal for: ' + profileUrl);
      }
      
      const leadId = leads[0].id;
      const leadName = `${leads[0].firstName || ''} ${leads[0].lastName || ''}`.trim();
      
      // Quick update
      const updateResult = await sendMessage({
        type: 'QUICK_UPDATE',
        leadId,
        content: rawContent,
        section: 'linkedin'
      });
      
      if (!updateResult.success) {
        throw new Error(updateResult.error || 'Update failed');
      }
      
      updateButtonState('success');
      showToast(`Saved ${conversation.length} messages for ${leadName}`, 'success');
      
      // Check if we need to return to messaging thread
      const returnUrl = sessionStorage.getItem('na_return_url');
      if (returnUrl) {
        sessionStorage.removeItem('na_return_url');
        sessionStorage.removeItem('na_pending_save');
        setTimeout(() => {
          showToast('Returning to messages...', 'info');
          window.location.href = returnUrl;
        }, 1500);
      } else {
        setTimeout(() => {
          if (!isProcessing) updateButtonState('ready');
        }, 3000);
      }
      
    } catch (error) {
      console.error('[NA Extension] Save error:', error);
      updateButtonState('error');
      showToast(error.message, 'error');
      sessionStorage.removeItem('na_pending_save');
      
      setTimeout(() => {
        updateButtonState('ready');
      }, 3000);
    } finally {
      isProcessing = false;
    }
  }
  
  // Check on page load if we need to auto-save (redirected from messaging)
  function checkPendingSave() {
    if (sessionStorage.getItem('na_pending_save') === 'true' && window.location.pathname.startsWith('/in/')) {
      // Wait for URL to fully resolve (LinkedIn may still be redirecting)
      let attempts = 0;
      const maxAttempts = 20; // 10 seconds max
      
      const checkUrl = setInterval(() => {
        attempts++;
        const slug = window.location.pathname.replace('/in/', '').replace('/', '');
        
        // Check if we have the real URL (not internal ID)
        if (!slug.startsWith('ACoA')) {
          clearInterval(checkUrl);
          const profileUrl = window.location.origin + window.location.pathname.split('?')[0];
          saveConversation(profileUrl);
        } else if (attempts >= maxAttempts) {
          clearInterval(checkUrl);
          console.error('[NA Extension] URL did not resolve to real slug');
          showToast('Could not get profile URL. Please try from the profile page.', 'error');
          sessionStorage.removeItem('na_pending_save');
          sessionStorage.removeItem('na_scraped_messages');
          sessionStorage.removeItem('na_return_url');
        }
      }, 500);
    }
  }
  
  // Auto-scroll to load all messages in the conversation
  async function loadAllMessages() {
    // No-op for now - we'll use clipboard-based approach
    console.log('[NA Extension] Ready to capture messages');
  }
  
  // Scrape messages - try multiple strategies
  async function scrapeConversation() {
    const messages = [];
    
    // Strategy 1: Check if user has selected text
    const selection = window.getSelection();
    const selectedText = selection?.toString()?.trim();
    
    if (selectedText && selectedText.length > 20) {
      console.log('[NA Extension] Using selected text');
      return parseLinkedInText(selectedText);
    }
    
    // Strategy 2: Try to read from clipboard (requires permission)
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText && clipboardText.length > 20 && 
          (clipboardText.includes('sent the following message') || clipboardText.includes('AM') || clipboardText.includes('PM'))) {
        console.log('[NA Extension] Using clipboard text');
        return parseLinkedInText(clipboardText);
      }
    } catch (e) {
      console.log('[NA Extension] Clipboard access denied or empty');
    }
    
    // Strategy 3: Try to find and use LinkedIn's copy feature
    // LinkedIn has a "Copy" option in the conversation menu
    // But for now, show a helpful message
    
    // Strategy 4: Try DOM scraping as fallback
    const domMessages = await scrapeDOMMessages();
    if (domMessages.length > 0) {
      console.log('[NA Extension] Scraped', domMessages.length, 'messages from DOM');
      return domMessages;
    }
    
    // No messages found - return empty
    return [];
  }
  
  // Parse LinkedIn's copied text format
  function parseLinkedInText(text) {
    const messages = [];
    const lines = text.split('\n');
    
    let currentSender = null;
    let currentContent = [];
    const seenContent = new Set();
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Match: "Name sent the following message at HH:MM AM/PM"
      const sentMatch = line.match(/^(.+?)\s+sent the following message at/);
      if (sentMatch) {
        // Save previous message if exists
        if (currentSender && currentContent.length > 0) {
          const content = currentContent.join('\n').trim();
          const key = content.substring(0, 50);
          if (!seenContent.has(key)) {
            seenContent.add(key);
            messages.push({ sender: currentSender, content, timestamp: '' });
          }
        }
        currentSender = sentMatch[1].trim();
        currentContent = [];
        continue;
      }
      
      // Match: "Name   HH:MM AM/PM" (the second line before message content)
      const nameTimeMatch = line.match(/^(.+?)\s{2,}\d{1,2}:\d{2}\s*(AM|PM)/i);
      if (nameTimeMatch) {
        // This is just a header line, skip it
        continue;
      }
      
      // Skip day headers like "Tuesday", "Friday", etc.
      const dayHeaders = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Today', 'Yesterday'];
      if (dayHeaders.includes(line)) {
        continue;
      }
      
      // Skip date headers like "Jan 20"
      if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/i.test(line)) {
        continue;
      }
      
      // Skip empty lines between messages but not within them
      if (line === '') {
        if (currentContent.length > 0 && currentContent[currentContent.length - 1] !== '') {
          currentContent.push(''); // Preserve blank lines within messages
        }
        continue;
      }
      
      // This is message content
      if (currentSender) {
        currentContent.push(line);
      }
    }
    
    // Don't forget the last message
    if (currentSender && currentContent.length > 0) {
      const content = currentContent.join('\n').trim();
      const key = content.substring(0, 50);
      if (!seenContent.has(key)) {
        seenContent.add(key);
        messages.push({ sender: currentSender, content, timestamp: '' });
      }
    }
    
    return messages;
  }
  
  // Fallback DOM scraping (may not work with obfuscated classes)
  async function scrapeDOMMessages() {
    const messages = [];
    const seenContent = new Set();
    
    // Try known selectors (these are legacy and may not work)
    const messageElements = document.querySelectorAll(
      '.msg-s-message-list__event, .msg-s-message-group, .msg-s-event-listitem, [role="listitem"]'
    );
    
    // Also try to find elements with time elements (messages usually have timestamps)
    const timeElements = document.querySelectorAll('time');
    
    for (const timeEl of timeElements) {
      // Walk up to find the message container
      let msgContainer = timeEl.closest('li') || timeEl.closest('article') || timeEl.parentElement?.parentElement?.parentElement;
      if (msgContainer) {
        const text = msgContainer.innerText?.trim();
        if (text && text.length > 5 && text.length < 2000) {
          const key = text.substring(0, 50);
          if (!seenContent.has(key)) {
            seenContent.add(key);
            // Can't reliably determine sender from DOM
            messages.push({ sender: 'Unknown', content: text, timestamp: '' });
          }
        }
      }
    }
    
    return messages;
  }
  
  // Format conversation to match LinkedIn's native copy/paste format
  // This allows the server-side parser to handle it consistently
  function formatConversationForApi(messages) {
    const output = [];
    let lastDay = null;
    
    for (const msg of messages) {
      // Add day header if it changed (e.g., "Tuesday", "Friday")
      const dayHeader = getDayHeader(msg.timestamp);
      if (dayHeader && dayHeader !== lastDay) {
        output.push(dayHeader);
        lastDay = dayHeader;
      }
      
      // Get time portion
      const timeStr = getTimeFromTimestamp(msg.timestamp);
      
      // Match LinkedIn's format:
      // "Sender Name sent the following message at HH:MM AM/PM"
      // "Sender Name   HH:MM AM/PM"
      // Message content
      output.push(`${msg.sender} sent the following message at ${timeStr}`);
      output.push(`${msg.sender}   ${timeStr}`);
      output.push(msg.content);
      output.push(''); // Blank line between messages
    }
    
    return output.join('\n');
  }
  
  // Get day header from timestamp (e.g., "Tuesday", "Friday", "Jan 20")
  function getDayHeader(timestamp) {
    if (!timestamp) return null;
    
    const lowerTs = timestamp.toLowerCase().trim();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Check if timestamp contains a day name
    for (const day of dayNames) {
      if (lowerTs.includes(day.toLowerCase())) {
        return day;
      }
    }
    
    // Check for "Today" or "Yesterday"
    if (lowerTs.includes('today')) return 'Today';
    if (lowerTs.includes('yesterday')) return 'Yesterday';
    
    // Check for date format like "Jan 20"
    const monthMatch = timestamp.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i);
    if (monthMatch) return monthMatch[0];
    
    return null;
  }
  
  // Get time from timestamp (e.g., "11:39 AM")
  function getTimeFromTimestamp(timestamp) {
    if (!timestamp) return '12:00 PM';
    
    // Extract time pattern HH:MM AM/PM
    const timeMatch = timestamp.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
    if (timeMatch) {
      let time = timeMatch[1].trim();
      // Ensure AM/PM is uppercase
      time = time.replace(/am/i, 'AM').replace(/pm/i, 'PM');
      // Add AM/PM if missing (assume based on hour)
      if (!time.includes('AM') && !time.includes('PM')) {
        const hour = parseInt(time.split(':')[0], 10);
        time += hour >= 8 && hour < 12 ? ' AM' : ' PM';
      }
      return time;
    }
    
    return '12:00 PM';
  }
  
  // Update button visual state
  function updateButtonState(state) {
    if (!button) return;
    
    button.className = 'na-quick-update-btn';
    
    switch (state) {
      case 'loading':
        button.classList.add('na-loading');
        button.innerHTML = `
          <svg class="na-spinner" width="20" height="20" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="32" stroke-linecap="round"/>
          </svg>
          <span class="na-btn-text">Saving...</span>
        `;
        break;
        
      case 'success':
        button.classList.add('na-success');
        button.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span class="na-btn-text">Saved!</span>
        `;
        break;
        
      case 'error':
        button.classList.add('na-error');
        button.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <span class="na-btn-text">Failed</span>
        `;
        break;
        
      case 'not-auth':
        button.classList.add('na-warning');
        button.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <span class="na-btn-text">Open Portal</span>
        `;
        break;
        
      default:
        button.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          <span class="na-btn-text">Save to Portal</span>
        `;
    }
  }
  
  // Show confirmation dialog - returns Promise<boolean> (true = confirm, false = cancel)
  function showConfirmDialog(message, confirmText = 'Continue', cancelText = 'Cancel') {
    return new Promise((resolve) => {
      const existing = document.getElementById('na-confirm-dialog');
      if (existing) existing.remove();
      
      const overlay = document.createElement('div');
      overlay.id = 'na-confirm-dialog';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
      
      const box = document.createElement('div');
      box.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 24px;
        max-width: 400px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      `;
      
      box.innerHTML = `
        <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.5; color: #333;">${message}</p>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button id="na-confirm-cancel" style="padding: 8px 16px; border: 1px solid #ccc; background: white; border-radius: 6px; cursor: pointer; font-size: 14px;">${cancelText}</button>
          <button id="na-confirm-ok" style="padding: 8px 16px; border: none; background: #0a66c2; color: white; border-radius: 6px; cursor: pointer; font-size: 14px;">${confirmText}</button>
        </div>
      `;
      
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      
      const cleanup = () => {
        overlay.remove();
      };
      
      box.querySelector('#na-confirm-ok').onclick = () => { cleanup(); resolve(true); };
      box.querySelector('#na-confirm-cancel').onclick = () => { cleanup(); resolve(false); };
      overlay.onclick = (e) => { if (e.target === overlay) { cleanup(); resolve(false); } };
    });
  }
  
  // Show toast notification
  function showToast(message, type = 'info') {
    const existing = document.getElementById('na-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = 'na-toast';
    toast.className = `na-toast na-toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('na-toast-visible');
    });
    
    // Remove after delay
    setTimeout(() => {
      toast.classList.remove('na-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
  
  // Promise wrapper for chrome.runtime.sendMessage
  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      });
    });
  }
  
  // Start the extension
  init();
  
})();
