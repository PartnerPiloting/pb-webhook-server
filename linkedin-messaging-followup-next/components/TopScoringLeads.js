"use client";
import React, { useEffect, useMemo, useState } from 'react';
import HelpButton from './HelpButton';
import { getCurrentClientId } from "../utils/clientUtils";

// Derive backend origin from NEXT_PUBLIC_API_BASE_URL which may include a path like /api/linkedin
const RAW_API = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://pb-webhook-server.onrender.com/api/linkedin';
let API_ORIGIN = 'https://pb-webhook-server.onrender.com';
try { API_ORIGIN = new URL(RAW_API).origin; } catch (_) {}

function buildClientId() {
  const cached = typeof getCurrentClientId === 'function' ? getCurrentClientId() : null;
  if (cached) return cached;
  try {
    const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const t = sp?.get('testClient') || sp?.get('clientId');
    return t || null;
  } catch (_) {
    return null;
  }
}

function buildUrl(path, cid) {
  let url = `${API_ORIGIN.replace(/\/$/, '')}/api/top-scoring-leads${path}`;
  if (!cid) {
    try {
      const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const t = sp?.get('testClient') || sp?.get('clientId');
      if (t) url += (path.includes('?') ? '&' : '?') + `testClient=${encodeURIComponent(t)}`;
    } catch (_) {}
  }
  return url;
}

async function apiGet(path, clientId) {
  const cid = clientId ?? buildClientId();
  const res = await fetch(buildUrl(path, cid), {
    headers: {
      'Content-Type': 'application/json',
      ...(cid ? { 'x-client-id': cid } : {})
    },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPut(path, body, clientId) {
  const cid = clientId ?? buildClientId();
  const res = await fetch(buildUrl(path, cid), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(cid ? { 'x-client-id': cid } : {})
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path, body, clientId) {
  const cid = clientId ?? buildClientId();
  const res = await fetch(buildUrl(path, cid), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cid ? { 'x-client-id': cid } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function TopScoringLeads() {
  // --- State ---
  const [threshold, setThreshold] = useState(null);
  const [savedThreshold, setSavedThreshold] = useState(null); // last persisted threshold
  const [eligible, setEligible] = useState([]); // current page (preview) OR full locked batch
  const [hasSelected, setHasSelected] = useState(false); // has preview selection
  const [selectedCount, setSelectedCount] = useState(0); // count that WOULD be locked (capped 1000)
  const [totalEligible, setTotalEligible] = useState(null); // raw total count (uncapped)
  const [page, setPage] = useState(1); // preview page or client-side page for locked batch
  const [hasMore, setHasMore] = useState(false); // server indicates more preview pages
  const [inProgress, setInProgress] = useState(false); // locked batch exists (Temp flag in Airtable)
  const [phase, setPhase] = useState('IDLE'); // IDLE | SELECTING | READY | EXPORTING | AWAITING_CONFIRM | FINALIZING | RESETTING | DONE
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: null }); // show during lock/export
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saving, setSaving] = useState(false); // threshold save in progress
  const clientId = useMemo(() => buildClientId(), []);
  const [lastExportAt, setLastExportAt] = useState(null);
  const [exportAckTs, setExportAckTs] = useState(null); // reserved
  const [emptyMessage, setEmptyMessage] = useState(null); // message when no eligible leads on preview

  // --- Helpers ---
  const getEffectiveThreshold = () => {
    const t = Number(threshold);
    if (Number.isFinite(t)) return t;
    const s = Number(savedThreshold);
    return Number.isFinite(s) ? s : null;
  };

  const setInProgressFlag = (val) => {
    setInProgress(val);
    try {
      const k = `tsl_in_progress_${clientId || 'unknown'}`;
      if (typeof window !== 'undefined') {
        if (val) window.localStorage.setItem(k, '1'); else window.localStorage.removeItem(k);
      }
    } catch (_) {}
  };

  async function loadLockedBatch() {
    try {
      setError(null);
      setPhase(p => (p === 'IDLE' ? 'READY' : p));
      const current = await apiGet('/batch/current?all=1&limit=1000', clientId);
      const items = Array.isArray(current?.items) ? current.items : [];
      setEligible(items);
      setHasSelected(true);
      setSelectedCount(items.length);
      setTotalEligible(items.length);
      setHasMore(items.length > 50);
      setPage(1);
    } catch (e) {
      setError(e?.message || 'Failed to load locked batch');
    }
  }

  // Progressive loader (simulate incremental arrival so we can show a counter)
  async function loadLockedBatchProgressive() {
    try {
      setError(null);
      setPhase(p => (p === 'IDLE' ? 'READY' : p));
      const current = await apiGet('/batch/current?all=1&limit=1000', clientId);
      const items = Array.isArray(current?.items) ? current.items : [];
      setSelectedCount(items.length);
      setTotalEligible(items.length);
      setHasSelected(true);
      setHasMore(items.length > 50);
      setPage(1);
      setEligible([]);
      setLoadProgress({ loaded: 0, total: items.length });
      // Slice items into chunks to simulate incremental network paging
      const chunkSize = 50;
      for (let i = 0; i < items.length; i += chunkSize) {
        const slice = items.slice(i, i + chunkSize);
        // eslint-disable-next-line no-loop-func
        await new Promise(r => setTimeout(r, 40)); // small delay for visual progress
        setEligible(prev => [...prev, ...slice]);
        setLoadProgress(lp => ({ loaded: Math.min(items.length, (lp.loaded + slice.length)), total: items.length }));
      }
    } catch (e) {
      setError(e?.message || 'Failed to load locked batch');
    }
  }

  async function lockCurrentBatch(effThreshold) {
    if (inProgress) return; // already locked
    const thr = Number.isFinite(effThreshold) ? `&threshold=${encodeURIComponent(effThreshold)}` : '';
    // Real select (mutation) with cap 1000
    await apiPost(`/batch/select?all=1&pageSize=1000&replace=1${thr}`, null, clientId);
    setInProgressFlag(true);
    // Load full locked batch
  setPhase('EXPORTING');
  await loadLockedBatchProgressive();
  }

  // --- Initial load: threshold + check for locked batch ---
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await apiGet('/threshold', clientId);
        if (!mounted) return;
        setThreshold(res.value ?? null);
        setSavedThreshold(res.value ?? null);
      } catch (_) {}
      try {
        const currentPeek = await apiGet('/batch/current?limit=1', clientId);
        if (!mounted) return;
        const anyLocked = Array.isArray(currentPeek?.items) && currentPeek.items.length > 0;
        if (anyLocked) {
          setInProgressFlag(true);
          await loadLockedBatch();
        }
      } catch (_) {}
      try {
        const last = await apiGet('/export/last', clientId);
        if (last && typeof last.at === 'number') setLastExportAt(last.at);
      } catch (_) {}
    })();
    return () => { mounted = false; };
  }, [clientId]);

  // --- Save threshold on blur (not while locked) ---
  const saveThresholdIfChanged = async () => {
    if (inProgress) return; // locked: cannot change
    if (threshold === null || Number.isNaN(Number(threshold))) return;
    if (savedThreshold === threshold) return;
    try {
      setSaving(true);
      await apiPut('/threshold', { value: Number(threshold) }, clientId);
      setSavedThreshold(threshold);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1200);
    } catch (e) {
      setError(e?.message || 'Failed to save threshold');
    } finally {
      setSaving(false);
    }
  };

  // --- Preview selection (dry run) ---
  const onSelectPreview = async () => {
    // Allow re-preview while not locked (READY or IDLE). Block during async/exporting/finalizing/resetting.
    if (inProgress) return; // locked state can't preview
    if (!['IDLE', 'READY', 'DONE'].includes(phase)) return;
    setPhase('SELECTING');
    setError(null);
  setEmptyMessage(null);
    setHasSelected(false);
    setEligible([]);
    try {
      // Auto-save threshold if edited but not saved (only when not locked)
      if (!inProgress && threshold !== null && threshold !== savedThreshold) {
        try {
          setSaving(true);
          await apiPut('/threshold', { value: Number(threshold) }, clientId);
          setSavedThreshold(threshold);
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 1200);
        } catch (e) {
          // Non-fatal: continue with preview
          console.warn('Auto-save threshold failed', e?.message || e);
        } finally {
          setSaving(false);
        }
      }
      const eff = getEffectiveThreshold();
      const thrQ = Number.isFinite(eff) ? `&threshold=${encodeURIComponent(eff)}` : '';
      // Count total eligible
      let total = 0;
      try { const cnt = await apiGet(`/eligible/count?${thrQ.slice(1)}`, clientId); total = Number(cnt?.total ?? 0); } catch (_) {}
      // Dry run batch selection to know how many WOULD be set (capped at 1000)
      let willSet = 0;
      try { const dry = await apiPost(`/batch/select?all=1&pageSize=1000&dryRun=1${thrQ}`, null, clientId); willSet = Number(dry?.willSet ?? 0); } catch (_) {}
      const capped = Math.min(1000, willSet || total);
      setTotalEligible(total);
      setSelectedCount(capped);
      if (capped === 0) {
  setPhase('IDLE');
  setEmptyMessage('No eligible leads found – all potential candidates are already processed or below the threshold.');
        return;
      }
      // Fetch first preview page (pageSize 50)
      const list = await apiGet(`/eligible?page=1&pageSize=50${thrQ}`, clientId);
      const items = Array.isArray(list?.items) ? list.items : [];
      setEligible(items);
      setHasSelected(true);
      setPage(1);
      setHasMore(!!list?.hasMore);
      setPhase('READY');
    } catch (e) {
      setError(e?.message || 'Failed to build preview');
      setPhase('IDLE');
    }
  };

  // --- Export actions (lock on demand) ---
  const performLockIfNeeded = async () => {
    if (!inProgress) {
      const eff = getEffectiveThreshold();
      await lockCurrentBatch(eff);
    }
  };

  const copyUrls = async () => {
    if (!hasSelected || phase === 'SELECTING' || phase === 'IDLE') return;
    try {
      setError(null);
      setPhase('EXPORTING');
      
      // Get the current threshold
      const eff = getEffectiveThreshold();
      
      // Directly fetch ALL eligible leads from the new endpoint
      console.log(`DEBUG: Fetching all eligible leads with threshold ${eff}`);
      const allLeads = await apiGet(`/eligible/all?threshold=${eff}`, clientId);
      
      // Extract URLs from the leads
      const urlList = allLeads.map(r => r?.linkedinUrl).filter(u => !!u);
      console.log(`DEBUG: About to copy ${urlList.length} URLs from ${allLeads.length} items from API`);
      
      if (urlList.length === 0) {
        setError(`No LinkedIn URLs found among ${allLeads.length} selected leads.`);
        setPhase(inProgress ? 'AWAITING_CONFIRM' : 'READY');
        return;
      }
      const urls = urlList.join('\n');
      
      // Robust clipboard copy with multiple fallback strategies
      const copyToClipboard = async (text) => {
        // Strategy 1: Request user interaction first to ensure focus
        const ensureFocus = async () => {
          // Force multiple focus attempts
          window.focus();
          document.documentElement.focus();
          if (document.body) document.body.focus();
          
          // Create a temporary interactive element to ensure user interaction context
          const tempInput = document.createElement('input');
          tempInput.style.position = 'fixed';
          tempInput.style.top = '-9999px';
          tempInput.style.left = '-9999px';
          tempInput.style.opacity = '0';
          document.body.appendChild(tempInput);
          
          tempInput.focus();
          tempInput.click();
          
          // Small delay to ensure focus
          await new Promise(resolve => setTimeout(resolve, 50));
          
          document.body.removeChild(tempInput);
        };
        
        // Ensure we have proper focus context
        await ensureFocus();
        
        // Strategy 2: Modern clipboard API with user interaction
        if (navigator?.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(text);
            return { success: true, method: 'modern' };
          } catch (e) {
            console.warn('Modern clipboard failed:', e);
            // Continue to fallback
          }
        }
        
        // Strategy 3: Enhanced textarea fallback with better positioning and focus
        try {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          
          // Better styling for cross-browser compatibility
          Object.assign(textarea.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '1px',
            height: '1px',
            padding: '0',
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
            background: 'transparent',
            fontSize: '16px', // Prevents zoom on iOS
            zIndex: '9999'
          });
          
          document.body.appendChild(textarea);
          
          // Multiple focus and selection attempts
          textarea.focus();
          textarea.select();
          
          // iOS/mobile compatibility
          if (textarea.setSelectionRange) {
            textarea.setSelectionRange(0, textarea.value.length);
          }
          
          // Additional attempt for better mobile support
          if (window.getSelection) {
            const range = document.createRange();
            range.selectNodeContents(textarea);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
          }
          
          const successful = document.execCommand('copy');
          document.body.removeChild(textarea);
          
          if (successful) {
            return { success: true, method: 'legacy' };
          }
          throw new Error('Copy command returned false');
          
        } catch (e) {
          console.error('Enhanced textarea fallback failed:', e);
          throw new Error(`Clipboard access failed: ${e.message}. Please ensure the page has focus and try again, or use Download instead.`);
        }
      };
      
      try {
        const result = await copyToClipboard(urls);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
        console.log(`SUCCESS: Copied ${urlList.length} URLs using ${result.method} method`);
        
        // After successful copy, lock the batch if not already locked
        if (!inProgress) {
          console.log('Locking batch after successful copy...');
          const eff = getEffectiveThreshold();
          await lockCurrentBatch(eff);
        }
        
        setPhase(inProgress ? 'AWAITING_CONFIRM' : 'READY');
      } catch (e) {
        console.error('All clipboard methods failed:', e);
        setError(e.message || 'Copy failed. Try "Download .txt" instead.');
        setPhase('READY');
      }
    } catch (e) {
      setError(`Failed to copy URLs${e?.message ? `: ${e.message}` : ''}`);
      setPhase(inProgress ? 'AWAITING_CONFIRM' : 'READY');
    }
  };

  const downloadTxt = async () => {
    if (!hasSelected || phase === 'SELECTING' || phase === 'IDLE') return;
    try {
      setError(null);
      setPhase('EXPORTING');
      
      // Get the current threshold
      const eff = getEffectiveThreshold();
      
      // Directly fetch ALL eligible leads from the new endpoint
      console.log(`DEBUG: Fetching all eligible leads with threshold ${eff} for download`);
      const allLeads = await apiGet(`/eligible/all?threshold=${eff}`, clientId);
      
      // Extract URLs from the leads
      const urlList = allLeads.map(r => r?.linkedinUrl).filter(u => !!u);
      console.log(`DEBUG: About to download ${urlList.length} URLs from ${allLeads.length} items from API`);
      
      const urls = urlList.join('\n');
      const blob = new Blob([urls], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; 
      // Add date to filename
      const dateStr = new Date().toISOString().split('T')[0];
      a.download = `linkedin-urls-${dateStr}.txt`; 
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      
      // After successful download, lock the batch if not already locked
      if (!inProgress) {
        console.log('Locking batch after successful download...');
        const eff = getEffectiveThreshold();
        await lockCurrentBatch(eff);
      }
      
      setPhase(inProgress ? 'AWAITING_CONFIRM' : 'READY');
    } catch (e) {
      setError('Download failed');
      setPhase('READY');
    }
  };

  // --- Finalize / Reset ---
  const finalizeBatch = async () => {
    if (!inProgress || !(phase === 'AWAITING_CONFIRM' || phase === 'READY')) return;
    setPhase('FINALIZING');
    try {
      const total = selectedCount || eligible.length || 0;
      if (total) setLoadProgress({ loaded: 0, total });
      let current = 0;
      const increment = Math.max(1, Math.ceil((total || 20) / 25));
      const intId = setInterval(() => {
        if (!total) return;
        current += increment;
        if (current >= total * 0.85) current = Math.floor(total * 0.85);
        setLoadProgress(lp => ({ ...lp, loaded: Math.min(current, total) }));
      }, 60);
      await apiPost('/batch/finalize', null, clientId);
      if (total) setLoadProgress({ loaded: total, total });
      clearInterval(intId);
      setEligible([]);
      setHasSelected(false);
      setSelectedCount(0);
      setInProgressFlag(false);
      setPhase('DONE');
      setTimeout(() => setPhase('IDLE'), 1200);
    } catch (e) {
      setError(e?.message || 'Failed to finalize');
      setPhase('AWAITING_CONFIRM');
    }
  };

  const resetBatch = async () => {
    if (!(inProgress || phase === 'AWAITING_CONFIRM' || phase === 'READY' || phase === 'EXPORTING')) return;
    try {
      setPhase('RESETTING');
      const total = selectedCount || eligible.length || 0;
      if (total > 0) setLoadProgress({ loaded: 0, total }); else setLoadProgress({ loaded: 0, total: null });
      // Simulated progressive counter while waiting for API since backend does not stream progress
      let currentLoaded = 0;
      const increment = Math.max(1, Math.ceil((total || 20) / 25));
      const tick = () => {
        currentLoaded += increment;
        if (total) {
          if (currentLoaded >= total * 0.85) currentLoaded = Math.floor(total * 0.85); // pause near end until API completes
          setLoadProgress(lp => ({ ...lp, loaded: Math.min(currentLoaded, total) }));
        }
      };
      const intId = setInterval(tick, 60);
      try {
        await apiPost('/batch/reset', null, clientId);
      } finally {
        clearInterval(intId);
      }
      if (total) setLoadProgress({ loaded: total, total });
      setEligible([]);
      setHasSelected(false);
      setSelectedCount(0);
      setInProgressFlag(false);
      setPhase('IDLE');
    } catch (e) {
      setError(e?.message || 'Failed to reset');
      setPhase(inProgress ? 'READY' : 'IDLE');
    }
  };

  // --- Pagination (preview server-side, locked client-side) ---
  const goPage = async (dir) => {
    if (!hasSelected) return;
    if (inProgress) {
      const maxPage = Math.max(1, Math.ceil(eligible.length / 50));
      let np = page + dir; if (np < 1) np = 1; if (np > maxPage) np = maxPage; setPage(np);
    } else {
      if (phase !== 'READY') return;
      if (dir === -1 && page === 1) return;
      if (dir === 1 && !hasMore) return;
      const np = page + dir; if (np < 1) return; setPage(np);
      try {
        const eff = getEffectiveThreshold();
        const thrQ = Number.isFinite(eff) ? `&threshold=${encodeURIComponent(eff)}` : '';
        const list = await apiGet(`/eligible?page=${np}&pageSize=50${thrQ}`, clientId);
        const items = Array.isArray(list?.items) ? list.items : [];
        setEligible(items);
        setHasMore(!!list?.hasMore);
      } catch (_) {}
    }
  };

  // --- Render ---
  return (
    <div className="space-y-6">
      <div className="bg-white border rounded p-4">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-semibold">Top Scoring Leads</h2>
          <HelpButton area="top_scoring_leads" className="ml-1" title="Help: Top Scoring Leads" />
        </div>
        <p className="text-sm text-gray-600 mb-4">Leads not yet queued in the Linked Helper campaign.</p>
        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm text-gray-700">AI Score threshold</label>
          <input
            type="number"
            className="border rounded px-2 py-1 w-24"
            value={threshold ?? ''}
            onChange={(e) => setThreshold(e.target.value === '' ? null : Number(e.target.value))}
            onBlur={saveThresholdIfChanged}
            disabled={inProgress || phase === 'SELECTING'}
            title={inProgress ? 'Locked batch present – reset to change threshold.' : 'Adjust and blur to save'}
          />
          {inProgress && <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">Locked</span>}
          {!inProgress && savedThreshold !== threshold && threshold !== null && <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300">Unsaved</span>}
          {saving && <span className="text-sm text-gray-600" aria-live="polite">Saving…</span>}
          {!saving && justSaved && <span className="text-sm text-emerald-700" aria-live="polite">Saved ✓</span>}
          {error && <span className="text-sm text-red-600 ml-2">{error}</span>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            className={`px-3 py-2 rounded text-white ${(!inProgress && ['IDLE','READY','DONE'].includes(phase)) ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-gray-300 cursor-not-allowed'}`}
            disabled={inProgress || !['IDLE','READY','DONE'].includes(phase)}
            onClick={onSelectPreview}
            title={inProgress ? 'Batch locked – reset to preview again' : 'Dry-run preview (no Airtable writes). Can re-run to refresh.'}
          >Select Top Scorers</button>
          {hasSelected && <span className="text-sm text-gray-600">Selected: {selectedCount}</span>}
          {inProgress && (
            <>
              {(phase === 'READY' || phase === 'AWAITING_CONFIRM' || phase === 'FINALIZING') && (
                <button
                  className={`px-3 py-2 rounded text-white ${phase === 'FINALIZING' ? 'bg-amber-400 cursor-wait' : 'bg-amber-700 hover:bg-amber-600'}`}
                  onClick={finalizeBatch}
                  disabled={phase === 'FINALIZING'}
                >{phase === 'FINALIZING' ? 'Finalizing…' : 'Confirm Pasted to LH'}</button>
              )}
              {(phase === 'AWAITING_CONFIRM') && (
                <button
                  className={`px-3 py-2 rounded border ${phase === 'FINALIZING' ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-200 text-gray-900 hover:bg-gray-300'}`}
                  onClick={resetBatch}
                  disabled={phase === 'FINALIZING'}
                >Cancel — Reselect</button>
              )}
              {(phase !== 'AWAITING_CONFIRM') && (
                <button className="px-3 py-2 rounded border bg-gray-200 text-gray-900 hover:bg-gray-300" onClick={resetBatch} disabled={phase === 'FINALIZING' || phase === 'RESETTING'}>Reset Batch</button>
              )}
            </>
          )}
        </div>
        {/* Status messages */}
        {(() => {
          if (error) return <div className="mt-2 text-xs text-red-600" role="alert">{error}</div>;
          if (phase === 'SELECTING') return <div className="mt-2 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded px-2 py-1">Preparing preview…</div>;
          if (phase === 'READY' && !inProgress) return <div className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">Preview ready – up to {selectedCount} leads (cap 1000). Copy or Download to lock.</div>;
          if (phase === 'READY' && inProgress) return <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">Locked batch detected ({selectedCount} leads). Copy / Download to re-export, Confirm if already pasted, or Reset to pick a new set.</div>;
          if (phase === 'EXPORTING') return (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-3">
              <span>Locking & building export… {loadProgress.total ? `${loadProgress.loaded}/${loadProgress.total}` : ''}</span>
              {loadProgress.total && (
                <span className="flex-1 h-2 bg-amber-100 rounded overflow-hidden">
                  <span
                    className="h-2 bg-amber-500 block transition-all"
                    style={{ width: `${Math.min(100, Math.round((loadProgress.loaded / loadProgress.total) * 100))}%` }}
                  />
                </span>
              )}
            </div>
          );
          if (phase === 'AWAITING_CONFIRM') return <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{(selectedCount || eligible.length) ? `${selectedCount || eligible.length} exported – ` : ''}Copied/Downloaded. Paste into Linked Helper then Confirm or Cancel.</div>;
          if (phase === 'FINALIZING') return (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-3">
              <span>Finalizing batch… {loadProgress.total ? `${Math.min(loadProgress.loaded, loadProgress.total)}/${loadProgress.total}` : ''}</span>
              {loadProgress.total && (
                <span className="flex-1 h-2 bg-amber-100 rounded overflow-hidden">
                  <span
                    className="h-2 bg-amber-500 block transition-all"
                    style={{ width: `${Math.min(100, Math.round((loadProgress.loaded / loadProgress.total) * 100))}%` }}
                  />
                </span>
              )}
            </div>
          );
          if (phase === 'RESETTING') return (
            <div className="mt-2 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded px-2 py-1 flex items-center gap-3">
              <span>Clearing batch… {loadProgress.total ? `${Math.min(loadProgress.loaded, loadProgress.total)}/${loadProgress.total}` : ''}</span>
              {loadProgress.total && (
                <span className="flex-1 h-2 bg-blue-100 rounded overflow-hidden">
                  <span
                    className="h-2 bg-blue-500 block transition-all"
                    style={{ width: `${Math.min(100, Math.round((loadProgress.loaded / loadProgress.total) * 100))}%` }}
                  />
                </span>
              )}
            </div>
          );
          if (phase === 'DONE') return <div className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">Batch finalized.</div>;
          return null;
        })()}
      </div>

      <div className="bg-white border rounded">
        <div className="p-4 border-b font-medium flex items-center gap-3 flex-wrap">
          <span>Eligible Leads</span>
          <button className="px-3 py-1 border rounded" onClick={copyUrls} disabled={!hasSelected || phase === 'SELECTING' || phase === 'IDLE'}>Copy URLs {copied ? '✓' : ''}</button>
          <button className="px-3 py-1 border rounded" onClick={downloadTxt} disabled={!hasSelected || phase === 'SELECTING' || phase === 'IDLE'}>Download .txt</button>
          <span className="ml-2 text-xs text-gray-500">
            {lastExportAt ? `Last Export: ${new Date(Number(lastExportAt)).toLocaleString()}` : 'Last Export: —'}
          </span>
        </div>
        <div className="p-4">
          {phase === 'IDLE' && <div className="text-gray-500">Click “Select Top Scorers” to start.</div>}
          {phase === 'IDLE' && emptyMessage && <div className="text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2 text-sm mt-2">{emptyMessage}</div>}
          {phase === 'SELECTING' && <div className="text-gray-500">Preparing preview…</div>}
          {hasSelected && eligible.length === 0 && phase !== 'IDLE' && <div className="text-gray-500">No eligible leads at this threshold.</div>}
          {hasSelected && eligible.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-gray-600">
                  <tr>
                    <th className="py-2 pr-4">AI Score</th>
                    <th className="py-2 pr-4">First Name</th>
                    <th className="py-2 pr-4">Last Name</th>
                    <th className="py-2 pr-4">LinkedIn</th>
                    <th className="py-2 pr-4">Scoring Status</th>
                    <th className="py-2 pr-4">Connection</th>
                  </tr>
                </thead>
                <tbody>
                  {(inProgress ? eligible.slice((page-1)*50, (page-1)*50 + 50) : eligible).map(it => (
                    <tr key={it.id} className="border-t">
                      <td className="py-2 pr-4">{it.score ?? ''}</td>
                      <td className="py-2 pr-4">{it.firstName ?? ''}</td>
                      <td className="py-2 pr-4">{it.lastName ?? ''}</td>
                      <td className="py-2 pr-4">{it.linkedinUrl ? <a className="text-blue-600 underline" href={it.linkedinUrl} target="_blank" rel="noreferrer">{it.linkedinUrl}</a> : ''}</td>
                      <td className="py-2 pr-4">{it.scoringStatus ?? ''}</td>
                      <td className="py-2 pr-4">{it.connectionStatus ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between mt-3 text-xs text-gray-600">
                <div>
                  {inProgress ? (
                    <span>Locked batch: page {page} of {Math.max(1, Math.ceil(eligible.length / 50))} ({eligible.length} total)</span>
                  ) : (
                    <span>Preview page {page} {hasMore ? '(more available)' : ''}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={page === 1 || phase === 'SELECTING'} onClick={() => goPage(-1)}>Prev</button>
                  <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={phase === 'SELECTING' || (inProgress ? page >= Math.ceil(eligible.length / 50) : !hasMore)} onClick={() => goPage(1)}>Next</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
