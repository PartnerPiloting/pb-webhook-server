"use client";
// Reconnect on the coach's board (docs/RECONNECT-BUILD-PLAN.md, "The client process").
//
// Two jobs, both the coach's side of the process:
//   1. Get the "connect your LinkedIn" link for a client. Connecting is done under the coach's
//      direction - a link THEY send at the moment they choose, never a button the client can press.
//   2. See where each connected client is up to: waiting for history, ready for a session,
//      collecting older history, complete - with their connection count, and a flag for anyone
//      close to LinkedIn's 30,000 limit (the only clients worth offering disconnects to).
// Everything shown is worked out by the server (services/linkedinCollect.js + clientBoardService).

import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { getBackendBase, getAuthenticatedHeaders } from '../services/api';

const STATE = {
  waiting: { label: 'Waiting for history', cls: 'bg-gray-100 text-gray-700' },
  ready: { label: 'Ready for a session', cls: 'bg-emerald-100 text-emerald-800' },
  collecting: { label: 'Collecting older history', cls: 'bg-sky-100 text-sky-800' },
  complete: { label: 'History complete', cls: 'bg-indigo-100 text-indigo-800' },
  stalled: { label: 'Stalled - nothing arrived', cls: 'bg-red-100 text-red-700' },
};
const num = (n) => Number(n || 0).toLocaleString('en-AU');
const day = (v) => (v ? String(v).slice(0, 10) : '-');

export default function ReconnectBoardPanel({ clients = [] }) {
  const [rows, setRows] = useState(null);
  const [pick, setPick] = useState('');
  const [link, setLink] = useState(null);      // { clientId, url, expiresAt }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${getBackendBase()}/api/client-board/reconnect/status`, { timeout: 30000, headers: getAuthenticatedHeaders() });
      setRows((r.data && r.data.clients) || []);
    } catch (_) {
      setRows([]); // optional panel - a failed load must never break the board
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const getLink = async () => {
    if (!pick) return;
    setBusy(true); setError(null); setLink(null); setCopied(false);
    try {
      const r = await axios.post(`${getBackendBase()}/api/client-board/${encodeURIComponent(pick)}/linkedin-link`, {}, { timeout: 30000, headers: getAuthenticatedHeaders() });
      if (r.data && r.data.url) setLink({ clientId: pick, url: r.data.url, expiresAt: r.data.expiresAt });
      else setError('No link came back.');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not get a link.');
    } finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link.url); setCopied(true); } catch (_) { setError('Could not copy - select the link and copy it by hand.'); }
  };

  const connected = new Set((rows || []).map((r) => r.clientId));

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Reconnect</h2>
        <p className="text-[13px] text-gray-500">Waking up the people a client already knows on LinkedIn</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="text-gray-700">LinkedIn connect link for</span>
        <select className="border border-gray-300 rounded px-2 py-1 text-sm" value={pick} onChange={(e) => { setPick(e.target.value); setLink(null); }}>
          <option value="">choose a client</option>
          {clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.clientName}{connected.has(c.clientId) ? ' (already connected)' : ''}</option>)}
        </select>
        <button className="px-3 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50" disabled={!pick || busy} onClick={getLink}>
          {busy ? 'Getting it…' : 'Get link'}
        </button>
        <span className="text-[13px] text-gray-500">Send it a day or two before their session. It lasts 24 hours.</span>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {link && (
        <div className="flex items-center gap-2 flex-wrap text-sm bg-gray-50 border border-gray-200 rounded p-2">
          <input readOnly className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1 text-xs font-mono" value={link.url} onFocus={(e) => e.target.select()} />
          <button className="px-3 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[13px] text-gray-500 border-b">
                <th className="py-1 pr-3 font-medium">Client</th>
                <th className="py-1 pr-3 font-medium">Where they are up to</th>
                <th className="py-1 pr-3 font-medium">Connections</th>
                <th className="py-1 pr-3 font-medium">Conversations</th>
                <th className="py-1 pr-3 font-medium">History back to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = STATE[r.state] || STATE.waiting;
                return (
                  <tr key={r.clientId} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-medium text-gray-900">{r.clientName}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${st.cls}`}>{st.label}</span>
                      {r.reconnectOn && <span className="ml-2 text-xs text-emerald-700">list is on</span>}
                      {r.lastError && <span className="ml-2 text-xs text-red-600" title={r.lastError}>last collect failed</span>}
                    </td>
                    <td className="py-1.5 pr-3">
                      {num(r.connections)}
                      {r.nearLimit && <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800" title="LinkedIn stops at 30,000 connections - worth offering disconnects">near the limit</span>}
                    </td>
                    <td className="py-1.5 pr-3">{num(r.conversations)}</td>
                    <td className="py-1.5 pr-3">{day(r.oldestMsgAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length === 0 && <p className="text-sm text-gray-500">Nobody has connected their LinkedIn yet.</p>}
    </section>
  );
}
