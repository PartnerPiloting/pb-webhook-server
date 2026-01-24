// Content script for Network Accelerator portal
// Broadcasts auth credentials to the extension when the portal loads

(function() {
  'use strict';
  
  // Determine environment from URL
  const isStaging = window.location.hostname.includes('staging');
  const environment = isStaging ? 'staging' : 'production';
  
  // Inject a script to access page-level variables and relay them via custom events
  function injectPageScript() {
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        function sendCredentials() {
          const clientId = window.__NA_CLIENT_ID__;
          if (clientId) {
            window.dispatchEvent(new CustomEvent('na-extension-credentials', {
              detail: { clientId }
            }));
          }
        }
        // Send immediately if available
        sendCredentials();
        // Also retry periodically in case clientId is set later
        const interval = setInterval(() => {
          if (window.__NA_CLIENT_ID__) {
            sendCredentials();
            clearInterval(interval);
          }
        }, 500);
        // Stop trying after 30 seconds
        setTimeout(() => clearInterval(interval), 30000);
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();
  }
  
  // Listen for credentials from the injected script
  let pageClientId = null;
  window.addEventListener('na-extension-credentials', (e) => {
    pageClientId = e.detail?.clientId;
    console.log('[NA Extension] Received clientId from page:', pageClientId);
    broadcastCredentials();
  });
  
  // Function to extract and broadcast credentials
  function broadcastCredentials() {
    try {
      // Portal stores token in sessionStorage
      const portalToken = sessionStorage.getItem('portalToken');
      
      // Try to get clientId from various sources
      let clientId = pageClientId;
      
      // Check URL params as fallback
      if (!clientId) {
        const urlParams = new URLSearchParams(window.location.search);
        clientId = urlParams.get('client') || urlParams.get('clientId') || urlParams.get('testClient');
      }
      
      // Check localStorage as fallback
      if (!clientId) {
        clientId = localStorage.getItem('clientCode');
      }
      
      const urlParams = new URLSearchParams(window.location.search);
      const devKey = urlParams.get('devKey') || localStorage.getItem('devKey');
      
      console.log('[NA Extension] Checking credentials:', { 
        hasToken: !!portalToken, 
        clientId: clientId,
        environment 
      });
      
      if (clientId && portalToken) {
        chrome.runtime.sendMessage({
          type: 'AUTH_BROADCAST',
          clientId,
          portalToken,
          devKey,
          environment
        }, (response) => {
          if (chrome.runtime.lastError) {
            // Extension not available, ignore
            return;
          }
          if (response?.success) {
            console.log('[NA Extension] Credentials synced to extension');
            showSyncNotification();
          }
        });
      } else {
        console.log('[NA Extension] Waiting for credentials...', { hasToken: !!portalToken, clientId });
      }
    } catch (e) {
      console.error('[NA Extension] Error reading credentials:', e);
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
  
  // Inject page script to access window variables
  injectPageScript();
  
  // Broadcast immediately on load (will retry when clientId becomes available)
  broadcastCredentials();
  
  // Also broadcast when sessionStorage changes
  window.addEventListener('storage', (e) => {
    if (e.key === 'portalToken') {
      broadcastCredentials();
    }
  });
  
  // Rebroadcast periodically to handle extension reinstalls
  setInterval(broadcastCredentials, 30000);
  
})();
