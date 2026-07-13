// Popup script for Network Accelerator extension

document.addEventListener('DOMContentLoaded', () => {
  updateUI();
  
  // Disconnect button
  document.getElementById('btn-disconnect')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_AUTH' }, () => {
      updateUI();
    });
  });

  // BYO Claude key — kept in this browser only (chrome.storage.local), sent per draft as a header.
  const keyInput = document.getElementById('anthropic-key');
  const keyStatus = document.getElementById('key-status');
  const setKeyStatus = (msg, ok) => {
    if (!keyStatus) return;
    keyStatus.textContent = msg;
    keyStatus.className = `key-status${ok ? ' ok' : ''}`;
  };
  chrome.storage.local.get(['anthropicKey'], (d) => {
    if (keyInput && d.anthropicKey) {
      keyInput.value = d.anthropicKey;
      setKeyStatus('Key saved ✓', true);
    }
  });
  document.getElementById('btn-save-key')?.addEventListener('click', () => {
    const v = (keyInput?.value || '').trim();
    if (v && !v.startsWith('sk-ant-')) {
      setKeyStatus('That doesn\'t look like an Anthropic key (starts with sk-ant-).', false);
      return;
    }
    chrome.storage.local.set({ anthropicKey: v }, () => {
      setKeyStatus(v ? 'Key saved ✓' : 'Key cleared', true);
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
