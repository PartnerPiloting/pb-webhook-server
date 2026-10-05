"use client";
// The client journey at the top of Start Here: the eight stops, and where THIS client is up to.
//
// The words and the order come from the server (content/client-journey.json, served with this
// client's progress by GET /api/wingguy/journey). Nothing about the journey is written in this
// file - it only draws what it is given, so the page can never describe a different journey from
// the one written down (Guy, 5 Oct 2026: one journey, one order, everywhere).
//
// It is optional furniture on a page that works without it: a failed load draws nothing.

import React, { useEffect, useState } from 'react';
import { getBackendBase, getAuthenticatedHeaders } from '../services/api';

const MARK = {
  done: { label: 'In place', cls: 'bg-emerald-100 text-emerald-800' },
  started: { label: 'Started', cls: 'bg-amber-100 text-amber-800' },
  todo: { label: 'To come', cls: 'bg-gray-100 text-gray-500' },
};

export default function ClientJourney() {
  const [journey, setJourney] = useState(null);
  const [open, setOpen] = useState(null);       // key of the stop whose detail is showing
  const [showAll, setShowAll] = useState(false); // a finished client can still unfold it
  const [why, setWhy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getBackendBase()}/api/wingguy/journey`, { headers: getAuthenticatedHeaders(), cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || !data.ok || !data.journey) return;
        setJourney(data.journey);
        const here = data.journey.stops.find((s) => s.current);
        if (here) setOpen(here.key);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!journey) return null;

  if (journey.complete && !showAll) {
    return (
      <div className="mx-auto max-w-5xl px-2 pb-6">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center gap-3 flex-wrap">
          <span><span className="font-semibold">You are fully set up.</span> All eight stops of your journey are in place.</span>
          <button className="text-emerald-800 underline" onClick={() => setShowAll(true)}>Show the journey</button>
        </div>
      </div>
    );
  }

  const detail = journey.stops.find((s) => s.key === open) || null;

  return (
    <div className="mx-auto max-w-5xl px-2 pb-8">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{journey.title}</h1>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
          {journey.done} of {journey.total} in place
        </span>
      </div>
      <p className="mt-2 text-base text-gray-600 max-w-3xl">{journey.lede}</p>

      <ol className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {journey.stops.map((s) => {
          const mark = MARK[s.status] || MARK.todo;
          const isOpen = s.key === open;
          return (
            <li key={s.key} className="min-w-0">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : s.key)}
                aria-expanded={isOpen}
                className={`w-full h-full text-left rounded-lg border px-3 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${s.current ? 'border-emerald-500 bg-emerald-50' : isOpen ? 'border-gray-400 bg-white' : 'border-gray-200 bg-white hover:border-gray-300'}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-lg font-semibold ${s.status === 'done' ? 'text-emerald-700' : 'text-gray-400'}`}>{s.n}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide ${mark.cls}`}>{mark.label}</span>
                  {s.current && <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">You are here</span>}
                </div>
                <div className="mt-1 font-semibold text-gray-900">{s.name}</div>
                <div className="text-sm text-gray-600">{s.line}</div>
                <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{s.when}</div>
              </button>
            </li>
          );
        })}
      </ol>

      {detail && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-4">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-gray-900">{detail.n}. {detail.name}</h2>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{detail.when}</span>
          </div>
          <p className="mt-1 text-sm text-gray-600 max-w-3xl">{detail.intro}</p>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">What happens</div><p className="mt-1 text-sm text-gray-800">{detail.happens}</p></div>
            <div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Your part</div><p className="mt-1 text-sm text-gray-800">{detail.yourPart}</p></div>
            <div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">What you walk away with</div><p className="mt-1 text-sm text-gray-800">{detail.walkAway}</p></div>
          </div>
        </div>
      )}

      {journey.whyFirst && (
        <div className="mt-4">
          <button type="button" className="text-sm text-emerald-800 underline" aria-expanded={why} onClick={() => setWhy((w) => !w)}>
            {journey.whyFirst.heading} {why ? '▴' : '▾'}
          </button>
          {why && (
            <div className="mt-2 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3">
              <p className="text-sm font-semibold text-gray-900">{journey.whyFirst.line}</p>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {journey.whyFirst.reasons.map((r) => (
                  <div key={r.title} className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900">{r.title}</div>
                    <p className="text-sm text-gray-700">{r.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {journey.complete && (
        <button className="mt-3 text-sm text-gray-500 underline" onClick={() => setShowAll(false)}>Hide the journey</button>
      )}
    </div>
  );
}
