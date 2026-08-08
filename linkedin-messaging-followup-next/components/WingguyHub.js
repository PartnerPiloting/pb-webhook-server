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
import { usePageAuth } from './WingguyReview';

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

function WingguyHubInner() {
  const searchParams = useSearchParams();
  const { query: q } = usePageAuth(searchParams);
  const href = (path) => (q ? `${path}?${q}` : path);

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
