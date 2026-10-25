"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ClockIcon, CheckCircleIcon, ExclamationTriangleIcon, PaperAirplaneIcon, PencilSquareIcon,
  XCircleIcon, ArrowPathIcon, ChevronDownIcon, ChevronUpIcon, CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import {
  getScheduledEmails, getScheduledEmail, approveScheduledEmail, editScheduledEmail,
  moveScheduledEmail, cancelScheduledEmail, sendScheduledEmailNow,
} from '../services/scheduledEmailsApi';

/**
 * Scheduled - every email queued to send from the coach's own mailbox (Guy, 25 Oct 2026: "I need
 * more control ... I can't see, for example, Rick's email"). Open one to see it exactly as it will
 * arrive; approve the ones Claude wrote for him (they never send until approved); change the
 * words, the time, cancel, or send now. Nothing here sends on its own except at the time shown,
 * and each email is checked again just before it goes.
 */

const GROUPS = [
  { key: 'awaiting', title: 'Needs your OK', help: 'Written for you - these will not go until you approve them.', tone: 'amber' },
  { key: 'held', title: 'Held - need you', help: 'Stopped just before sending. Read why, then send it, move it or cancel it.', tone: 'red' },
  { key: 'scheduled', title: 'Scheduled', help: 'These go by themselves at the time shown, after a last check.', tone: 'blue' },
  { key: 'sent', title: 'Sent in the last 14 days', help: '', tone: 'gray' },
];
const TONE = {
  amber: 'border-amber-300 bg-amber-50', red: 'border-red-300 bg-red-50', blue: 'border-blue-200 bg-white', gray: 'border-gray-200 bg-gray-50',
};
const KIND = { weekly: 'Weekly email', intro: 'Introduction', email: 'Email' };

const names = (list) => (list || []).map((p) => p.name || p.email).join(', ');

/** ISO -> the value a datetime-local box wants, in this browser's clock. */
function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EmailCard({ item, tone, onChanged }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('view'); // view | edit | move
  const [subject, setSubject] = useState('');
  const [when, setWhen] = useState('');
  const [note, setNote] = useState(null);
  const bodyRef = useRef(null);

  const load = useCallback(async () => {
    const r = await getScheduledEmail(item.id);
    if (r && r.success) { setDetail(r.email); setSubject(r.email.subject); setWhen(toLocalInput(r.email.sendAt)); }
  }, [item.id]);

  useEffect(() => { if (open && !detail) load(); }, [open, detail, load]);

  const run = async (fn, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      setNote({ ok: !!r.success, text: r.message || (r.success ? 'Done.' : 'That did not work.') });
      if (r.success) { setMode('view'); setDetail(null); await onChanged(); if (open) await load(); }
    } finally { setBusy(false); }
  };

  const editable = ['awaiting', 'scheduled', 'held', 'failed'].includes(item.status);

  return (
    <div className={`border rounded-lg ${TONE[tone]} mb-3`}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">{KIND[item.kind] || item.kind} · #{item.id}</div>
          <div className="font-medium text-gray-900 truncate">{item.subject}</div>
          <div className="text-sm text-gray-600 truncate">To {names(item.to)}{item.cc && item.cc.length ? ` and ${names(item.cc)}` : ''}</div>
          {(item.status === 'held' || item.status === 'failed') && (
            <div className="text-sm text-red-700 mt-1 flex items-start gap-1"><ExclamationTriangleIcon className="h-4 w-4 mt-0.5 shrink-0" />{item.holdReason || item.result}</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm text-gray-700 flex items-center gap-1 justify-end">
            {item.status === 'sent' ? <CheckCircleIcon className="h-4 w-4 text-green-600" /> : <ClockIcon className="h-4 w-4 text-gray-500" />}
            {item.status === 'sent' ? 'Sent ' : ''}{item.when}
          </div>
          <div className="text-xs text-gray-500">your time</div>
          {open ? <ChevronUpIcon className="h-4 w-4 ml-auto mt-1 text-gray-500" /> : <ChevronDownIcon className="h-4 w-4 ml-auto mt-1 text-gray-500" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {!detail && <div className="text-sm text-gray-500">Loading the email...</div>}
          {detail && mode === 'view' && (
            <>
              <div className="text-sm text-gray-700 mb-2"><span className="text-gray-500">Subject:</span> {detail.subject}</div>
              <iframe title={`email-${item.id}`} sandbox="" srcDoc={`<!doctype html><html><body style="margin:12px">${detail.html}</body></html>`} className="w-full bg-white border border-gray-200 rounded" style={{ height: 460 }} />
            </>
          )}
          {detail && mode === 'edit' && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2 mb-3 text-sm" />
              <label className="block text-sm text-gray-600 mb-1">Email - click into it and change the words</label>
              <div ref={bodyRef} contentEditable suppressContentEditableWarning className="w-full bg-white border border-gray-300 rounded p-3 text-sm min-h-[240px] max-h-[520px] overflow-auto" dangerouslySetInnerHTML={{ __html: detail.rawHtml }} />
              <div className="flex gap-2 mt-3">
                <button type="button" disabled={busy} onClick={() => run(() => editScheduledEmail(item.id, { subject, html: bodyRef.current ? bodyRef.current.innerHTML : detail.rawHtml }))} className="px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">Save changes</button>
                <button type="button" onClick={() => setMode('view')} className="px-3 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200">Back</button>
              </div>
            </div>
          )}
          {detail && mode === 'move' && (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Send at (your time)</label>
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              <button type="button" disabled={busy || !when} onClick={() => run(() => moveScheduledEmail(item.id, new Date(when).toISOString()))} className="px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">Move it</button>
              <button type="button" onClick={() => setMode('view')} className="px-3 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200">Back</button>
            </div>
          )}

          {note && <div className={`mt-3 text-sm rounded px-3 py-2 ${note.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>{note.text}</div>}

          {detail && mode === 'view' && editable && (
            <div className="flex flex-wrap gap-2 mt-3">
              {item.status === 'awaiting' && (
                <button type="button" disabled={busy} onClick={() => run(() => approveScheduledEmail(item.id))} className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"><CheckCircleIcon className="h-4 w-4" />Approve</button>
              )}
              <button type="button" disabled={busy} onClick={() => setMode('edit')} className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"><PencilSquareIcon className="h-4 w-4" />Edit</button>
              <button type="button" disabled={busy} onClick={() => setMode('move')} className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"><CalendarDaysIcon className="h-4 w-4" />Move</button>
              <button type="button" disabled={busy} onClick={() => run(() => sendScheduledEmailNow(item.id), `Send "${item.subject}" now?`)} className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"><PaperAirplaneIcon className="h-4 w-4" />Send now</button>
              <button type="button" disabled={busy} onClick={() => run(() => cancelScheduledEmail(item.id), `Cancel "${item.subject}"? It will not go.`)} className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded bg-white border border-red-200 text-red-700 hover:bg-red-50"><XCircleIcon className="h-4 w-4" />Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ScheduledEmails() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getScheduledEmails();
      if (r && r.success) { setData(r); setError(null); } else setError((r && r.error) || 'Could not load the queue.');
    } catch (e) {
      setError(e.response && e.response.status === 403 ? 'This page is for the coach only.' : e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Scheduled emails</h2>
          <p className="text-sm text-gray-600">Sent from your own mailbox at the time shown, after a last check. Open one to see it exactly as it will arrive.</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading} className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      {data && data.away && (
        <div className="mb-4 rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-900">
          You're away {data.away.from} to {data.away.until}: introductions wait for your return, weekly emails still go.
        </div>
      )}
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {!data && !error && <div className="text-sm text-gray-500">Loading...</div>}

      {data && GROUPS.map((g) => {
        const items = data.emails.filter((e) => (g.key === 'held' ? ['held', 'failed'].includes(e.status) : e.status === g.key));
        if (!items.length) return null;
        return (
          <section key={g.key} className="mb-6">
            <h3 className="text-sm font-semibold text-gray-800">{g.title} ({items.length})</h3>
            {g.help && <p className="text-xs text-gray-500 mb-2">{g.help}</p>}
            {items.map((item) => <EmailCard key={item.id} item={item} tone={g.tone} onChanged={refresh} />)}
          </section>
        );
      })}
      {data && !data.emails.length && <div className="text-sm text-gray-500">Nothing scheduled. Schedule an email by saying "schedule it" to Claude once you've agreed it.</div>}
    </div>
  );
}
