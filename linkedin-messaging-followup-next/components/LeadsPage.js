"use client";
// The Leads tab of the three-tab portal (Owen's layout, 7 Oct 2026): everything about finding or
// fixing a person's record, as opposed to talking to them (that is Today). Search sits first
// because looking someone up is the thing people come here for; the other lead screens are a row
// of doors above it. The old URLs (/, /new-leads, /top-scoring-leads) all still work.

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { UserPlusIcon, TrophyIcon } from '@heroicons/react/24/outline';
import { getClientProfile } from '../utils/clientUtils';
import LeadSearchUpdate from './LeadSearchUpdate';

function Door({ href, icon: Icon, title, blurb }) {
  return (
    <Link href={href} className="flex items-start gap-3 bg-white border rounded-lg px-4 py-3 hover:bg-gray-50 hover:border-gray-300">
      <Icon className="h-5 w-5 text-gray-400 mt-0.5 shrink-0" />
      <span>
        <span className="block font-medium text-gray-900">{title}</span>
        <span className="block text-sm text-gray-500">{blurb}</span>
      </span>
    </Link>
  );
}

function LeadsInner() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const features = getClientProfile()?.features || {};
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Door href={`/new-leads?${qs}`} icon={UserPlusIcon} title="New leads" blurb="Just arrived, not yet sorted - and add someone by hand" />
        {features.topScoringLeadsHidden !== true && (
          <Door href={`/top-scoring-leads?${qs}`} icon={TrophyIcon} title="Top scoring leads" blurb="Optional: your existing network, best fit first" />
        )}
      </div>
      <LeadSearchUpdate />
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="text-gray-500">Loading…</div>}>
      <LeadsInner />
    </Suspense>
  );
}
