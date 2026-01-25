// Content script for LinkedIn messaging pages
// Injects the quick update button and handles conversation scraping

(function() {
  'use strict';
  
  let button = null;
  let isProcessing = false;
  
  // DOM selectors for LinkedIn messaging (externalize later for hot-updates)
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
    
    // Check if we were redirected here to auto-save
    checkPendingSave();
    
    // Always set up the observer first - don't wait for auth check
    observeForConversations();
    
    // Watch for SPA navigation (URL changes without page reload)
    setupSPANavigationDetection();
    
    // Then check auth status (just for button state, not blocking)
    try {
      chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('[NA Extension] Auth check failed, will retry on click');
          return;
        }
        
        if (response?.authenticated) {
          console.log('[NA Extension] Already authenticated');
        }
      });
    } catch (e) {
      console.log('[NA Extension] Extension context error, will retry on click');
    }
    
    // Listen for auth ready events
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'AUTH_READY') {
        console.log('[NA Extension] Auth is now ready');
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
    
    // The SPA navigation detection will handle subsequent checks
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
    setInterval(() => {
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
  
  // Simple URL-based check - very reliable
  function isMessagingPage() {
    const path = window.location.pathname;
    return path.startsWith('/messaging');
  }
  
  // Legacy function - now just uses URL
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
      
      // Get auth data to know the client's name (to exclude from contact extraction)
      const authData = await sendMessage({ type: 'GET_AUTH' });
      
      // Parse the OTHER person's name from clipboard (not the client's name)
      // LinkedIn format: "Name sent the following message at HH:MM AM/PM"
      // We need to find ALL unique senders and pick the one that's NOT the client
      const senderPattern = /^(.+?)\s+sent the following message at/gm;
      const allSenders = new Set();
      let match;
      while ((match = senderPattern.exec(clipboardText)) !== null) {
        const name = match[1].trim();
        if (name && name.length > 1 && name.length < 50) {
          allSenders.add(name);
        }
      }
      
      // Also try alternate format: "Name   HH:MM AM/PM" (with spaces before time)
      const altPattern = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+\d{1,2}:\d{2}\s*[AP]M$/gm;
      while ((match = altPattern.exec(clipboardText)) !== null) {
        const name = match[1].trim();
        if (name && name.length > 1 && name.length < 50) {
          allSenders.add(name);
        }
      }
      
      // Determine the contact name (the OTHER person, not the client)
      let contactName = '';
      // Derive client name from clientId (format: "Guy-Wilson" -> "Guy Wilson")
      const clientName = authData?.clientId ? authData.clientId.replace(/-/g, ' ') : '';
      
      if (allSenders.size > 0) {
        // Filter out the client's name (compare by first name if full name not available)
        const clientFirstName = clientName.split(' ')[0].toLowerCase();
        const otherPeople = Array.from(allSenders).filter(name => {
          const senderFirstName = name.split(' ')[0].toLowerCase();
          return clientFirstName && senderFirstName !== clientFirstName && name.toLowerCase() !== clientName.toLowerCase();
        });
        
        // Use the first OTHER person as the contact
        if (otherPeople.length > 0) {
          contactName = otherPeople[0];
        } else if (allSenders.size === 1) {
          // Only one sender found - might be viewing own sent messages, use it anyway
          contactName = Array.from(allSenders)[0];
        }
      }
      
      console.log('[NA Extension] Extracted senders:', Array.from(allSenders), 'Client:', clientName, 'Contact:', contactName);
      
      // Store data for portal to pick up
      const portalData = {
        contactName: contactName,
        conversationText: clipboardText,
        timestamp: Date.now()
      };
      
      // Send to background script to store
      await sendMessage({ 
        type: 'STORE_CLIPBOARD_DATA', 
        data: portalData 
      });
      
      // Build portal URL with auth credentials so new tab is authenticated
      // (authData already retrieved above for name extraction)
      let portalUrl = 'https://pb-webhook-server-staging.vercel.app/quick-update?from=extension';
      
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
      showToast(error.message, 'error');
      
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
