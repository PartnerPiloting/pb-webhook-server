'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Layout from '../../components/Layout';
import { getKrispReviewQueue, getKrispReviewEvent, saveKrispSpeakers, updateKrispStatus } from '../../services/api';
import { getCurrentClientId, buildAuthUrl } from '../../utils/clientUtils';

const STATUS_META: Record<string, { label: string; colour: string }> = {
  new:               { label: 'New',                 colour: 'bg-red-100 text-red-800 border-red-200' },
  speakers_verified: { label: 'Speakers verified',  colour: 'bg-amber-100 text-amber-800 border-amber-200' },
  skipped:           { label: 'Skipped',             colour: 'bg-gray-100 text-gray-500 border-gray-200' },
  ready:             { label: 'Legacy: ready',       colour: 'bg-slate-100 text-slate-700 border-slate-200' },
  linked:            { label: 'Legacy: linked',      colour: 'bg-slate-100 text-slate-700 border-slate-200' },
};

const EDITABLE_STATUSES = ['new', 'speakers_verified', 'skipped'] as const;

const QUEUE_FILTERS: { value: string; label: string }[] = [
  { value: 'new', label: 'New (not dealt with yet)' },
  { value: 'speakers_verified', label: 'Speakers verified' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'legacy', label: 'Legacy (old ready/linked)' },
  { value: 'all', label: 'Everything' },
];

function Badge({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META.new;
  return (
    <span className={`text-[11px] font-semibold uppercase tracking-wide border rounded px-2 py-0.5 ${m.colour}`}>
      {m.label}
    </span>
  );
}

function formatBrisbane(iso: string) {
  try { return new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
}

function formatDur(sec: number | null) {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ---------------------------------------------------------------------------
// Queue view
// ---------------------------------------------------------------------------
function QueueView({ onSelect }: { onSelect: (id: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('new');

  useEffect(() => {
    setLoading(true);
    getKrispReviewQueue(filter).then(r => {
      setRows(r.rows || []);
      setError(r.error || null);
    }).finally(() => setLoading(false));
  }, [filter]);

  const emptyMsg =
    filter === 'new'
      ? 'Nothing in the New queue — you’re caught up, or switch the filter above.'
      : filter === 'all'
        ? 'No transcripts stored yet.'
        : 'No rows match this filter.';

  if (loading) return <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>;
  if (error) return <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-4">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <label htmlFor="krisp-queue-filter" className="text-sm font-medium text-gray-700 shrink-0">
          Show
        </label>
        <select
          id="krisp-queue-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm max-w-md focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
        >
          {QUEUE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="text-gray-500 italic text-sm py-8 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50/80 px-4">{emptyMsg}</p>
      ) : (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <th className="px-4 py-3 text-left font-semibold">#</th>
            <th className="px-4 py-3 text-left font-semibold">When</th>
            <th className="px-4 py-3 text-left font-semibold">Meeting</th>
            <th className="px-4 py-3 text-left font-semibold">Status</th>
            <th className="px-4 py-3 text-left font-semibold">Speakers</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r: any) => {
            const title = r.meeting_title || r.event || '—';
            const dur = formatDur(r.duration_seconds ? Number(r.duration_seconds) : null);
            return (
              <tr key={r.id} className="hover:bg-violet-50/40 transition-colors">
                <td className="px-4 py-3 font-mono text-gray-500">{r.id}</td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatBrisbane(r.received_at)}</td>
                <td className="px-4 py-3">
                  <span className="text-gray-900">{title}</span>
                  {dur && <span className="text-gray-400 ml-1 text-xs">({dur})</span>}
                </td>
                <td className="px-4 py-3"><Badge status={r.status || 'new'} /></td>
                <td className="px-4 py-3 text-gray-500">{r.verified_speakers ? '✓' : '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => onSelect(String(r.id))} className="text-sm font-medium text-violet-700 hover:text-violet-900 hover:underline">
                    Review
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single event review
// ---------------------------------------------------------------------------
function EventReview({ eventId, onBack }: { eventId: string; onBack: () => void }) {
  const [ev, setEv] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [speakers, setSpeakers] = useState<Record<string, { name: string; email: string }>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    getKrispReviewEvent(eventId).then(r => {
      if (r.event) {
        setEv(r.event);
        const vs = r.event.verified_speakers || {};
        const init: Record<string, { name: string; email: string }> = {};
        for (const label of (r.event.speaker_labels || [])) {
          init[label] = { name: vs[label]?.name || '', email: vs[label]?.email || '' };
        }
        setSpeakers(init);
      }
      setError(r.error || null);
    }).finally(() => setLoading(false));
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const handleSaveSpeakers = async () => {
    setSaving(true);
    const r = await saveKrispSpeakers(eventId, speakers);
    setSaving(false);
    if (r.ok) { flash('Speakers saved'); load(); } else flash('Error: ' + (r.error || 'unknown'));
  };

  const handleStatus = async (st: string) => {
    if (!st || !EDITABLE_STATUSES.includes(st as (typeof EDITABLE_STATUSES)[number])) {
      flash('Choose a status');
      return;
    }
    const r = await updateKrispStatus(eventId, st);
    if (r.ok) { flash('Status updated'); load(); } else flash('Error: ' + (r.error || 'unknown'));
  };

  if (loading) return <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>;
  if (error || !ev) return <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-4">{error || 'Not found'}</p>;

  const labels: string[] = ev.speaker_labels || [];
  const calAttendees: { email: string; name: string }[] = ev.calendar_attendees || [];
  const st = ev.status || 'new';
  const fullText: string = ev.full_text || '';
  const verified = ev.verified_speakers || {};

  const transcriptHtml = fullText.split('\n').map((line: string, i: number) => {
    const m = line.match(/^(Speaker\s*\d+|[^:]{1,40}):\s/);
    if (m) {
      const label = m[1].trim();
      const vName = verified[label]?.name;
      const display = vName || label;
      const rest = line.slice(m[0].length);
      return (
        <div key={i} className="mb-1">
          <span className="font-semibold text-violet-800" title={label}>{display}:</span>{' '}
          <span>{rest}</span>
        </div>
      );
    }
    return <div key={i} className="mb-1">{line}</div>;
  });

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm text-violet-700 hover:underline">&larr; Back to queue</button>

      <div>
        <h2 className="text-xl font-bold text-gray-900">{ev.title}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {formatBrisbane(ev.received_at)}
          {ev.duration ? ` · ${formatDur(ev.duration)}` : ''}
          {' · #'}{ev.id}{' · '}
          <Badge status={st} />
        </p>
      </div>

      {/* Speakers */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Verify speakers</h3>
        {labels.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No speaker labels detected in transcript.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-x-3 gap-y-2 items-center text-sm">
              <div className="text-xs text-gray-500 uppercase font-semibold">Label</div>
              <div className="text-xs text-gray-500 uppercase font-semibold">Name</div>
              <div className="text-xs text-gray-500 uppercase font-semibold">Email</div>
              <div className="text-xs text-gray-500 uppercase font-semibold">Suggest</div>
              {labels.map(label => (
                <React.Fragment key={label}>
                  <div className="font-medium text-gray-700">{label}</div>
                  <input
                    type="text"
                    value={speakers[label]?.name || ''}
                    onChange={e => setSpeakers(s => ({ ...s, [label]: { ...s[label], name: e.target.value } }))}
                    placeholder="Real name"
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                  />
                  <input
                    type="email"
                    value={speakers[label]?.email || ''}
                    onChange={e => setSpeakers(s => ({ ...s, [label]: { ...s[label], email: e.target.value } }))}
                    placeholder="Email (optional)"
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                  />
                  <div className="flex gap-1 flex-wrap">
                    {calAttendees.length > 0 ? calAttendees.map(a => (
                      <button
                        key={a.email}
                        type="button"
                        onClick={() => setSpeakers(s => ({ ...s, [label]: { name: a.name || a.email, email: a.email } }))}
                        className="text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded px-2 py-0.5 hover:bg-violet-100"
                      >
                        {a.name || a.email}
                      </button>
                    )) : <span className="text-xs text-gray-400">—</span>}
                  </div>
                </React.Fragment>
              ))}
            </div>
            <button
              onClick={handleSaveSpeakers}
              disabled={saving}
              className="mt-2 px-5 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save speakers'}
            </button>
          </div>
        )}
      </div>

      {/* Transcript */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Transcript</h3>
        <div className="max-h-[500px] overflow-y-auto text-sm text-gray-700 leading-relaxed font-sans">
          {transcriptHtml}
        </div>
      </div>

      {/* Status */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Status</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={(['ready', 'linked'] as string[]).includes(st) ? '' : st}
            onChange={e => handleStatus(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
          >
            {(['ready', 'linked'] as string[]).includes(st) && (
              <option value="" disabled>
                {(STATUS_META[st]?.label || st)} — choose a status below
              </option>
            )}
            {EDITABLE_STATUSES.map((k) => (
              <option key={k} value={k}>{STATUS_META[k].label}</option>
            ))}
          </select>
          <button
            onClick={() => { if (confirm('Skip this transcript?')) handleStatus('skipped'); }}
            className="text-sm text-red-600 hover:text-red-800 hover:underline"
          >
            Skip
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-50 animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
function KrispReviewContent() {
  const searchParams = useSearchParams();
  const reviewIdFromUrl = searchParams.get('reviewId');
  const [selectedId, setSelectedId] = useState<string | null>(reviewIdFromUrl || null);
  const clientId = getCurrentClientId();
  const isGuy = clientId === 'Guy-Wilson';

  if (!isGuy) {
    return (
      <Layout>
        <div className="py-12 text-center text-gray-500">
          <p>This page is only available for Guy Wilson.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto py-6 px-4 sm:px-6">
        {!selectedId ? (
          <>
            <div className="mb-5">
              <h1 className="text-2xl font-bold text-gray-900">Transcript Review Queue</h1>
              <p className="text-sm text-gray-500 mt-1">
                Defaults to <strong>New</strong> only so the list stays short. Use the filter to see other rows. Newest first.
              </p>
            </div>
            <QueueView onSelect={setSelectedId} />
          </>
        ) : (
          <EventReview eventId={selectedId} onBack={() => setSelectedId(null)} />
        )}
      </div>
    </Layout>
  );
}

export default function KrispReviewPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-gray-500">Loading…</div>}>
      <KrispReviewContent />
    </Suspense>
  );
}
