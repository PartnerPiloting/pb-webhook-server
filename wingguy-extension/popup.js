// Popup script for Network Accelerator extension

document.addEventListener('DOMContentLoaded', () => {
  updateUI();
  
  // Disconnect button
  document.getElementById('btn-disconnect')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_AUTH' }, () => {
      updateUI();
    });
  });
});

// Update UI based on auth state
function updateUI() {
  chrome.runtime.sendMessage({ type: 'GET_AUTH' }, (data) => {
    const isConnected = !!(data?.clientId && data?.portalToken);
    
    const connectedState = document.getElementById('connected-state');
    const disconnectedState = document.getElementById('disconnected-state');
    const helpSection = document.getElementById('help-section');
    
    if (isConnected) {
      connectedState.classList.remove('hidden');
      disconnectedState.classList.add('hidden');
      helpSection.classList.add('hidden');
      
      // Update client name
      const clientNameEl = document.getElementById('client-name');
      if (clientNameEl) {
        clientNameEl.textContent = data.clientId || 'Unknown';
      }
      
      // Update environment badge
      const envBadge = document.getElementById('env-badge');
      if (envBadge) {
        const isStaging = data.environment === 'staging';
        envBadge.textContent = isStaging ? 'STAGING' : 'PROD';
        envBadge.className = `env-badge ${isStaging ? 'staging' : 'production'}`;
      }
    } else {
      connectedState.classList.add('hidden');
      disconnectedState.classList.remove('hidden');
      helpSection.classList.remove('hidden');
    }
  });
}

// Listen for auth changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    updateUI();
  }
});
