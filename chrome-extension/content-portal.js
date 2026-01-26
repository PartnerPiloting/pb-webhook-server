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
      
      // Look for the textarea for notes (Content field)
      const textArea = document.querySelector('textarea[placeholder*="conversation"]') ||
                       document.querySelector('textarea[placeholder*="Paste"]') ||
                       document.querySelector('textarea');
      
      // Look for the LinkedIn section button - check multiple element types
      // These buttons might be <button>, <div>, <span>, etc. styled as pills
      const allClickables = document.querySelectorAll('button, [role="button"], div, span');
      const linkedinButton = Array.from(allClickables).find(el => {
        const text = el.textContent?.trim();
        // Must be exactly "LinkedIn" or very short containing LinkedIn (not "Sales Nav" which contains "LinkedIn" substring issues)
        return text === 'LinkedIn';
      });
      
      if (searchInput) {
        clearInterval(checkInterval);
        
        // Step 1: Pre-fill the search with contact name FIRST
        // This triggers a React re-render/search, so we do it before clicking LinkedIn
        if (data.contactName) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(searchInput, data.contactName);
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // Step 2: Wait for React to settle after contact name input, THEN click LinkedIn button
        setTimeout(() => {
          // Helper function to find and click LinkedIn button
          const clickLinkedInButton = () => {
            const allClickables = document.querySelectorAll('button, [role="button"], div, span, label');
            const linkedinBtn = Array.from(allClickables).find(el => {
              const text = el.textContent?.trim();
              return text === 'LinkedIn';
            });
            
            if (linkedinBtn) {
              console.log('[NA Extension] Found LinkedIn button, clicking...');
              linkedinBtn.focus();
              linkedinBtn.click();
              linkedinBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              linkedinBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
              linkedinBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              
              // Also try clicking parent if button is nested
              if (linkedinBtn.parentElement) {
                linkedinBtn.parentElement.click();
              }
              return true;
            }
            return false;
          };
          
          // Try clicking immediately
          clickLinkedInButton();
          
          // Try again after a short delay (in case React re-rendered)
          setTimeout(() => clickLinkedInButton(), 200);
          setTimeout(() => clickLinkedInButton(), 400);
          
          // Step 3: Wait for LinkedIn click to take effect, then fill textarea
          setTimeout(() => {
            const activeTextArea = document.querySelector('textarea');
            
            if (activeTextArea?.placeholder?.includes('First select a source')) {
              // Try clicking again if still disabled
              console.log('[NA Extension] Textarea still disabled, retrying click...');
              clickLinkedInButton();
            }
            
            // Final attempt to fill textarea after another short delay
            setTimeout(() => {
              // One more click attempt
              clickLinkedInButton();
              
              setTimeout(() => {
                const finalTextArea = document.querySelector('textarea');
                if (finalTextArea && data.conversationText) {
                  console.log('[NA Extension] Filling textarea with conversation...');
                  const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                  nativeTextAreaValueSetter.call(finalTextArea, data.conversationText);
                  finalTextArea.dispatchEvent(new Event('input', { bubbles: true }));
                  finalTextArea.dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                showDataLoadedNotification(data.contactName);
              }, 200);
            }, 300);
            
          }, 600); // Wait for LinkedIn button click to take effect
          
        }, 800); // Wait for contact name input to settle
        
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        console.log('[NA Extension] Could not find Quick Update form fields');
      }
    }, 250);
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
