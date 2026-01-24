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
  
  // Initialize the extension
  function init() {
    // Check auth status first
    chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('[NA Extension] Extension context not available');
        return;
      }
      
      if (response?.authenticated) {
        observeForConversations();
      } else {
        // Still inject button, but it will show auth prompt when clicked
        observeForConversations();
      }
    });
    
    // Listen for auth ready events
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'AUTH_READY') {
        console.log('[NA Extension] Auth is now ready');
        updateButtonState('ready');
      }
    });
  }
  
  // Watch for conversation thread to appear
  function observeForConversations() {
    const observer = new MutationObserver((mutations) => {
      // Check if we're on a conversation page
      if (isConversationVisible() && !button) {
        injectButton();
      } else if (!isConversationVisible() && button) {
        removeButton();
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Also check immediately
    if (isConversationVisible()) {
      injectButton();
    }
  }
  
  // Check if a conversation thread is visible
  function isConversationVisible() {
    return !!(
      document.querySelector(SELECTORS.messageThread) ||
      document.querySelector(SELECTORS.conversationContainer) ||
      document.querySelector('.msg-s-message-list')
    );
  }
  
  // Inject the quick update button
  function injectButton() {
    if (button) return;
    
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
  
  // Handle button click
  async function handleButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (isProcessing) return;
    
    // Check auth first
    const authResponse = await sendMessage({ type: 'CHECK_AUTH' });
    
    if (!authResponse?.authenticated) {
      showToast('Please open your Network Accelerator portal first', 'warning');
      updateButtonState('not-auth');
      return;
    }
    
    isProcessing = true;
    updateButtonState('loading');
    
    try {
      // 1. Get profile URL from conversation
      const profileUrl = extractProfileUrl();
      if (!profileUrl) {
        throw new Error('Could not find LinkedIn profile URL');
      }
      
      // 2. Scrape conversation
      const conversation = scrapeConversation();
      if (!conversation || conversation.length === 0) {
        throw new Error('Could not find any messages in this conversation');
      }
      
      const rawContent = formatConversationForApi(conversation);
      
      // 3. Lookup lead
      const lookupResult = await sendMessage({
        type: 'LOOKUP_LEAD',
        linkedinUrl: profileUrl
      });
      
      if (!lookupResult.success) {
        throw new Error(lookupResult.error || 'Failed to find lead');
      }
      
      const leads = lookupResult.data?.leads || [];
      if (leads.length === 0) {
        throw new Error('No matching lead found in your portal');
      }
      
      const leadId = leads[0].id;
      const leadName = `${leads[0].firstName || ''} ${leads[0].lastName || ''}`.trim();
      
      // 4. Quick update
      const updateResult = await sendMessage({
        type: 'QUICK_UPDATE',
        leadId,
        content: rawContent,
        section: 'linkedin'
      });
      
      if (!updateResult.success) {
        throw new Error(updateResult.error || 'Failed to update lead');
      }
      
      updateButtonState('success');
      showToast(`Saved ${conversation.length} messages for ${leadName}`, 'success');
      
      // Reset button after delay
      setTimeout(() => {
        if (!isProcessing) updateButtonState('ready');
      }, 3000);
      
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
  
  // Extract LinkedIn profile URL from conversation
  function extractProfileUrl() {
    // Try different selectors
    const selectors = [
      SELECTORS.profileLink,
      SELECTORS.threadHeader,
      SELECTORS.altProfileLink,
      '.msg-thread .artdeco-entity-lockup__title a',
      '.msg-overlay-bubble-header__link'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element?.href) {
        const url = element.href;
        // Normalize LinkedIn URL
        if (url.includes('linkedin.com/in/')) {
          return url.split('?')[0]; // Remove query params
        }
      }
    }
    
    // Try to extract from page URL if we're on a profile page with messaging
    if (window.location.pathname.startsWith('/in/')) {
      return window.location.origin + window.location.pathname.split('?')[0];
    }
    
    return null;
  }
  
  // Scrape messages from the conversation
  function scrapeConversation() {
    const messages = [];
    
    // Find all message containers
    const messageElements = document.querySelectorAll(
      `${SELECTORS.messageItem}, .msg-s-message-group, .msg-s-event-listitem`
    );
    
    messageElements.forEach((elem) => {
      try {
        // Get sender name
        const senderEl = elem.querySelector(
          `${SELECTORS.messageSender}, .msg-s-message-group__name, .t-14.t-black.t-bold`
        );
        const sender = senderEl?.textContent?.trim() || 'Unknown';
        
        // Get message content
        const contentEl = elem.querySelector(
          `${SELECTORS.messageContent}, .msg-s-event-listitem__body p, .msg-s-event__content`
        );
        const content = contentEl?.textContent?.trim() || '';
        
        // Get timestamp
        const timeEl = elem.querySelector(
          `${SELECTORS.messageTimestamp}, time`
        );
        const timestamp = timeEl?.textContent?.trim() || timeEl?.getAttribute('datetime') || '';
        
        if (content) {
          messages.push({ sender, content, timestamp });
        }
      } catch (e) {
        console.warn('[NA Extension] Error parsing message:', e);
      }
    });
    
    return messages;
  }
  
  // Format conversation for the API
  function formatConversationForApi(messages) {
    // Format as raw LinkedIn-style conversation
    return messages.map(msg => {
      const timeStr = msg.timestamp ? `[${msg.timestamp}]` : '';
      return `${msg.sender} ${timeStr}\n${msg.content}`;
    }).join('\n\n');
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
