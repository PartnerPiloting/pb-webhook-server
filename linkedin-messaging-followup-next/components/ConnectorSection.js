"use client";

/**
 * "Connect Wingguy to your Claude" (14 Oct 2026) - the client's OWN connector link, on the
 * "Your Wingguy" setup page above the Claude key.
 *
 * WHY: the link used to travel by email or DM, and Ashley Knowles ended up on the shared secret,
 * which maps to Guy - his Claude ran as Guy for weeks and nothing showed it. The server builds the
 * link from the token this page was opened with, so it can only ever be the client's own, and it
 * says when their Claude last used it: connected but never green = wrong address.
 *
 * Hidden for assistants (the server answers { hidden: true }): the link is the client's own key,
 * and an assistant works in the portal, not in the client's Claude.
 */

import React, { useState, useEffect } from 'react';
import { getBackendBase } from '../services/api';

function whenText(iso) {
  try {
    const then = new Date(iso);
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins} minutes ago`;
    const sameDay = then.toDateString() === new Date().toDateString();
    if (sameDay) return `today at ${then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    return then.toLocaleDateString([], { day: 'numeric', month: 'short' });
  } catch (e) { return ''; }
}

export default function ConnectorSection({ authHeaders }) {
  const [st, setSt] = useState({ status: 'loading' }); // loading | hidden | ready(+url, lastSeen)
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getBackendBase()}/api/wingguy/setup/connector`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setSt(res.ok && data.ok && !data.hidden && data.url ? { status: 'ready', ...data } : { status: 'hidden' });
      } catch (e) {
        if (!cancelled) setSt({ status: 'hidden' });
      }
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);

  if (st.status !== 'ready') return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(st.url);
    } catch (e) {
      // Older browsers: select the field so a manual copy is one keystroke.
      try { document.getElementById('wg-connector-url')?.select(); } catch (_) { /* nothing more to do */ }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <section id="connect-claude" className="flex flex-col gap-4 scroll-mt-6">
      <div className="flex flex-col gap-3 pb-4 border-b border-slate-200">
        <h2 className="font-serif text-2xl text-slate-900">Connect Wingguy to your Claude</h2>
        <p className="text-slate-600 max-w-2xl">
          Wingguy lives inside your own Claude chat. This is your personal link - it only ever
          opens your account, so keep it to yourself and don&apos;t forward it or put it in a
          shared doc.
        </p>
        <p className="text-[15px] text-slate-600 max-w-2xl">
          We normally do this together on your first call. Doing it on your own?{' '}
          <a className="text-emerald-800 font-semibold underline underline-offset-2 hover:text-emerald-900"
            href="https://knowaguy.com.au/connect-wingguy" target="_blank" rel="noopener noreferrer">
            Here&apos;s how, step by step
          </a>.
        </p>
      </div>

      {st.lastSeen ? (
        <p className="text-[15px] text-emerald-800">
          <strong>Connected</strong> - your Claude last used Wingguy {whenText(st.lastSeen)}.
        </p>
      ) : null}

      <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
        <input
          id="wg-connector-url"
          type="text"
          readOnly
          spellCheck={false}
          className="flex-1 border border-slate-300 rounded px-3 py-2 font-mono text-sm text-slate-800 bg-slate-50"
          value={st.url}
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button"
          onClick={copy}
          className="px-4 py-2 rounded text-white text-sm font-semibold bg-emerald-700 hover:bg-emerald-800"
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      <ol className="list-decimal pl-5 text-[15px] text-slate-700 flex flex-col gap-1 max-w-2xl">
        <li>In <strong>claude.ai</strong>, open <strong>Settings</strong> → <strong>Connectors</strong>.</li>
        <li>Click <strong>Add custom connector</strong>, name it <strong>Wingguy</strong>, paste the link and click <strong>Add</strong>.</li>
        <li>Start a new chat and type <strong>&quot;what can I do with Wingguy?&quot;</strong></li>
      </ol>
    </section>
  );
}
