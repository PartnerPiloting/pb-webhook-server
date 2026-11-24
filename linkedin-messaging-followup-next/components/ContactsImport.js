"use client";
// Import contacts from a file (Guy, 24 Nov 2026). The client exports their address book from Google
// Contacts, Outlook or their phone - or brings a newsletter or event list - and uploads it here.
// Everyone in it becomes a CONTACT (someone Wingguy just keeps details for), never a lead.
//
// Two steps on purpose: "Check the file" only COUNTS ("312 new, 48 updated, 9 skipped"), and
// nothing is saved until "Import" is pressed, when the same file is sent again to be written.
import React, { useState } from 'react';
import { importContacts } from '../services/api';

const MAX_BYTES = 8 * 1024 * 1024;

export default function ContactsImport({ onClose }) {
  const [file, setFile] = useState(null);       // { name, text }
  const [listName, setListName] = useState('');
  const [busy, setBusy] = useState('');         // '' | 'checking' | 'importing'
  const [preview, setPreview] = useState(null); // the server's summary, before anything is saved
  const [done, setDone] = useState(null);       // the summary after saving
  const [error, setError] = useState('');

  const pick = async (e) => {
    const f = e.target.files && e.target.files[0];
    setPreview(null); setDone(null); setError('');
    if (!f) { setFile(null); return; }
    if (f.size > MAX_BYTES) { setFile(null); setError('That file is too big (over 8 MB). Split it into smaller files.'); return; }
    try {
      setFile({ name: f.name, text: await f.text() });
    } catch (_) {
      setFile(null); setError('That file could not be read.');
    }
  };

  const send = async (confirm) => {
    if (!file) return;
    setError('');
    setBusy(confirm ? 'importing' : 'checking');
    const r = await importContacts({ filename: file.name, text: file.text, listName: listName.trim(), confirm });
    setBusy('');
    if (!r || !r.ok) { setError((r && r.error) || 'That did not work. Nothing was saved.'); return; }
    if (confirm) { setDone(r.summary); setPreview(null); } else setPreview(r.summary);
  };

  const field = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm';
  return (
    <div id="contacts-import" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Import contacts" className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-medium text-gray-900">Import contacts</h3>
          <button type="button" aria-label="Close" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          Upload a file exported from Google Contacts, Outlook or your phone - or a list with columns such as Name, Email, Phone, Company.
          Everyone in it becomes a contact, not a lead.
        </p>

        {done ? (
          <div id="contacts-import-done" className="mt-4 p-4 rounded-lg bg-green-100 text-green-800 text-sm">
            <p className="font-medium">Imported: {done.line}.</p>
            <p className="mt-1">Search a name on Your CRM to find them.{done.leadsUpdated ? ` ${done.leadsUpdated} of your leads had a blank filled in - that finishes in the next minute or so.` : ''}</p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="contacts-import-file" className="block text-sm font-medium text-gray-700 mb-1">File (.csv or .vcf)</label>
              <input id="contacts-import-file" type="file" accept=".csv,.vcf,.txt,text/csv,text/vcard,text/x-vcard" onChange={pick} className="block w-full text-sm text-gray-700" />
            </div>
            <div>
              <label htmlFor="contacts-import-list" className="block text-sm font-medium text-gray-700 mb-1">Name for this list <span className="font-normal text-gray-500">(optional)</span></label>
              <input id="contacts-import-list" type="text" value={listName} onChange={(e) => { setListName(e.target.value); setPreview(null); }} className={field} placeholder='e.g. "Safe to Say" or "My phone contacts"' />
              <p className="mt-1 text-xs text-gray-500">Shown on each person as where Wingguy knows them from.</p>
            </div>
            {preview ? (
              <div id="contacts-import-preview" className="p-4 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-900">
                <p className="font-medium">{preview.inFile} people in the file: {preview.line}.</p>
                <p className="mt-1">
                  Nothing has been saved yet. New people become contacts. Someone you already have only gets blanks filled in - nothing is overwritten.
                  {preview.leadsUpdated ? ` ${preview.leadsUpdated} of the updates are leads with a blank phone, email or company.` : ''}
                </p>
              </div>
            ) : null}
          </div>
        )}

        {error ? <p id="contacts-import-error" className="mt-3 text-sm text-red-700">{error}</p> : null}

        <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm text-gray-600 hover:underline">{done ? 'Close' : 'Cancel'}</button>
          {done ? null : preview ? (
            <button type="button" id="contacts-import-confirm" onClick={() => send(true)} disabled={!!busy || (preview.new + preview.updated === 0)} className="text-sm font-medium bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700 disabled:opacity-60">
              {busy === 'importing' ? 'Importing…' : 'Import'}
            </button>
          ) : (
            <button type="button" id="contacts-import-check" onClick={() => send(false)} disabled={!file || !!busy} className="text-sm font-medium bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700 disabled:opacity-60">
              {busy === 'checking' ? 'Checking…' : 'Check the file'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
