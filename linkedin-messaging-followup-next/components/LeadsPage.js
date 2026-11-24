"use client";
// The "Your CRM" tab (was "Leads" until Guy renamed it 7 Nov 2026) of the three-tab portal (Owen's layout, 7 Oct 2026): everything about finding or
// fixing a person's record, as opposed to talking to them (that is Today). Search sits first
// because looking someone up is the thing people come here for; the other lead screens are a row
// of doors above it. The old URLs (/, /new-leads, /top-scoring-leads) all still work.

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { UserPlusIcon, TrophyIcon } from '@heroicons/react/24/outline';
import { getClientProfile } from '../utils/clientUtils';
import LeadSearchUpdate from './LeadSearchUpdate';
import { wantsNewLeadSearch } from '../services/api';
import ContactsImport from './ContactsImport';

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

// The same door where contacts are on: the link is unchanged, and the card also carries the
// "Import contacts" button (a button cannot sit inside a link, so the card holds both).
function DoorWithImport({ href, icon: Icon, title, blurb, onImport }) {
  return (
    <div id="new-leads-door" className="flex items-start justify-between gap-3 bg-white border rounded-lg px-4 py-3 hover:border-gray-300">
      <Link href={href} className="flex items-start gap-3 min-w-0 hover:opacity-80">
        <Icon className="h-5 w-5 text-gray-400 mt-0.5 shrink-0" />
        <span>
          <span className="block font-medium text-gray-900">{title}</span>
          <span className="block text-sm text-gray-500">{blurb}</span>
        </span>
      </Link>
      <button type="button" id="import-contacts-open" onClick={onImport} className="shrink-0 text-sm text-blue-700 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-50">
        Import contacts
      </button>
    </div>
  );
}

function LeadsInner() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const features = getClientProfile()?.features || {};
  // Contacts as well as leads (Guy only for now, 24 Nov 2026): the door says so where that is on.
  const [contactsOn, setContactsOn] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => { let alive = true; wantsNewLeadSearch().then((yes) => { if (alive && yes) setContactsOn(true); }); return () => { alive = false; }; }, []);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {contactsOn ? (
          <DoorWithImport href={`/new-leads?${qs}`} icon={UserPlusIcon} title="New leads & contacts" blurb="Just arrived, not yet sorted - add someone by hand or import your contacts" onImport={() => setImportOpen(true)} />
        ) : (
          <Door href={`/new-leads?${qs}`} icon={UserPlusIcon} title="New leads" blurb="Just arrived, not yet sorted - and add someone by hand" />
        )}
        {features.topScoringLeadsHidden !== true && (
          <Door href={`/top-scoring-leads?${qs}`} icon={TrophyIcon} title="Top scoring leads" blurb="Optional: your existing network, best fit first" />
        )}
      </div>
      <LeadSearchUpdate />
      {importOpen ? <ContactsImport onClose={() => setImportOpen(false)} /> : null}
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
