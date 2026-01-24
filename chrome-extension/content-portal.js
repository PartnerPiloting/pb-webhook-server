// Content script for Network Accelerator portal
// Broadcasts auth credentials to the extension when the portal loads

(function() {
  'use strict';
  
  // Determine environment from URL
  const isStaging = window.location.hostname.includes('staging');
  const environment = isStaging ? 'staging' : 'production';
  
  // Function to extract and broadcast credentials
  function broadcastCredentials() {
    try {
      // Portal stores both token and clientId in sessionStorage
      const portalToken = sessionStorage.getItem('portalToken');
      const clientId = sessionStorage.getItem('clientId');
      
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
        console.log('[NA Extension] Waiting for credentials...', { hasToken: !!portalToken, hasClientId: !!clientId });
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
  
  // Poll for credentials (they may not be available immediately after page load)
  let attempts = 0;
  const maxAttempts = 60; // 30 seconds
  const pollInterval = setInterval(() => {
    attempts++;
    const hasCredentials = sessionStorage.getItem('portalToken') && sessionStorage.getItem('clientId');
    if (hasCredentials) {
      broadcastCredentials();
      clearInterval(pollInterval);
    } else if (attempts >= maxAttempts) {
      console.log('[NA Extension] Gave up waiting for credentials after 30 seconds');
      clearInterval(pollInterval);
    }
  }, 500);
  
  // Broadcast immediately in case credentials are already there
  broadcastCredentials();
  
  // Also broadcast when sessionStorage changes
  window.addEventListener('storage', (e) => {
    if (e.key === 'portalToken' || e.key === 'clientId') {
      broadcastCredentials();
    }
  });
  
  // Rebroadcast periodically to handle extension reinstalls
  setInterval(broadcastCredentials, 30000);
  
})();
