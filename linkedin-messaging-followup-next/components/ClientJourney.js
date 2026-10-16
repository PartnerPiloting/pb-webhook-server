"use client";
// The client journey at the top of the Wingguy hub: the eight stops, and where THIS client is up to.
//
// The words and the order come from the server (content/client-journey.json, served with this
// client's progress by GET /api/wingguy/journey). Nothing about the journey is written in this
// file - it only draws what it is given, so the page can never describe a different journey from
// the one written down (Guy, 5 Oct 2026: one journey, one order, everywhere).
//
// It is optional furniture on a page that works without it: a failed load draws nothing.

import React, { useEffect, useState } from 'react';
import { getBackendBase, getAuthenticatedHeaders } from '../services/api';
import { buildAuthUrl } from '../utils/clientUtils';

// Where each stop happens in the portal, so the map is also the way there (16 Oct 2026). A stop
// with no entry happens somewhere else (a Claude connection, a call with Guy) and shows no link.
// Keys are the stop keys in content/client-journey.json; the words are the stop's own.
const GO = {
  reconnect: { href: '/today', label: 'Open Today - your Reconnect list is there' },
  voice: { href: '/my-wingguy/setup', label: 'Give Wingguy your instructions' },
  linkedin: { href: '/my-wingguy/install', label: 'Install the browser extension' },
  calls: { href: '/settings?view=recorder', label: 'Connect your meeting recorder' },
  rhythm: { href: '/today', label: 'Open Today' },
  newpeople: { href: '/today', label: 'Open Today - new connections are there' },
};

// Whether the full map is unfolded. Folded by default (Guy, 16 Oct 2026): on a laptop the eight
// cards filled the first screen and pushed the hub's doors below the fold, and after the first
// few visits a client only needs two things from the map - how far along, and what is next.
// A client who unfolds it keeps it unfolded on that browser; folding it again is one click.
const OPEN_KEY = 'wingguyJourneyOpen';
const readOpen = () => { try { return window.localStorage.getItem(OPEN_KEY) === '1'; } catch (e) { return false; } };
const writeOpen = (v) => { try { window.localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch (e) { /* private window */ } };

const MARK = {
  done: { label: 'In place', cls: 'bg-emerald-100 text-emerald-800' },
  started: { label: 'Started', cls: 'bg-amber-100 text-amber-800' },
  todo: { label: 'To come', cls: 'bg-gray-100 text-gray-500' },
};

/** `embedded`: drawn inside another page's column (the hub) rather than as a page of its own.
 *  `onLoad(journey)`: the host page hears whether this client is done, so it can hide or show
 *  its own "set up and running" furniture instead of contradicting the map. */
export default function ClientJourney({ embedded = false, onLoad } = {}) {
  const [journey, setJourney] = useState(null);
  const [open, setOpen] = useState(null);       // key of the stop whose detail is showing
  const [expanded, setExpanded] = useState(false); // folded until the browser says otherwise
  const toggle = (v) => { setExpanded(v); writeOpen(v); };

  useEffect(() => { setExpanded(readOpen()); }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getBackendBase()}/api/wingguy/journey`, { headers: getAuthenticatedHeaders(), cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || !data.ok || !data.journey) return;
        setJourney(data.journey);
        if (onLoad) onLoad(data.journey);
        const here = data.journey.stops.find((s) => s.current);
        if (here) setOpen(here.key);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!journey) return null;

  const wrap = embedded ? 'w-full' : 'mx-auto max-w-5xl px-2';
  const Title = embedded ? 'h2' : 'h1';

  if (journey.complete && !expanded) {
    return (
      <div className={`${wrap} pb-6`}>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center gap-3 flex-wrap">
          <span><span className="font-semibold">You are fully set up.</span> All eight stops of your journey are in place.</span>
          <button className="text-emerald-800 underline" onClick={() => toggle(true)}>Show the journey</button>
        </div>
      </div>
    );
  }

  const here = journey.stops.find((s) => s.current) || null;

  if (!expanded) {
    const go = here && GO[here.key];
    return (
      <div className={`${wrap} pb-6`}>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-x-4 gap-y-2 flex-wrap">
          <Title className="text-base font-semibold text-gray-900">{journey.title}</Title>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            {journey.done} of {journey.total} in place
          </span>
          {here && (
            <span className="text-sm text-gray-800">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 mr-2">You are here</span>
              {here.n}. {here.name}
              {go && (
                <>
                  {' '}&middot;{' '}
                  <a href={buildAuthUrl(go.href)} className="font-semibold text-blue-700 hover:underline">{go.label} &rarr;</a>
                </>
              )}
            </span>
          )}
          <button type="button" className="ml-auto text-sm text-emerald-800 underline" onClick={() => toggle(true)}>
            Show all eight stops
          </button>
        </div>
      </div>
    );
  }

  const detail = journey.stops.find((s) => s.key === open) || null;

  return (
    <div className={`${wrap} pb-8`}>
      <div className="flex items-baseline gap-3 flex-wrap">
        <Title className="text-2xl font-semibold tracking-tight text-gray-900">{journey.title}</Title>
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
          {GO[detail.key] && (
            <a href={buildAuthUrl(GO[detail.key].href)} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline">
              {GO[detail.key].label} <span aria-hidden="true">&rarr;</span>
            </a>
          )}
          {/* The reasons Reconnect is stop two belong with stop two (Guy, 16 Oct 2026) - they used
              to be a fold under the whole grid, read by nobody who had not already opened it. */}
          {detail.key === 'reconnect' && journey.whyFirst && (
            <div className="mt-4 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">{journey.whyFirst.heading}</div>
              <p className="mt-1 text-sm font-semibold text-gray-900">{journey.whyFirst.line}</p>
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

      <button type="button" className="mt-3 text-sm text-gray-500 underline" onClick={() => toggle(false)}>
        Fold the journey away
      </button>
    </div>
  );
}
