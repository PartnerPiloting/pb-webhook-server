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
import ContactQuickForm from './ContactQuickForm';

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

// The same door where contacts are on. Clicking the card still opens the "just arrived" lists; beside
// it sit three plain buttons, each going straight to its form with no question first (Guy, 24 Nov
// 2026): Add a lead, Add a contact, Import contacts. (A button cannot sit inside a link, so the card
// holds the link and the buttons side by side.)
function DoorWithActions({ href, addLeadHref, icon: Icon, title, blurb, onAddContact, onImport }) {
  const btn = 'shrink-0 text-sm text-blue-700 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-50 whitespace-nowrap';
  return (
    <div id="new-leads-door" className="bg-white border rounded-lg px-4 py-3 hover:border-gray-300">
      <Link href={href} className="flex items-start gap-3 min-w-0 hover:opacity-80">
        <Icon className="h-5 w-5 text-gray-400 mt-0.5 shrink-0" />
        <span>
          <span className="block font-medium text-gray-900">{title}</span>
          <span className="block text-sm text-gray-500">{blurb}</span>
        </span>
      </Link>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={addLeadHref} id="add-lead-open" className={btn}>Add a lead</Link>
        <button type="button" id="add-contact-open" onClick={onAddContact} className={btn}>Add a contact</button>
        <button type="button" id="import-contacts-open" onClick={onImport} className={btn}>Import contacts</button>
      </div>
    </div>
  );
}

/** "Add a contact": the short form, straight away, over the page. */
function AddContactPanel({ onClose }) {
  return (
    <div id="add-contact-panel" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Add a contact" className="bg-white rounded-lg shadow-xl w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-medium text-gray-900">Add a contact</h3>
          <button type="button" aria-label="Close" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <p id="contact-form-purpose" className="mt-1 mb-4 text-sm text-gray-700">A contact is someone Wingguy just keeps their details for.</p>
        <ContactQuickForm />
      </div>
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
  const [addContactOpen, setAddContactOpen] = useState(false);
  useEffect(() => { let alive = true; wantsNewLeadSearch().then((yes) => { if (alive && yes) setContactsOn(true); }); return () => { alive = false; }; }, []);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {contactsOn ? (
          <DoorWithActions href={`/new-leads?${qs}`} addLeadHref={`/new-leads?${qs ? `${qs}&` : ''}add=lead`} icon={UserPlusIcon} title="New leads & contacts" blurb="Just arrived, not yet sorted - add someone by hand or import your contacts" onAddContact={() => setAddContactOpen(true)} onImport={() => setImportOpen(true)} />
        ) : (
          <Door href={`/new-leads?${qs}`} icon={UserPlusIcon} title="New leads" blurb="Just arrived, not yet sorted - and add someone by hand" />
        )}
        {features.topScoringLeadsHidden !== true && (
          <Door href={`/top-scoring-leads?${qs}`} icon={TrophyIcon} title="Top scoring leads" blurb="Optional: your existing network, best fit first" />
        )}
      </div>
      <LeadSearchUpdate />
      {importOpen ? <ContactsImport onClose={() => setImportOpen(false)} /> : null}
      {addContactOpen ? <AddContactPanel onClose={() => setAddContactOpen(false)} /> : null}
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
