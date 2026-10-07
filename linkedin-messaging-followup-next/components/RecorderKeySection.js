"use client";

/**
 * "Your meeting recorder" - self-service for the client's recorder key: Fathom (the standard),
 * Granola or Fireflies (Guy, 7 Oct 2026). Same door as ClaudeKeySection: one paste box, the stored
 * key is never shown (masked tail only), and every pasted key is tested with the recorder
 * server-side BEFORE anything is stored. The reply is proof - the client's own newest recording.
 *
 * Granola: the server also registers the webhook and stores its secret - nothing more to do.
 * Fireflies: the server mints a secret, and this page shows the link + secret to paste into
 * Fireflies (the one recorder with a step on their side).
 *
 * The steps to get each key are on the page itself (open until that recorder is connected).
 *
 * `authHeaders(extra?)` must be a STABLE callback (useCallback) - it is an effect dependency.
 */

import React, { useState, useEffect } from 'react';
import { getBackendBase } from '../services/api';

const LABEL = { fathom: 'Fathom', granola: 'Granola', fireflies: 'Fireflies' };

const BLURB = {
  fathom: 'Our standard - free, and reliable on Zoom. A notetaker joins your calls.',
  granola: 'Nothing joins your calls, and it works when you are a guest. Needs Granola\'s Business plan.',
  fireflies: 'A notetaker joins your calls. Only sends meetings you organise. Paid plan.',
};

const A = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{children}</a>
);

export function RecorderKeySteps({ provider }) {
  if (provider === 'granola') {
    return (
      <ol className="list-decimal pl-5 space-y-3 text-sm text-gray-700">
        <li>Open <strong>Granola</strong> (<A href="https://granola.ai">granola.ai</A>) - you need to be on Granola&apos;s <strong>Business plan</strong> for an API key.</li>
        <li>Go to Granola&apos;s <strong>Settings</strong> and find <strong>API</strong>.</li>
        <li><strong>Create an API key</strong> (call it <em>Wingguy</em> if it asks for a name) and <strong>copy it</strong> - it may only be shown once.</li>
        <li><strong>Paste it in the box below</strong> and press Connect. Wingguy checks it with Granola and connects to your notes - nothing else to do.</li>
      </ol>
    );
  }
  if (provider === 'fireflies') {
    return (
      <ol className="list-decimal pl-5 space-y-3 text-sm text-gray-700">
        <li>Sign in to <strong>Fireflies</strong> at <A href="https://app.fireflies.ai">app.fireflies.ai</A>.</li>
        <li>Go to <strong>Settings</strong>, then <strong>MCP and API</strong>, and <strong>copy your API key</strong>.</li>
        <li><strong>Paste it in the box below</strong> and press Connect.</li>
        <li>Wingguy then shows you a <strong>link</strong> and a <strong>secret</strong> to paste back into Fireflies - one last step on your side.</li>
      </ol>
    );
  }
  return (
    <ol className="list-decimal pl-5 space-y-3 text-sm text-gray-700">
      <li><strong>Sign in to Fathom</strong> at <A href="https://fathom.video">fathom.video</A> - with the same Google or Microsoft account your calendar is on.</li>
      <li>Click <strong>Settings</strong> in Fathom&apos;s menu, then scroll down to <strong>API Access</strong>.</li>
      <li>Click <strong>Add +</strong>, then <strong>Generate API Key</strong>. Name it <em>Wingguy</em> and click <strong>Create</strong>.</li>
      <li><strong>Copy the key</strong> straight away - Fathom only shows it once. If you click away before copying, just generate another one.</li>
      <li><strong>Paste it in the box below</strong> and press Connect. Wingguy checks it with Fathom and shows you your latest recording as proof.</li>
    </ol>
  );
}

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) { /* select-and-copy still works */ }
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <div className="flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.target.select()} className="flex-1 border border-gray-300 rounded px-2 py-1.5 font-mono text-xs text-gray-800 bg-white" />
        <button type="button" onClick={copy} className="px-3 py-1.5 rounded border border-gray-300 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function FirefliesFinish({ url, secret }) {
  return (
    <div className="border border-blue-200 bg-blue-50 rounded p-4 flex flex-col gap-3">
      <p className="text-sm font-semibold text-gray-900">Last step - in Fireflies</p>
      <ol className="list-decimal pl-5 space-y-2 text-sm text-gray-700">
        <li>Go to <strong>Settings</strong>, then <strong>Webhooks</strong>. Edit the existing row (hover it, three dots, Edit) or click <strong>Add Config</strong>.</li>
        <li>Paste the <strong>link</strong> below into the webhook URL box and press <strong>Continue</strong>.</li>
        <li>On the next screen, paste the <strong>secret</strong> below into <strong>Signing Secret</strong> - it is easy to skip past, and nothing arrives without it.</li>
        <li>Tick <strong>Meeting transcribed</strong> and <strong>Meeting summarized</strong>, then press <strong>Save</strong> (or <strong>Update</strong>).</li>
      </ol>
      <CopyRow label="Link" value={url} />
      <CopyRow label="Secret" value={secret} />
      <p className="text-xs text-gray-600">Copy one at a time, in this order - your clipboard only holds one thing.</p>
    </div>
  );
}

export default function RecorderKeySection({ authHeaders }) {
  const [st, setSt] = useState({ status: 'loading' }); // loading | hidden | ready(+status)
  const [choice, setChoice] = useState('fathom');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false); // false | 'save' | 'remove'
  const [msg, setMsg] = useState(null); // { kind: 'ok' | 'err', text }
  const [showSteps, setShowSteps] = useState(false);

  const endpoint = `${getBackendBase()}/api/wingguy/setup/recorder-key`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(endpoint, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.ok) { setSt({ status: 'ready', ...data }); setChoice(data.provider || 'fathom'); }
        else setSt({ status: 'hidden' });
      } catch (e) {
        if (!cancelled) setSt({ status: 'hidden' });
      }
    })();
    return () => { cancelled = true; };
  }, [endpoint, authHeaders]);

  const niceDate = (iso) => { try { return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''; } catch (e) { return ''; } };
  const proofLine = (name, last) => (last
    ? `Your latest recording is "${last.title}"${last.at ? `, ${niceDate(last.at)}` : ''}.`
    : `Your next ${name} recording will be the first to come through.`);

  const connected = st.status === 'ready' && st.hasKey;
  const onChosen = connected && choice === st.provider;
  const name = LABEL[choice];

  const save = async () => {
    if (connected && choice !== st.provider
      && !window.confirm(`Switch to ${name}? Your ${LABEL[st.provider]} connection will be removed, so only ${name} feeds Wingguy.`)) return;
    setBusy('save'); setMsg(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ provider: choice, key: draft.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setSt({ status: 'ready', ...data });
        setDraft(''); setShowSteps(false);
        const tail = choice === 'fireflies'
          ? 'One last step below - paste the link and secret into Fireflies.'
          : `${proofLine(name, data.lastRecording)} From now on your recorded calls come into Wingguy by themselves.`;
        setMsg({ kind: 'ok', text: `Connected - ${name} accepted your key. ${tail}` });
      } else {
        setMsg({ kind: 'err', text: data.error || 'That did not work - try again.' });
      }
    } catch (e) {
      setMsg({ kind: 'err', text: 'Could not reach Wingguy - check your connection and try again.' });
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!window.confirm(`Disconnect ${LABEL[st.provider]}? Your calls stop coming into Wingguy until you connect a recorder again.`)) return;
    setBusy('remove'); setMsg(null);
    try {
      const res = await fetch(endpoint, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) { setSt({ status: 'ready', ...data }); setMsg({ kind: 'ok', text: 'Disconnected. Your calls will stop coming into Wingguy until you connect a recorder again.' }); }
      else setMsg({ kind: 'err', text: data.error || 'That did not work - try again.' });
    } catch (e) {
      setMsg({ kind: 'err', text: 'Could not reach Wingguy - check your connection and try again.' });
    }
    setBusy(false);
  };

  if (st.status === 'loading') return null;
  if (st.status === 'hidden') {
    return <p className="text-sm text-red-700">Could not load your recorder status - check your connection and refresh.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {connected ? (
        st.working === false ? (
          <div className="border-l-4 border-red-600 bg-red-50 px-4 py-3 text-[15px] text-red-900">
            <strong>{LABEL[st.provider]} is no longer accepting your key.</strong> It may have been
            deleted. Create a new one (steps below) and paste it here.
          </div>
        ) : (
          <div className="border-l-4 border-green-600 bg-green-50 px-4 py-3 text-[15px] text-green-900">
            <strong>{LABEL[st.provider]} is connected</strong> (key <span className="font-mono">{st.masked}</span>).{' '}
            {st.working && st.provider !== 'fireflies' ? proofLine(LABEL[st.provider], st.lastRecording) : ''}
          </div>
        )
      ) : (
        <div className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
          <strong>No recorder connected yet.</strong> Until there is, your calls don&apos;t come into
          Wingguy - so no drafting from the call, and no prep from last time. It takes two minutes.
        </div>
      )}

      {connected && st.provider === 'fireflies' && st.webhookUrl && st.webhookSecret && choice === 'fireflies' ? (
        <FirefliesFinish url={st.webhookUrl} secret={st.webhookSecret} />
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-gray-900">{connected ? 'Your recorder' : 'Which recorder do you use?'}</span>
        <div className="grid grid-cols-3 gap-2">
          {['fathom', 'granola', 'fireflies'].map((id) => (
            <button key={id} type="button" disabled={!!busy}
              onClick={() => { setChoice(id); setMsg(null); setDraft(''); }}
              className={`px-3 py-2 rounded border text-sm font-semibold ${choice === id ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {LABEL[id]}{connected && st.provider === id ? ' ✓' : ''}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">{BLURB[choice]}</p>
      </div>

      {!onChosen || st.working === false || showSteps ? (
        <div className="bg-gray-50 border border-gray-200 rounded p-4">
          <p className="text-sm font-semibold text-gray-900 mb-3">How to get your {name} key</p>
          <RecorderKeySteps provider={choice} />
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
          placeholder={onChosen ? `Paste a replacement ${name} key` : `Paste your ${name} key`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!!busy}
        />
        <button
          type="button"
          onClick={save}
          disabled={!!busy || !draft.trim()}
          className="px-4 py-2 rounded text-white text-sm font-semibold disabled:opacity-40 bg-blue-600 hover:bg-blue-700"
        >
          {busy === 'save' ? `Checking with ${name}…` : onChosen ? 'Replace key' : connected ? `Switch to ${name}` : 'Connect'}
        </button>
      </div>

      {connected ? (
        <button type="button" onClick={remove} disabled={!!busy}
          className="self-start text-sm text-gray-500 underline underline-offset-2 disabled:opacity-40 hover:text-red-700">
          {busy === 'remove' ? 'Disconnecting…' : `Disconnect ${LABEL[st.provider]}`}
        </button>
      ) : null}

      {msg ? <p className={`text-[15px] ${msg.kind === 'ok' ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p> : null}

      {choice === 'fathom' ? (
        <p className="text-xs text-gray-500">
          One more thing Fathom needs: its desktop app, running on your computer (the Fathom icon down by
          the clock). Without it nothing gets recorded. In Fathom: Settings, then Fathom apps, then Download.
        </p>
      ) : null}
    </div>
  );
}
