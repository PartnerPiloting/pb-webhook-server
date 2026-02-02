// Content script for Network Accelerator portal
// Broadcasts auth credentials to the extension when the portal loads

(function() {
  'use strict';
  
  // Track if we've already shown the sync notification this session
  let hasShownNotification = false;
  
  // Determine environment from URL
  const isStaging = window.location.hostname.includes('staging');
  const environment = isStaging ? 'staging' : 'production';
  
  // Function to extract and broadcast credentials
  function broadcastCredentials() {
    // Check if extension context is still valid
    if (!chrome.runtime?.id) {
      return; // Extension was reloaded, stop trying
    }
    
    try {
      // Portal stores credentials in localStorage (persistent) and sessionStorage (legacy)
      const portalToken = localStorage.getItem('portalToken') || sessionStorage.getItem('portalToken');
      const clientId = localStorage.getItem('clientCode') || sessionStorage.getItem('clientId');
      
      const urlParams = new URLSearchParams(window.location.search);
      const devKey = urlParams.get('devKey') || localStorage.getItem('devKey');
      
      if (clientId && portalToken) {
        chrome.runtime.sendMessage({
          type: 'AUTH_BROADCAST',
          clientId,
          portalToken,
          devKey,
          environment
        }, (response) => {
          if (chrome.runtime.lastError) {
            // Extension context invalidated, stop silently
            return;
          }
          if (response?.success) {
            console.log('[NA Extension] Credentials synced to extension');
            // Only show notification once per page load
            if (!hasShownNotification) {
              hasShownNotification = true;
              showSyncNotification();
            }
          }
        });
      }
    } catch (e) {
      // Silently ignore - extension context may be invalidated
    }
  }
  
  // Show a brief notification that sync occurred
  function showSyncNotification() {
    const existing = document.getElementById('na-extension-sync-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = 'na-extension-sync-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #22c55e;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 999999;
      animation: na-slide-in 0.3s ease-out;
    `;
    toast.innerHTML = '✓ LinkedIn extension connected';
    
    // Add animation keyframes
    const style = document.createElement('style');
    style.textContent = `
      @keyframes na-slide-in {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes na-fade-out {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(toast);
    
    // Fade out and remove after 3 seconds
    setTimeout(() => {
      toast.style.animation = 'na-fade-out 0.3s ease-out forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
  
  // Poll for credentials (they may not be available immediately after page load)
  let attempts = 0;
  const maxAttempts = 60; // 30 seconds
  const pollInterval = setInterval(() => {
    // Stop if extension context is invalidated
    if (!chrome.runtime?.id) {
      clearInterval(pollInterval);
      return;
    }
    
    attempts++;
    // Check both localStorage (persistent) and sessionStorage (legacy)
    const hasCredentials = (localStorage.getItem('portalToken') || sessionStorage.getItem('portalToken')) 
                        && (localStorage.getItem('clientCode') || sessionStorage.getItem('clientId'));
    if (hasCredentials) {
      broadcastCredentials();
      clearInterval(pollInterval);
    } else if (attempts >= maxAttempts) {
      clearInterval(pollInterval);
    }
  }, 500);
  
  // Broadcast immediately in case credentials are already there
  broadcastCredentials();
  
  // Also broadcast when storage changes (works for localStorage, not sessionStorage)
  window.addEventListener('storage', (e) => {
    if (e.key === 'portalToken' || e.key === 'clientId' || e.key === 'clientCode') {
      broadcastCredentials();
    }
  });
  
  // Check if this is Quick Update opened from extension
  function checkForExtensionData() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('from') !== 'extension') return;
    
    // Check if extension context is valid
    if (!chrome.runtime?.id) return;
    
    // Request clipboard data from background script
    chrome.runtime.sendMessage({ type: 'GET_CLIPBOARD_DATA' }, (data) => {
      if (chrome.runtime.lastError || !data) {
        console.log('[NA Extension] No clipboard data available');
        return;
      }
      
      console.log('[NA Extension] Received clipboard data for:', data.contactName);
      
      // Wait for the Quick Update form to be ready
      waitForQuickUpdateForm(data);
    });
  }
  
  // Wait for form elements and populate them
  function waitForQuickUpdateForm(data) {
    let attempts = 0;
    const maxAttempts = 40; // 10 seconds
    
    const checkInterval = setInterval(() => {
      attempts++;
      
      // Look for the search input - more flexible selector
      const searchInput = document.querySelector('input[placeholder*="name"]') ||
                         document.querySelector('input[placeholder*="LinkedIn"]') ||
                         document.querySelector('input[placeholder*="URL"]') ||
                         document.querySelector('input[placeholder*="email"]');
      
      if (searchInput) {
        clearInterval(checkInterval);
        
        // Step 1: Pre-fill the search with contact name FIRST
        // This triggers a React re-render/search, so we do it before clicking LinkedIn
        if (data.contactName) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(searchInput, data.contactName);
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // Step 2: Wait for the lead to be SELECTED (blue card appears)
        // This is important because selectLead() clears the form, so we must wait for it to complete
        console.log('[NA Extension] Search input filled, waiting for lead to be selected...');
        waitForLeadSelection(data);
        
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        console.log('[NA Extension] Could not find Quick Update form fields');
      }
    }, 250);
  }
  
  // Wait for lead to be selected (blue card visible) before filling the form
  function waitForLeadSelection(data) {
    let attempts = 0;
    const maxAttempts = 40; // 10 seconds
    
    const checkInterval = setInterval(() => {
      attempts++;
      
      // Look for the selected lead card (blue background with lead info)
      // This appears after selectLead() is called and React has finished updating
      const selectedLeadCard = document.querySelector('.bg-blue-50');
      const hasLeadName = selectedLeadCard?.textContent?.includes(data.contactName?.split(' ')[0]);
      
      if (selectedLeadCard && hasLeadName) {
        clearInterval(checkInterval);
        console.log('[NA Extension] Lead selected, waiting for React to settle...');
        
        // Wait a bit longer for React to fully complete its state updates from selectLead()
        setTimeout(() => {
          console.log('[NA Extension] Now filling the form...');
          fillFormAfterLeadSelected(data);
        }, 500);
        
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        console.log('[NA Extension] Lead card not found, attempting to fill form anyway...');
        // Try anyway - maybe the lead wasn't found or different layout
        setTimeout(() => fillFormAfterLeadSelected(data), 300);
      }
    }, 250);
  }
  
  // Fill the form after lead has been selected
  function fillFormAfterLeadSelected(data) {
    // Now we can safely click LinkedIn and fill the textarea
    // because selectLead() has already finished clearing the form
    
    // Helper function to find the LinkedIn button (specifically in the Source section, not Add Lead form)
    const findLinkedInButton = () => {
      const allButtons = document.querySelectorAll('button');
      
      // Find buttons with exact text "LinkedIn" that are NOT inside a dropdown/form
      for (const btn of allButtons) {
        const text = btn.textContent?.trim();
        if (text === 'LinkedIn' && btn.className.includes('rounded')) {
          const parent = btn.closest('.absolute');
          if (!parent) {
            return btn;
          }
        }
      }
      
      // Fallback: find any element with exact text "LinkedIn"
      const allClickables = document.querySelectorAll('button, [role="button"]');
      return Array.from(allClickables).find(el => el.textContent?.trim() === 'LinkedIn');
    };
    
    // Helper function to check if LinkedIn is already selected
    const isLinkedInSelected = () => {
      const btn = findLinkedInButton();
      if (!btn) return false;
      return btn.className.includes('bg-blue-600') || btn.className.includes('text-white');
    };
    
    // Helper function to click LinkedIn button with proper React event
    const clickLinkedInButton = () => {
      const linkedinBtn = findLinkedInButton();
      
      if (linkedinBtn) {
        console.log('[NA Extension] Found LinkedIn button, clicking...');
        linkedinBtn.focus();
        
        const clickEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1
        });
        linkedinBtn.dispatchEvent(clickEvent);
        
        return true;
      }
      console.log('[NA Extension] LinkedIn button not found');
      return false;
    };
    
    // Function to fill textarea after LinkedIn is selected
    const fillTextarea = () => {
      setTimeout(() => {
        const textarea = document.querySelector('textarea');
        
        if (textarea && data.conversationText) {
          console.log('[NA Extension] Filling textarea with conversation...');
          
          const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          ).set;
          nativeTextAreaValueSetter.call(textarea, data.conversationText);
          
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
          
          try {
            textarea.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: data.conversationText
            }));
          } catch (e) {
            // InputEvent might not be supported in all browsers
          }
          
          console.log('[NA Extension] Textarea filled successfully');
        } else {
          console.log('[NA Extension] Could not find textarea or no conversation text');
        }
        
        showDataLoadedNotification(data.contactName);
      }, 300);
    };
    
    // Try clicking with retries until it works
    let attempts = 0;
    const maxAttempts = 10;
    
    const tryClickWithRetry = () => {
      attempts++;
      
      if (isLinkedInSelected()) {
        console.log('[NA Extension] LinkedIn is already selected, proceeding to fill textarea...');
        fillTextarea();
        return;
      }
      
      if (attempts > maxAttempts) {
        console.log('[NA Extension] Max attempts reached, trying to fill textarea anyway...');
        fillTextarea();
        return;
      }
      
      console.log(`[NA Extension] Click attempt ${attempts}/${maxAttempts}...`);
      clickLinkedInButton();
      
      setTimeout(() => {
        if (isLinkedInSelected()) {
          console.log('[NA Extension] LinkedIn button now selected!');
          fillTextarea();
        } else {
          tryClickWithRetry();
        }
      }, 150);
    };
    
    // Start the retry loop
    tryClickWithRetry();
  }
  
  // Show notification that data was loaded
  function showDataLoadedNotification(contactName) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #3b82f6;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 999999;
    `;
    toast.innerHTML = `✓ Loaded conversation with <strong>${contactName || 'contact'}</strong>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }
  
  // Check for extension data on page load
  checkForExtensionData();
  
})();
