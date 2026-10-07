"use client";
// The "Setup and help" tab of the three-tab portal (Owen's layout, 7 Oct 2026): the things a client
// touches once, or when something is wrong. The overview comes first because it is the page Owen
// said saves people from being "bamboozled" - the plan, then the detail.

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BookOpenIcon, SparklesIcon, CogIcon } from '@heroicons/react/24/outline';
import { getClientProfile, buildAuthUrl } from '../utils/clientUtils';

function Door({ href, icon: Icon, title, blurb }) {
  return (
    <Link href={href} className="flex items-start gap-3 bg-white border rounded-lg px-4 py-4 hover:bg-gray-50 hover:border-gray-300">
      <Icon className="h-6 w-6 text-gray-400 mt-0.5 shrink-0" />
      <span>
        <span className="block font-medium text-gray-900">{title}</span>
        <span className="block text-sm text-gray-500">{blurb}</span>
      </span>
    </Link>
  );
}

function SetupInner() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const features = getClientProfile()?.features || {};
  // My Wingguy is standalone (its auth is the query string), so its link is rebuilt from the
  // stored auth the same way Layout.js does for its tab.
  const wingguyHref = !searchParams.get('token') && !searchParams.get('devKey') ? buildAuthUrl('/my-wingguy') : `/my-wingguy?${qs}`;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-lg">Setup and help</h2>
        <p className="text-sm text-gray-600">How it all works, your own setup, and the dials.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Door href={`/start-here?${qs}`} icon={BookOpenIcon} title="What Wingguy can do" blurb="The overview - everything it does, and where" />
        {features.wingguy === true && (
          <Door href={wingguyHref} icon={SparklesIcon} title="My Wingguy" blurb="Your setup, and what has changed" />
        )}
        <Door href={`/settings?${qs}`} icon={CogIcon} title="Settings" blurb="Scoring attributes and your profile" />
      </div>
      <p className="text-sm text-gray-500">Stuck on a screen? The <span className="font-medium">?</span> help button on each page explains that page.</p>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={<div className="text-gray-500">Loading…</div>}>
      <SetupInner />
    </Suspense>
  );
}
