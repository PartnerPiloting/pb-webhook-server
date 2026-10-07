"use client";

/**
 * "Your meeting recorder" - self-service for the client's Fathom API key (Guy, 7 Oct 2026).
 * Same door as ClaudeKeySection: one paste box for first key and replacement, the stored key is
 * never shown (masked tail only), and every pasted key is tested against Fathom server-side BEFORE
 * it is stored. The reply is proof - the client's own newest recording - not just "saved".
 *
 * The steps to find the key in Fathom are on the page itself (open until a key is on file), so a
 * client never has to ask how.
 *
 * `authHeaders(extra?)` must be a STABLE callback (useCallback) - it is an effect dependency.
 */

import React, { useState, useEffect } from 'react';
import { getBackendBase } from '../services/api';

export function FathomKeySteps() {
  return (
    <ol className="list-decimal pl-5 space-y-3 text-sm text-gray-700">
      <li>
        <strong>Sign in to Fathom</strong> at{' '}
        <a href="https://fathom.video" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">fathom.video</a>{' '}
        - with the same Google or Microsoft account your calendar is on.
      </li>
      <li>
        Click <strong>Settings</strong> in Fathom&apos;s menu, then scroll down to <strong>API Access</strong>.
      </li>
      <li>
        Click <strong>Add +</strong>, then <strong>Generate API Key</strong>. Name it <em>Wingguy</em> and
        click <strong>Create</strong>.
      </li>
      <li>
        <strong>Copy the key</strong> straight away - Fathom only shows it once. If you click away
        before copying, just generate another one.
      </li>
      <li>
        <strong>Paste it in the box below</strong> and press Connect. Wingguy checks it with Fathom
        and shows you your latest recording as proof.
      </li>
    </ol>
  );
}

export default function FathomKeySection({ authHeaders }) {
  const [st, setSt] = useState({ status: 'loading' }); // loading | hidden | ready(+key status)
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false); // false | 'save' | 'remove'
  const [msg, setMsg] = useState(null); // { kind: 'ok' | 'err', text }
  const [showSteps, setShowSteps] = useState(false);

  const endpoint = `${getBackendBase()}/api/wingguy/setup/fathom-key`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(endpoint, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setSt(res.ok && data.ok ? { status: 'ready', ...data } : { status: 'hidden' });
      } catch (e) {
        if (!cancelled) setSt({ status: 'hidden' });
      }
    })();
    return () => { cancelled = true; };
  }, [endpoint, authHeaders]);

  const niceDate = (iso) => { try { return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''; } catch (e) { return ''; } };
  const proofLine = (last) => (last
    ? `Your latest recording is "${last.title}"${last.at ? `, ${niceDate(last.at)}` : ''}.`
    : 'Your Fathom has no recordings yet - your next recorded call will be the first to come through.');

  const call = async (kind, options) => {
    setBusy(kind); setMsg(null);
    try {
      const res = await fetch(endpoint, options);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setSt({ status: 'ready', ...data });
        setDraft('');
        setMsg({
          kind: 'ok',
          text: kind === 'remove'
            ? 'Fathom disconnected. Your calls will stop coming into Wingguy until you add a key again.'
            : `Connected - Fathom accepted your key. ${proofLine(data.lastRecording)} From now on your recorded calls come into Wingguy by themselves, within about 5 minutes of each call ending.`,
        });
      } else {
        setMsg({ kind: 'err', text: data.error || 'That did not work - try again.' });
      }
    } catch (e) {
      setMsg({ kind: 'err', text: 'Could not reach Wingguy - check your connection and try again.' });
    }
    setBusy(false);
  };

  const saveKey = () => call('save', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ key: draft.trim() }),
  });
  const removeKey = () => {
    if (!window.confirm('Disconnect Fathom? Your calls stop coming into Wingguy until you add a key again.')) return;
    call('remove', { method: 'DELETE', headers: authHeaders() });
  };

  if (st.status === 'loading') return null;
  if (st.status === 'hidden') {
    return <p className="text-sm text-red-700">Could not load your recorder status - check your connection and refresh.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {st.hasKey ? (
        st.working === false ? (
          <div className="border-l-4 border-red-600 bg-red-50 px-4 py-3 text-[15px] text-red-900">
            <strong>Fathom is no longer accepting your key.</strong> It may have been deleted in
            Fathom. Generate a new one (steps below) and paste it here.
          </div>
        ) : (
          <div className="border-l-4 border-green-600 bg-green-50 px-4 py-3 text-[15px] text-green-900">
            <strong>Fathom is connected</strong> (key <span className="font-mono">{st.masked}</span>).{' '}
            {st.working ? proofLine(st.lastRecording) : ''}
          </div>
        )
      ) : (
        <div className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
          <strong>Fathom is not connected yet.</strong> Until it is, your calls don&apos;t come into
          Wingguy - so no drafting from the call, and no prep from last time. It takes two minutes.
        </div>
      )}

      {!st.hasKey || st.working === false || showSteps ? (
        <div className="bg-gray-50 border border-gray-200 rounded p-4">
          <p className="text-sm font-semibold text-gray-900 mb-3">How to get your Fathom key</p>
          <FathomKeySteps />
        </div>
      ) : (
        <button type="button" onClick={() => setShowSteps(true)} className="self-start text-sm text-blue-600 underline underline-offset-2">
          How do I get a new key?
        </button>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 border border-gray-300 rounded px-3 py-2 font-mono text-sm text-gray-800 placeholder:font-sans"
          placeholder={st.hasKey ? 'Paste a replacement Fathom key' : 'Paste your Fathom key'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!!busy}
        />
        <button
          type="button"
          onClick={saveKey}
          disabled={!!busy || !draft.trim()}
          className="px-4 py-2 rounded text-white text-sm font-semibold disabled:opacity-40 bg-blue-600 hover:bg-blue-700"
        >
          {busy === 'save' ? 'Checking with Fathom…' : st.hasKey ? 'Replace key' : 'Connect'}
        </button>
      </div>

      {st.hasKey ? (
        <button type="button" onClick={removeKey} disabled={!!busy}
          className="self-start text-sm text-gray-500 underline underline-offset-2 disabled:opacity-40 hover:text-red-700">
          {busy === 'remove' ? 'Disconnecting…' : 'Disconnect Fathom'}
        </button>
      ) : null}

      {msg ? <p className={`text-[15px] ${msg.kind === 'ok' ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p> : null}

      <p className="text-xs text-gray-500">
        One more thing Fathom needs: its desktop app, running on your computer (the Fathom icon down by
        the clock). Without it nothing gets recorded. In Fathom: Settings, then Fathom apps, then Download.
      </p>
    </div>
  );
}
