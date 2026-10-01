"use client";

/**
 * "My Wingguy" — the front door behind the portal tab.
 *
 * Guy's call: a tab carrying the product's name should not open onto a settings form. Someone who
 * has heard the Wingguy story clicks here and needs a way IN to what it does, not a wall of
 * blanks. So this is a hub of three plain doors, and the working pages sit behind them.
 *
 * Deliberately tiny: no stats, no dashboard. A number that is wrong undermines the product more
 * than a plain page ever could, and none of these counts have been verified per-client yet.
 */

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePageAuth } from './WingguyReview';
import { getBackendBase } from '../services/api';

const DOORS = [
  {
    href: '/my-wingguy/about',
    eyebrow: 'Start here if it is new to you',
    title: 'What Wingguy does',
    body: 'A day of it, moment by moment - what you say, and what it does. Ten minutes, and it explains the whole thing better than any list of features.',
    cta: 'See what it does',
    tone: 'emerald',
  },
  {
    href: '/my-wingguy/setup',
    eyebrow: 'About ten minutes, once',
    title: 'Give Wingguy your instructions',
    body: 'The handful of things only you can tell it - your name, your sign-off, how you describe what you do - and every instruction it already follows, in plain English, each one changeable.',
    cta: 'Give it your instructions',
    tone: 'slate',
  },
  {
    href: '/my-wingguy/review',
    eyebrow: 'Any time',
    title: "What's changed lately",
    body: 'Everything anyone has changed about your Wingguy - who, when, and what it means. Leave a note on anything, undo anything, or ask it to start doing something differently.',
    cta: 'Review recent changes',
    tone: 'slate',
  },
];

/**
 * The way into the client's Linked Helper machine (29 Sep 2026): a web link that opens its
 * desktop in a browser tab. Only drawn for a client who HAS a link - a door that leads nowhere
 * is worse than no door - and a failed lookup draws nothing rather than an error, because this
 * page works perfectly well without it.
 */
function useMachineLink({ token, client, devKey, hasAuth, ready }) {
  const [link, setLink] = useState(null);
  useEffect(() => {
    if (!ready || !hasAuth) return undefined;
    let cancelled = false;
    const headers = {};
    if (token) headers['x-portal-token'] = token;
    if (client) headers['x-client-id'] = client;
    if (devKey) headers['x-dev-key'] = devKey;
    fetch(`${getBackendBase()}/api/wingguy/machine`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data && data.ok && data.link) setLink(data.link); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token, client, devKey, hasAuth, ready]);
  return link;
}

/**
 * The extension's version against the current one (29 Sep 2026 lane change): drives the install
 * door and the "a new version is ready" nag. installed=null means we have never seen this client
 * on any version - the door says "install it". Best-effort: a failed lookup leaves it null, and
 * the door falls back to a plain "Install the extension" rather than an error.
 */
function useExtensionStatus({ token, client, devKey, hasAuth, ready }) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!ready || !hasAuth) return undefined;
    let cancelled = false;
    const headers = {};
    if (token) headers['x-portal-token'] = token;
    if (client) headers['x-client-id'] = client;
    if (devKey) headers['x-dev-key'] = devKey;
    fetch(`${getBackendBase()}/extension/dist/portal-status`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data && data.ok) setStatus(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token, client, devKey, hasAuth, ready]);
  return status;
}

function ExtensionCard({ status, href }) {
  const behind = status && status.behind;
  const upToDate = status && !status.behind && !status.neverInstalled;
  const base = 'group flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-[14px] border px-7 py-5 transition duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(31,41,51,.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';
  const tone = behind
    ? 'border-amber-300 bg-amber-50 hover:border-amber-400 focus-visible:ring-amber-600'
    : 'border-slate-200 bg-white hover:border-slate-300 focus-visible:ring-slate-700';
  let title = 'Install the extension';
  let body = 'The Wingguy window on LinkedIn - get it into your browser in a couple of minutes.';
  let cta = 'Install it';
  if (behind) {
    title = 'A new version of your extension is ready';
    body = `You're on ${status.installed} - the current one is ${status.current}. Updating takes about 30 seconds.`;
    cta = 'Update it';
  } else if (upToDate) {
    title = 'Your extension is up to date';
    body = `Running version ${status.current}. Reinstall it, or set it up on another computer, from here.`;
    cta = 'Open';
  }
  return (
    <a href={href('/my-wingguy/install')} className={`${base} ${tone}`}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 font-serif text-[21px] leading-snug text-slate-900">
          {behind && <span className="inline-block h-[9px] w-[9px] rounded-full bg-amber-500" aria-hidden="true" />}
          {title}
        </div>
        <p className="text-[15px] leading-relaxed text-slate-600">{body}</p>
      </div>
      <div className={`inline-flex items-center gap-1.5 text-sm font-bold ${behind ? 'text-amber-700' : 'text-blue-600'}`}>
        {cta}{' '}
        <span aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-1">&rarr;</span>
      </div>
    </a>
  );
}

function WingguyHubInner() {
  const searchParams = useSearchParams();
  const auth = usePageAuth(searchParams);
  const { query: q } = auth;
  const href = (path) => (q ? `${path}?${q}` : path);
  const machineLink = useMachineLink(auth);
  const extStatus = useExtensionStatus(auth);

  return (
    <div className="flex flex-col gap-8 max-w-[1240px]">
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div className="flex flex-col gap-3">
          <h1 className="font-serif text-4xl md:text-[42px] leading-tight text-slate-900">My Wingguy</h1>
          <p className="text-lg leading-relaxed text-slate-600 max-w-[620px]">
            It reads every conversation, writes what comes next in your words, books the meetings
            and remembers the follow-ups - and it never sends anything without you seeing it first.
          </p>
        </div>
        <div className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">
          <span aria-hidden="true" className="mr-2 inline-block h-[7px] w-[7px] rounded-full bg-emerald-600 align-middle" />
          Set up and running
        </div>
      </header>

      {machineLink && (
        <a
          href={machineLink}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-[14px] border border-slate-200 bg-white px-7 py-5 transition duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_8px_28px_rgba(31,41,51,.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-2"
        >
          <div className="flex flex-col gap-1">
            <div className="font-serif text-[21px] leading-snug text-slate-900">Your Linked Helper machine</div>
            <p className="text-[15px] leading-relaxed text-slate-600">
              Opens in a new tab. The first time, it asks for your email and sends you a code.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 text-sm font-bold text-blue-600">
            Open my Linked Helper machine{' '}
            <span aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-1">&rarr;</span>
          </div>
        </a>
      )}

      <ExtensionCard status={extStatus} href={href} />

      <div className="grid gap-5 lg:grid-cols-3">
        {DOORS.map((d) => (
          <a
            key={d.href}
            href={href(d.href)}
            className={`group flex flex-col rounded-[14px] border p-7 lg:min-h-[280px] transition duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(31,41,51,.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
              d.tone === 'emerald'
                ? 'border-emerald-200 bg-emerald-50 focus-visible:ring-emerald-700'
                : 'border-slate-200 bg-white hover:border-slate-300 focus-visible:ring-slate-700'
            }`}
          >
            <div className={`mb-3 text-[11.5px] font-bold uppercase tracking-[0.09em] ${d.tone === 'emerald' ? 'text-emerald-700' : 'text-slate-500'}`}>
              {d.eyebrow}
            </div>
            <div className="mb-3 font-serif text-[25px] leading-snug text-slate-900">
              {d.title}
            </div>
            <p className="mb-6 text-[15px] leading-relaxed text-slate-600">{d.body}</p>
            <div className={`mt-auto inline-flex items-center gap-1.5 text-sm font-bold ${d.tone === 'emerald' ? 'text-emerald-700' : 'text-blue-600'}`}>
              {d.cta}{' '}
              <span aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-1">&rarr;</span>
            </div>
          </a>
        ))}
      </div>

      <p className="text-sm text-slate-500 border-t border-slate-200 pt-6">
        You can also just talk to it - in the Wingguy window on LinkedIn, or in a chat. Anything on
        these pages can be said out loud instead: &ldquo;never say reach out&rdquo;, &ldquo;what
        have I changed?&rdquo;, &ldquo;review my edits&rdquo;.
      </p>
    </div>
  );
}

export default function WingguyHub() {
  return (
    <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
      <WingguyHubInner />
    </Suspense>
  );
}
