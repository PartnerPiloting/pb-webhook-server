"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import HelpButton from './HelpButton';
import { getCurrentClientId, getCurrentPortalToken, getCurrentDevKey } from "../utils/clientUtils";

// Derive backend origin from NEXT_PUBLIC_API_BASE_URL which may include a path like /api/linkedin
const RAW_API = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://pb-webhook-server.onrender.com/api/linkedin';
let API_ORIGIN = 'https://pb-webhook-server.onrender.com';
try { API_ORIGIN = new URL(RAW_API).origin; } catch (_) {}

function buildClientId() {
  const cached = typeof getCurrentClientId === 'function' ? getCurrentClientId() : null;
  if (cached) return cached;
  try {
    const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    return sp?.get('testClient') || sp?.get('clientId') || null;
  } catch (_) { return null; }
}

function buildUrl(path, cid) {
  let url = `${API_ORIGIN.replace(/\/$/, '')}/api/thanks-for-connecting${path}`;
  if (!cid) {
    try {
      const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const t = sp?.get('testClient') || sp?.get('clientId');
      if (t) url += (path.includes('?') ? '&' : '?') + `testClient=${encodeURIComponent(t)}`;
    } catch (_) {}
  }
  return url;
}

function buildHeaders(cid) {
  const headers = { 'Content-Type': 'application/json', ...(cid ? { 'x-client-id': cid } : {}) };
  const portalToken = getCurrentPortalToken();
  const devKey = getCurrentDevKey();
  if (portalToken) headers['x-portal-token'] = portalToken;
  if (devKey) headers['x-dev-key'] = devKey;
  return headers;
}

async function apiGet(path, cid) {
  const res = await fetch(buildUrl(path, cid), { headers: buildHeaders(cid), cache: 'no-store' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPatch(path, body, cid) {
  const res = await fetch(buildUrl(path, cid), {
    method: 'PATCH',
    headers: buildHeaders(cid),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function connectedAgo(days) {
  if (days === null || days === undefined) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// "All time" sends a very wide window; the backend caps the row count.
const ALL_TIME = 36500;
const WINDOW_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 60, label: 'Last 60 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 12 months' },
  { value: ALL_TIME, label: 'All time' }
];

const STATUS_BADGE = {
  'Messaged': 'bg-emerald-100 text-emerald-800 border-emerald-300',
  'Skipped': 'bg-gray-100 text-gray-600 border-gray-300'
};

// Tint the AI profile score by band so a strong fit pops at a glance (higher = better fit).
function scoreBadgeClass(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'bg-gray-100 text-gray-600 border-gray-300';
  if (n >= 80) return 'bg-emerald-100 text-emerald-800 border-emerald-300';
  if (n >= 50) return 'bg-amber-100 text-amber-800 border-amber-300';
  return 'bg-gray-100 text-gray-600 border-gray-300';
}

function formatScore(score) {
  if (score === null || score === undefined || score === '') return null;
  const n = Number(score);
  return Number.isFinite(n) ? Math.round(n) : String(score);
}

export default function ThanksForConnecting() {
  const clientId = useMemo(() => buildClientId(), []);
  const [view, setView] = useState('outstanding'); // 'outstanding' | 'all'
  const [items, setItems] = useState([]);
  const [outstandingCount, setOutstandingCount] = useState(0);
  const [windowDays, setWindowDays] = useState(null); // null = use client's configured default
  const [sortDir, setSortDir] = useState('oldest'); // 'oldest' | 'newest'
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [undo, setUndo] = useState(null); // { item, prevStatus, timer }

  const load = useCallback(async (which, days) => {
    setLoading(true);
    setError(null);
    try {
      const q = `/worklist?view=${which}` + (days != null ? `&days=${days}` : '');
      const data = await apiGet(q, clientId);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setOutstandingCount(Number(data?.outstandingCount ?? 0));
      setTruncated(!!data?.truncated);
      // Adopt the client's configured default the first time (so the selector reflects it).
      if (days == null && data?.lookbackDays != null) setWindowDays(data.lookbackDays);
    } catch (e) {
      setError(e?.message || 'Failed to load worklist');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(view, windowDays); }, [view, windowDays, load]);

  // Apply a status. In Outstanding view the row leaves the queue (optimistic remove + undo).
  const setStatus = useCallback(async (item, newStatus) => {
    const prevStatus = item.thanksStatus || null;

    // Optimistic UI
    if (view === 'outstanding') {
      setItems(prev => prev.filter(it => it.id !== item.id));
      if (newStatus) setOutstandingCount(c => Math.max(0, c - 1));
    } else {
      setItems(prev => prev.map(it => it.id === item.id ? { ...it, thanksStatus: newStatus } : it));
      // Outstanding = items still with no status. Decrement when one leaves Outstanding,
      // increment when one is reset back to it.
      let delta = 0;
      if (!prevStatus && newStatus) delta = -1;
      else if (prevStatus && !newStatus) delta = 1;
      setOutstandingCount(c => Math.max(0, c + delta));
    }

    // Offer undo
    if (undo?.timer) clearTimeout(undo.timer);
    const timer = setTimeout(() => setUndo(null), 6000);
    setUndo({ item, prevStatus, newStatus, timer });

    try {
      await apiPatch(`/lead/${encodeURIComponent(item.id)}`, { thanksStatus: newStatus }, clientId);
    } catch (e) {
      setError(e?.message || 'Failed to update — refreshing');
      if (undo?.timer) clearTimeout(undo.timer);
      setUndo(null);
      load(view, windowDays);
    }
  }, [view, clientId, undo, load, windowDays]);

  const doUndo = useCallback(async () => {
    if (!undo) return;
    const { item, prevStatus, timer } = undo;
    if (timer) clearTimeout(timer);
    setUndo(null);
    try {
      await apiPatch(`/lead/${encodeURIComponent(item.id)}`, { thanksStatus: prevStatus }, clientId);
    } catch (_) {}
    load(view, windowDays);
  }, [undo, clientId, view, load, windowDays]);

  // Sort in the UI so order is guaranteed regardless of API order or any caching.
  const sortedItems = useMemo(() => {
    const dir = sortDir === 'newest' ? -1 : 1;
    return [...items].sort((a, b) => {
      const ta = a.dateConnected ? new Date(a.dateConnected).getTime() : Infinity;
      const tb = b.dateConnected ? new Date(b.dateConnected).getTime() : Infinity;
      return (ta - tb) * dir;
    });
  }, [items, sortDir]);

  const headlineLine = (it) => {
    const parts = [];
    if (it.headline) parts.push(it.headline);
    else if (it.jobTitle) parts.push(it.jobTitle);
    if (it.company && !(it.headline || '').includes(it.company)) parts.push(it.company);
    return parts.join(' · ');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border rounded p-4">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="font-semibold text-lg">Thanks for Connecting</h2>
          <HelpButton area="thanks_for_connecting" className="ml-1" title="Help: Thanks for Connecting" />
          {outstandingCount > 0 && (
            <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300">
              {outstandingCount} to thank
            </span>
          )}
        </div>
        <p className="text-sm text-gray-600">
          Welcome your recent connections. Click a name to open their LinkedIn profile, send your
          note, then tick <span className="font-medium">Messaged</span> — or <span className="font-medium">Skipped</span> to
          leave it to the automated sequence.
        </p>

        {/* View toggle */}
        <div className="mt-3 flex items-center gap-2">
          <button
            className={`px-3 py-1.5 rounded text-sm border ${view === 'outstanding' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
            onClick={() => setView('outstanding')}
          >Outstanding Only</button>
          <button
            className={`px-3 py-1.5 rounded text-sm border ${view === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
            onClick={() => setView('all')}
          >All recent</button>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Sort
              <select
                className="border rounded px-2 py-1 text-sm text-gray-700"
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value)}
              >
                <option value="oldest">Oldest first</option>
                <option value="newest">Most recent first</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Show
              <select
                className="border rounded px-2 py-1 text-sm text-gray-700"
                value={windowDays ?? 14}
                onChange={(e) => setWindowDays(Number(e.target.value))}
              >
                {(WINDOW_OPTIONS.some(o => o.value === windowDays) || windowDays == null
                  ? WINDOW_OPTIONS
                  : [...WINDOW_OPTIONS, { value: windowDays, label: `Last ${windowDays} days` }]
                      .sort((a, b) => a.value - b.value)
                ).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="bg-white border rounded">
        <div className="p-4">
          {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2" role="alert">{error}</div>}

          {truncated && (
            <div className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Showing the {items.length} most recent — there are older connections beyond this. Narrow the window to see them all.
            </div>
          )}

          {loading && <div className="text-gray-500 py-8 text-center">Loading your recent connections…</div>}

          {!loading && items.length === 0 && (
            <div className="py-12 text-center">
              <div className="text-4xl mb-2">🎉</div>
              <div className="text-gray-800 font-medium">
                {view === 'outstanding' ? "All caught up — nobody waiting to be thanked." : 'No recent connections in this window.'}
              </div>
              <div className="text-gray-500 text-sm mt-1">
                {view === 'outstanding' ? 'New connections will appear here as they come in.' : ''}
              </div>
            </div>
          )}

          {!loading && items.length > 0 && (
            <>
            <div className="flex items-center gap-4 pb-2 mb-1 border-b text-xs font-medium text-gray-400 uppercase tracking-wide">
              <div className="w-24 sm:w-32 shrink-0">Connected</div>
              <div className="flex-1">Lead</div>
              <div className="shrink-0">Action</div>
            </div>
            <ul className="divide-y">
              {sortedItems.map(it => (
                <li key={it.id} className="py-3 flex items-start gap-4">
                  <div className="w-24 sm:w-32 shrink-0">
                    <div className="text-sm text-gray-900">{formatDate(it.dateConnected)}</div>
                    <div className="text-xs text-gray-400">{connectedAgo(it.daysSinceConnected)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {it.linkedinUrl ? (
                        <a className="font-medium text-blue-700 hover:underline" href={it.linkedinUrl} target="_blank" rel="noreferrer">
                          {it.name || it.linkedinUrl}
                        </a>
                      ) : (
                        <span className="font-medium text-gray-900">{it.name || '(no name)'}</span>
                      )}
                      {formatScore(it.aiScore) !== null && (
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${scoreBadgeClass(it.aiScore)}`}
                          title="AI profile score (higher = better fit)"
                        >
                          {formatScore(it.aiScore)}
                        </span>
                      )}
                      {view === 'all' && it.thanksStatus && (
                        <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_BADGE[it.thanksStatus] || 'bg-gray-100 text-gray-600 border-gray-300'}`}>
                          {it.thanksStatus}
                        </span>
                      )}
                    </div>
                    {headlineLine(it) && <div className="text-sm text-gray-600 truncate">{headlineLine(it)}</div>}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {(view === 'outstanding' || it.thanksStatus !== 'Messaged') && (
                      <button
                        className="px-3 py-1.5 rounded text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-600"
                        onClick={() => setStatus(it, 'Messaged')}
                        title="I personally reached out — remove from the queue"
                      >Messaged</button>
                    )}
                    {(view === 'outstanding' || it.thanksStatus !== 'Skipped') && (
                      <button
                        className="px-3 py-1.5 rounded text-sm border bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        onClick={() => setStatus(it, 'Skipped')}
                        title="Skip — leave it to the automated sequence"
                      >Skipped</button>
                    )}
                    {view === 'all' && it.thanksStatus && (
                      <button
                        className="px-2 py-1.5 rounded text-sm text-gray-500 hover:text-gray-800"
                        onClick={() => setStatus(it, null)}
                        title="Move back to Outstanding"
                      >Reset</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            </>
          )}
        </div>
      </div>

      {/* Undo toast */}
      {undo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm rounded-lg shadow-lg px-4 py-2 flex items-center gap-3">
          <span>
            {undo.item.name || 'Lead'} {undo.newStatus ? `marked “${undo.newStatus}”` : 'moved to Outstanding'}
          </span>
          <button className="font-semibold text-blue-300 hover:text-blue-200" onClick={doUndo}>Undo</button>
        </div>
      )}
    </div>
  );
}
