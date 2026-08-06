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

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { pageAuthQuery } from './WingguyReview';

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
    cta: "See what's changed",
    tone: 'slate',
  },
];

function WingguyHubInner() {
  const searchParams = useSearchParams();
  const q = pageAuthQuery(searchParams);
  const href = (path) => (q ? `${path}?${q}` : path);

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <header className="flex flex-col gap-3">
        <h1 className="font-serif text-4xl text-slate-900">My Wingguy</h1>
        <p className="font-serif text-lg leading-relaxed text-slate-600">
          It reads every conversation, writes what comes next in your words, books the meetings and
          remembers the follow-ups - and it never sends anything without you seeing it first.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {DOORS.map((d) => (
          <a
            key={d.href}
            href={href(d.href)}
            className={`group block border-2 p-6 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
              d.tone === 'emerald'
                ? 'border-emerald-600 bg-emerald-50 hover:bg-emerald-100 focus-visible:ring-emerald-700'
                : 'border-slate-300 bg-white hover:border-slate-500 focus-visible:ring-slate-700'
            }`}
          >
            <div className={`text-[11px] font-bold uppercase tracking-[0.12em] ${d.tone === 'emerald' ? 'text-emerald-800' : 'text-slate-500'}`}>
              {d.eyebrow}
            </div>
            <div className="font-serif text-2xl text-slate-900 mt-2 group-hover:text-emerald-900">
              {d.title}
            </div>
            <p className="text-[15px] text-slate-700 leading-relaxed mt-2">{d.body}</p>
            <div className={`mt-3 text-sm font-semibold ${d.tone === 'emerald' ? 'text-emerald-800' : 'text-slate-700'}`}>
              {d.cta} <span aria-hidden="true">&rarr;</span>
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
