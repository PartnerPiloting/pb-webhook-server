"use client";
// The Potential disconnects section of the Follow-Ups screen (docs/RECONNECT-BUILD-PLAN.md, brick 5).
//
// Connections the client may not want to keep: the ones they flagged from the Reconnect list, and
// the ones the system suggests because the conversation read as a decline or as their pitch.
// services/reconnectDisconnects.js decides who is listed - this file renders and sends clicks.
//
// NOTHING HERE REMOVES ANYONE FROM LINKEDIN. Approve records the decision; the approved people
// then sit in a short list of profile links for the client to act on.

import React, { useCallback, useEffect, useState } from 'react';

const BTN = 'px-3 py-1.5 rounded text-sm border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:opacity-50';
const TAG_CLS = { 'You flagged': 'bg-indigo-100 text-indigo-800', Declined: 'bg-red-100 text-red-700', 'Their pitch': 'bg-amber-100 text-amber-800' };

export default function DisconnectSection({ get, post, refreshKey }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await get('/disconnects');
      setData(d && d.enabled ? d : null);
    } catch (_) {
      setData(null); // the section is optional - a failed load must never break the screen
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (!data) return null;
  const pending = data.pending || [];
  const approved = data.approved || [];
  if (!pending.length && !approved.length) return null;

  const toggle = (key) => setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const chosen = pending.filter((p) => selected.has(p.key));

  const run = async (action, keys, done) => {
    setError(null);
    setBusy(true);
    try {
      await post('/disconnect-action', { action, keys });
      setSelected(new Set());
      setNotice(done);
      await load();
    } catch (_) {
      setError('That did not save. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const approve = () => {
    if (!chosen.length) return;
    const ok = window.confirm(
      `Approve ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'} for removal?\n\n` +
      'Nothing is removed from LinkedIn by this - they move to your approved list.\n' +
      'Removing a connection also deletes any endorsements and recommendations between you, for good.'
    );
    if (ok) run('approve', chosen.map((p) => p.key), `${chosen.length} approved for removal.`);
  };

  const copyLinks = async () => {
    const text = approved.map((p) => p.linkedin).filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); setNotice(`${approved.length} profile links copied.`); } catch (_) { setError('Could not copy - select the names and copy them by hand.'); }
  };

  const markRemoved = () => {
    if (window.confirm(`Have you removed all ${approved.length} from LinkedIn? This clears the approved list.`)) run('removed', [], 'Approved list cleared.');
  };

  return (
    <div className="bg-white border rounded p-4">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h2 className="font-semibold text-lg">Potential disconnects</h2>
        {pending.length > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
            {pending.length} to review
          </span>
        )}
        {approved.length > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 border border-gray-300">
            {approved.length} approved, not yet removed
          </span>
        )}
        {pending.length > 0 && (
          <button className="text-sm text-blue-700 hover:underline ml-1" onClick={() => setOpen((o) => !o)}>{open ? 'Hide ▴' : 'Show ▾'}</button>
        )}
      </div>
      <p className="text-sm text-gray-600 mb-3">
        Connections you may not want to keep - the ones you flagged, and ones whose conversation read as a no or as them
        selling to you. Tick the ones to go and approve them together. Nothing is removed until you approve, and nobody you
        connected with in the last year is ever suggested.
      </p>
      {notice && <div className="text-sm text-emerald-700 mb-2">{notice}</div>}
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}

      {approved.length > 0 && (
        <div className="border rounded p-3 mb-3 bg-gray-50">
          <div className="text-sm text-gray-800 mb-2">
            <span className="font-medium">{approved.length} approved for removal.</span> Remove them on LinkedIn, or paste the
            links into Linked Helper, then clear the list.
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button className={BTN} disabled={busy} onClick={copyLinks}>Copy profile links</button>
            <button className={BTN} disabled={busy} onClick={markRemoved}>I have removed these</button>
          </div>
        </div>
      )}

      {open && pending.length > 0 && (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <button className={BTN} disabled={busy} onClick={() => setSelected(new Set(pending.map((p) => p.key)))}>Select all</button>
            <button className={BTN} disabled={busy} onClick={() => setSelected(new Set())}>Select none</button>
            <button className={`${BTN} text-red-700 border-red-200 hover:bg-red-50`} disabled={busy || !chosen.length} onClick={approve}>
              Approve {chosen.length || ''} for removal
            </button>
            <button className={BTN} disabled={busy || !chosen.length} onClick={() => run('keep', chosen.map((p) => p.key), `${chosen.length} kept - they will not be suggested again.`)}>
              Keep {chosen.length || ''}
            </button>
          </div>
          <ul className="divide-y">
            {pending.map((p) => (
              <li key={p.key} className="py-2 flex items-start gap-3">
                <input type="checkbox" className="mt-1" checked={selected.has(p.key)} onChange={() => toggle(p.key)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${TAG_CLS[p.tag] || 'bg-gray-100 text-gray-600'}`}>{p.tag}</span>
                    {p.linkedin ? (
                      <a href={p.linkedin} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline">{p.name}</a>
                    ) : (
                      <span className="font-semibold">{p.name}</span>
                    )}
                    {p.connectedOn && <span className="text-xs text-gray-500">connected {p.connectedOn}</span>}
                  </div>
                  {p.headline && <div className="text-xs text-gray-500 truncate">{p.headline}</div>}
                  {p.why && <div className="text-sm text-gray-800">{p.why}</div>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
