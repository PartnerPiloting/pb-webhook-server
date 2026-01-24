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
      const clientId = localStorage.getItem('clientId');
      const portalToken = localStorage.getItem('portalToken');
      const devKey = localStorage.getItem('devKey');
      
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
      }
    } catch (e) {
      // localStorage access failed, ignore
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
  
  // Broadcast immediately on load
  broadcastCredentials();
  
  // Also broadcast when localStorage changes (in case user logs in after page load)
  window.addEventListener('storage', (e) => {
    if (e.key === 'clientId' || e.key === 'portalToken') {
      broadcastCredentials();
    }
  });
  
  // Rebroadcast periodically to handle extension reinstalls
  setInterval(broadcastCredentials, 30000);
  
})();
