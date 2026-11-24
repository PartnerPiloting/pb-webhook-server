"use client";
// Add a CONTACT by hand (Guy, 24 Nov 2026). A lead is someone Wingguy works on with the client; a
// contact is someone it just keeps details for. This is the small form the add-by-hand screen shows
// when "Contact" is chosen: a name plus an email or a phone is enough - no LinkedIn address needed.
// It saves to the contacts store, never the leads base, and the server checks first whether the
// email or LinkedIn address already belongs to a lead or a contact.
import React, { useState } from 'react';
import { saveContact } from '../services/api';

const EMPTY = { name: '', company: '', email: '', phone: '', linkedin: '' };

export default function ContactQuickForm() {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { tone: 'ok'|'info'|'error', text }
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); };

  const submit = async (e) => {
    e.preventDefault();
    setResult(null);
    if (!form.name.trim()) { setResult({ tone: 'error', text: 'A contact needs a name.' }); return; }
    if (!form.email.trim() && !form.phone.trim()) { setResult({ tone: 'error', text: 'Add an email or a phone number - one is enough.' }); return; }
    setSaving(true);
    const r = await saveContact(form);
    setSaving(false);
    if (!r || !r.ok) { setResult({ tone: 'error', text: (r && r.error) || 'The contact could not be saved.' }); return; }
    if (r.exists && r.kind === 'lead') {
      setResult({ tone: 'info', text: `${r.name} is already one of your leads, so nothing new was saved. Search their name on Your CRM to open their record.` });
      return;
    }
    if (r.exists) {
      const c = r.contact || {};
      setResult({ tone: 'info', text: `${r.name} is already in your contacts${c.email ? ` (${c.email})` : ''}, so nothing new was saved. Search their name on Your CRM to see or edit their details.` });
      return;
    }
    setResult({ tone: 'ok', text: `Saved ${r.name} to your contacts. Search their name on Your CRM to find them.` });
    setForm(EMPTY);
  };

  const field = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none';
  const tone = { ok: 'bg-green-100 text-green-800', info: 'bg-blue-50 text-blue-900 border border-blue-200', error: 'bg-red-100 text-red-800' };
  return (
    <form id="contact-quick-form" onSubmit={submit} className="space-y-4 max-w-xl">
      {result ? <div id="contact-quick-result" className={`p-4 rounded-lg text-sm ${tone[result.tone]}`}>{result.text}</div> : null}
      <div>
        <label htmlFor="contact-name" className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
        <input id="contact-name" type="text" value={form.name} onChange={set('name')} className={field} placeholder="Jane Smith" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input id="contact-email" type="email" value={form.email} onChange={set('email')} className={field} placeholder="jane@example.com" />
        </div>
        <div>
          <label htmlFor="contact-phone" className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input id="contact-phone" type="tel" value={form.phone} onChange={set('phone')} className={field} placeholder="0412 345 678" />
        </div>
      </div>
      <p className="text-xs text-gray-500 -mt-2">An email or a phone number - one is enough.</p>
      <div>
        <label htmlFor="contact-company" className="block text-sm font-medium text-gray-700 mb-1">Company</label>
        <input id="contact-company" type="text" value={form.company} onChange={set('company')} className={field} />
      </div>
      <div>
        <label htmlFor="contact-linkedin" className="block text-sm font-medium text-gray-700 mb-1">LinkedIn address <span className="font-normal text-gray-500">(optional)</span></label>
        <input id="contact-linkedin" type="text" value={form.linkedin} onChange={set('linkedin')} className={field} placeholder="https://www.linkedin.com/in/username" />
      </div>
      <button type="submit" id="contact-quick-save" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
        {saving ? 'Saving…' : 'Save contact'}
      </button>
    </form>
  );
}
