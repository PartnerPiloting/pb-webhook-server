"use client";

/**
 * "Your Claude key" - self-service for the BYO Anthropic key (Julian's ask, 28 Aug 2026).
 * One paste box is the whole door: first key, replacement, and re-check all go through it. The
 * stored key is never shown or sent to the browser - the status endpoint serves a masked tail
 * only, and every pasted key is live-tested against Anthropic server-side BEFORE being stored
 * (the common failure is a real key on an account with no credit, not a bad paste).
 *
 * SHARED between the two places a client can reach it (one source of truth, not a fork):
 *   - the "Your Wingguy" setup page  -> variant="setup"    (serif heading, hides entirely for
 *     managed-plan clients or on a status-load failure - the section is additive there)
 *   - the portal Settings page       -> variant="settings" (no heading of its own - the Settings
 *     view provides the chrome - and it ALWAYS renders something: a managed-plan client who
 *     clicked the card gets told why there is nothing to manage, not a blank screen)
 *
 * `authHeaders(extra?)` must be a STABLE callback (useCallback) - it is an effect dependency.
 */

import React, { useState, useEffect } from 'react';
import { getBackendBase } from '../services/api';

export default function ClaudeKeySection({ authHeaders, variant = 'setup' }) {
  const [st, setSt] = useState({ status: 'loading' }); // loading | managed | hidden | ready(+key status)
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false); // false | 'save' | 'recheck' | 'remove'
  const [msg, setMsg] = useState(null); // { kind: 'ok' | 'err', text }

  const endpoint = `${getBackendBase()}/api/wingguy/setup/claude-key`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(endpoint, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.ok) setSt(data.managed ? { status: 'managed' } : { status: 'ready', ...data });
        else setSt({ status: 'hidden' });
      } catch (e) {
        if (!cancelled) setSt({ status: 'hidden' });
      }
    })();
    return () => { cancelled = true; };
  }, [endpoint, authHeaders]);

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
            ? 'Key removed. Drafting and your overnight brief are off until a new one is added.'
            : 'Key checked with Anthropic and saved - Wingguy is running on it now.',
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
  const recheck = () => call('recheck', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ recheck: true }),
  });
  const removeKey = () => {
    if (!window.confirm('Remove your key? Wingguy stops drafting for you (and your overnight brief stops) until a new one is added.')) return;
    call('remove', { method: 'DELETE', headers: authHeaders() });
  };

  const inSettings = variant === 'settings';

  if (st.status === 'loading') return null;
  if (st.status === 'managed') {
    if (!inSettings) return null;
    return (
      <p className="text-sm text-gray-600">
        Your account runs on the managed plan - Wingguy&apos;s writing is covered for you, and
        there is no key to manage here.
      </p>
    );
  }
  if (st.status === 'hidden') {
    if (!inSettings) return null;
    return (
      <p className="text-sm text-red-700">
        Could not load your key status - check your connection and refresh.
      </p>
    );
  }

  const niceDate = (iso) => { try { return new Date(iso).toLocaleDateString(); } catch (e) { return ''; } };

  const body = (
    <>
      {st.failingSince ? (
        <div className="border-l-4 border-red-600 bg-red-50 px-4 py-3 text-[15px] text-red-900">
          <strong>Your key stopped working{niceDate(st.failingSince) ? ` on ${niceDate(st.failingSince)}` : ''}.</strong>{' '}
          {st.failReason === 'billing'
            ? 'The account looks out of credit, or over its spend limit. Top up or raise the limit in the Anthropic Console, then press "Check again" - or paste a new key.'
            : 'It looks revoked or invalid. Paste a new key from the Anthropic Console.'}
        </div>
      ) : null}

      {st.hasKey ? (
        <p className={inSettings ? 'text-sm text-gray-600' : 'text-[15px] text-slate-600'}>
          Key on file: <span className={inSettings ? 'font-mono text-gray-800' : 'font-mono text-slate-800'}>{st.masked}</span>
          {st.addedAt ? ` · added ${niceDate(st.addedAt)}` : ''}
          {!st.failingSince ? ' · working at last check' : ''}
        </p>
      ) : (
        <div className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
          <strong>No Claude key yet.</strong> Drafting and your overnight brief are switched off
          until one is added. It takes a minute: create a key in the Anthropic Console, paste it
          below, done.
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          className={`flex-1 border rounded px-3 py-2 font-mono text-sm placeholder:font-sans ${inSettings ? 'border-gray-300 text-gray-800' : 'border-slate-300 text-slate-800'}`}
          placeholder={st.hasKey ? 'Paste a replacement key (sk-ant-…)' : 'Paste your key (sk-ant-…)'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!!busy}
        />
        <button
          type="button"
          onClick={saveKey}
          disabled={!!busy || !draft.trim()}
          className={`px-4 py-2 rounded text-white text-sm font-semibold disabled:opacity-40 ${inSettings ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-700 hover:bg-emerald-800'}`}
        >
          {busy === 'save' ? 'Checking with Anthropic…' : st.hasKey ? 'Replace key' : 'Save key'}
        </button>
      </div>

      {st.hasKey ? (
        <div className="flex items-center gap-5 text-sm">
          <button type="button" onClick={recheck} disabled={!!busy}
            className={`font-semibold underline underline-offset-2 disabled:opacity-40 ${inSettings ? 'text-blue-600 hover:text-blue-800' : 'text-emerald-800 hover:text-emerald-900'}`}>
            {busy === 'recheck' ? 'Checking…' : 'Check again'}
          </button>
          <button type="button" onClick={removeKey} disabled={!!busy}
            className={`underline underline-offset-2 disabled:opacity-40 hover:text-red-700 ${inSettings ? 'text-gray-500' : 'text-slate-500'}`}>
            {busy === 'remove' ? 'Removing…' : 'Remove key'}
          </button>
        </div>
      ) : null}

      {msg ? (
        <p className={`text-[15px] ${msg.kind === 'ok' ? (inSettings ? 'text-green-700' : 'text-emerald-800') : 'text-red-700'}`}>{msg.text}</p>
      ) : null}
    </>
  );

  if (inSettings) return <div className="flex flex-col gap-4">{body}</div>;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 pb-4 border-b border-slate-200">
        <h2 className="font-serif text-2xl text-slate-900">Your Claude key</h2>
        <p className="text-slate-600 max-w-2xl">
          Wingguy writes with Claude, on your own Anthropic key, so your usage is billed to you
          and only you. Paste a key from the Anthropic Console here - it gets tested with
          Anthropic before anything is saved.
        </p>
      </div>
      {body}
    </section>
  );
}
