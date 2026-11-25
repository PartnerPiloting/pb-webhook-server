"use client";
import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import InlineEditableText, { validators, formatters } from './InlineEditableText';
import InlineEditableSelect from './InlineEditableSelect';

// Lazy load inline editor so first paint stays light
const InlineSearchTermsEditor = dynamic(() => import('./InlineSearchTermsEditor'), { ssr: false, loading: () => <span className="text-xs text-gray-400">…</span> });

const KIND_LEAD = 'px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800';
const KIND_CONTACT = 'px-2 py-0.5 rounded-full text-xs bg-gray-200 text-gray-800';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const stop = (e) => e.stopPropagation();
const telHref = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;

/** A person's email, phone and LinkedIn, each one a link (mailto: / tel: / their profile). Clicking one
 * never opens the row. */
function ReachLines({ email, phone, linkedin }) {
  const e = String(email || '').trim();
  const p = String(phone || '').trim();
  const l = String(linkedin || '').trim();
  if (!e && !p && !l) return <span className="text-gray-400">-</span>;
  return (
    <span className="block space-y-0.5">
      {e ? <a href={`mailto:${e}`} onClick={stop} className="block text-blue-700 hover:underline break-all">{e}</a> : null}
      {p ? <a href={telHref(p)} onClick={stop} className="block text-blue-700 hover:underline whitespace-nowrap">{p}</a> : null}
      {l ? <a href={l} target="_blank" rel="noopener noreferrer" onClick={stop} className="block text-xs text-gray-500 hover:underline">LinkedIn profile</a> : null}
    </span>
  );
}

// Self-contained table with the same props shape used by LeadSearchEnhanced
export default function LeadSearchTableDirect({
  leads = [],
  totalLeads = 0,
  currentPage = 1,
  leadsPerPage = 25,
  onLeadSelect,
  selectedLead = null,
  isLoading = false,
  onQuickFieldUpdate,
  hideFooter = false, // when true, suppress internal footer so parent can render a unified pagination bar
  sortField: propSortField = null, // Server-side sort field from parent
  sortDirection: propSortDirection = null, // Server-side sort direction from parent  
  onSortChange = null, // Callback when sort changes (for server-side sorting)
  showCampaign = false, // Show the Campaign column (the Lead Search campaign filter is on for this client)
  flagUnlabelled = false, // Mark people who have no tag yet
  // A name is typed and contacts ride along (Lead Search, 23 Nov 2026): every row says Lead or
  // Contact, and the people in `contacts` - who are NOT leads - follow the leads in the same table.
  showKind = false,
  contacts = [], // [{ id, name, email, phone, linkedin, company, knownFrom, add: { state, leadRecordId, text } }]
  contactsMore = false, // more contacts matched than are shown
  onAddContact = null,
  onEditContact = null // (contact, fields) => { ok, contact, error } - Edit on the details card
}) {
  // Use local state only if no parent-controlled sort (backwards compatible)
  const [localSortKey, setLocalSortKey] = useState('AI Score');
  const [localSortDir, setLocalSortDir] = useState('desc');
  
  // Use parent props if provided, otherwise fall back to local state
  const sortKey = propSortField ?? localSortKey;
  const sortDir = propSortDirection ?? localSortDir;

  // The Campaign column shows only where the Lead Search campaign filter does (showCampaign).
  // IN A NAME SEARCH (showKind - Guy, 24 Nov 2026): people look someone up to see their details, and
  // Email / Phone / LinkedIn sat at the far right, off the screen, behind columns that are blank for
  // a contact. So those three become ONE column, "Email & phone", directly after the name, and the
  // table is set tighter with long text wrapping, so it fits a laptop without scrolling sideways.
  // With no name typed - and for every other client - the columns are exactly as they were.
  const columns = [
    { key: 'fullName', label: 'Name', sortable: true },
    ...(showKind ? [{ key: 'reach', label: 'Email & phone', sortable: false }] : []),
    { key: 'Company', label: 'Company', sortable: true },
    { key: 'location', label: 'Location', sortable: true },
    { key: 'AI Score', label: 'Score', sortable: true, isNumeric: true },
    { key: 'Priority', label: 'Priority', sortable: true },
    { key: 'Status', label: 'Status', sortable: true },
    { key: 'Date Connected', label: 'Connected', sortable: true, isDate: true },
    ...(showCampaign ? [{ key: 'campaign', label: 'Campaign', sortable: false }] : []),
    // "Tags (Search Terms)" where the new Lead Search wording is on (Guy only for now, 24 Nov 2026) - the
    // same label as the filter heading and the lead record. The field itself is unchanged.
    { key: 'searchTerms', label: flagUnlabelled ? 'Tags (Search Terms)' : 'Search Terms', sortable: false },
    ...(showKind ? [] : [
      { key: 'linkedinProfileUrl', label: 'LinkedIn', sortable: false },
      { key: 'email', label: 'Email', sortable: false },
      { key: 'phone', label: 'Phone', sortable: false },
    ]),
  ];
  // Cell + heading spacing: the usual roomy one-line cells, or the tighter wrapping ones of a name search.
  const WRAP = { fullName: 'max-w-[13rem]', reach: 'min-w-[15rem] max-w-[18rem]', Company: 'max-w-[11rem]', location: 'max-w-[9rem]', campaign: 'max-w-[11rem]', searchTerms: 'max-w-[10rem]' };
  const cellClass = (key) => (showKind
    ? `px-3 py-3 text-sm align-top relative ${WRAP[key] ? `whitespace-normal break-words ${WRAP[key]}` : 'whitespace-nowrap'}`
    : 'px-6 py-4 whitespace-nowrap text-sm align-top relative');


  const getCellValue = (lead, key) => {
    if (key === 'fullName') {
      const firstName = lead['First Name'] || '';
      const lastName = lead['Last Name'] || '';
      return `${firstName} ${lastName}`.trim() || 'Unnamed';
    }
    if (key === 'location') {
      return lead.location || lead['Location'] || '';
    }
    const value = lead[key];
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return '';
    return String(value);
  };

  const sortedLeads = useMemo(() => {
    if (!leads || leads.length === 0) return [];
    return [...leads].sort((a, b) => {
      const aVal = getCellValue(a, sortKey);
      const bVal = getCellValue(b, sortKey);
      const column = columns.find((col) => col.key === sortKey);
      if (column?.isDate) {
        // Not connected yet (no date) always sits at the bottom, either direction
        if (!aVal || !bVal) return (aVal ? 0 : 1) - (bVal ? 0 : 1);
        const diff = new Date(aVal) - new Date(bVal);
        return sortDir === 'asc' ? diff : -diff;
      }
      if (column?.isNumeric) {
        const aNum = parseFloat(aVal) || 0;
        const bNum = parseFloat(bVal) || 0;
        return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
      }
      const comparison = aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [leads, sortKey, sortDir]);

  const handleHeaderClick = (columnKey) => {
    const column = columns.find((col) => col.key === columnKey);
    if (!column?.sortable) return;
    
    let newSortKey = columnKey;
    let newSortDir;
    
    if (sortKey === columnKey) {
      // Toggle direction
      newSortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      // New column - default direction based on type
      newSortDir = column.isNumeric || column.isDate ? 'desc' : 'asc';
    }
    
    // If parent controls sorting (server-side), notify parent
    if (onSortChange) {
      onSortChange(newSortKey, newSortDir);
    } else {
      // Otherwise use local state (client-side sorting)
      setLocalSortKey(newSortKey);
      setLocalSortDir(newSortDir);
    }
  };

  const renderSearchTerms = (lead) => <InlineSearchTermsEditor lead={lead} />;

  const renderLinkedIn = (lead) => {
    const url = lead['LinkedIn Profile URL'] || lead['linkedinProfileUrl'] || '';
    if (!url) return <span className="text-gray-400 text-sm">-</span>;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center px-2 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded text-xs text-blue-700 transition-colors"
        title="Open LinkedIn Profile"
      >
        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
        Profile
      </a>
    );
  };

  const renderCell = (lead, column) => {
    const { key } = column;
    if (key === 'reach') return <ReachLines email={lead['Email'] || lead.email} phone={lead['Phone'] || lead.phone} linkedin={lead['LinkedIn Profile URL'] || lead.linkedinProfileUrl} />;
    if (key === 'searchTerms') return renderSearchTerms(lead);
    if (key === 'email') {
      return (
        <InlineEditableText
          lead={lead}
          field="email"
          value={lead['Email'] || lead.email || ''}
          type="email"
          placeholder="Add email"
          validate={validators.email}
          maxLength={120}
          onUpdated={(val)=> onQuickFieldUpdate && onQuickFieldUpdate(lead.id || lead.recordId || lead['Profile Key'], { email: val, Email: val })}
        />
      );
    }
    if (key === 'phone') {
      return (
        <InlineEditableText
          lead={lead}
          field="phone"
          value={lead['Phone'] || lead.phone || ''}
          type="tel"
          placeholder="Add phone"
          validate={validators.phone}
          formatOnBlur={formatters.phone}
          maxLength={24}
          onUpdated={(val)=> onQuickFieldUpdate && onQuickFieldUpdate(lead.id || lead.recordId || lead['Profile Key'], { phone: val, Phone: val })}
        />
      );
    }
    if (key === 'linkedinProfileUrl') return renderLinkedIn(lead);
    if (key === 'Priority') {
      return (
        <InlineEditableSelect
          lead={lead}
          field="priority"
          value={lead['Priority'] || lead.priority || ''}
          options={['One', 'Two', 'Three']}
          placeholder="—"
          onUpdated={(val) => onQuickFieldUpdate && onQuickFieldUpdate(lead.id || lead.recordId || lead['Profile Key'], { priority: val, Priority: val })}
        />
      );
    }
    if (key === 'AI Score') {
      const score = lead[key];
      if (!score) return <span className="text-gray-400">-</span>;
      const numScore = parseFloat(score);
      const colorClass = numScore >= 75 ? 'text-green-600' : numScore >= 50 ? 'text-yellow-600' : 'text-red-600';
      return <span className={`font-medium ${colorClass}`}>{score}</span>;
    }
    if (key === 'Status') {
      const status = lead[key];
      if (!status) return <span className="text-gray-400">-</span>;
      const colorMap = {
        'In Progress': 'bg-blue-100 text-blue-800',
        Completed: 'bg-green-100 text-green-800',
        Pending: 'bg-yellow-100 text-yellow-800',
        Failed: 'bg-red-100 text-red-800',
      };
      const colorClass = colorMap[status] || 'bg-gray-100 text-gray-800';
      return <span className={`px-2 py-1 rounded-full text-xs ${colorClass}`}>{status}</span>;
    }
    if (key === 'Date Connected') {
      const dc = lead['Date Connected'];
      if (!dc) return <span className="text-gray-400 text-sm">Not connected</span>;
      const d = new Date(dc);
      return isNaN(d.getTime())
        ? String(dc)
        : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    const value = getCellValue(lead, key);
    if (key === 'fullName') {
      const noTag = flagUnlabelled && !String(lead['Search Terms'] || '').trim();
      if (showKind || noTag) {
        return (
          <span>
            {value || <span className="text-gray-400 text-sm">-</span>}
            <span className={showKind ? 'block mt-1 space-x-1' : 'block mt-1'}>
              {showKind ? <span className={KIND_LEAD}>Lead</span> : null}
              {noTag ? <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800" title="Nothing in Search Terms yet">No tag</span> : null}
            </span>
          </span>
        );
      }
    }
    return value || <span className="text-gray-400 text-sm">-</span>;
  };

  // One cell of a CONTACT row. People look a contact up to SEE THEIR DETAILS (Guy, 24 Nov 2026), so
  // email and phone are the main thing on the row and clickable. Score, priority, status, connected,
  // campaign and tags are a lead's and stay blank. "Make this contact a lead" is not on the row - it is a quiet
  // action inside the details card the row opens.
  const renderContactCell = (c, column) => {
    const { key } = column;
    const added = c.add && c.add.state === 'added';
    if (key === 'fullName') {
      return (
        <span>
          {c.name || c.email || 'Unnamed'}
          <span className="block mt-1">
            <span className={added ? KIND_LEAD : KIND_CONTACT}>{added ? 'Lead' : 'Contact'}</span>
          </span>
          {added ? <span className="block mt-1 text-xs text-green-700">Now one of your leads</span> : null}
        </span>
      );
    }
    if (key === 'reach') return <ReachLines email={c.email} phone={c.phone} linkedin={c.linkedin} />;
    if (key === 'Company') return c.company || (c.headline ? <span className="text-gray-500">{c.headline}</span> : '');
    if (key === 'email') return c.email ? <a href={`mailto:${c.email}`} onClick={stop} className="text-blue-600 hover:underline">{c.email}</a> : '';
    if (key === 'phone') return c.phone ? <a href={telHref(c.phone)} onClick={stop} className="text-blue-600 hover:underline">{c.phone}</a> : '';
    if (key === 'linkedinProfileUrl') {
      return c.linkedin
        ? <a href={c.linkedin} target="_blank" rel="noopener noreferrer" onClick={stop} className="text-blue-600 hover:underline">Profile</a>
        : '';
    }
    return '';
  };

  // The details card a contact row opens.
  const [openContactId, setOpenContactId] = useState(null);
  // Edit on the card: null = reading, otherwise the fields being typed.
  const [editDraft, setEditDraft] = useState(null);
  const [editState, setEditState] = useState({ saving: false, error: '' });
  const closeCard = () => { setOpenContactId(null); setEditDraft(null); setEditState({ saving: false, error: '' }); };
  const startEdit = (c) => { setEditState({ saving: false, error: '' }); setEditDraft({ name: c.name || '', company: c.company || '', email: c.email || '', phone: c.phone || '', linkedin: c.linkedin || '' }); };
  const saveEdit = async (c) => {
    if (!onEditContact) return;
    setEditState({ saving: true, error: '' });
    const r = await onEditContact(c, editDraft);
    if (r && r.ok) { setEditDraft(null); setEditState({ saving: false, error: '' }); }
    else setEditState({ saving: false, error: (r && r.error) || 'Could not save the changes.' });
  };
  const openContact = showKind ? contacts.find((c) => c.id === openContactId) : null;
  // The warehouse holds one row per address, so the same person can sit on two rows: the card also
  // lists the other addresses found under exactly the same name in this search.
  const sameNameEmails = openContact && String(openContact.name || '').trim()
    ? contacts.filter((c) => c.id !== openContact.id && c.email && String(c.name || '').trim().toLowerCase() === String(openContact.name).trim().toLowerCase()).map((c) => c.email)
    : [];

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/4" />
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-4 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if ((!sortedLeads || sortedLeads.length === 0) && !(showKind && contacts.length)) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Search Results (showing 0)
          <span className="ml-2 text-sm font-normal text-gray-500">Sorted by Score (descending)</span>
        </h3>
        <div className="text-center py-8">
          <div className="text-gray-500">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">{showKind ? 'Nobody found' : 'No leads found'}</h3>
            <p className="mt-1 text-sm text-gray-500">Try adjusting your search criteria</p>
          </div>
        </div>
      </div>
    );
  }

  // a contact just added from this list is a lead now - the count line says so
  const addedCount = showKind ? contacts.filter((c) => c.add && c.add.state === 'added').length : 0;
  const startIndex = (currentPage - 1) * leadsPerPage + 1;
  const endIndex = Math.min(startIndex + sortedLeads.length - 1, totalLeads);

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900">
          {showKind
            ? `Search results: ${plural((totalLeads || sortedLeads.length) + addedCount, 'lead')}, ${plural(contacts.length - addedCount, 'contact')}`
            : `Search Results (showing ${sortedLeads.length}${totalLeads ? ` of ${totalLeads}` : ''})`}
          {showKind && contactsMore ? <span className="ml-2 text-sm font-normal text-gray-500">(the first {contacts.length} contacts - more match, type more of the name)</span> : null}
          <span className="ml-2 text-sm font-normal text-gray-500">
            Sorted by {columns.find((col) => col.key === sortKey)?.label || sortKey} ({sortDir === 'asc' ? 'ascending' : 'descending'})
          </span>
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  onClick={() => handleHeaderClick(column.key)}
                  className={`${showKind ? 'px-3' : 'px-6'} py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${column.sortable ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                >
                  <div className="flex items-center space-x-1">
                    <span>{column.label}</span>
                    {column.sortable && (
                      <div className="flex flex-col">
                        <svg className={`w-3 h-3 ${sortKey === column.key && sortDir === 'asc' ? 'text-gray-900' : 'text-gray-400'}`} fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                        </svg>
                        <svg className={`w-3 h-3 -mt-1 ${sortKey === column.key && sortDir === 'desc' ? 'text-gray-900' : 'text-gray-400'}`} fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedLeads.map((lead, index) => (
              <tr
                key={lead.id || index}
                onClick={() => onLeadSelect && onLeadSelect(lead)}
                className={`${onLeadSelect ? 'cursor-pointer hover:bg-gray-50' : ''} ${selectedLead?.id === lead.id ? 'bg-blue-50' : ''}`}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cellClass(column.key)}
                    style={{ overflow: 'visible' }}
                  >
                    {renderCell(lead, column)}
                  </td>
                ))}
              </tr>
            ))}
            {showKind && contacts.map((c) => {
              const added = c.add && c.add.state === 'added' && c.add.leadRecordId;
              return (
                <tr
                  key={`contact-${c.id}`}
                  data-kind={added ? 'lead' : 'contact'}
                  onClick={() => { if (added && onLeadSelect) onLeadSelect({ id: c.add.leadRecordId }); else setOpenContactId(c.id); }}
                  className="cursor-pointer bg-gray-50/50 hover:bg-gray-100"
                >
                  {columns.map((column) => (
                    <td key={column.key} className={cellClass(column.key)}>
                      {renderContactCell(c, column)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openContact && (
        <div id="contact-card" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={closeCard}>
          <div role="dialog" aria-label="Contact details" className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={stop}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-lg font-medium text-gray-900">{openContact.name || openContact.email || 'Unnamed'}</h4>
                {openContact.company ? <div className="text-sm text-gray-600">{openContact.company}</div> : null}
                {openContact.headline && openContact.headline !== openContact.company ? <div id="contact-card-headline" className="text-sm text-gray-500">{openContact.headline}</div> : null}
                <span className={`inline-block mt-1 ${openContact.add && openContact.add.state === 'added' ? KIND_LEAD : KIND_CONTACT}`}>{openContact.add && openContact.add.state === 'added' ? 'Lead' : 'Contact'}</span>
              </div>
              <button type="button" aria-label="Close" onClick={closeCard} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            {editDraft ? (
              <form id="contact-card-edit" className="mt-4 space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); saveEdit(openContact); }}>
                {[['name', 'Name', 'text'], ['company', 'Company', 'text'], ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'], ['linkedin', 'LinkedIn address', 'text']].map(([k, label, type]) => (
                  <label key={k} className="block">
                    <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
                    <input
                      type={type}
                      name={`contact-edit-${k}`}
                      value={editDraft[k]}
                      onChange={(e) => setEditDraft((d) => ({ ...d, [k]: e.target.value }))}
                      className="mt-0.5 w-full px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </label>
                ))}
                {editState.error ? <p id="contact-card-edit-error" className="text-xs text-red-700">{editState.error}</p> : null}
                <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-3">
                  <button type="button" onClick={() => { setEditDraft(null); setEditState({ saving: false, error: '' }); }} className="text-sm text-gray-600 hover:underline">Cancel</button>
                  <button type="submit" id="contact-card-save" disabled={editState.saving} className="text-sm font-medium bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700 disabled:opacity-60">
                    {editState.saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            ) : (
              <>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Email</dt>
                <dd className="mt-0.5 space-y-0.5">
                  {[openContact.email, ...(openContact.otherEmails || [])].filter(Boolean).map((e) => (
                    <a key={e} href={`mailto:${e}`} className="block text-blue-600 hover:underline break-all">{e}</a>
                  ))}
                  {!openContact.email ? <span className="text-gray-400">None on file</span> : null}
                  {sameNameEmails.length ? (
                    <span className="block pt-1 text-xs text-gray-500">Also under this name: {sameNameEmails.map((e, i) => (
                      <React.Fragment key={e}>{i ? ', ' : ''}<a href={`mailto:${e}`} className="text-blue-600 hover:underline break-all">{e}</a></React.Fragment>
                    ))}</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Phone</dt>
                <dd className="mt-0.5">{openContact.phone ? <a href={telHref(openContact.phone)} className="text-blue-600 hover:underline">{openContact.phone}</a> : <span className="text-gray-400">None on file</span>}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">LinkedIn</dt>
                <dd className="mt-0.5">{openContact.linkedin ? <a href={openContact.linkedin} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{openContact.linkedin}</a> : <span className="text-gray-400">None on file</span>}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Wingguy knows them from</dt>
                <dd className="mt-0.5 text-gray-800">{openContact.knownFrom || 'your contacts'}</dd>
              </div>
              <p id="contact-card-why" className="text-xs text-gray-500">
                Leads are people Wingguy is working on with you. Contacts are people it has only come across, such as in your email. Search to look a contact up.
              </p>
            </dl>
            <div className="mt-5 pt-4 border-t border-gray-100 flex items-start justify-between gap-3">
              {openContact.add && openContact.add.state === 'added' ? (
                <>
                  <span className="text-sm text-green-700">Now one of your leads</span>
                  <button type="button" id="contact-card-open-lead" onClick={() => { const id = openContact.add.leadRecordId; closeCard(); if (onLeadSelect && id) onLeadSelect({ id }); }} className="text-sm text-blue-700 hover:underline">Open their lead record</button>
                </>
              ) : (
                <>
                  <span className="text-xs text-gray-500">
                    {openContact.add && openContact.add.state === 'error' ? <span className="block text-red-700">{openContact.add.text}</span> : null}
                    {onEditContact ? <button type="button" id="contact-card-edit-open" onClick={() => startEdit(openContact)} className="text-sm text-blue-700 hover:underline whitespace-nowrap">Edit details</button> : 'Not one of your leads.'}
                  </span>
                  <span className="text-right">
                    <button
                      type="button"
                      id="contact-card-add"
                      onClick={() => onAddContact && onAddContact(openContact)}
                      disabled={openContact.add && openContact.add.state === 'adding'}
                      className="text-sm text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-60"
                    >
                      {openContact.add && openContact.add.state === 'adding' ? 'Adding…' : 'Make this contact a lead'}
                    </button>
                    <span id="contact-card-add-note" className="mt-1 block text-xs text-gray-500">Wingguy will then keep track of your conversations with them and remind you to follow up.</span>
                  </span>
                </>
              )}
            </div>
              </>
            )}
          </div>
        </div>
      )}

      {!hideFooter && (
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700">
              Page {currentPage} - Showing {sortedLeads.length} {sortedLeads.length === 1 ? 'lead' : 'leads'} (up to {leadsPerPage} per page)
            </div>
            <div className="text-xs text-gray-500">{startIndex}–{endIndex}</div>
          </div>
        </div>
      )}
    </div>
  );
}
