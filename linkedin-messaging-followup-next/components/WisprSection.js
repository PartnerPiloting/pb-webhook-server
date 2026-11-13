"use client";

/**
 * "Connect Wispr" (13 Nov 2026) - sits under the recorder key on Settings > Your Meeting Recorder.
 *
 * Wispr Flow has no key to paste: the client clicks one link, clicks Allow on Wispr's own page, and
 * from then on Wingguy collects their Wispr calls by itself. The server builds the link and says
 * where the connection stands; no token ever reaches this page.
 *
 * HIDDEN unless the server says the feed is switched on for this client (WISPR_FEED_TENANTS) - it
 * answers { hidden: true } for everyone else, and this renders nothing at all.
 *
 * `authHeaders(extra?)` must be a STABLE callback (useCallback) - it is an effect dependency.
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

export default function WisprSection({ authHeaders }) {
  const [st, setSt] = useState({ status: 'loading' }); // loading | hidden | ready(+connectUrl, status...)

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getBackendBase()}/api/wingguy/setup/wispr`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setSt(res.ok && data.ok && !data.hidden && data.connectUrl ? { ...data, view: 'ready' } : { view: 'hidden' });
      } catch (e) {
        if (!cancelled) setSt({ view: 'hidden' });
      }
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);

  if (st.view !== 'ready') return null;

  const connected = st.status === 'connected';
  const dropped = st.status === 'needs_reconnect';

  return (
    <div className="mt-6 pt-6 border-t border-gray-200">
      <h4 className="text-base font-semibold text-gray-900">Wispr Flow Notetaker</h4>
      <p className="mt-1 text-sm text-gray-600">
        Record with Wispr Flow? Connect it once and Wingguy collects those calls by itself - nothing
        joins your calls, and there is no key to paste. Wingguy can only read your recordings; it
        cannot change or delete anything in Wispr.
      </p>

      {connected ? (
        <p className="mt-3 text-sm text-emerald-800">
          <strong>Connected.</strong>{' '}
          {st.lastSuccessAt ? `Last checked for new calls ${whenText(st.lastSuccessAt)}.` : 'The first check is under way.'}
        </p>
      ) : null}

      {dropped ? (
        <p className="mt-3 text-sm text-rose-700">
          <strong>The connection has dropped.</strong> Wispr is still recording, but Wingguy has
          stopped collecting. One click below reconnects it, and Wingguy catches up by itself.
        </p>
      ) : null}

      <a
        href={st.connectUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`mt-4 inline-flex items-center px-4 py-2 rounded text-sm font-semibold ${connected ? 'border border-gray-300 text-gray-700 bg-white hover:bg-gray-50' : 'text-white bg-emerald-700 hover:bg-emerald-800'}`}
      >
        {connected ? 'Reconnect Wispr' : (dropped ? 'Reconnect Wispr' : 'Connect Wispr')}
      </a>
      {!connected ? (
        <p className="mt-2 text-xs text-gray-500">
          A Wispr page opens - sign in if it asks, then click Allow.
        </p>
      ) : null}
    </div>
  );
}
