"use client";
import React, { useEffect, useMemo, useState } from 'react';
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
  const [threshold, setThreshold] = useState(null);
  const [eligible, setEligible] = useState([]);
  const [hasSelected, setHasSelected] = useState(false);
  const [inProgress, setInProgress] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  // Advanced panel removed for simplicity
  const [savedThreshold, setSavedThreshold] = useState(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [totalEligible, setTotalEligible] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  // Local dismissal for the stale Last Export banner
  const [hideStaleExportWarning, setHideStaleExportWarning] = useState(false);
  const [batchSize, setBatchSize] = useState(() => {
    try {
      const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const raw = sp?.get('batchSize') ?? sp?.get('batchsize');
      const n = raw ? Number(raw) : NaN;
      if (!Number.isNaN(n) && n > 0) return Math.min(n, 200);
    } catch (_) {}
    return 50;
  });
  const batchCapActive = useMemo(() => {
    try {
      const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  return !!(sp?.get('batchSize') || sp?.get('batchsize'));
    } catch (_) {
      return false;
    }
  }, []);
  const [showParamHelp, setShowParamHelp] = useState(false);

  // Threshold save feedback
  const [justSaved, setJustSaved] = useState(false);

  // Prefer in-memory threshold when querying; fall back to saved
  const getEffectiveThreshold = () => {
    const t = Number(threshold);
    if (Number.isFinite(t)) return t;
    const s = Number(savedThreshold);
    return Number.isFinite(s) ? s : null;
  };

  // Debounced auto-save on threshold change
  useEffect(() => {
    const t = Number(threshold);
    if (inProgress) return; // don't auto-save while a batch is locked
    if (!Number.isFinite(t)) return; // nothing to save
    if (savedThreshold === t) return; // no change
    const handle = setTimeout(() => {
      saveThresholdIfChanged();
    }, 600);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, inProgress]);

  // Advanced panel removed; keep code streamlined for operators

  const clientId = useMemo(() => buildClientId(), []);

  // Track last copy/download time (persisted locally per client)
  const [lastExportAt, setLastExportAt] = useState(null);
  const [exportAckTs, setExportAckTs] = useState(null);
  useEffect(() => {
    try {
      const key = `tsl_last_export_${clientId || 'unknown'}`;
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
      if (raw) setLastExportAt(Number(raw));
      const ackKey = `tsl_export_ack_${clientId || 'unknown'}`;
      const ackRaw = typeof window !== 'undefined' ? window.localStorage.getItem(ackKey) : null;
      if (ackRaw) setExportAckTs(Number(ackRaw));
  const ipKey = `tsl_in_progress_${clientId || 'unknown'}`;
  const ipRaw = typeof window !== 'undefined' ? window.localStorage.getItem(ipKey) : null;
  if (ipRaw === '1') setInProgress(true);
    } catch (_) {}
    // Best-effort: also load from server (Credentials)
    (async () => {
      try {
        const res = await apiGet('/export/last', clientId);
        if (res && typeof res.at === 'number' && !Number.isNaN(res.at)) {
          setLastExportAt(res.at);
          const key = `tsl_last_export_${clientId || 'unknown'}`;
          if (typeof window !== 'undefined') window.localStorage.setItem(key, String(res.at));
        }
      } catch (_) {
        // ignore if field not present
      }
      // New: check server for any locked batch to source truth from backend, not local storage
      try {
        const currentPeek = await apiGet('/batch/current?limit=1', clientId);
        const anyLocked = Array.isArray(currentPeek?.items) && currentPeek.items.length > 0;
        if (anyLocked) {
          setInProgressFlag(true);
          await loadLockedBatch();
        } else {
          setInProgressFlag(false);
        }
      } catch (_) {
        // non-fatal; keep local state
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  const markExportNow = () => {
    try {
      const ts = Date.now();
      setLastExportAt(ts);
      const key = `tsl_last_export_${clientId || 'unknown'}`;
      if (typeof window !== 'undefined') window.localStorage.setItem(key, String(ts));
      // New export invalidates any prior acknowledgment
      const ackKey = `tsl_export_ack_${clientId || 'unknown'}`;
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(ackKey);
      }
      setExportAckTs(null);
      // Persist to Airtable at export time for team visibility
      apiPut('/export/last', { at: ts }, clientId).catch(() => {});
    } catch (_) {}
  };

  const setInProgressFlag = (value) => {
    setInProgress(value);
    try {
      const ipKey = `tsl_in_progress_${clientId || 'unknown'}`;
      if (typeof window !== 'undefined') {
        if (value) window.localStorage.setItem(ipKey, '1');
        else window.localStorage.removeItem(ipKey);
      }
    } catch (_) {}
  };

  // Load the currently locked batch (read-only) if an export is in progress
  const loadLockedBatch = async () => {
    try {
      setLoading(true);
      setError(null);
      const current = await apiGet('/batch/current?all=1', clientId);
      const items = Array.isArray(current?.items) ? current.items : [];
      setEligible(items);
      setHasSelected(true);
      setSelectedCount(items.length);
  setTotalEligible(items.length);
      setHasMore(false);
      setPage(1);
    } catch (e) {
      setError(e?.message || 'Failed to load locked batch');
    } finally {
      setLoading(false);
    }
  };

  async function lockCurrentPreview() {
    // Replace exactly N: reset then select N when capped; select-all otherwise
    if (inProgress) return; // don't re-lock while already in progress
    const capped = (batchCapActive && Number.isFinite(Number(batchSize)) && Number(batchSize) > 0);
    if (capped) {
      const n = Math.min(500, Math.max(1, Math.floor(Number(batchSize))));
      // Always force replace mode when locking a batch
      await apiPost(`/batch/select?all=1&pageSize=${n}&replace=1`, null, clientId);
    } else {
      await apiPost('/batch/select?all=1', null, clientId);
    }
    setInProgressFlag(true);
    // Refresh from server so Selected reflects actual locked count and grid shows locked rows
    await loadLockedBatch();
  }

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const t = await apiGet('/threshold', clientId);
        if (!mounted) return;
        setThreshold(t.value ?? null);
        setSavedThreshold(t.value ?? null);
        // Do not fetch eligible until user clicks Select
      } catch (e) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [clientId, batchSize]);

  // When we detect an in-progress export (e.g., after reload), show the locked batch
  useEffect(() => {
    if (inProgress) {
      loadLockedBatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inProgress, clientId]);

  const saveThresholdIfChanged = async () => {
    if (inProgress) return;
    if (threshold === null || Number.isNaN(Number(threshold))) return;
    if (savedThreshold === threshold) return;
    try {
      setLoading(true);
      setError(null);
  await apiPut('/threshold', { value: Number(threshold) }, clientId);
      setSavedThreshold(threshold);
  setJustSaved(true);
  setTimeout(() => setJustSaved(false), 1500);
  // If a preview has been selected, recompute count and refresh first page (preview-only)
      if (hasSelected) {
        setPage(1);
        try {
          const eff = getEffectiveThreshold();
          const thr = Number.isFinite(eff) ? `?threshold=${encodeURIComponent(eff)}` : '';
          const cnt = await apiGet(`/eligible/count${thr}`, clientId);
          const total = Number(cnt?.total ?? 0);
          setTotalEligible(total);
          const cappedTotal = batchCapActive ? Math.min(Number(batchSize), total) : total;
          setSelectedCount(cappedTotal);
        } catch (_) {}
        await refreshEligible({ preserveSelectedCount: true, page: 1 });
      }
    } catch (e) {
      setError(e?.message || 'Failed to save threshold');
    } finally {
      setLoading(false);
    }
  };

  const onCopyUrls = async () => {
    try {
      // Build from current preview immediately to preserve user gesture for clipboard write
      const urls = (eligible || []).map((it) => it?.linkedinUrl).filter(Boolean).join('\n');
      // Prefer execCommand path to avoid permission prompt; fall back to modern API
      let copiedOk = false;
      try {
        const ta = document.createElement('textarea');
        ta.value = urls;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        copiedOk = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) {
        // ignore; try modern API below
      }
      if (!copiedOk && navigator?.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(urls);
          copiedOk = true;
        } catch (_) {
          // still not ok
        }
      }
      if (!copiedOk) throw new Error('clipboard');

      setCopied(true);
      setTimeout(() => setCopied(false), 1500);

      // Lock records and timestamp after copying (async; skip if already in progress)
      if (!inProgress) {
        lockCurrentPreview().then(() => { try { markExportNow(); } catch(_) {} }).catch(() => {});
      }
    } catch (e) {
      setError('Failed to copy URLs');
    }
  };

  const onDownloadTxt = () => {
    try {
      // Build from current preview immediately for a snappy download
      const urls = (eligible || []).map((it) => it?.linkedinUrl).filter(Boolean).join('\n');
      const blob = new Blob([urls], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'eligible-linkedin-urls.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      // Lock and timestamp after download is triggered (skip if already in progress)
      if (!inProgress) {
        lockCurrentPreview().then(() => markExportNow()).catch(() => {});
      }
    }
  };

  const refreshEligible = async (options = {}) => {
    const { preserveSelectedCount = true, page: pageOverride } = options;
    try {
  const p = pageOverride ?? page;
  const eff = getEffectiveThreshold();
  const thr = Number.isFinite(eff) ? `&threshold=${encodeURIComponent(eff)}` : '';
  const list = await apiGet(`/eligible?page=${p}&pageSize=${batchSize}${thr}`, clientId);
      const items = list.items || [];
      setEligible(items);
      setHasMore(!!list.hasMore);
      if (!preserveSelectedCount) {
        if (totalEligible !== null && totalEligible !== undefined) {
          const cappedTotal = batchCapActive ? Math.min(Number(batchSize), Number(totalEligible)) : Number(totalEligible);
          setSelectedCount(cappedTotal);
        } else {
          setSelectedCount(items.length);
        }
      }
      return items;
    } catch (e) {
  setError(e?.message || 'Failed to load eligible list');
      return [];
    }
  };

  const onSelectCurrentBatch = async () => {
    if (inProgress || loading) return; // ignore while export is in progress
    try {
      setLoading(true);
      setError(null);
  // Compute total eligible first so Selected reflects the full batch size
  try {
    const eff = getEffectiveThreshold();
    const thr = Number.isFinite(eff) ? `?threshold=${encodeURIComponent(eff)}` : '';
    const cnt = await apiGet(`/eligible/count${thr}`, clientId);
    const total = Number(cnt?.total ?? 0);
    setTotalEligible(total);
    const cappedTotal = batchCapActive ? Math.min(Number(batchSize), total) : total;
    setSelectedCount(cappedTotal);
  } catch (_) {}
  // Preview only: fetch page 1 but preserve the Selected total
  setPage(1);
  await refreshEligible({ preserveSelectedCount: true, page: 1 });
      setHasSelected(true);
    } catch (e) {
      setError(e?.message || 'Failed to select batch');
    } finally {
      setLoading(false);
    }
  };

  const onFinalizeBatch = async (doDryRun = true) => {
    try {
      setLoading(true);
      setError(null);
    const path = `/batch/finalize`;
      // Use staged records on the server; payload optional
      const res = await apiPost(path, null, clientId);
      // After real finalize, clear preview and in-progress; Last Export remains the export time
      if (!doDryRun) {
        setEligible([]);
        setHasSelected(false);
  setSelectedCount(0);
        setInProgressFlag(false);
  // Hide the stale export warning once action is confirmed
  setHideStaleExportWarning(true);
        // Acknowledge the last export timestamp so the stale banner doesn't reappear after reload
        try {
          if (lastExportAt) {
            const ackKey = `tsl_export_ack_${clientId || 'unknown'}`;
            if (typeof window !== 'undefined') window.localStorage.setItem(ackKey, String(lastExportAt));
            setExportAckTs(Number(lastExportAt));
          }
        } catch (_) {}
      }
    } catch (e) {
      setError(e?.message || 'Failed to finalize batch');
    } finally {
      setLoading(false);
    }
  };

  const onResetExport = async (doDryRun = false) => {
    try {
      setLoading(true);
      setError(null);
    const path = `/batch/reset`;
      const res = await apiPost(path, null, clientId);
      if (!doDryRun) {
        setEligible([]);
        setHasSelected(false);
  setSelectedCount(0);
        setInProgressFlag(false);
  // Hide the stale export warning once action is confirmed
  setHideStaleExportWarning(true);
        // Acknowledge the last export timestamp so the stale banner doesn't reappear after reload
        try {
          if (lastExportAt) {
            const ackKey = `tsl_export_ack_${clientId || 'unknown'}`;
            if (typeof window !== 'undefined') window.localStorage.setItem(ackKey, String(lastExportAt));
            setExportAckTs(Number(lastExportAt));
          }
        } catch (_) {}
      }
    } catch (e) {
      setError(e?.message || 'Failed to reset export');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded p-4">
  <h2 className="font-semibold mb-2" title="Send Connection Requests to">Top Scoring Leads</h2>
  <p className="text-sm text-gray-600 mb-4">Leads not yet queued in the Linked Helper connection request and messaging campaign.</p>
        <div className="text-xs text-gray-600 mb-2 flex items-center gap-3 flex-wrap">
          {batchCapActive && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200" title="URL cap active; Copy/Confirm limited to this count">
              Cap: {batchSize}
            </span>
          )}
          <button className="underline" onClick={() => setShowParamHelp(v => !v)} aria-expanded={showParamHelp}>
            URL params
          </button>
          {showParamHelp && (
            <span className="text-gray-700">
              batchSize=N caps preview and real writes to N. testClient=ID (or clientId=ID) scopes to a tenant.
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <label className="text-sm text-gray-700">AI Score threshold</label>
          <input
            type="number"
            className="border rounded px-2 py-1 w-24"
            value={threshold ?? ''}
            onChange={(e) => setThreshold(e.target.value === '' ? null : Number(e.target.value))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
            onBlur={saveThresholdIfChanged}
            disabled={loading || inProgress}
            aria-disabled={loading || inProgress}
            title={inProgress ? 'Export in progress — threshold is locked until you Confirm or Cancel.' : undefined}
          />
          {justSaved && (
            <span className="text-sm text-emerald-700" aria-live="polite">Saved ✓</span>
          )}
          {error && <span className="text-sm text-red-600 ml-2">{error}</span>}
        </div>
    {/* Simplified: no server batch shown; we only hint based on last export time below */}
        <div className="mt-3 flex items-center gap-2">
          <button
            className="px-3 py-2 bg-emerald-700 text-white rounded"
  onClick={() => onSelectCurrentBatch()}
  disabled={loading || inProgress}
      title={`Fetch leads with an AI Score ≥ ${threshold ?? savedThreshold ?? 'current threshold'} that have not already been sent to Linked Helper. This is a preview only; Airtable isn't updated until you click Mark Copied.`}
            aria-label="Select Top Scorers"
          >
            Select Top Scorers
          </button>
          {hasSelected && (
            <span className="text-sm text-gray-600" title="Number of leads currently in the preview">
              Selected: {selectedCount}
            </span>
          )}
          {inProgress && (
            <>
              <button
                className="px-3 py-2 bg-amber-700 text-white rounded"
                onClick={() => onFinalizeBatch(false)}
                disabled={loading}
                title="Confirm you pasted these into Linked Helper and clear the batch."
                aria-label="Confirm Pasted to LH"
              >
                Confirm Pasted to LH
              </button>
              <button
                className="px-3 py-2 bg-gray-200 text-gray-900 rounded border"
                onClick={() => onResetExport(false)}
                disabled={loading}
                title="Cancel this batch and reselect a new one."
                aria-label="Cancel — Reselect"
              >
                Cancel — Reselect
              </button>
            </>
          )}
        </div>
    {inProgress && (
          <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 max-w-prose">
      Export in progress - Select is disabled until you "Confirm Pasted to LH" OR "Cancel - Reselect"
          </div>
        )}
  {/* No pre-selection gating: if no live batch, keep Select available and only show informational Last Export in the header */}

  {/* Red stale-export warning intentionally removed per UX: keep preview neutral; actions only during in-progress */}

  {/* Advanced/Debug panel removed */}
      </div>

      <div className="bg-white border rounded">
        <div className="p-4 border-b font-medium flex items-center gap-3 flex-wrap">
          <span>Eligible Leads</span>
          <button className="px-3 py-1 border rounded" onClick={onCopyUrls} disabled={!hasSelected || !eligible?.length}>Copy URLs {copied ? '✓' : ''}</button>
          <button className="px-3 py-1 border rounded" onClick={onDownloadTxt} disabled={!hasSelected || !eligible?.length}>Download .txt</button>
          <span className="ml-2 text-xs text-gray-500">
            {(() => {
              if (!lastExportAt) return 'Last Export: —';
              const ageMs = Date.now() - Number(lastExportAt);
              const olderThanDay = ageMs > 24 * 60 * 60 * 1000;
              const ts = new Date(Number(lastExportAt)).toLocaleString();
              return (
                <span>
                  Last Export: {ts}
                  {olderThanDay && (
                    <span
                      className="ml-1 inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-700"
                      title="Last Export is over a day old"
                    >
                      24h+
                    </span>
                  )}
                </span>
              );
            })()}
          </span>
        </div>
        <div className="p-4">
          {loading && <div>Loading…</div>}
          {!loading && !hasSelected && (
            <div className="text-gray-500">Click “Select Top Scorers” to fetch a preview.</div>
          )}
          {!loading && hasSelected && eligible.length === 0 && (
            <div className="text-gray-500">No eligible leads at the current threshold.</div>
          )}
          {!loading && hasSelected && eligible.length > 0 && (
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
                  {eligible.map((it) => (
                    <tr key={it.id} className="border-t">
                      <td className="py-2 pr-4">{it.score ?? ''}</td>
                      <td className="py-2 pr-4">{it.firstName ?? ''}</td>
                      <td className="py-2 pr-4">{it.lastName ?? ''}</td>
                      <td className="py-2 pr-4">
                        {it.linkedinUrl ? (
                          <a className="text-blue-600 underline" href={it.linkedinUrl} target="_blank" rel="noreferrer">{it.linkedinUrl}</a>
                        ) : ''}
                      </td>
                      <td className="py-2 pr-4">{it.scoringStatus ?? ''}</td>
                      <td className="py-2 pr-4">{it.connectionStatus ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between mt-3 text-sm">
                <button
                  className="px-2 py-1 border rounded"
                  onClick={() => { if (page > 1) { const np = page - 1; setPage(np); refreshEligible({ page: np }); } }}
                  disabled={page <= 1 || loading}
                  title="Previous page"
                >
                  ‹ Prev
                </button>
                <span>Page {page}</span>
                <button
                  className="px-2 py-1 border rounded"
                  onClick={() => { if (hasMore) { const np = page + 1; setPage(np); refreshEligible({ page: np }); } }}
                  disabled={!hasMore || loading}
                  title="Next page"
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
