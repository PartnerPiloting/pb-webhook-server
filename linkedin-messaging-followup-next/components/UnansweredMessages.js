"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import HelpButton from './HelpButton';
import { getCurrentClientId, getCurrentPortalToken, getCurrentDevKey } from "../utils/clientUtils";

// Unanswered messages - the people who wrote to you and never got a reply.
//
// Sibling of Thanks for Connecting and deliberately the same rhythm: a short list, worked top
// down, one click to clear a row. The difference is what a row MEANS. TFC is "say hello to
// someone new". This is "you dropped this conversation" - so the message itself is the thing on
// the card, not the person's headline. You cannot judge whether to reply without seeing what
// they actually said.
//
// Replying happens in LinkedIn with /wg, not here. This screen's whole job is deciding WHO, and
// getting out of the way - so the primary action is a link straight into the conversation.

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
  let url = `${API_ORIGIN.replace(/\/$/, '')}/api/unanswered${path}`;
  if (!cid) {
    try {
      const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const t = sp?.get('testClient') || sp?.get('clientId');
      if (t) url += (path.includes('?') ? '&' : '?') + `testClient=${encodeURIComponent(t)}`;
    } catch (_) {}
  }
  return url;
}

function buildHeaders(cid, json = true) {
  const headers = { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(cid ? { 'x-client-id': cid } : {}) };
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
    method: 'PATCH', headers: buildHeaders(cid), body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiUpload(path, file, cid) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(buildUrl(path, cid), { method: 'POST', headers: buildHeaders(cid, false), body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const WINDOWS = [
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 12 months' },
  { value: 36500, label: 'All time' },
];

function waitingFor(iso) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(days)) return '';
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  if (days < 60) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  const y = (days / 365).toFixed(1).replace(/\.0$/, '');
  return `${y} years`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function UnansweredMessages() {
  const clientId = useMemo(() => buildClientId(), []);
  const [items, setItems] = useState([]);
  const [pending, setPending] = useState(0);
  const [windowDays, setWindowDays] = useState(365);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [undo, setUndo] = useState(null);   // { item, timer }
  const [openKey, setOpenKey] = useState(null);
  const [thread, setThread] = useState(null);

  const load = useCallback(async (days) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet(`/worklist?days=${days}`, clientId);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setPending(Number(data?.pending ?? 0));
    } catch (e) {
      setError(e?.message || 'Failed to load');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(windowDays); }, [windowDays, load]);

  // Anything not yet triaged is being judged in the background, so come back for it once. A
  // single retry rather than a poll: the first import is the only time the pending count is
  // large, and a screen that re-fetches forever is worse than one you refresh yourself.
  useEffect(() => {
    if (!pending) return undefined;
    const t = setTimeout(() => load(windowDays), 12000);
    return () => clearTimeout(t);
  }, [pending, windowDays, load]);

  const onUpload = useCallback(async (file) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const r = await apiUpload('/import', file, clientId);
      setNotice(`Imported ${r.messagesInserted} new message${r.messagesInserted === 1 ? '' : 's'} across ${r.threads} conversations (you are "${r.ownerName}").`);
      load(windowDays);
    } catch (e) {
      setError(e?.message || 'Import failed');
    } finally {
      setUploading(false);
    }
  }, [clientId, windowDays, load]);

  // Dismiss = "read it, not replying". Answering someone in LinkedIn clears them by itself on the
  // next import or sweep, because the list is derived rather than a queue - so this button is
  // only for the ones that genuinely need no answer.
  const dismiss = useCallback(async (item) => {
    setItems(prev => prev.filter(it => it.threadKey !== item.threadKey));
    if (undo?.timer) clearTimeout(undo.timer);
    const timer = setTimeout(() => setUndo(null), 6000);
    setUndo({ item, timer });
    try {
      await apiPatch(`/thread/${encodeURIComponent(item.threadKey)}`, { dismissed: true }, clientId);
    } catch (e) {
      setError(e?.message || 'Failed to update - refreshing');
      setUndo(null);
      load(windowDays);
    }
  }, [clientId, undo, load, windowDays]);

  const doUndo = useCallback(async () => {
    if (!undo) return;
    const { item, timer } = undo;
    if (timer) clearTimeout(timer);
    setUndo(null);
    try {
      await apiPatch(`/thread/${encodeURIComponent(item.threadKey)}`, { dismissed: false }, clientId);
    } catch (_) {}
    load(windowDays);
  }, [undo, clientId, load, windowDays]);

  const openThread = useCallback(async (item) => {
    if (openKey === item.threadKey) { setOpenKey(null); setThread(null); return; }
    setOpenKey(item.threadKey);
    setThread(null);
    try {
      const r = await apiGet(`/thread/${encodeURIComponent(item.threadKey)}`, clientId);
      setThread(Array.isArray(r?.messages) ? r.messages : []);
    } catch (_) {
      setThread([]);
    }
  }, [openKey, clientId]);

  // Sensitive first (they need a person, not a draft), then longest waiting. Everything still
  // being judged sits at the bottom so it never displaces something we know is owed.
  const sorted = useMemo(() => {
    const rank = (t) => (t.verdict === 'reply-sensitive' ? 0 : t.verdict === 'reply' ? 1 : 2);
    return [...items].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return new Date(a.lastAt).getTime() - new Date(b.lastAt).getTime();
    });
  }, [items]);

  const owed = sorted.filter(t => t.verdict && t.verdict.startsWith('reply')).length;

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-semibold">Unanswered messages</h1>
        <HelpButton helpArea="unanswered-messages" />
      </div>
      <p className="text-sm text-gray-600 mb-4">
        People who wrote to you and never got a reply. Open the conversation in LinkedIn and answer
        it there with /wg - once you have, they drop off this list on their own.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          className="border rounded px-2 py-1 text-sm"
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value))}
        >
          {WINDOWS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
        </select>

        <span className="text-sm text-gray-700">
          <strong>{owed}</strong> to answer
          {pending ? <span className="text-gray-500"> · {pending} still being checked</span> : null}
        </span>

        <label className="ml-auto text-sm">
          <span className="px-3 py-1 border rounded cursor-pointer hover:bg-gray-50">
            {uploading ? 'Importing...' : 'Import LinkedIn messages'}
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={uploading}
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
        </label>
      </div>

      {notice && <div className="mb-3 p-2 text-sm bg-emerald-50 border border-emerald-200 rounded">{notice}</div>}
      {error && <div className="mb-3 p-2 text-sm bg-red-50 border border-red-200 rounded">{error}</div>}

      {undo && (
        <div className="mb-3 p-2 text-sm bg-gray-50 border rounded flex items-center justify-between">
          <span>Dismissed {undo.item.name || 'conversation'}.</span>
          <button className="underline" onClick={doUndo}>Undo</button>
        </div>
      )}

      {loading && <div className="text-sm text-gray-500">Loading...</div>}

      {!loading && !sorted.length && (
        <div className="p-6 border rounded text-sm text-gray-600">
          Nothing outstanding. If you have not imported your LinkedIn messages yet, download them
          from LinkedIn (Settings, then Get a copy of your data) and use Import above - it only
          needs doing once.
        </div>
      )}

      <ul className="space-y-3">
        {sorted.map((t) => (
          <li key={t.threadKey} className="border rounded p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{t.name || 'Unknown'}</span>
                  <span className="text-xs text-gray-500">waiting {waitingFor(t.lastAt)}</span>
                  {t.verdict === 'reply-sensitive' && (
                    <span className="text-xs px-2 py-0.5 rounded border bg-amber-100 text-amber-800 border-amber-300">
                      write this one yourself
                    </span>
                  )}
                  {!t.verdict && (
                    <span className="text-xs px-2 py-0.5 rounded border bg-gray-100 text-gray-600 border-gray-300">
                      checking
                    </span>
                  )}
                </div>
                {t.verdictReason && <div className="text-xs text-gray-500 mt-0.5">{t.verdictReason}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {t.linkedinUrl && (
                  <a
                    className="text-sm px-3 py-1 border rounded hover:bg-gray-50"
                    href={t.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in LinkedIn
                  </a>
                )}
                <button className="text-sm px-3 py-1 border rounded hover:bg-gray-50" onClick={() => dismiss(t)}>
                  Not replying
                </button>
              </div>
            </div>

            {/* The message itself is the evidence. You cannot judge a row without it. */}
            <blockquote className="mt-2 text-sm text-gray-800 bg-gray-50 border-l-2 border-gray-300 pl-3 py-1 whitespace-pre-wrap">
              {t.lastText}
            </blockquote>
            <div className="mt-1 text-xs text-gray-500">
              {formatDate(t.lastAt)} · {t.messageCount} message{t.messageCount === 1 ? '' : 's'} in this conversation
              {t.messageCount > 1 && (
                <button className="ml-2 underline" onClick={() => openThread(t)}>
                  {openKey === t.threadKey ? 'hide' : 'show the exchange'}
                </button>
              )}
            </div>

            {openKey === t.threadKey && (
              <div className="mt-2 border-t pt-2 space-y-2">
                {thread === null && <div className="text-xs text-gray-500">Loading...</div>}
                {thread?.map((m, i) => (
                  <div key={i} className={m.outbound ? 'text-sm text-gray-600' : 'text-sm text-gray-900'}>
                    <span className="text-xs text-gray-500">
                      {m.outbound ? 'You' : (m.senderName || 'Them')} · {formatDate(m.sentAt)}
                    </span>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
