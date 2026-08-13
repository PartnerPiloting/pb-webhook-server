// Popup script for Network Accelerator extension

document.addEventListener('DOMContentLoaded', () => {
  updateUI();
  
  // Disconnect button
  document.getElementById('btn-disconnect')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_AUTH' }, () => {
      updateUI();
    });
  });

  // Connect button (disconnected state): open/reload the portal tab. The popup then updates itself
  // via the storage.onChanged listener below the moment the portal broadcasts the credentials.
  document.getElementById('btn-open-portal')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_PORTAL' }, () => window.close());
  });

  // The popup carries NO key field (removed 2026-08-05, Julian's feedback: an empty key box reads
  // as a form to fill in). Drafting runs on the Claude key on the client's account; if that isn't
  // set up, the draft itself says so - the popup never raises the subject.
  const vline = document.getElementById('version-line');
  if (vline) vline.textContent = `v${chrome.runtime.getManifest().version} • Wingguy`;
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
