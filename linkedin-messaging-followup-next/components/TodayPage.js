"use client";
// The Today page - the one place a client works their network, top to bottom.
//
// Owen Pyrah, 7 Oct 2026: "currently you've got a whole bunch of options, and you don't really
// know where to start... you'd start your day, go, okay, I'm going to dedicate half an hour to my
// networking now, come in, so you know then this one, then this one, then this one." Guy added
// the fold: every section starts closed with just its number showing, so the whole morning is
// visible at a glance, and the client picks the order that suits them.
//
// Nothing here decides anything. The four sections are the existing screens rendered as slices:
//   1. New connections to welcome - ThanksForConnecting embedded (highest score first)
//   2. Waiting on you           - FollowUpsQueue section='owed'  (reply owed + needs judgement)
//      Welcome went first on 8 Oct 2026 (Guy, Owen's original order): it is the quick, daily
//      warm-up, and its count lands in a second (no live check). Nothing opens by default.
//   3. Worth picking up again   - FollowUpsQueue section='quiet' (went quiet, drop/park recommended)
//   4. Reconnect                - FollowUpsQueue section='reconnect' (Reconnect + Potential disconnects)
//                                 Its own box since 8 Oct 2026 (Guy): a different job from chasing a
//                                 recent conversation, and folded into box 3 its count was invisible.
//                                 Shown from the start when the profile's Reconnect switch is on
//                                 (counting "…" like the others), then by what /queue returns.
// /api/followups/queue is fetched ONCE here and handed to all three queue sections, so the live
// check of Airtable + calendar + mailbox runs once per visit, not three times.
//
// Every section is mounted even while folded (hidden, not unmounted) so its count is known before
// it is opened. A section whose feature switch is off for this client is simply not shown.

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import { getClientProfile } from '../utils/clientUtils';
import FollowUpsQueue, { apiGet as followupsGet, buildClientId } from './FollowUpsQueue';
import ThanksForConnecting from './ThanksForConnecting';
import HelpButton from './HelpButton';

const TONE = {
  owed: { badge: 'bg-emerald-100 text-emerald-800', zero: 'bg-gray-100 text-gray-500' },
  welcome: { badge: 'bg-blue-100 text-blue-800', zero: 'bg-gray-100 text-gray-500' },
  quiet: { badge: 'bg-gray-200 text-gray-700', zero: 'bg-gray-100 text-gray-500' },
  reconnect: { badge: 'bg-amber-100 text-amber-800', zero: 'bg-gray-100 text-gray-500' },
};

function Section({ id, title, blurb, count, open, onToggle, children }) {
  const tone = TONE[id] || TONE.quiet;
  const known = typeof count === 'number';
  return (
    <section className="bg-white border rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-gray-50"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`today-${id}`}
      >
        <span className={`inline-flex items-center justify-center min-w-[2.25rem] h-9 px-2 rounded-full text-base font-semibold ${known && count > 0 ? tone.badge : tone.zero}`}>
          {known ? count : '…'}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-gray-900">{title}</span>
          <span className="block text-sm text-gray-500">{blurb}</span>
        </span>
        {open ? <ChevronUpIcon className="h-5 w-5 text-gray-400 shrink-0" /> : <ChevronDownIcon className="h-5 w-5 text-gray-400 shrink-0" />}
      </button>
      <div id={`today-${id}`} className={open ? 'border-t px-4 py-4' : 'hidden'}>
        {children}
      </div>
    </section>
  );
}

function TodayInner() {
  const searchParams = useSearchParams();
  // The profile lands a beat after the first paint (Layout fills it after auth), so read it in an
  // effect rather than once at mount - otherwise the greeting never gets the name.
  const [profile, setProfile] = useState(() => getClientProfile());
  useEffect(() => {
    if (profile?.clientName) return undefined;
    const t = setInterval(() => { const p = getClientProfile(); if (p?.clientName) { setProfile(p); clearInterval(t); } }, 250);
    const stop = setTimeout(() => clearInterval(t), 10000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [profile]);
  const features = profile?.features || {};
  const hasQueue = features.followupsScreen === true;
  const hasWelcome = features.thanksForConnecting === true;
  const firstName = String(profile?.clientName || '').trim().split(/\s+/)[0] || '';

  const clientId = useMemo(() => buildClientId(), []);
  const [queue, setQueue] = useState(null);
  const [queueError, setQueueError] = useState(null);
  const [loadSecs, setLoadSecs] = useState(0);

  // One fetch for all the queue sections (see the header comment).
  useEffect(() => {
    if (!hasQueue) return undefined;
    let alive = true;
    setLoadSecs(0);
    const tick = setInterval(() => setLoadSecs((s) => s + 1), 1000);
    (async () => {
      try {
        const data = await followupsGet('/queue', clientId);
        if (alive) setQueue(data || {});
      } catch (e) {
        if (alive) setQueueError(e?.message || 'Failed to load the queue');
      } finally {
        clearInterval(tick);
      }
    })();
    return () => { alive = false; clearInterval(tick); };
  }, [hasQueue, clientId]);

  const [counts, setCounts] = useState({});
  const countOwed = useCallback((n) => setCounts((c) => (c.owed === n ? c : { ...c, owed: n })), []);
  const countWelcome = useCallback((n) => setCounts((c) => (c.welcome === n ? c : { ...c, welcome: n })), []);
  const countQuiet = useCallback((n) => setCounts((c) => (c.quiet === n ? c : { ...c, quiet: n })), []);
  const countReconnect = useCallback((n) => setCounts((c) => (c.reconnect === n ? c : { ...c, reconnect: n })), []);
  const hasReconnect = hasQueue && (queue ? !!queue.reconnect : features.reconnect === true);

  // Which sections are folded open. None by default (Guy, 8 Oct 2026): the client sees every box
  // and its number, then picks one - auto-opening the first jumped them in before they had looked.
  const order = [hasWelcome && 'welcome', hasQueue && 'owed', hasQueue && 'quiet', hasReconnect && 'reconnect'].filter(Boolean);
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const qs = searchParams.toString();
  const waitingOnQueue = hasQueue && !queue && !queueError;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-lg">{firstName ? `Good day, ${firstName}` : 'Today'}</h2>
          <p className="text-sm text-gray-600">
            Work down the page. Each box shows how many are in it - open the one you want to start with.
            {waitingOnQueue && (
              <span className="text-gray-400"> Checking your CRM, calendar and mailbox… {loadSecs}s{loadSecs >= 15 ? ' - nearly there' : ''}</span>
            )}
          </p>
        </div>
        <HelpButton area="followups" className="ml-1" title="Help: Today" />
      </div>

      {order.length === 0 && (
        <div className="bg-white border rounded-lg p-6 text-center text-gray-600">
          Nothing is switched on for this page yet. Your leads are under <Link className="text-blue-700 hover:underline" href={`/leads?${qs}`}>Leads</Link>.
        </div>
      )}

      {hasWelcome && (
        <Section id="welcome" title="New connections to welcome" blurb="Accepted recently, best fit first" count={counts.welcome} open={open.has('welcome')} onToggle={() => toggle('welcome')}>
          <ThanksForConnecting embedded onCount={countWelcome} />
        </Section>
      )}

      {hasQueue && (
        <Section id="owed" title="Waiting on you" blurb="They wrote last - it's your turn" count={counts.owed} open={open.has('owed')} onToggle={() => toggle('owed')}>
          <FollowUpsQueue section="owed" preloaded={queue} preloadError={queueError} onCount={countOwed} />
        </Section>
      )}

      {hasQueue && (
        <Section id="quiet" title="Worth picking up again" blurb="Good conversations that went quiet" count={counts.quiet} open={open.has('quiet')} onToggle={() => toggle('quiet')}>
          <FollowUpsQueue section="quiet" preloaded={queue} preloadError={queueError} onCount={countQuiet} />
        </Section>
      )}

      {hasReconnect && (
        <Section id="reconnect" title="Reconnect" blurb="People you haven't talked to in a long while - a few each day" count={counts.reconnect} open={open.has('reconnect')} onToggle={() => toggle('reconnect')}>
          <FollowUpsQueue section="reconnect" preloaded={queue} preloadError={queueError} onCount={countReconnect} />
        </Section>
      )}
    </div>
  );
}

export default function TodayPage() {
  return (
    <Suspense fallback={<div className="text-gray-500">Loading…</div>}>
      <TodayInner />
    </Suspense>
  );
}
